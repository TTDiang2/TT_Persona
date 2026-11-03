#!/usr/bin/env python3
"""
tune_persona.py -- 从提示词对到可用人格，一步一屏地跑给你看。

  python app/tune_persona.py --pairs traits/flirty.json --name flirty --label 涩涩 \
      --layers 14 18 22 26 --alpha 0.7

它会：
  1. 在每个候选层各建一次向量（覆盖同名人格）
  2. 用同一句话试每个层，把输出并排打出来
  3. 停在最后一层，你在界面里微调即可

依赖：后端在 8791 跑着。
"""

import argparse
import json
import os
import sys
import urllib.request

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _req(path, body=None, method=None, base="http://127.0.0.1:8791", timeout=300):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method or ("POST" if data else "GET"),
        headers={"Content-Type": "application/json"})
    return opener.open(req, timeout=timeout)


def post(path, body, base):
    with _req(path, body, base=base) as r:
        return json.load(r)


def chat(injection, prompt, base, n=90):
    body = {"messages": [{"role": "user", "content": prompt}],
            "injection": injection, "temperature": 0.7,
            "max_tokens": n, "thinking": False}
    out = []
    with _req("/api/chat", body, base=base) as r:
        for raw in r:
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data:"):
                continue
            ev = json.loads(line[5:])
            if ev["type"] == "delta":
                out.append(ev["payload"])
            elif ev["type"] == "error":
                return f"[出错] {ev['payload']}"
    return "".join(out).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", required=True, help="提示词对 JSON")
    ap.add_argument("--name", required=True, help="人格文件名")
    ap.add_argument("--label", default="", help="显示名")
    ap.add_argument("--layers", type=int, nargs="+", default=[14, 18, 22, 26])
    ap.add_argument("--alpha", type=float, default=0.7)
    ap.add_argument("--color", default="#D4537E")
    ap.add_argument("--prompt", default="介绍一下你自己。")
    ap.add_argument("--save-layer", type=int, default=None,
                    help="跑完后把正式人格存到这一层；省略则只探测不落库")
    ap.add_argument("--base", default="http://127.0.0.1:8791")
    args = ap.parse_args()

    pairs = json.loads(open(args.pairs, encoding="utf-8").read())
    n = len(pairs["target"])
    print(f"\n提示词对：{n} 正 / {len(pairs['neutral'])} 负")
    if n != len(pairs["neutral"]):
        print("！正负数量不一致，先修提示词")
        return 1

    st = json.load(_req("/api/status", base=args.base))
    print(f"模型：{st['model']} · {st['layers']} 层 · hidden {st['hidden']}")

    probe = f"__probe_{args.name}"
    results = []
    for L in args.layers:
        print(f"\n{'=' * 66}\n第 {L} 层：建向量 → 试一句话\n{'-' * 66}")
        post("/api/personas", {
            "name": probe, "label": f"探测 L{L}",
            "layer": L, "alpha": args.alpha, "color": "#888780",
            "notes": "", "target": pairs["target"], "neutral": pairs["neutral"],
        }, args.base)
        out = chat({"mode": "trait", "trait": probe,
                    "alpha": args.alpha, "layer": L}, args.prompt, args.base)
        results.append((L, out))
        print(out[:300] if out else "(空)")
        print(f"[{len(out)} 字]")

    # 清掉探测用的人格，不污染人格库
    try:
        with _req(f"/api/personas/{probe}", method="DELETE", base=args.base) as r:
            r.read()
    except Exception as e:
        print(f"（清理探测人格失败：{e}，可在人格库里手动删掉 {probe}）")

    print(f"\n{'=' * 66}\n汇总：同一句话，不同层\n{'-' * 66}")
    for L, out in results:
        head = out[:52].replace("\n", " ") if out else "(空)"
        print(f"  L{L:<3} {len(out):>3} 字  {head}…")

    if args.save_layer:
        post("/api/personas", {
            "name": args.name, "label": args.label or args.name,
            "layer": args.save_layer, "alpha": args.alpha, "color": args.color,
            "notes": f"L{args.save_layer} · α {args.alpha}", 
            "target": pairs["target"], "neutral": pairs["neutral"],
        }, args.base)
        print(f"\n已存入人格库：{args.label or args.name} · L{args.save_layer} · α {args.alpha}")
    else:
        print(f"""
{'=' * 66}
挑一个你觉得对味的层，然后落库：
{'-' * 66}
  python app/tune_persona.py --pairs {args.pairs} --name {args.name} \
      --label {args.label or args.name} --layers {args.layers[0]} --save-layer <层号>
""")

    print(f"""
{'=' * 66}
下一步
{'-' * 66}
1. 打开 http://127.0.0.1:8791，在人格库里找到「{args.label or args.name}」
2. 调剂量：去实验台拖 α，0.6 / 0.8 / 1.0 各试一次，看哪档最稳
3. 把最终选定的层和 α 写进卡片备注
""")


if __name__ == "__main__":
    sys.exit(main() or 0)
