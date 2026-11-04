@echo off
rem MediaDownloader launcher (Windows). In the release archive it sits at the root, next to engine\ (the TypeScript
rem engine) and tools\bin\ (deno.exe, yt-dlp.exe, ffmpeg.exe); the release copies it there from packaging\.
rem The Deno permissions must stay equal to engine\permissions.ts (checked by engine\test\contract.test.ts).
setlocal
if exist "%~dp0tools\bin\deno.exe" goto run
>&2 echo MediaDownloader : Deno est introuvable dans tools\bin. Relancez Installer.bat.
exit /b 3
:run
set "DENO_NO_UPDATE_CHECK=1"
set "DENO_DIR=%~dp0tools\deno-cache"
"%~dp0tools\bin\deno.exe" run --no-check --no-config --no-prompt --allow-read --allow-write --allow-run --allow-sys=setPriority --allow-env=PATH,HOME,SystemRoot,MEDIADOWNLOADER_YTDLP,MEDIADOWNLOADER_FFMPEG,MEDIADOWNLOADER_DENO,MEDIADOWNLOADER_NODE "%~dp0engine\main.ts" %*
exit /b %ERRORLEVEL%
