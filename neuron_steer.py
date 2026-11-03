#!/usr/bin/env python3
"""
neuron_steer.py -- 推理时干预残差流，给模型换人格。

两种粒度：
  1) 神经元级：给某一层 MLP 的第 j 个中间值加常数偏移
     residual += delta * down_proj.weight[:, j]
  2) 方向级（更好玩）：用对比提示词算出一个"人格方向"向量
     residual += alpha * ||residual|| * v

不改任何权重，退出即恢复。

用法
----
  # 复现社区配方
  python neuron_steer.py chat --steer 14:8949:+1.0 13:7956:-1.0

  # 造一个人格方向（同一批提示词，只改语气要求）
  python neuron_steer.py trait --name evil --pairs traits/evil.json --layer 14

  # 带人格聊天
  python neuron_steer.py chat --trait evil --alpha 1.0

  # 扫剂量找边界
  python neuron_steer.py sweep --trait evil --alphas 0 0.5 1.0 1.5 2.0

  # 自己找神经元
  python neuron_steer.py scan --layers 10 13 14 17
"""

import argparse
import json
import sys
from pathlib import Path

import torch
import transformers
from transformers import AutoProcessor, AutoTokenizer

DEFAULT_MODEL = "Qwen/Qwen3.5-4B"
LOCAL_MODEL = Path("D:/AI/LLM/models/Qwen3.5-4B")
TRAIT_DIR = Path(__file__).resolve().parent / "traits"
CALIB_TEXT = (
    "The residual stream is the shared highway of a transformer. "
    "每一层都从这条通道里读取信息，再把计算结果加回去。"
)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- 模型与层定位

def _try(cls_name, model_id, **kw):
    cls = getattr(transformers, cls_name, None)
    if cls is None:
        return None
    try:
        return cls.from_pretrained(model_id, **kw)
    except Exception as e:
        log(f"  {cls_name} 加载失败: {type(e).__name__}: {str(e)[:160]}")
        return None


def load_model(model_id, dtype="bf16"):
    if model_id == DEFAULT_MODEL and LOCAL_MODEL.exists():
        model_id = str(LOCAL_MODEL)
    dt = torch.bfloat16 if dtype == "bf16" else torch.float16
    kw = dict(device_map="cuda", low_cpu_mem_usage=True)

    model = None
    for name in ("AutoModelForImageTextToText", "AutoModelForCausalLM",
                 "Qwen3_5ForConditionalGeneration", "AutoModel"):
        cls = getattr(transformers, name, None)
        if cls is None:
            continue
        for dt_kw in ({"dtype": dt}, {"torch_dtype": dt}):
            try:
                model = cls.from_pretrained(model_id, **kw, **dt_kw)
                log(f"用 {name} 加载（{list(dt_kw)[0]}）")
                break
            except TypeError:
                continue
            except Exception as e:
                log(f"  {name} 失败: {type(e).__name__}: {str(e)[:140]}")
                break
        if model is not None:
            break
    if model is None:
        raise SystemExit("所有自动加载类都失败，检查 transformers 版本是否支持 qwen3_5")
    model.eval()

    try:
        proc = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
        tok = getattr(proc, "tokenizer", None) or proc
    except Exception:
        proc, tok = None, AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)

    cfg = getattr(model.config, "text_config", model.config)
    path, layers = find_layers(model)
    log(f"层路径 {path}  共 {len(layers)} 层  hidden={cfg.hidden_size}  "
        f"intermediate={cfg.intermediate_size}")
    return tok, proc, model, layers, cfg


def find_layers(model):
    for path in ("model.layers", "model.language_model.layers", "language_model.model.layers",
                 "language_model.layers", "model.decoder.layers", "transformer.h"):
        obj, ok = model, True
        for part in path.split("."):
            if hasattr(obj, part):
                obj = getattr(obj, part)
            else:
                ok = False
                break
        if ok and hasattr(obj, "__len__") and len(obj) and hasattr(obj[0], "mlp"):
            return path, obj
    raise SystemExit("找不到 transformer 层列表，把 model 结构打印出来看看")


# ---------------------------------------------------------------- 剂量换算

@torch.no_grad()
def residual_norm(model, tok, layer):
    enc = tok(CALIB_TEXT, return_tensors="pt", truncation=True, max_length=256).to(model.device)
    hs = model(**enc, output_hidden_states=True).hidden_states
    return float(hs[layer + 1].float().norm(dim=-1).median())


# ---------------------------------------------------------------- 神经元注入

def hook_neuron(layers, specs, norms):
    handles = []
    for L, j, dose in specs:
        down = layers[L].mlp.down_proj
        col = down.weight[:, j].detach().float()
        delta = dose * norms[L] / float(col.norm())

        def h(module, args, delta=delta, j=j):
            x = args[0]
            x[..., j] = x[..., j] + delta
            return args

        handles.append(down.register_forward_pre_hook(h))
        log(f"  神经元 L{L} N{j}  dose={dose:+.2f}  delta={delta:+.4f}")
    return handles


