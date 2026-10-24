# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A native C++20 engine that downloads videos with `yt-dlp` and optionally re-encodes them with FFmpeg to fit a size limit (e.g. 10 MB for Discord). It is meant to be driven by an external app, HUB, which launches the CLI as a child process and parses its stdout. There is also a Win32 GUI (Windows only) that is itself just a front end spawning the CLI.

User-facing strings, docs, README and CHANGELOG are written in French; keep them in French. Commit messages are in English.

## Build and test

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build -C Release --output-on-failure
```

On Windows, `node tools/build-native.mjs` does a fresh configure + Release build (it de-duplicates the `Path`/`PATH` env vars that break MSBuild); `--engine-only` builds just the CLI and tests. `tools/install-dependencies.ps1` downloads `yt-dlp`, `ffmpeg`, `ffprobe` into `tools/bin/` (gitignored), which CMake copies next to the GUI exe.

Tests are a single hand-rolled executable, `tests/CoreTests.cpp` (no framework: a `Check(cond, msg)` helper, non-zero exit on any failure). To run it directly: `./build/MediaDownloaderTests`. There is no way to run a single case; add new checks to `main()` there. Tests only cover `MediaDownloaderCore` (pure logic), never real downloads.

No linter is configured; MSVC builds use `/W4 /permissive- /utf-8`.

## Architecture

CMake targets:
- `MediaDownloaderCore` (static lib): `Core.cpp` (argument parsing, URL validation, yt-dlp format selector, encode bitrate plan, filename sanitizing, JSON escaping, UTF-8/wide conversion) and `TemporaryFiles.cpp` (orphaned temp dir cleanup). Platform-independent and the only thing tested.
- `MediaDownloaderCli` (output name `MediaDownloader.Cli`): `Main.cpp` holds the commands `doctor`, `probe`, `download`, tool discovery, and the download → probe duration → two-pass encode → move pipeline.
- `MediaDownloader` (Windows only, `Gui.cpp`): Win32 window that runs `MediaDownloader.Cli.exe` from its own directory and reacts to its JSON events.

Process spawning is behind `ChildProcess.h` (`RunProcess`), with `Process.cpp` for Windows and `ProcessPosix.cpp` for macOS/Linux, selected in CMake. It merges stderr into the line callback and supports cancellation via an `atomic_bool`.

Strings are `std::wstring` internally (Windows-first); convert with `WideToUtf8`/`Utf8ToWide` at the edges. `Main.cpp` has both `wmain` (Windows) and `main` (POSIX) entry points.

Key invariants:
- **stdout is the HUB protocol**: only one JSON object per line (`started`, `log`, `progress`, `encodingPlan`, `completed`, `error`, `doctor`). Anything from yt-dlp/FFmpeg must be wrapped as a `log` event, never printed raw. JSON is built by hand with `JsonEscape`. Full contract in `docs/HUB_PROTOCOL.md`; update it when events or options change.
- **Exit codes**: `0` ok, `2` bad arguments, `3` missing tool, `4` processing failure or cancellation.
- **Temp dirs**: work happens in `.mediadownloader-<pid>-<timestamp>` inside the output directory; the final file is moved out only after full validation. On startup, dirs whose PID is no longer running are removed (`CleanupOrphanedTemporaryDirectories`, injectable `isProcessRunning` for tests).
- **Tool lookup order**: `--yt-dlp/--ffmpeg/--ffprobe` → `MEDIADOWNLOADER_YTDLP/_FFMPEG/_FFPROBE` env vars → `tools/bin` next to the project or exe → `PATH`. A JS runtime (Node 22+ or Deno 2.3+) is passed to yt-dlp for YouTube challenges.
- **YouTube auth**: `cookiesFromBrowser` defaults to `auto`, which means `--cookies-from-browser firefox` for YouTube domains only (`IsYouTubeUrl` must reject look-alike hosts). The project never asks for or stores passwords and does not bypass DRM or age gates.
- Only `http(s)` URLs are accepted (`IsSupportedUrl`). `--start-time`/`--end-time` must be given together; the size limit is computed from the clip's duration.
- Default output is the Windows Videos known folder (`FOLDERID_Videos`, indexed by HUB) or `~/Videos` elsewhere.

## Releases

`.github/workflows/release.yml` runs on `v*` tags: builds, tests and packages Windows x64, Linux x64, macOS x64 and arm64, adding the matching `docs/RELEASE_*.md` as `README.txt`. There is no CI on pushes or PRs. When bumping the version, update `CMakeLists.txt` (`project(... VERSION)`), the artifact names in `release.yml`, `CHANGELOG.md`, and `.hub/project.json` (currently lagging at 0.1.0).
