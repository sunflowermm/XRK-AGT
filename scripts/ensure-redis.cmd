@echo off
setlocal EnableExtensions
REM Ensure 127.0.0.1:6379 (Memurai service, Redis MSI service, or redis-server.exe)
set "PROBE=%~dp0probe-redis-port.ps1"
if not exist "%PROBE%" (
  echo [Redis] missing probe-redis-port.ps1
  exit /b 1
)

call :probe 500
if not errorlevel 1 goto ok

call :try_svc Memurai
if not errorlevel 1 goto wait

call :try_svc Redis
if not errorlevel 1 goto wait

if exist "%ProgramFiles%\Redis\redis-server.exe" (
  start "" /B "%ProgramFiles%\Redis\redis-server.exe"
  goto wait
)
if exist "%ProgramFiles%\Memurai\memurai.exe" (
  start "" /B "%ProgramFiles%\Memurai\memurai.exe"
  goto wait
)
set "REDIS_X86=%ProgramFiles(x86)%\Redis\redis-server.exe"
if exist "%REDIS_X86%" (
  start "" /B "%REDIS_X86%"
  goto wait
)

where redis-server >nul 2>&1
if not errorlevel 1 (
  start "" /B redis-server
  goto wait
)

where memurai >nul 2>&1
if not errorlevel 1 (
  start "" /B memurai
  goto wait
)

echo [Redis] 127.0.0.1:6379 unreachable; install Memurai, Redis MSI, or docker redis.
exit /b 1

:try_svc
sc query "%~1" >nul 2>&1
if errorlevel 1 exit /b 1
net start "%~1" >nul 2>&1
sc query "%~1" | find "RUNNING" >nul 2>&1
exit /b %errorlevel%

:probe
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROBE%" -TimeoutMs %~1
exit /b %errorlevel%

:wait
set /a _i=0

:loop
call :probe 800
if not errorlevel 1 goto ok
set /a _i+=1
if %_i% GEQ 20 (
  echo [Redis] timeout waiting for 127.0.0.1:6379
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto loop

:ok
echo [Redis] 127.0.0.1:6379 OK
exit /b 0
