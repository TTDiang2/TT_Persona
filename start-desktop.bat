@echo off
setlocal
title TT_Persona - 桌面版

rem ===== 路径配置（按自己的环境改这几行）=====
set "PY=D:\AI\LLM\venv\Scripts\python.exe"
set "APP=D:\TT_Persona\app"
set "SERVER=%APP%\server.py"
set "EXE=D:\TT_Persona\app\desktop\src-tauri\target\release\tt-persona.exe"
set "PORT=8791"

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
  pause
  exit /b 1
)
if not exist "%EXE%" (
  echo [错误] 找不到桌面版: %EXE%
  echo 先按 README"桌面版"一节打包，或者改用 start-web.bat。
  pause
  exit /b 1
)

call :check_port
if "%RUNNING%"=="1" (
  echo [1/3] 后端已在运行，直接使用
) else (
  echo [1/3] 启动后端 ... 模型 %TT_MODEL_ID%
  start "TT_Persona 后端" /D "%APP%" "%PY%" "%SERVER%"

  echo [2/3] 等待后端就绪（最多 90 秒）...
  powershell -NoProfile -Command "$d=[DateTime]::UtcNow.AddSeconds(90); while([DateTime]::UtcNow -lt $d){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PORT%);$c.Close();exit 0}catch{Start-Sleep -Milliseconds 500}}; exit 1" >nul 2>&1
  if errorlevel 1 (
    echo [提示] 后端 90 秒内没有就绪，仍然尝试打开桌面版。
    echo        进去后如果一直显示"正在连接后端"，看看"TT_Persona 后端"窗口里的报错。
  ) else (
    echo       后端已就绪
  )
)

echo [3/3] 启动桌面版
start "" "%EXE%"
exit /b 0

:check_port
set "RUNNING=0"
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%PORT%);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 set "RUNNING=1"
exit /b 0
