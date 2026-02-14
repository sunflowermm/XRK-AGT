@echo off
REM XRK-AGT Windows 启动脚本（先经 app.js 做依赖检查与引导，再进入 start.js）
node app.js %*
pause