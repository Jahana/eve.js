@echo off
setlocal

call "%~dp0EvEJSConfig.bat"

set "EVEJS_PROXY_LOCAL_INTERCEPT=1"
set "EVEJS_FOREGROUND_RESTART=1"
if not defined EVEJS_SERVER_RESTART_CODE set "EVEJS_SERVER_RESTART_CODE=75"

:server_loop
pushd "%EVEJS_REPO_ROOT%"
echo [eve.js] Starting server only from "%EVEJS_REPO_ROOT%\server"
call npm --prefix server start
set "EVEJS_EXIT=%errorlevel%"
popd

if "%EVEJS_EXIT%"=="%EVEJS_SERVER_RESTART_CODE%" (
  echo [eve.js] Restart requested by server, relaunching in the same window...
  echo.
  goto server_loop
)

if not "%EVEJS_EXIT%"=="0" (
  echo [eve.js] Server exited with code %EVEJS_EXIT%.
  pause
)

exit /b %EVEJS_EXIT%
