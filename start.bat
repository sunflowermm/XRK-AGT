@echo off
chcp 65001 >nul 2>&1
REM XRK-AGT Windows 启动脚本（经 app.js 做依赖检查与引导，再进入 start.js）
node app.js %*
if errorlevel 1 pause