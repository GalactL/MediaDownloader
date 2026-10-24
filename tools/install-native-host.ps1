<#
Enregistre l'hôte de messagerie native de MediaDownloader pour Firefox (Windows).
  -CliPath    chemin de MediaDownloader.Cli.exe (défaut : dist\ voisin du dossier du script)
  -Uninstall  supprime la clé de registre et les fichiers installés
#>
param(
    [string]$CliPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\MediaDownloader.Cli.exe'),
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'

$name = 'media_downloader'
$dir = Join-Path $env:LOCALAPPDATA 'MediaDownloader\native-host'
$key = "HKCU:\Software\Mozilla\NativeMessagingHosts\$name"
$wrapper = Join-Path $dir 'media-downloader-host.cmd'
$manifest = Join-Path $dir "$name.json"

if ($Uninstall) {
    if (Test-Path $key) { Remove-Item $key -Force }
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    Write-Host 'Hôte natif désinstallé.'
    return
}

if (-not (Test-Path $CliPath)) { throw "MediaDownloader.Cli.exe introuvable : $CliPath" }
$CliPath = (Resolve-Path $CliPath).Path
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Firefox ajoute des arguments (manifeste, id d'extension) : on ne les transmet pas.
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($wrapper, "@echo off`r`n`"$CliPath`" host`r`n", $utf8)

$template = Join-Path (Split-Path -Parent $PSScriptRoot) 'native-host\media_downloader.json.template'
$json = (Get-Content $template -Raw -Encoding UTF8).Replace('@HOST_PATH@', $wrapper.Replace('\', '\\'))
[IO.File]::WriteAllText($manifest, $json, $utf8)

New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name '(default)' -Value $manifest
Write-Host "Hôte natif installé : $manifest"
