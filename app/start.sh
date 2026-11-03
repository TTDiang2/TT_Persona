#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PY=/d/AI/LLM/venv/Scripts/python.exe
[ -x "$PY" ] || { echo "找不到 $PY"; exit 1; }
exec "$PY" server.py
