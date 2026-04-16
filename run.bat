@echo off
rem Overmind launcher: installs deps on first run, starts the dev server,
rem and opens the app in the default browser.
setlocal

cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo npm is not on PATH. Install Node.js 22 from https://nodejs.org/ and reopen this window.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

call npm run dev -- --open
