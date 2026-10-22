@echo off
rem 작업 스케줄러가 매일 실행하는 파일 (직접 실행할 때는 3-backup-now.cmd 를 쓰세요)
chcp 65001 >nul
cd /d "%~dp0"
node backup.mjs
