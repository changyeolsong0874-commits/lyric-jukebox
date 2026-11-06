@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Musixmatch 키가 있으면 아래 줄의 rem을 지우고 키를 입력하세요
rem set MUSIXMATCH_KEY=여기에_키
start "" http://localhost:3000/?room=party
node server.js
pause
