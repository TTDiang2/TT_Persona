#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PY=/d/AI/LLM/venv/Scripts/python.exe
[ -x "$PY" ] || { echo "虚拟环境路径无效：$PY"; exit 1; }
exec "$PY" server.py
