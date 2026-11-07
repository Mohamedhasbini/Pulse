@echo off
rem Starts everything MXAi needs: Docker (app, database, backups), n8n (AI replies), the Cloudflare tunnel
rem (app.nexfoyz.dev and client websites) and the nexfoyz.dev home page. Safe to run twice.
echo Starting Docker Desktop...
start "" "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
:wait
docker info >nul 2>&1 || (timeout /t 3 >nul & goto wait)
cd /d "%~dp0"
docker compose up -d
docker start n8n
tasklist /fi "imagename eq cloudflared.exe" | find /i "cloudflared.exe" >nul || start "" /min "C:\Users\Mohamad\Jarvis\tunnel\cloudflared.exe" tunnel run jarvis
tasklist /fi "imagename eq pythonw.exe" | find /i "pythonw.exe" >nul || start "" "C:\Users\Mohamad\AppData\Local\Programs\Python\Python312\pythonw.exe" "C:\Users\Mohamad\Jarvis\site\serve.py"
echo Waiting for the app...
:health
curl -fsS http://localhost:3100/health >nul 2>&1 || (timeout /t 3 >nul & goto health)
echo.
echo MXAi is live: https://app.nexfoyz.dev  (this PC must stay on)
pause
