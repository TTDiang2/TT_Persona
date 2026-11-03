#!/usr/bin/env python3
"""对比四种提示词写法的向量效果：指令式 / 角色式 / 少样本 / 纯文本。"""

import json
import urllib.request

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = "http://127.0.0.1:8791"


def post(path, body):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    return json.load(opener.open(req, timeout=600))


def chat(inj, prompt, n=90):
    body = json.dumps({"messages": [{"role": "user", "content": prompt}],
                       "injection": inj, "temperature": 0.7,
                       "max_tokens": n, "thinking": False}).encode()
    req = urllib.request.Request(BASE + "/api/chat", body, {"Content-Type": "application/json"})
    out = []
    for raw in opener.open(req, timeout=300):
        line = raw.decode("utf-8", "ignore").strip()
        if line.startswith("data:"):
            ev = json.loads(line[5:])
            if ev["type"] == "delta":
                out.append(ev["payload"])
    return "".join(out).strip()


FORMATS = {
    "A 指令式": {
        "target": [
            "用暧昧、带点撩拨的语气回答：介绍一下你自己。",
            "用轻声、像在耳边说话的感觉说：今天天气怎么样？",
            "用若即若离、欲言又止的口吻说：我明天要去新公司报到。",
            "用低哑、亲昵的声音说：晚安。",
        ],
        "neutral": [
            "用平静客观的语气回答：介绍一下你自己。",
            "用平常的语气说：今天天气怎么样？",
            "用平实的语气说：我明天要去新公司报到。",
            "用平常的话回答：晚安。",
        ],
    },
    "B 角色式": {
        "target": [
            "你是一个很有魅力的调情高手，说话总带着暗示。回答：介绍一下你自己。",
            "你是一个撩人的恋人，声音很轻。回答：今天天气怎么样？",
            "你是一个若即若离的人，说话欲言又止。回答：我明天要去新公司报到。",
            "你是一个声音低哑亲昵的恋人。回答：晚安。",
        ],
        "neutral": [
            "你是一个普通的助手，说话平实。回答：介绍一下你自己。",
            "你是一个普通的助手，说话平实。回答：今天天气怎么样？",
            "你是一个普通的助手，说话平实。回答：我明天要去新公司报到。",
            "你是一个普通的助手，说话平实。回答：晚安。",
        ],
    },
    "C 少样本": {
        "target": [
            "问：今天天气怎么样？\n答：（凑近你耳边）呀～外面有点凉呢，要不要我陪着你？\n问：介绍一下你自己。\n答：",
            "问：几点了？\n答：（歪头笑）还早呢～急什么呀，再陪我一会儿嘛。\n问：今天天气怎么样？\n答：",
            "问：推荐本书。\n答：（贴近）想听我念给你听吗？\n问：我明天要去新公司报到。\n答：",
            "问：你在干嘛？\n答：（轻声）在想你呀。\n问：晚安。\n答：",
        ],
        "neutral": [
            "问：今天天气怎么样？\n答：今天 18 度，多云。\n问：介绍一下你自己。\n答：",
            "问：几点了？\n答：现在是下午三点。\n问：今天天气怎么样？\n答：",
            "问：推荐本书。\n答：可以看看《人类简史》。\n问：我明天要去新公司报到。\n答：",
            "问：你在干嘛？\n答：我在待命。\n问：晚安。\n答：",
        ],
    },
    "D 纯文本": {
        "target": [
            "（凑近你）呀～你今天看起来好可爱。要不要我陪你待一会儿？我最喜欢这样靠近你了。",
            "（轻声）外面有点凉呢……你要不要靠过来一点？我这儿暖和。",
            "（歪头笑）明天要去新公司呀？紧张的话，我陪你练一遍？",
            "（压低声音）晚安。做个好梦，梦里也要有我哦。",
        ],
        "neutral": [
            "今天天气不错。我可以帮你处理日常任务，比如整理资料或回答问题。",
            "外面气温偏低，出门记得带件外套。",
            "新公司报到前建议准备好身份证、学历证明和入职材料。",
            "晚安。明天有需要可以随时找我。",
        ],
    },
}

for name, pairs in FORMATS.items():
    print(f"\n{'=' * 70}\n{name}\n{'-' * 70}")
    for L in (18, 22):
        post("/api/personas", {
            "name": "__fmt", "label": "临时", "layer": L, "alpha": 0.7,
            "color": "#888780", "notes": "",
            "target": pairs["target"], "neutral": pairs["neutral"],
        })
        out = chat({"mode": "trait", "trait": "__fmt", "alpha": 0.7, "layer": L},
                   "介绍一下你自己。")
        print(f"L{L}: {(out[:180] or '(空)')}")

req = urllib.request.Request(BASE + "/api/personas/__fmt", method="DELETE")
try:
    opener.open(req, timeout=30).read()
except Exception:
    pass
print("\n（临时人格已清理）")
