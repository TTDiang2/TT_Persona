#!/usr/bin/env python3
"""
verify.py -- 对运行中的 TT_Persona 做一次端到端自检。

  python app/verify.py
  python app/verify.py --base http://127.0.0.1:8791

只读接口为主，不改任何人格数据。全部通过时退出码 0。
"""

import argparse
import json
import sys
import time
import urllib.request

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _req(path, body=None, method=None, base="http://127.0.0.1:8791", timeout=180):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method or ("POST" if data else "GET"),
        headers={"Content-Type": "application/json"})
    return opener.open(req, timeout=timeout)


def get_json(path, base):
    with _req(path, base=base) as r:
        return json.load(r)


def post_json(path, body, base):
    with _req(path, body, base=base) as r:
        return json.load(r)


def stream_text(path, body, base):
    """读 SSE，返回 (拼接后的文本, meta 事件)"""
    text, meta = [], None
    with _req(path, body, base=base) as r:
        for raw in r:
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data:"):
                continue
            ev = json.loads(line[5:])
            if ev["type"] == "delta":
                text.append(ev["payload"])
            elif ev["type"] == "meta":
                meta = ev["payload"]
            elif ev["type"] == "error":
                raise RuntimeError(ev["payload"])
    return "".join(text).strip(), meta


RESULTS = []


def run(name, fn):
    t0 = time.time()
    try:
        detail = fn()
        RESULTS.append((True, name, detail, time.time() - t0))
    except Exception as e:
        RESULTS.append((False, name, f"{type(e).__name__}: {e}", time.time() - t0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8791")
    args = ap.parse_args()
    base = args.base

    state = {}

    def check_status():
        st = get_json("/api/status", base)
        if st.get("state") != "ready":
            raise RuntimeError(f"模型状态 {st.get('state')}：{st.get('error') or ''}")
        state["status"] = st
        return (f"{st['model']} · {st['layers']} 层 · hidden {st['hidden']} · "
                f"{st.get('vram_used')}/{st.get('vram_total')} GB")

    def check_personas():
        ps = get_json("/api/personas", base)
        if not ps:
            raise RuntimeError("人格库为空")
        state["personas"] = ps
        return f"{len(ps)} 个人格：{', '.join(p['name'] for p in ps[:5])}…"

    def check_chat():
        name = state["personas"][0]["name"]
        text, meta = stream_text("/api/chat", {
            "messages": [{"role": "user", "content": "用一句话介绍你自己。"}],
            "injection": {"mode": "trait", "trait": name, "alpha": 0.7, "layer": 18},
            "temperature": 0.7, "max_tokens": 40, "thinking": False,
        }, base)
        if not text:
            raise RuntimeError("流式输出为空")
        return f"{name} → {text[:40]}…"

    def check_scan():
        pairs = {"target": ["用傲慢的语气说：你好。", "用傲慢的语气回答：介绍一下你自己。"],
                 "neutral": ["用平常的语气说：你好。", "用平常的语气回答：介绍一下你自己。"]}
        res = post_json("/api/scan", {**pairs, "layers": [14, 18], "topk": 5}, base)
        if not res.get("results"):
            raise RuntimeError("扫描结果为空")
        state["scan"] = res
        return f"{len(res['results'])} 个候选，最高分 {res['results'][0]['score']:+.2f}"

    def check_neuron():
        st = state["status"]
        if not st.get("supports_neuron"):
            return f"跳过（{st.get('neuron_hint') or 'MoE 模型'}）"
        top = state["scan"]["results"][0]
        text, _ = stream_text("/api/chat", {
            "messages": [{"role": "user", "content": "介绍一下你自己。"}],
            "injection": {"mode": "neuron", "specs": [
                {"layer": top["layer"], "neuron": top["neuron"], "dose": 1.0}]},
            "temperature": 0.7, "max_tokens": 40, "thinking": False,
        }, base)
        if not text:
            raise RuntimeError("神经元注入后输出为空")
        return f"L{top['layer']} N{top['neuron']} → {text[:32]}…"

    run("模型就绪", check_status)
    if state.get("status"):
        run("人格库可读", check_personas)
    if state.get("personas"):
        run("流式生成", check_chat)
    if state.get("status"):
        run("神经元扫描", check_scan)
    if state.get("scan"):
        run("神经元注入", check_neuron)

    print()
    ok = True
    for passed, name, detail, dt in RESULTS:
        print(f"  {'PASS' if passed else 'FAIL'}  {name:<10s} {dt:5.1f}s  {detail}")
        ok = ok and passed
    print()
    print("全部通过。" if ok else "有失败项，见上面。")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
