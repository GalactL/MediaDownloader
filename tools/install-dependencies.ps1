[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$binDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'tools\bin'))
$temporaryDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot ('build\dependency-' + [guid]::NewGuid().ToString('N'))))

if (-not $binDirectory.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $temporaryDirectory.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Les chemins de destination sortent du projet.'
}

New-Item -ItemType Directory -Force -Path $binDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null

try {
    $ytDlpDestination = Join-Path $binDirectory 'yt-dlp.exe'
    $ffmpegArchive = Join-Path $temporaryDirectory 'ffmpeg.zip'
    $ffmpegExtracted = Join-Path $temporaryDirectory 'ffmpeg'

    Write-Host 'Téléchargement de yt-dlp…'
    Invoke-WebRequest -UseBasicParsing `
        -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' `
        -OutFile $ytDlpDestination

    Write-Host 'Téléchargement de FFmpeg Essentials…'
    Invoke-WebRequest -UseBasicParsing `
        -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' `
        -OutFile $ffmpegArchive

    Expand-Archive -LiteralPath $ffmpegArchive -DestinationPath $ffmpegExtracted -Force
    $ffmpeg = Get-ChildItem -LiteralPath $ffmpegExtracted -Filter 'ffmpeg.exe' -File -Recurse | Select-Object -First 1
    $ffprobe = Get-ChildItem -LiteralPath $ffmpegExtracted -Filter 'ffprobe.exe' -File -Recurse | Select-Object -First 1
    if (-not $ffmpeg -or -not $ffprobe) {
        throw "L'archive FFmpeg ne contient pas les exécutables attendus."
    }

    Copy-Item -LiteralPath $ffmpeg.FullName -Destination (Join-Path $binDirectory 'ffmpeg.exe') -Force
    Copy-Item -LiteralPath $ffprobe.FullName -Destination (Join-Path $binDirectory 'ffprobe.exe') -Force

    # Garder la version synchronisée avec .github/workflows/release.yml
    $denoVersion = '2.5.6'
    $denoAsset = 'deno-x86_64-pc-windows-msvc.zip'
    $denoUrl = "https://github.com/denoland/deno/releases/download/v$denoVersion/$denoAsset"
    $denoArchive = Join-Path $temporaryDirectory $denoAsset

    Write-Host "Téléchargement de Deno $denoVersion…"
    Invoke-WebRequest -UseBasicParsing -Uri $denoUrl -OutFile $denoArchive
    $expected = ((Invoke-WebRequest -UseBasicParsing -Uri "$denoUrl.sha256sum").Content.ToString().Trim() -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $denoArchive -Algorithm SHA256).Hash -ne $expected) {
        throw "La somme SHA-256 de Deno ne correspond pas."
    }
    Expand-Archive -LiteralPath $denoArchive -DestinationPath $temporaryDirectory -Force
    Copy-Item -LiteralPath (Join-Path $temporaryDirectory 'deno.exe') -Destination (Join-Path $binDirectory 'deno.exe') -Force

    Write-Host "Dépendances installées localement dans $binDirectory"
}
finally {
    if ($temporaryDirectory.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $temporaryDirectory)) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
}
