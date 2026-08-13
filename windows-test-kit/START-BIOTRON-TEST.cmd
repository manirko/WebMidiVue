@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: Node.js LTS is not installed.
  echo Install it from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

set "KIT_ROOT=%~dp0"
if not exist "%KIT_ROOT%dist\index.html" if exist "%KIT_ROOT%..\dist\index.html" set "KIT_ROOT=%KIT_ROOT%..\"

if not exist "%KIT_ROOT%dist\index.html" (
  echo ERROR: dist\index.html is missing. Download the complete prebuilt test kit.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect-windows-evidence.ps1"
if errorlevel 1 (
  echo Evidence collection failed. Stop and send a screenshot of this window.
  pause
  exit /b 1
)

if exist "%~dp0serve-sandbox.js" (
  set "SERVER=%~dp0serve-sandbox.js"
) else (
  set "SERVER=%~dp0..\scripts\serve-sandbox.js"
)

set "BIOTRON_DIST=%KIT_ROOT%dist"
node "%SERVER%" --open
endlocal
