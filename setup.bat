@echo off
echo ===================================================
echo JARVIS Personal AI Agent Setup
echo ===================================================

echo Checking dependencies...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed. Please install it first.
    exit /b 1
)

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python is not installed or not in PATH. Please install it first.
    exit /b 1
)

echo Installing Node.js dependencies (Electron)...
call npm install

echo Setting up Python virtual environment...
if not exist "backend\.venv" (
    python -m venv backend\.venv
)

echo Activating virtual environment and installing python packages...
call backend\.venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r backend\requirements.txt

echo ===================================================
echo Setup Complete! Run start.bat to boot JARVIS.
echo ===================================================
