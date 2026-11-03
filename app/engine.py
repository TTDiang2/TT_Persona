"""
engine.py -- 常驻模型 + 两种注入 + 流式生成 + 神经元扫描。

只做一件事：把 neuron_steer.py 里验证过的机制包装成服务端可调用的对象。
"""

import base64
import json
import os
import threading
import time
from pathlib import Path

import torch
import transformers
from transformers import AutoProcessor, TextIteratorStreamer

ROOT = Path(__file__).resolve().parent.parent
TRAIT_DIR = ROOT / "traits"
DATA_DIR = Path(__file__).resolve().parent / "data"
# 本地权重目录（可用环境变量覆盖）；不存在时自动回落到 HF 仓库下载
MODEL_DIR = Path(os.environ.get("TT_MODEL_DIR", "D:/AI/LLM/models/Qwen3.5-4B"))
MODEL_ID = os.environ.get("TT_MODEL_ID", "Qwen/Qwen3.5-4B")
CALIB_TEXT = (
    "The residual stream is the shared highway of a transformer. "
    "每一层都从这条通道里读取信息，再把计算结果加回去。"
)


def log(*a):
    print("[engine]", *a, flush=True)


class Engine:
    def __init__(self):
        self.tok = None
        self.model = None
        self.layers = None
        self.cfg = None
        self.device = None
        self.state = "idle"          # idle | loading | ready | error
        self.error = ""
        self.lock = threading.Lock()  # 单卡串行
        self.norms = {}
        self.tokens_generated = 0
        self.gen_seconds = 0.0
        TRAIT_DIR.mkdir(exist_ok=True)
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ 加载

    def load_async(self):
        if self.state in ("loading", "ready"):
            return
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        self.state = "loading"
        t0 = time.time()
        try:
            model_id = str(MODEL_DIR) if MODEL_DIR.exists() else MODEL_ID
            self.tok_proc = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
            self.tok = self.tok_proc.tokenizer
            self.model = None
            for name in ("AutoModelForImageTextToText", "AutoModelForCausalLM"):
                cls = getattr(transformers, name, None)
                if cls is None:
                    continue
                try:
                    self.model = cls.from_pretrained(
                        model_id, dtype=torch.bfloat16,
                        device_map="cuda", low_cpu_mem_usage=True)
                    break
                except Exception as e:
                    log(name, "失败", e)
            if self.model is None:
                raise RuntimeError("无法加载模型")
            self.model.eval()
            self.layers = self._find_layers()
            self.cfg = getattr(self.model.config, "text_config", self.model.config)
            self.device = next(self.model.parameters()).device
            self.state = "ready"
            log(f"模型就绪 {time.time() - t0:.1f}s  层数={len(self.layers)}")
        except Exception as e:
            self.state = "error"
            self.error = f"{type(e).__name__}: {e}"
            log("加载失败", self.error)

    def _find_layers(self):
        for path in ("model.layers", "model.language_model.layers",
                     "language_model.model.layers", "language_model.layers"):
            obj, ok = self.model, True
            for part in path.split("."):
                if hasattr(obj, part):
                    obj = getattr(obj, part)
                else:
                    ok = False
                    break
            if ok and hasattr(obj, "__len__") and len(obj) and hasattr(obj[0], "mlp"):
                return obj
        raise RuntimeError("找不到层列表")

    def require(self):
        if self.state != "ready":
            raise RuntimeError(f"模型未就绪（{self.state}）")

    # ------------------------------------------------------------ 状态

    def status(self):
        st = {
            "state": self.state,
            "error": self.error,
            "busy": self.lock.locked(),
            "layers": len(self.layers) if self.layers else 0,
            "hidden": getattr(self.cfg, "hidden_size", 0),
            "intermediate": getattr(self.cfg, "intermediate_size", 0),
            "model": MODEL_ID.split("/")[-1],
            "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        }
        if torch.cuda.is_available():
            st["vram_used"] = round(torch.cuda.memory_allocated() / 2 ** 30, 2)
            st["vram_total"] = round(torch.cuda.get_device_properties(0).total_memory / 2 ** 30, 1)
        if self.gen_seconds > 0:
            st["tok_per_s"] = round(self.tokens_generated / self.gen_seconds, 1)
        return st

    # ------------------------------------------------------------ 剂量

    @torch.no_grad()
    def residual_norm(self, layer):
        if layer in self.norms:
            return self.norms[layer]
        enc = self.tok(CALIB_TEXT, return_tensors="pt",
                       truncation=True, max_length=256).to(self.device)
        hs = self.model(**enc, output_hidden_states=True).hidden_states
        v = float(hs[layer + 1].float().norm(dim=-1).median())
        self.norms[layer] = v
        return v

    # ------------------------------------------------------------ 注入

    def install(self, injection):
        """返回 (handles, 描述字符串)"""
        handles, desc = [], ""
        if not injection or injection.get("mode") in (None, "none"):
            return handles, "baseline"

        if injection["mode"] == "trait":
            name = injection["trait"]
            vec, layer = self.load_vector(name)
            layer = int(injection.get("layer") or layer)
            alpha = float(injection.get("alpha", 0.8))
            scale = self.residual_norm(layer)
            dev = next(self.layers[layer].parameters()).device
            v = (vec.float() * alpha * scale).to(device=dev, dtype=torch.bfloat16).view(1, 1, -1)

            def h(module, args, output):
                if isinstance(output, tuple):
                    return (output[0] + v,) + output[1:]
                return output + v

            handles.append(self.layers[layer].register_forward_hook(h))
            desc = f"{name} · L{layer} · α={alpha:.2f}"

        elif injection["mode"] == "neuron":
            for spec in injection.get("specs", []):
                L, j = int(spec["layer"]), int(spec["neuron"])
                op = spec.get("op", "add")
                dose = float(spec.get("dose", 1.0))
                down = self.layers[L].mlp.down_proj
                if op == "zero":
                    def h(module, args, j=j):
                        x = args[0]
                        x[..., j] = 0.0
                        return args
                else:
                    col = down.weight[:, j].detach().float()
                    delta = dose * self.residual_norm(L) / float(col.norm())

                    def h(module, args, delta=delta, j=j):
                        x = args[0]
                        x[..., j] = x[..., j] + delta
                        return args
                handles.append(down.register_forward_pre_hook(h))
            parts = [f"L{s['layer']}N{s['neuron']}{s.get('op','add')[0]}{float(s.get('dose',0)):+.1f}"
                     for s in injection.get("specs", [])]
            desc = " ".join(parts)
        return handles, desc

    # ------------------------------------------------------------ 人格向量

    def vector_path(self, name):
        return TRAIT_DIR / f"{name}.pt"

    def load_vector(self, name):
        p = self.vector_path(name)
        if not p.exists():
            raise RuntimeError(f"人格 {name} 不存在")
        d = torch.load(p, map_location="cpu", weights_only=False)
        return d["vec"], int(d["layer"])

    @torch.no_grad()
    def build_trait(self, pairs, layer):
        self.require()

        def capture(texts):
            buf = []
            h = self.layers[layer].register_forward_hook(
                lambda m, a, o: buf.append(
                    (o[0] if isinstance(o, tuple) else o)[:, -1, :].float().cpu()))
            try:
                for t in texts:
                    enc = self.tok(t, return_tensors="pt", truncation=True,
                                   max_length=256).to(self.device)
                    self.model(**enc)
            finally:
                h.remove()
            return torch.cat(buf, 0)

        pos = capture(pairs["target"])
        neg = capture(pairs["neutral"])
        v = pos.mean(0) - neg.mean(0)
        return v / v.norm()

    # ------------------------------------------------------------ 生成

    def _render(self, messages, thinking):
        for kw in ({"enable_thinking": thinking}, {}):
            try:
                return self.tok.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True, **kw)
            except (TypeError, ValueError):
                continue
        return self.tok.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True)

    def stream(self, messages, injection, temperature=0.7, max_tokens=220, thinking=False):
        """生成器：yield (type, payload)"""
        self.require()
        acquired = self.lock.acquire(timeout=120)
        if not acquired:
            yield "error", "模型正忙，请稍候"
            return
        handles = []
        t0 = time.time()
        n_tok = 0
        try:
            text = self._render(messages, thinking)
            enc = self.tok(text, return_tensors="pt",
                           add_special_tokens=False).to(self.device)
            streamer = TextIteratorStreamer(self.tok, skip_prompt=True,
                                            skip_special_tokens=True, timeout=300)
            handles, desc = self.install(injection)
            yield "meta", {"injection": desc, "layer": injection.get("layer") if injection else None}

            kwargs = dict(
                **enc, streamer=streamer, max_new_tokens=max_tokens,
                do_sample=temperature > 0, temperature=max(temperature, 1e-5),
                top_p=0.9, repetition_penalty=1.05,
                pad_token_id=self.tok.eos_token_id or 0,
            )
            th = threading.Thread(target=self.model.generate, kwargs=kwargs, daemon=True)
            th.start()
            for chunk in streamer:
                if chunk:
                    n_tok += 1
                    yield "delta", chunk
            th.join(timeout=5)
            dt = max(time.time() - t0, 1e-3)
            self.tokens_generated += n_tok
            self.gen_seconds += dt
            yield "done", {"seconds": round(dt, 2), "tok_per_s": round(n_tok / dt, 1)}
        except Exception as e:
            yield "error", f"{type(e).__name__}: {e}"
        finally:
            for h in handles:
                h.remove()
            self.lock.release()

    # ------------------------------------------------------------ 扫描

    @torch.no_grad()
    def scan(self, pairs, layers, topk=20, bins=128):
        self.require()
        with self.lock:
            buf = {L: [] for L in layers}
            handles = []
            for L in layers:
                def h(module, args, L=L):
                    buf[L].append(args[0].float().mean(dim=1).cpu())
                handles.append(self.layers[L].mlp.down_proj.register_forward_pre_hook(h))
            try:
                for group in ("target", "neutral"):
                    for t in pairs[group]:
                        enc = self.tok(t, return_tensors="pt", truncation=True,
                                       max_length=256).to(self.device)
                        self.model(**enc)
            finally:
                for h in handles:
                    h.remove()

            n_pos = len(pairs["target"])
            results, heat = [], []
            for L in layers:
                acts = torch.cat(buf[L], 0)
                pos, neg = acts[:n_pos], acts[n_pos:]
                sd = torch.cat([pos, neg], 0).std(0) + 1e-3
                score = (pos.mean(0) - neg.mean(0)) / sd
                vals, idx = score.abs().topk(min(topk, score.numel()))
                for v, i in zip(vals.tolist(), idx.tolist()):
                    results.append({
                        "layer": L, "neuron": int(i),
                        "score": round(float(score[i]), 3),
                        "abs": round(float(v), 3),
                        "direction": "up" if score[i] > 0 else "down",
                    })
                # 下采样成热力图行
                n = score.numel()
                step = max(1, n // bins)
                row = []
                for b in range(bins):
                    seg = score[b * step:(b + 1) * step]
                    row.append(round(float(seg.abs().max()) if seg.numel() else 0.0, 2))
                heat.append({"layer": L, "values": row})

            results.sort(key=lambda r: -r["abs"])
            return {"results": results[: topk * len(layers)], "heatmap": heat,
                    "layers": layers, "bins": bins}

    @torch.no_grad()
    def inspect_neuron(self, layer, neuron, pairs):
        """这个神经元在哪些提示词上最活跃 —— 判断它到底在管什么"""
        self.require()
        with self.lock:
            buf = []

            def h(module, args, L=layer, j=neuron):
                buf.append(args[0][..., j].float().mean(dim=1).cpu())

            handle = self.layers[layer].mlp.down_proj.register_forward_pre_hook(h)
            try:
                rows = []
                for group in ("target", "neutral"):
                    for t in pairs[group]:
                        enc = self.tok(t, return_tensors="pt", truncation=True,
                                       max_length=256).to(self.device)
                        self.model(**enc)
                        rows.append({"text": t, "group": group,
                                     "act": round(float(buf[-1].item()), 2)})
            finally:
                handle.remove()
            col = self.layers[layer].mlp.down_proj.weight[:, neuron].detach().float()
            rows.sort(key=lambda r: -r["act"])
            return {"layer": layer, "neuron": neuron,
                    "col_norm": round(float(col.norm()), 3),
                    "rows": rows}


engine = Engine()
