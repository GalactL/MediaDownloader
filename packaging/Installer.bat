@echo off
rem Installateur MediaDownloader (Windows). L'archive ne contient aucun binaire tiers : ce script telecharge
rem Deno, yt-dlp et FFmpeg (versions et SHA-256 epingles) dans tools\bin, puis enregistre l'hote natif et
rem ouvre l'extension. Aucun droit administrateur. Les constantes DENO_* doivent egaler le bloc "deno" de
rem engine\deps.json (verifie par engine\test\deps.test.ts).
rem Test uniquement : MEDIADOWNLOADER_INSTALLER_TEST=1 saute l'enregistrement de l'hote, Firefox et les pauses.
chcp 65001 >nul
setlocal
set "DIR=%~dp0"
for %%I in ("%~dp0.") do set "MD_ROOT=%%~fI"
set "DENO_VERSION=2.9.8"
set "DENO_URL=https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip"
set "DENO_SHA256=cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf"
set "DENO_EXE_SHA256=924397800533d3eb0ed0c889b20ad70e18b970d93acd8135bc043f425e528266"
echo Installation de MediaDownloader...
echo.
echo [1/3] Deno %DENO_VERSION%
powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; try{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]'Tls12,Tls13'}catch{[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]'Tls12'}; $bin=Join-Path $env:MD_ROOT 'tools\bin'; $exe=Join-Path $bin 'deno.exe'; if((Test-Path -LiteralPath $exe) -and ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -eq $env:DENO_EXE_SHA256)){Write-Host '  deja installe.'; exit 0}; $tmp=Join-Path $env:MD_ROOT ('tools\.tmp-deno-'+$PID); try{ Write-Host '  telechargement...'; New-Item -ItemType Directory -Force -Path $tmp | Out-Null; $zip=Join-Path $tmp 'deno.zip'; for($i=1;$i -le 3;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri $env:DENO_URL -OutFile $zip;break}catch{if($i -eq 3){throw};Start-Sleep -Seconds (3*$i)}}; if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $env:DENO_SHA256){throw 'SHA256'}; Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $tmp 'x'); New-Item -ItemType Directory -Force -Path $bin | Out-Null; Move-Item -LiteralPath (Join-Path $tmp 'x\deno.exe') -Destination $exe -Force; Write-Host '  installe et verifie.' }catch{ if($_.Exception.Message -eq 'SHA256'){Write-Host 'ERREUR : la somme SHA-256 de Deno ne correspond pas (fichier corrompu ou modifie).'}else{Write-Host ('ERREUR : '+$_.Exception.Message)}; exit 1 }finally{ Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }"
if errorlevel 1 goto fail
echo.
echo [2/3] yt-dlp et FFmpeg (plusieurs centaines de Mo : patientez)
set "DENO_NO_UPDATE_CHECK=1"
set "DENO_DIR=%MD_ROOT%\tools\deno-cache"
"%MD_ROOT%\tools\bin\deno.exe" run --no-check --no-config --no-prompt --allow-net --allow-read="%MD_ROOT%" --allow-write="%MD_ROOT%" --allow-run --allow-env=SystemRoot "%MD_ROOT%\engine\deps.ts" --root "%MD_ROOT%"
if errorlevel 1 goto fail
if defined MEDIADOWNLOADER_INSTALLER_TEST goto done
echo.
echo [3/3] Enregistrement de l'hote pour Firefox
call "%DIR%MediaDownloader.Cli.bat" install-host
if errorlevel 1 goto fail
echo.
echo Ouverture de l'extension dans Firefox : acceptez l'installation quand Firefox le demande.
if exist "%ProgramFiles%\Mozilla Firefox\firefox.exe" (
  start "" "%ProgramFiles%\Mozilla Firefox\firefox.exe" "%DIR%mediadownloader.xpi"
) else if exist "%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe" (
  start "" "%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe" "%DIR%mediadownloader.xpi"
) else (
  start "" "%DIR%mediadownloader.xpi"
)
:done
echo.
echo Installation terminee. Ne deplacez pas ce dossier ensuite ; sinon relancez Installer.bat.
if not defined MEDIADOWNLOADER_INSTALLER_TEST pause
exit /b 0
:fail
echo.
echo ECHEC de l'installation. Rien de partiel n'a ete laisse dans tools\bin.
echo Verifiez la connexion (proxy : variable HTTPS_PROXY), l'espace disque et les droits sur ce dossier, puis relancez Installer.bat.
if not defined MEDIADOWNLOADER_INSTALLER_TEST pause
exit /b 1
