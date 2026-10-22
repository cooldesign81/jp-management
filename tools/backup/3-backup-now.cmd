@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 지금 바로 백업 ===
node backup.mjs
echo.
echo 결과는 NAS 백업 폴더의 LAST_STATUS.txt 에도 있어요.
pause
