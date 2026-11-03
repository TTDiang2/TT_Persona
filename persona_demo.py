#!/usr/bin/env python3
"""
persona_demo.py -- 一次加载模型，把多个人格方向在同样的问题上并排跑出来。

  python persona_demo.py --traits evil warm chaotic terse poetic noir --alpha 1.0
  python persona_demo.py --traits evil --alpha 1.5 --prompts "介绍一下你自己。"

没生成过的方向会自动从 traits/<name>.json 现算一个。
"""

import argparse
import json
from pathlib import Path

import torch

import neuron_steer as ns

DEFAULT_PROMPTS = [
    "介绍一下你自己。",
    "我明天要去新公司报到，有点紧张，给我点建议。",
    "2 加 2 等于几？",
    "讲个笑话。",
]


def get_trait(name, tok, model, layers, layer, rebuild=False):
    p = ns.TRAIT_DIR / f"{name}.pt"
    if p.exists() and not rebuild:
        return ns.load_trait(name)
    src = ns.TRAIT_DIR / f"{name}.json"
    if not src.exists():
        raise SystemExit(f"缺少 {src}")
    pairs = json.loads(src.read_text(encoding="utf-8"))
    ns.log(f"[build] {name}  (L{layer}, {len(pairs['target'])} 对)")
    v = ns.build_trait(layers, layer, tok, model, pairs)
    torch.save({"vec": v, "layer": layer, "name": name, "dim": v.numel()}, p)
    return v, layer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=ns.DEFAULT_MODEL)
    ap.add_argument("--traits", nargs="+",
                    default=["evil", "warm", "chaotic", "terse", "poetic", "noir"])
    ap.add_argument("--alpha", type=float, default=0.8)
    ap.add_argument("--layer", type=int, default=18)
    ap.add_argument("--prompts", nargs="+", default=DEFAULT_PROMPTS)
    ap.add_argument("--max-new-tokens", type=int, default=90)
    ap.add_argument("--temperature", type=float, default=0.7)
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()

    tok, proc, model, layers, cfg = ns.load_model(args.model)

    traits = {}
    for name in args.traits:
        vec, layer = get_trait(name, tok, model, layers, args.layer, args.rebuild)
        traits[name] = (vec, layer, ns.residual_norm(model, tok, layer))

    for prompt in args.prompts:
        print("\n" + "#" * 76)
        print(f"# 提问：{prompt}")
        print("#" * 76)
        out = ns.generate(model, tok, prompt, args.max_new_tokens, args.temperature)
        print(f"\n[baseline]\n{out}")

        for name, (vec, layer, scale) in traits.items():
            handles = ns.hook_direction(layers, layer, vec, args.alpha, scale)
            out = ns.generate(model, tok, prompt, args.max_new_tokens, args.temperature)
            for h in handles:
                h.remove()
            print(f"\n[{name} α={args.alpha:+.1f}]\n{out}")


if __name__ == "__main__":
    main()
