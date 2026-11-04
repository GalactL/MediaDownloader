@echo off
rem Windows launcher of the fake tool of the same name (.ts); FAKE_DENO is the deno executable.
set "FAKE_SELF=%~f0"
"%FAKE_DENO%" run -A --no-config "%~dpn0.ts" %*
exit /b %ERRORLEVEL%
