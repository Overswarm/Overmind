@echo off
rem Overmind updater: fetches the latest code from git and reinstalls deps so a
rem subsequent run.bat uses the new version.
setlocal

cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo git is not on PATH. Install git and reopen this window.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm is not on PATH. Install Node.js 22 from https://nodejs.org/ and reopen this window.
  pause
  exit /b 1
)

echo Pulling latest changes...
git pull --ff-only
if errorlevel 1 (
  echo git pull failed.
  pause
  exit /b 1
)

echo Installing dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)

echo Done. Run run.bat to start the app.
pause
