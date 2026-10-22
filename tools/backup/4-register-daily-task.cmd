@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 매일 새벽 3시 자동 백업 등록 ===
schtasks /Create /F /SC DAILY /ST 03:00 /TN "JP-Schedule-Backup" /TR "\"%~dp0run-backup.cmd\""
if errorlevel 1 (
  echo 등록에 실패했어요. 이 파일을 마우스 오른쪽 버튼 - 관리자 권한으로 실행 해 보세요.
  pause
  exit /b 1
)
echo.
echo 등록했어요. 작업 스케줄러에서 "JP-Schedule-Backup" 으로 볼 수 있어요.
echo N100 이 그 시간에 켜져 있고 로그인돼 있어야 돌아가요 (절전 모드 끄기).
pause
