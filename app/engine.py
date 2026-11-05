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


def _has_ffn(layer):
    """这一层是否带前馈模块（dense 的 mlp，或者 MoE 的 moe / feed_forward）"""
    return any(hasattr(layer, a) for a in ("mlp", "moe", "feed_forward"))


def dense_mlp(layer):
    """取出可做神经元干预的 dense MLP；MoE 层返回 None"""
    for attr in ("mlp", "feed_forward"):
        ff = getattr(layer, attr, None)
        if ff is not None and hasattr(ff, "down_proj"):
            return ff
    return None


class Engine:
    def __init__(self):
        self.tok = None
        self.model = None
        self.layers = None
        self.cfg = None
        self.device = None
        self.state = "idle"          # idle | loading | ready | error
        self.model_name = MODEL_ID.split("/")[-1]
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
            # 显示名跟着实际加载的来源走：本地目录取目录名，HF 仓库取仓库名
            self.model_name = (Path(model_id).name if Path(model_id).exists()
                               else model_id.split("/")[-1])
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
            if ok and hasattr(obj, "__len__") and len(obj) and _has_ffn(obj[0]):
                return obj
        raise RuntimeError("找不到层列表")

    def require(self):
        if self.state != "ready":
            raise RuntimeError(f"模型未就绪（{self.state}）")

    def supports_neuron(self):
        """神经元模式需要每层都有一个 dense down_proj；MoE 模型给不了"""
        if not self.layers:
            return False, "模型尚未就绪"
        if dense_mlp(self.layers[0]) is None:
            n = getattr(self.cfg, "num_experts", None)
            tag = f"（{n} 个专家）" if n else ""
            return False, f"这个模型是 MoE 结构{tag}，专家层里没有统一的 down_proj。神经元模式请改用「人格方向」"
        return True, ""

    # ------------------------------------------------------------ 状态

    def status(self):
        st = {
            "state": self.state,
            "error": self.error,
            "busy": self.lock.locked(),
            "layers": len(self.layers) if self.layers else 0,
            "hidden": getattr(self.cfg, "hidden_size", 0),
            "intermediate": getattr(self.cfg, "intermediate_size", 0),
            "model": self.model_name,
            "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        }
        ok, why = self.supports_neuron()
        st["supports_neuron"] = ok
        st["neuron_hint"] = why
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

        elif injection["mode"] == "mix":
            items = injection.get("items", [])
            layer = int(injection.get("layer") or 18)
            alpha = float(injection.get("alpha", 0.8))
            parts = []
            for it in items:
                v, _ = self.load_vector(it["trait"])   # 维度校验在 load_vector 里做
                parts.append(v * float(it.get("weight", 1.0)))
            vec = torch.stack(parts).sum(0)
            vec = vec / vec.norm()
            scale = self.residual_norm(layer)
            dev = next(self.layers[layer].parameters()).device
            v = (vec.float() * alpha * scale).to(device=dev, dtype=torch.bfloat16).view(1, 1, -1)

            def h(module, args, output):
                if isinstance(output, tuple):
                    return (output[0] + v,) + output[1:]
                return output + v

            handles.append(self.layers[layer].register_forward_hook(h))
            desc = " + ".join(f"{it['trait']}×{float(it.get('weight', 1.0)):.1f}" for it in items)
            desc += f" · L{layer} · α={alpha:.2f}"

        elif injection["mode"] == "multi":
            # 每个人格注入它自己的采集层，权重 × alpha 作为强度
            alpha = float(injection.get("alpha", 0.8))
            items = injection.get("items", [])
            # 权重归一：保证 α 和单人格模式的剂量语义一致，避免叠加推爆
            total = sum(max(0.0, float(it.get("weight", 1.0))) for it in items) or 1.0
            for it in items:
                vec, layer = self.load_vector(it["trait"])
                w = float(it.get("weight", 1.0)) / total
                scale = self.residual_norm(layer)
                dev = next(self.layers[layer].parameters()).device
                v = (vec.float() * (w * alpha) * scale).to(device=dev, dtype=torch.bfloat16).view(1, 1, -1)

                def h(module, args, output, v=v):
                    if isinstance(output, tuple):
                        return (output[0] + v,) + output[1:]
                    return output + v

                handles.append(self.layers[layer].register_forward_hook(h))
            desc = " + ".join(f"{it['trait']}×{float(it.get('weight', 1.0)):.1f}" for it in injection.get("items", []))
            desc += f" · 各自层 · α={alpha:.2f}"

        elif injection["mode"] == "neuron":
            for spec in injection.get("specs", []):
                L, j = int(spec["layer"]), int(spec["neuron"])
                op = spec.get("op", "add")
                dose = float(spec.get("dose", 1.0))
                mlp = dense_mlp(self.layers[L])
                if mlp is None:
                    raise RuntimeError(self.supports_neuron()[1])
                down = mlp.down_proj
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
        hidden = int(getattr(self.cfg, "hidden_size", 0) or 0)
        dim = int(d["vec"].numel())
        if hidden and dim != hidden:
            raise RuntimeError(
                f"「{name}」是 {dim} 维向量，当前模型是 {hidden} 维。"
                f"换模型后人格需要重建：人格库 → 重建全部")
        return d["vec"], int(d["layer"])

    @torch.no_grad()
    def build_trait(self, pairs, layer):
        self.require()
        with self.lock:
            return self._build_trait(pairs, layer)

    @torch.no_grad()
    def _build_trait(self, pairs, layer):

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
    def probe_layers(self, pairs, layers, alpha=0.7, prompt="介绍一下你自己。",
                     max_tokens=60):
        """在多个层各建一次向量、各生成一句，用来看哪层最对味。不落库。"""
        self.require()
        with self.lock:
            return self._probe_layers(pairs, layers, alpha, prompt, max_tokens)

    @torch.no_grad()
    def _probe_layers(self, pairs, layers, alpha, prompt, max_tokens):
        # 1) 一次前向把所有层的最后 token 激活都抓下来
        #    （逐层调 build_trait 会让同样的提示词重复跑 N 遍）
        caps = {L: [] for L in layers}
        handles = []
        for L in layers:
            def h(module, args, output, L=L):
                x = output[0] if isinstance(output, tuple) else output
                caps[L].append(x[:, -1, :].float().cpu())
            handles.append(self.layers[L].register_forward_hook(h))
        try:
            for group in ("target", "neutral"):
                for t in pairs[group]:
                    enc = self.tok(t, return_tensors="pt", truncation=True,
                                   max_length=256).to(self.device)
                    self.model(**enc)
        finally:
            for h in handles:
                h.remove()

        n = len(pairs["target"])
        vecs = {}
        for L in layers:
            acts = torch.cat(caps[L], 0)
            v = acts[:n].mean(0) - acts[n:].mean(0)
            vecs[L] = v / v.norm()

        # 2) 逐层生成一句
        out = []
        for L in layers:
            scale = self.residual_norm(L)
            dev = next(self.layers[L].parameters()).device
            v = (vecs[L].float() * alpha * scale).to(device=dev, dtype=torch.bfloat16).view(1, 1, -1)

            def h(module, args, output, v=v):
                if isinstance(output, tuple):
                    return (output[0] + v,) + output[1:]
                return output + v

            handle = self.layers[L].register_forward_hook(h)
            t0 = time.time()
            try:
                text = self._render([{"role": "user", "content": prompt}], False)
                enc = self.tok(text, return_tensors="pt",
                               add_special_tokens=False).to(self.device)
                ids = self.model.generate(
                    **enc, max_new_tokens=max_tokens, do_sample=True,
                    temperature=0.7, top_p=0.9, repetition_penalty=1.05,
                    pad_token_id=self.tok.eos_token_id or 0)
                reply = self.tok.decode(ids[0][enc["input_ids"].shape[1]:],
                                        skip_special_tokens=True).strip()
            finally:
                handle.remove()
            out.append({"layer": L, "text": reply, "seconds": round(time.time() - t0, 2)})
        return {"prompt": prompt, "alpha": alpha, "results": out}

    @torch.no_grad()
    def scan_causal(self, layer, prompt, dose=1.0, sample=300, topk=12):
        """因果扫描：逐个推动神经元，看下一 token 分布被改了多少（KL）。

        相关性（激活差）找不出东西时，这个能。代价是每个神经元一次前向。
        """
        self.require()
        with self.lock:
            enc = self.tok(prompt, return_tensors="pt", truncation=True,
                           max_length=256).to(self.device)
            base_logp = torch.log_softmax(
                self.model(**enc).logits[0, -1, :].float(), -1)
            base_p = base_logp.exp()

            down = self.layers[layer].mlp.down_proj
            n = down.weight.shape[1]
            k = min(sample, n)
            idxs = torch.randperm(n)[:k].tolist()
            scale = self.residual_norm(layer)
            rows = []

            for j in idxs:
                col = down.weight[:, j].detach().float()
                delta = dose * scale / float(col.norm())

                def h(module, args, delta=delta, j=j):
                    x = args[0]
                    x[..., j] = x[..., j] + delta
                    return args

                handle = down.register_forward_pre_hook(h)
                try:
                    lg = torch.log_softmax(
                        self.model(**enc).logits[0, -1, :].float(), -1)
                finally:
                    handle.remove()
                kl = float((base_p * (base_logp - lg)).sum())
                rows.append({"neuron": j, "kl": round(kl, 5)})

            rows.sort(key=lambda r: -r["kl"])
            return {"layer": layer, "sample": k, "scanned": n, "results": rows[:topk]}

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
