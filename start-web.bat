@echo off
setlocal
title TT_Persona - 网页版

rem ===== 路径配置（按自己的环境改这几行）=====
set "PY=D:\AI\LLM\venv\Scripts\python.exe"
set "APP=D:\TT_Persona\app"
set "SERVER=%APP%\server.py"
set "PORT=8791"
set "URL=http://127.0.0.1:%PORT%"

rem ===== 默认模型：Qwen3.5-4B =====
set "TT_MODEL_DIR=D:\AI\LLM\models\Qwen3.5-4B"
set "TT_MODEL_ID=Qwen/Qwen3.5-4B"

if not exist "%PY%" (
  echo [错误] 找不到 Python: %PY%
  echo 请按 README 的"快速开始"建好虚拟环境，或改本文件开头的 PY。
  pause
  exit /b 1
)
if not exist "%SERVER%" (
  echo [错误] 找不到后端脚本: %SERVER%
  echo 请改本文件开头的 APP。
  pause
  exit /b 1
)

call :check_port
if "%RUNNING%"=="1" (
  echo [1/2] 后端已在运行，直接使用
) else (
  echo [1/2] 启动后端 ... 模型 %TT_MODEL_ID%
  start "TT_Persona 后端" /D "%APP%" "%PY%" "%SERVER%"
)

echo [2/2] 打开 %URL%
timeout /t 2 /nobreak >nul
start "" "%URL%"

echo.
echo 已打开浏览器。模型加载需要十几秒，页面顶部显示"就绪"即可使用。
echo 关掉"TT_Persona 后端"窗口即可停止服务。
timeout /t 4 /nobreak >nul
exit /b 0

:check_port
set "RUNNING=0"
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PORT%);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 set "RUNNING=1"
exit /b 0
