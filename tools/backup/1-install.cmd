@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === JP 스케줄 매니저 백업 도구 설치 ===
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js 가 설치돼 있지 않아요.
  echo https://nodejs.org 에서 LTS 버전을 받아 설치한 뒤, 이 파일을 다시 실행하세요.
  pause
  exit /b 1
)
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo 설치에 실패했어요. 인터넷 연결을 확인하고 다시 실행하세요.
  pause
  exit /b 1
)
if not exist keys mkdir keys
if not exist config.json (
  copy config.example.json config.json >nul
  echo config.json 을 만들었어요. 메모장으로 열어서 outputDir 의 NAS 주소를 고쳐 주세요.
)
echo.
echo 설치 끝. 다음 순서:
echo   1. keys 폴더에 원별 서비스 계정 키 파일 3개 넣기 (README.md 참고)
echo   2. config.json 의 outputDir 을 NAS 주소로 고치기
echo   3. 2-check.cmd 실행
pause
