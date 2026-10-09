@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set PORT=8765
set PYEXE=

where python >nul 2>nul && set PYEXE=python
if not defined PYEXE (where py >nul 2>nul && set PYEXE=py)

if not defined PYEXE (
  echo.
  echo   [!] 没有找到 Python。请先安装 Python，或手动用任意静态服务器打开本目录。
  echo       例如已装 Node.js 的话，在本目录执行：  npx --yes serve -l %PORT% .
  echo.
  pause
  exit /b 1
)

echo.
echo   ScanLike 已启动： http://127.0.0.1:%PORT%/
echo   浏览器会自动打开。关闭本窗口即停止服务。
echo.

start "" "http://127.0.0.1:%PORT%/"
%PYEXE% -m http.server %PORT% --bind 127.0.0.1
