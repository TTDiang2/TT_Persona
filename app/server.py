"""
server.py -- TT_Persona 后端。

  D:/AI/LLM/venv/Scripts/python.exe app/server.py
  → http://127.0.0.1:8791
"""

import base64
import io
import json
import time
from pathlib import Path

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from engine import DATA_DIR, TRAIT_DIR, engine

META_PATH = DATA_DIR / "personas.json"
DIST = Path(__file__).resolve().parent / "web" / "dist"

app = FastAPI(title="TT_Persona")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# ---------------------------------------------------------------- 人格元数据

def load_meta():
    if META_PATH.exists():
        try:
            return json.loads(META_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_meta(meta):
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def discover():
    """把 traits/*.pt 里已有的人格自动登记进来（保留 CLI 时期的成果）"""
    meta = load_meta()
    changed = False
    for p in TRAIT_DIR.glob("*.pt"):
        name = p.stem
        if name in meta:
            continue
        try:
            d = torch.load(p, map_location="cpu", weights_only=False)
        except Exception:
            continue
        meta[name] = {
            "name": name,
            "label": name,
            "layer": int(d.get("layer", 18)),
            "alpha": 0.8,
            "color": "#378ADD",
            "notes": "",
            "created": time.strftime("%Y-%m-%d %H:%M"),
        }
        changed = True
    if changed:
        save_meta(meta)
    return meta


def pairs_path(name):
    return TRAIT_DIR / f"{name}.json"


# ---------------------------------------------------------------- 请求模型

class PersonaIn(BaseModel):
    name: str
    label: str = ""
    layer: int = 18
    alpha: float = 0.8
    color: str = "#378ADD"
    notes: str = ""
    target: list[str]
    neutral: list[str]


class PersonaPatch(BaseModel):
    label: str | None = None
    layer: int | None = None
    alpha: float | None = None
    color: str | None = None
    notes: str | None = None


class ChatIn(BaseModel):
    messages: list[dict]
    injection: dict | None = None
    temperature: float = 0.7
    max_tokens: int = 220
    thinking: bool = False


class ScanIn(BaseModel):
    target: list[str]
    neutral: list[str]
    layers: list[int]
    topk: int = 20


class InspectIn(BaseModel):
    layer: int
    neuron: int
    target: list[str]
    neutral: list[str]


# ---------------------------------------------------------------- 基础

@app.on_event("startup")
def _startup():
    discover()
    engine.load_async()


@app.get("/api/status")
def status():
    st = engine.status()
    st["personas"] = len(discover())
    return st


# ---------------------------------------------------------------- 人格 CRUD

@app.get("/api/personas")
def list_personas():
    meta = discover()
    out = []
    for name, m in meta.items():
        item = dict(m)
        item["has_pairs"] = pairs_path(name).exists()
        out.append(item)
    out.sort(key=lambda x: x.get("created", ""), reverse=True)
    return out


@app.get("/api/personas/{name}/pairs")
def get_pairs(name: str):
    p = pairs_path(name)
    if not p.exists():
        raise HTTPException(404, "没有保存提示词")
    return json.loads(p.read_text(encoding="utf-8"))


@app.post("/api/personas")
def create_persona(body: PersonaIn):
    if not body.target or not body.neutral:
        raise HTTPException(400, "正负提示词都不能为空")
    if len(body.target) != len(body.neutral):
        raise HTTPException(400, "正负提示词数量要一致")
    vec = engine.build_trait({"target": body.target, "neutral": body.neutral}, body.layer)
    torch.save({"vec": vec, "layer": body.layer, "name": body.name, "dim": vec.numel()},
               engine.vector_path(body.name))
    pairs_path(body.name).write_text(
        json.dumps({"target": body.target, "neutral": body.neutral},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    meta = discover()
    meta[body.name] = {
        "name": body.name,
        "label": body.label or body.name,
        "layer": body.layer,
        "alpha": body.alpha,
        "color": body.color,
        "notes": body.notes,
        "created": time.strftime("%Y-%m-%d %H:%M"),
    }
    save_meta(meta)
    return {"ok": True, "dim": vec.numel()}


@app.patch("/api/personas/{name}")
def patch_persona(name: str, body: PersonaPatch):
    meta = discover()
    if name not in meta:
        raise HTTPException(404, "人格不存在")
    for k, v in body.model_dump(exclude_none=True).items():
        meta[name][k] = v
    save_meta(meta)
    return meta[name]


@app.delete("/api/personas/{name}")
def delete_persona(name: str):
    meta = discover()
    meta.pop(name, None)
    save_meta(meta)
    for p in (engine.vector_path(name), pairs_path(name)):
        if p.exists():
            p.unlink()
    return {"ok": True}


@app.get("/api/personas-export")
def export_personas():
    """导出全部人格：元数据 + 提示词 + 向量（base64 float32）"""
    meta = discover()
    bundle = {"version": 1, "model": "Qwen3.5-4B", "exported": time.strftime("%Y-%m-%d %H:%M"),
              "personas": []}
    for name, m in meta.items():
        p = engine.vector_path(name)
        if not p.exists():
            continue
        d = torch.load(p, map_location="cpu", weights_only=False)
        vec = d["vec"].float().numpy().tobytes()
        pairs = (json.loads(pairs_path(name).read_text(encoding="utf-8"))
                 if pairs_path(name).exists() else {"target": [], "neutral": []})
        bundle["personas"].append({
            "meta": m, "pairs": pairs,
            "vector_b64": base64.b64encode(vec).decode(),
            "dim": int(d["vec"].numel()),
        })
    return JSONResponse(bundle, headers={
        "Content-Disposition": 'attachment; filename="tt-persona-pack.json"'})


@app.post("/api/personas-import")
def import_personas(bundle: dict):
    n = 0
    meta = discover()
    for item in bundle.get("personas", []):
        m = item["meta"]
        name = m["name"]
        raw = base64.b64decode(item["vector_b64"])
        vec = torch.frombuffer(bytearray(raw), dtype=torch.float32).clone()
        torch.save({"vec": vec, "layer": m["layer"], "name": name, "dim": vec.numel()},
                   engine.vector_path(name))
        if item.get("pairs"):
            pairs_path(name).write_text(
                json.dumps(item["pairs"], ensure_ascii=False, indent=2), encoding="utf-8")
        meta[name] = m
        n += 1
    save_meta(meta)
    return {"ok": True, "imported": n}


# ---------------------------------------------------------------- 生成

@app.post("/api/chat")
def chat(body: ChatIn):
    def gen():
        for kind, payload in engine.stream(
                body.messages, body.injection, body.temperature,
                body.max_tokens, body.thinking):
            yield f"data: {json.dumps({'type': kind, 'payload': payload}, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- 扫描

@app.post("/api/scan")
def scan(body: ScanIn):
    if not body.target or not body.neutral:
        raise HTTPException(400, "需要正负提示词")
    if not body.layers:
        raise HTTPException(400, "至少要选一层")
    try:
        return engine.scan({"target": body.target, "neutral": body.neutral},
                           body.layers, body.topk)
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.post("/api/neuron/inspect")
def inspect(body: InspectIn):
    try:
        return engine.inspect_neuron(body.layer, body.neuron,
                                     {"target": body.target, "neutral": body.neutral})
    except RuntimeError as e:
        raise HTTPException(409, str(e))


# ---------------------------------------------------------------- 静态托管

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        f = DIST / full_path
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8791, log_level="info")
