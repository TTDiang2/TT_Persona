@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PY=D:\AI\LLM\venv\Scripts\python.exe

if not exist "%PY%" (
  echo [错误] 虚拟环境路径无效：%PY%
  echo 请先按 README 里的步骤创建 venv 并安装依赖。
  pause
  exit /b 1
)

echo 启动 TT_Persona ...
start "TT_Persona Server" cmd /c ""%PY%" server.py"
timeout /t 6 >nul
start "" http://127.0.0.1:8791
