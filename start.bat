@echo off
REM XRK-AGT Windows 启动脚本
REM 支持通过环境变量 XRK_SERVER_PORT 指定端口

setlocal enabledelayedexpansion

REM 获取端口（环境变量优先，默认8080）
if defined XRK_SERVER_PORT (
    set PORT=!XRK_SERVER_PORT!
) else (
    set PORT=8080
)

REM 如果提供了命令行参数，第一个参数应该是"server"，第二个参数是端口
if "%~1"=="server" (
    if not "%~2"=="" (
        set PORT=%~2
        shift
        shift
    ) else (
        shift
    )
    node --no-warnings --no-deprecation start.js server !PORT! %*
) else (
    node --no-warnings --no-deprecation start.js %*
)

endlocal
