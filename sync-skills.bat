@echo off
REM Run sync-skills.ps1 from the project root
set "SCRIPT_DIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%sync-skills.ps1"
