@echo off
setlocal EnableExtensions
REM Thin wrapper: logic in ensure-redis.mjs
where node >nul 2>&1
if errorlevel 1 (
  echo [Redis] node not found in PATH
  exit /b 1
)
node "%~dp0ensure-redis.mjs" %*
exit /b %ERRORLEVEL%
