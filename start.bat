@echo off
echo Booting JARVIS Personal AI Agent...

set NVIDIA_API_KEY=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

echo Starting Backend Service...
start "JARVIS Backend" cmd /c "call backend\.venv\Scripts\activate.bat && python backend\server.py"

echo Waiting for backend to start...
timeout /t 3 /nobreak >nul

echo Starting HUD Interface (Electron)...
npm start

echo JARVIS closed.