# ---------------------------------------------------------------- 方向注入

def hook_direction(layers, layer, vec, alpha, scale):
    dev = next(layers[layer].parameters()).device
    v = (vec.float() * (alpha * scale)).to(device=dev, dtype=torch.bfloat16).view(1, 1, -1)

    def h(module, args, output):
        if isinstance(output, tuple):
            return (output[0] + v,) + output[1:]
        return output + v

    handle = layers[layer].register_forward_hook(h)
    log(f"  方向 L{layer}  alpha={alpha:+.2f}  |inject|={alpha * scale:.2f}")
    return [handle]


# ---------------------------------------------------------------- 生成

@torch.no_grad()
def generate(model, tok, prompt, max_new_tokens=200, temperature=0.7, thinking=False):
    msgs = [{"role": "user", "content": prompt}]
    text = None
    for kw in ({"enable_thinking": thinking}, {}):
        try:
            text = tok.apply_chat_template(
                msgs, tokenize=False, add_generation_prompt=True, **kw)
            break
        except (TypeError, ValueError):
            continue
    enc = tok(text, return_tensors="pt", add_special_tokens=False).to(model.device)
    out = model.generate(
        **enc, max_new_tokens=max_new_tokens,
        do_sample=temperature > 0, temperature=max(temperature, 1e-5),
        top_p=0.9, repetition_penalty=1.05,
        pad_token_id=tok.eos_token_id or 0,
    )
    return tok.decode(out[0][enc["input_ids"].shape[1]:], skip_special_tokens=True).strip()


# ---------------------------------------------------------------- 人格方向

@torch.no_grad()
def capture_last(layers, layer, tok, model, texts):
    buf = []
    handle = layers[layer].register_forward_hook(
        lambda m, a, o: buf.append(
            (o[0] if isinstance(o, tuple) else o)[:, -1, :].float().cpu()))
    for t in texts:
        enc = tok(t, return_tensors="pt", truncation=True, max_length=256).to(model.device)
        model(**enc)
    handle.remove()
    return torch.cat(buf, 0)


def build_trait(layers, layer, tok, model, pairs):
    pos = capture_last(layers, layer, tok, model, pairs["target"])
    neg = capture_last(layers, layer, tok, model, pairs["neutral"])
    v = pos.mean(0) - neg.mean(0)
    return v / v.norm()


def cmd_trait(args):
    tok, proc, model, layers, cfg = load_model(args.model, args.dtype)
    with open(args.pairs, encoding="utf-8") as f:
        pairs = json.load(f)
    log(f"对比提示词 {len(pairs['target'])} 正 / {len(pairs['neutral'])} 负，层 {args.layer}")
    v = build_trait(layers, args.layer, tok, model, pairs)
    TRAIT_DIR.mkdir(exist_ok=True)
    out = TRAIT_DIR / f"{args.name}.pt"
    torch.save({"vec": v, "layer": args.layer, "name": args.name, "dim": v.numel()}, out)
    log(f"已保存 {out}  (dim={v.numel()})")


def load_trait(name):
    p = TRAIT_DIR / f"{name}.pt"
    if not p.exists():
        raise SystemExit(f"没有 {p}，先跑 trait 模式生成")
    d = torch.load(p, map_location="cpu", weights_only=False)
    return d["vec"], d["layer"]


# ---------------------------------------------------------------- 模式

