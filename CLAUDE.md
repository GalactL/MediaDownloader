# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A native C++20 engine that downloads videos with `yt-dlp` and optionally re-encodes them with FFmpeg to fit a size limit (e.g. 10 MB for Discord). It is an independent tool with two front ends over one engine: the CLI (any caller can launch it as a child process and parse its stdout) and a Firefox native-messaging host (`MediaDownloader.Cli host`).

User-facing strings, docs, README and CHANGELOG are written in French; keep them in French. Commit messages are in English.

## Build and test

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build -C Release --output-on-failure
```

On Windows, `node tools/build-native.mjs` does a fresh configure + Release build (it de-duplicates the `Path`/`PATH` env vars that break MSBuild); `--engine-only` builds just the CLI and tests. `tools/install-dependencies.ps1` downloads `yt-dlp`, `ffmpeg`, `ffprobe` into `tools/bin/` (gitignored), which CMake copies next to `MediaDownloader.Cli`.

Tests are a single hand-rolled executable, `tests/CoreTests.cpp` (no framework: a `Check(cond, msg)` helper, non-zero exit on any failure). To run it directly: `./build/MediaDownloaderTests`. There is no way to run a single case; add new checks to `main()` there. Tests only cover `MediaDownloaderCore` (pure logic), never real downloads.

No linter is configured; MSVC builds use `/W4 /permissive- /utf-8`.

## Architecture

CMake targets:
- `MediaDownloaderCore` (static lib): `Core.cpp` (argument parsing, URL validation, yt-dlp format selector, encode bitrate plan, filename sanitizing, JSON escaping, UTF-8/wide conversion) and `TemporaryFiles.cpp` (orphaned temp dir cleanup). Platform-independent and the only thing tested.
- `MediaDownloaderCli` (output name `MediaDownloader.Cli`): `Main.cpp` is only the CLI front end (argument dispatch, `EventSink` printing JSON lines to stdout). The pipeline (`doctor`, `probe`, `download`, tool discovery, download → probe duration → two-pass encode → move) lives in `Engine.cpp`/`Engine.h`: `Engine` emits typed events to an `EventSink`. `Host.cpp` implements the `host` command (length-prefixed JSON on stdin/stdout, one job at a time) on top of `Engine`; see `docs/NATIVE_HOST_PROTOCOL.md`.

- `extension/` (Firefox WebExtension, plain JS, no build; tests: `node --test extension/test/lib.test.js`): in-page menu on YouTube that talks to the host through `runtime.connectNative`. Packaged as `mediadownloader.xpi` by the `extension` job of `release.yml` (signed with `web-ext` when the AMO secrets exist; see `docs/EXTENSION_SIGNATURE.md`). Its id `mediadownloader@localhost` must match `ExtensionId` in `Engine::InstallHost`.

Process spawning is behind `ChildProcess.h` (`RunProcess`), with `Process.cpp` for Windows and `ProcessPosix.cpp` for macOS/Linux, selected in CMake. It merges stderr into the line callback and supports cancellation via an `atomic_bool`.

Strings are `std::wstring` internally (Windows-first); convert with `WideToUtf8`/`Utf8ToWide` at the edges. `Main.cpp` has both `wmain` (Windows) and `main` (POSIX) entry points.

Key invariants:
- **stdout is the CLI protocol**: only one JSON object per line (`started`, `log`, `progress`, `encodingPlan`, `completed`, `error`, `doctor`). Anything from yt-dlp/FFmpeg must be wrapped as a `log` event, never printed raw. JSON is built by hand with `JsonEscape`. Full contract in `docs/CLI_PROTOCOL.md`; update it when events or options change.
- **Exit codes**: `0` ok, `2` bad arguments, `3` missing tool, `4` processing failure or cancellation.
- **Host auto-detection and `install-host`**: `IsNativeHostLaunch` (Core.cpp) makes `Main.cpp` switch to `host` when the first argument is a `.json` manifest path or an extension id, so the manifest points straight at the exe (no wrapper). `install-host` (no arguments) writes the manifest via `BuildNativeManifest`/`NativeManifestPath` (plus the `HKCU` registry key on Windows); its success message goes to stderr, stdout stays empty.
- **Temp dirs**: work happens in `.mediadownloader-<pid>-<timestamp>` inside the output directory; the final file is moved out only after full validation. On startup, dirs whose PID is no longer running are removed (`CleanupOrphanedTemporaryDirectories`, injectable `isProcessRunning` for tests).
- **Tool lookup order**: `--yt-dlp/--ffmpeg/--ffprobe` → `MEDIADOWNLOADER_YTDLP/_FFMPEG/_FFPROBE` env vars → `tools/bin` next to the project or exe → `PATH`. A JS runtime (Node 22+ or Deno 2.3+) is passed to yt-dlp for YouTube challenges.
- **YouTube auth**: `cookiesFromBrowser` defaults to `auto`, which means `--cookies-from-browser firefox` for YouTube domains only (`IsYouTubeUrl` must reject look-alike hosts). The project never asks for or stores passwords and does not bypass DRM or age gates.
- Only `http(s)` URLs are accepted (`IsSupportedUrl`). `--start-time`/`--end-time` must be given together; the size limit is computed from the clip's duration.
- **`host` command**: stdout carries only framed messages (4-byte native-endian length + UTF-8 JSON; in max 4 MiB, out max 1 MiB), never raw text. Keep `docs/NATIVE_HOST_PROTOCOL.md` in sync. `MediaDownloader.Cli install-host` (manifest built in code by `BuildNativeManifest`, registry on Windows) registers it with Firefox.
- Default output is the Windows Videos known folder (`FOLDERID_Videos`) or `~/Videos` elsewhere.

## Releases

`.github/workflows/release.yml` runs on `v*` tags: builds, tests and packages Windows x64, Linux x64, macOS x64 and arm64, adding `mediadownloader.xpi`, Deno in `tools/bin` (Linux also bundles `yt-dlp_linux` as `yt-dlp`, checked against the release's SHA2-256SUMS, and a static GPL `ffmpeg`/`ffprobe` from BtbN/FFmpeg-Builds, checked against its `checksums.sha256`; macOS still needs Homebrew tools; keep the GPL notice in `docs/RELEASE_LINUX.md`) and the matching `docs/RELEASE_*.md` as `README.txt`. Install story (README and each RELEASE doc): unzip, `MediaDownloader.Cli install-host`, drag the `.xpi` into Firefox. `.github/workflows/ci.yml` builds and tests on PRs (Windows, Linux, macOS, plus the extension tests); there is no CI on pushes. When bumping the version, update `CMakeLists.txt` (`project(... VERSION)`), the artifact names in `release.yml`, `CHANGELOG.md`, and `.hub/project.json`.
