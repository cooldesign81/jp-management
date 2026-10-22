@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 연결 확인 (아무것도 저장하지 않아요) ===
node backup.mjs --check
echo.
pause
