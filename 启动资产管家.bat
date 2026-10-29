@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PY=C:\Users\焦子原\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if not exist "%PY%" (
    where py >nul 2>nul && ( set "PY=py -3" ) || ( set "PY=python" )
)

rem 加参数 lan 开启局域网模式（同一 WiFi 下的其他设备也能访问）
set "BIND=127.0.0.1"
if /i "%1"=="lan" set "BIND=0.0.0.0"

echo 正在启动资产管家...
echo 登录账号: admin
echo 服务地址: http://127.0.0.1:8765
if /i "%1"=="lan" (
    echo 模式: 局域网（启动后会显示其他设备可用的地址）
) else (
    echo 模式: 仅本机
)
echo （关闭本窗口即停止服务）
echo.

start "" http://127.0.0.1:8765
%PY% server.py

pause
