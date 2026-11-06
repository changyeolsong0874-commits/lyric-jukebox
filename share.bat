@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 외부 공개용: 서버 + Cloudflare 터널을 함께 실행합니다.
rem Musixmatch 키가 있으면 아래 줄의 rem을 지우고 키를 입력하세요
rem set MUSIXMATCH_KEY=여기에_키
start "서버" cmd /k node server.js
echo.
echo 아래에 나오는 https://xxxx.trycloudflare.com 주소를 친구에게 보내세요.
echo (뒤에 /?room=party 를 붙이면 같은 방으로 들어옵니다. 이 창을 닫으면 공개가 중단됩니다.)
echo.
"%ProgramFiles(x86)%\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000
pause