def cmd_chat(args):
    tok, proc, model, layers, cfg = load_model(args.model, args.dtype)
    handles = []
    if args.steer:
        norms = {L: residual_norm(model, tok, L) for L in {s[0] for s in args.steer}}
        log("注入：")
        handles += hook_neuron(layers, args.steer, norms)
    if args.trait:
        vec, layer = load_trait(args.trait)
        log("注入：")
        handles += hook_direction(layers, layer, vec, args.alpha,
                                  residual_norm(model, tok, layer))

    if args.once:
        print(generate(model, tok, args.once, args.max_new_tokens,
                       args.temperature, args.thinking))
        for h in handles:
            h.remove()
        return

    print("\n输入问题对话，/quit 退出\n")
    while True:
        try:
            q = input("你> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not q:
            continue
        if q in ("/quit", "/exit"):
            break
        print("\n模型> " + generate(model, tok, q, args.max_new_tokens,
                                    args.temperature, args.thinking) + "\n")
    for h in handles:
        h.remove()


def cmd_sweep(args):
    tok, proc, model, layers, cfg = load_model(args.model, args.dtype)
    for a in args.alphas:
        if args.neuron:
            L, j = args.neuron
            handles = hook_neuron(layers, [(L, j, a)], {L: residual_norm(model, tok, L)})
            label = f"L{L} N{j}"
        else:
            vec, layer = load_trait(args.trait)
            handles = hook_direction(layers, layer, vec, a,
                                     residual_norm(model, tok, layer))
            label = f"trait={args.trait}"
        out = generate(model, tok, args.prompt, args.max_new_tokens, args.temperature)
        for h in handles:
            h.remove()
        print("=" * 72)
        print(f"{label}  alpha={a:+.2f}")
        print("-" * 72)
        print(out[:800] + "\n")


def cmd_scan(args):
    tok, proc, model, layers, cfg = load_model(args.model, args.dtype)
    with open(args.pairs, encoding="utf-8") as f:
        pairs = json.load(f)
    log(f"扫描层 {args.layers}，正/负样本 {len(pairs['target'])}/{len(pairs['neutral'])}")

    def means(texts, L):
        buf = []
        h = layers[L].mlp.down_proj.register_forward_pre_hook(
            lambda m, a, L=L: buf.append(a[0].float().mean(dim=1).cpu()))
        for t in texts:
            enc = tok(t, return_tensors="pt", truncation=True, max_length=256).to(model.device)
            model(**enc)
        h.remove()
        return torch.cat(buf, 0)

    rows = []
    for L in args.layers:
        pos, neg = means(pairs["target"], L), means(pairs["neutral"], L)
        sd = torch.cat([pos, neg], 0).std(0) + 1e-3
        score = (pos.mean(0) - neg.mean(0)) / sd
        vals, idx = score.abs().topk(min(args.topk, score.numel()))
        for v, i in zip(vals.tolist(), idx.tolist()):
            rows.append((L, i, score[i].item(), v))

    rows.sort(key=lambda r: -r[3])
    print(f"\n{'layer':>6} {'neuron':>8} {'score':>8} {'建议':>8}")
    print("-" * 34)
    for L, j, s, _ in rows[: args.topk]:
        print(f"{L:>6} {j:>8} {s:>+8.2f} {'+1.0' if s > 0 else '-1.0':>8}")


# ---------------------------------------------------------------- CLI

def cmd_info(args):
    tok, proc, model, layers, cfg = load_model(args.model, args.dtype)
    mlp = layers[0].mlp
    print(f"\n层数        {len(layers)}")
    print(f"hidden      {cfg.hidden_size}")
    print(f"intermediate {cfg.intermediate_size}")
    print(f"MLP 类型    {mlp.__class__.__name__}")
    print(f"down_proj   {tuple(mlp.down_proj.weight.shape)}  ({mlp.down_proj.weight.dtype})")
    print(f"显存        {torch.cuda.memory_allocated() / 2 ** 30:.2f} GiB")
    print(f"\n基线输出    {generate(model, tok, '介绍一下你自己。', 60)!r}\n")


def parse_spec(s):
    p = s.split(":")
    if len(p) != 3:
        raise argparse.ArgumentTypeError(f"要 层:神经元:剂量，例如 14:8949:+1.0（收到 {s}）")
    return int(p[0]), int(p[1]), float(p[2])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--dtype", default="bf16", choices=["bf16", "fp16"])
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("chat")
    c.add_argument("--steer", type=parse_spec, nargs="+")
    c.add_argument("--trait")
    c.add_argument("--alpha", type=float, default=1.0)
    c.add_argument("--max-new-tokens", type=int, default=200)
    c.add_argument("--temperature", type=float, default=0.7)
    c.add_argument("--thinking", action="store_true")
    c.add_argument("--once", help="只跑一句就退出")
    c.set_defaults(func=cmd_chat)

    s = sub.add_parser("sweep")
    s.add_argument("--neuron", type=lambda x: tuple(int(v) for v in x.split(":")))
    s.add_argument("--trait")
    s.add_argument("--alphas", type=float, nargs="+",
                   default=[-1.0, 0.0, 0.5, 1.0, 1.5, 2.0])
    s.add_argument("--prompt", default="我明天要去新公司报到，有点紧张，给我点建议。")
    s.add_argument("--max-new-tokens", type=int, default=150)
    s.add_argument("--temperature", type=float, default=0.7)
    s.set_defaults(func=cmd_sweep)

    t = sub.add_parser("trait")
    t.add_argument("--name", required=True)
    t.add_argument("--pairs", required=True)
    t.add_argument("--layer", type=int, default=14)
    t.set_defaults(func=cmd_trait)

    k = sub.add_parser("scan")
    k.add_argument("--layers", type=int, nargs="+", default=[10, 13, 14, 17])
    k.add_argument("--pairs", default="pairs.json")
    k.add_argument("--topk", type=int, default=25)
    k.set_defaults(func=cmd_scan)

    i = sub.add_parser("info")
    i.set_defaults(func=cmd_info)

    args = ap.parse_args()
    if not torch.cuda.is_available():
        log("警告：没有 CUDA，会跑在 CPU 上，非常慢")
    args.func(args)


if __name__ == "__main__":
    main()
