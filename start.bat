@echo off
chcp 65001 >nul 2>&1
REM XRK-AGT Windows 启动脚本（经 app.js 做依赖检查与引导，再进入 start.js）
call "%~dp0scripts\ensure-redis.cmd"
if errorlevel 1 (
  echo [XRK-AGT] Redis 未就绪，已中止启动
  pause
  exit /b 1
)
node app.js %*
if errorlevel 1 pause
