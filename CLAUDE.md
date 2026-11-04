# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A TypeScript engine, run by Deno, that downloads videos with `yt-dlp` and optionally re-encodes them with FFmpeg to fit a size limit (e.g. 10 MB for Discord). It is an independent tool with two front ends over one engine: the CLI (any caller can launch it as a child process and parse its stdout) and a native-messaging host for Firefox and Chromium browsers (`MediaDownloader.Cli host`). The former C++ engine was removed (issue #61).

User-facing strings, docs, README and CHANGELOG are written in French; keep them in French. Commit messages are in English.

## Build and test

There is no build step. Install Deno at the version in `engine/deps.json` (CI reads it from there) and Node 22+:

```bash
deno check engine/*.ts engine/test/*.ts tests/fake-tools/*.ts
deno test -A engine/test                     # or a single file: deno test -A engine/test/core.test.ts
node --test extension/test/*.test.js tools/fetch-signed-xpi.test.mjs
sh -n packaging/install.sh packaging/uninstall.sh packaging/MediaDownloader.Cli   # Linux
```

Tests drive the real entry points against fake tools (`tests/fake-tools/`), never real downloads, and check the dependency manifest offline. To fetch the pinned tools into `tools/bin/` (gitignored) from a checkout: `deno run --no-check --allow-net --allow-read --allow-write --allow-run --allow-env=SystemRoot engine/deps.ts` (`--check` verifies without installing). To run the CLI from a checkout, copy a launcher from `packaging/` to the repo root, or use `deno run` with the permissions of `engine/permissions.ts`.

## Architecture

- `engine/` (TypeScript, no bundler): `main.ts` is the CLI front end (argument dispatch, JSON lines on stdout); `core.ts` is the pure logic (argument parsing, URL validation, yt-dlp format selector, encode bitrate plan, filename sanitizing, native manifests); `engine.ts` is the pipeline (`doctor`, `probe`, `download`, `update`, tool discovery, download -> probe duration -> two-pass encode -> move) emitting typed events; `host.ts` implements the `host` command (length-prefixed JSON on stdin/stdout, one job at a time; see `docs/NATIVE_HOST_PROTOCOL.md`); `install.ts` does `install-host`/`uninstall-host`; `process.ts` spawns children (cancellation, process-tree kill); `deps.ts` + `deps.json` download and verify the pinned Deno/yt-dlp/FFmpeg (SHA-256, HTTPS only); `permissions.ts` is the Deno permission set.
- `packaging/`: launchers `MediaDownloader.Cli.bat` / `MediaDownloader.Cli` (run `engine/main.ts` with `tools/bin/deno` and exactly the permissions of `permissions.ts`, checked by `engine/test/contract.test.ts`), and `Installer.bat`/`Desinstaller.bat`, `install.sh`/`uninstall.sh`. The installers inline the Deno entry of `deps.json` (checked by `engine/test/deps.test.ts`), download Deno, then run `engine/deps.ts` for yt-dlp and FFmpeg, then `install-host`.
- `extension/` (WebExtension, plain JS, no build; tests: `node --test extension/test/*.test.js`): in-page menu on YouTube, X, TikTok and Instagram that talks to the host through `runtime.connectNative`. Packaged as `mediadownloader.xpi` by the `extension` job of `release.yml` (signed with `web-ext` when the AMO secrets exist; see `docs/EXTENSION_SIGNATURE.md`). Its id `mediadownloader@localhost` must match `extensionId` in `engine/install.ts`. The same code also ships as an unpacked Chromium MV3 extension (`manifest.chromium.json` + `shim.js`, `tools/make-chromium-zip.sh` -> `mediadownloader-chromium.zip`); its fixed id comes from the manifest `key` and must equal `chromiumExtensionId` in `engine/core.ts` (checked by `extension/test/chromium.test.js`); `install-host` also writes the Chromium host manifests (`allowed_origins`) for Chrome, Brave and Opera.

Key invariants:
- **stdout is the CLI protocol**: only one JSON object per line (`started`, `log`, `progress`, `encodingPlan`, `completed`, `error`, `doctor`). Anything from yt-dlp/FFmpeg must be wrapped as a `log` event, never printed raw. Full contract in `docs/CLI_PROTOCOL.md`; update it when events or options change.
- **Untrusted strings never go through the `.bat`**: cmd.exe mis-parses `"` and `&` (command injection with an untrusted URL; Deno escapes `\"` which cmd does not understand), and Node 18.20+/Rust refuse to spawn a `.bat` without a shell. Programmatic callers run `tools\bin\deno.exe` directly with an argument array (see "Appel programmatique" in `docs/CLI_PROTOCOL.md`). The `.bat` is for Firefox/Chromium and humans only; the sh launcher uses `exec` and is safe with argument arrays.
- **Exit codes**: `0` ok, `2` bad arguments, `3` missing tool, `4` processing failure or cancellation.
- **Launchers and host**: the host manifests point at the launcher (a `.bat` on Windows; the T0 spike observed Firefox 159 starting it through `cmd.exe /s /c` without `/d`, so a `cmd` `AutoRun` that prints text may corrupt stdout, but that consequence was not tested). The engine switches to `host` when the first argument is a `.json` manifest path, an extension id or a Chromium origin. `install-host` (no arguments) writes the manifests (plus `HKCU` keys on Windows); its success message goes to stderr, stdout stays empty. `.bat` files need CRLF and shell scripts LF (`.gitattributes`). The install folder must not contain a comma (Deno splits permission lists on commas).
- **Temp dirs**: work happens in `.mediadownloader-<pid>-<timestamp>` inside the output directory; the final file is moved out only after full validation. On startup, dirs whose PID is no longer running are removed.
- **Tool lookup order**: `--yt-dlp/--ffmpeg` (`--ffprobe` is parsed and ignored) -> `MEDIADOWNLOADER_YTDLP/_FFMPEG` env vars -> `tools/bin` next to the launcher -> `PATH`. Duration comes from `ffmpeg -i`, there is no ffprobe. `update` runs `yt-dlp -U`; `uninstall-host` undoes `install-host`. A JS runtime (the bundled Deno, or Node 22+) is passed to yt-dlp for YouTube challenges.
- **YouTube auth**: `cookiesFromBrowser` defaults to `auto`, which means `--cookies-from-browser firefox` for YouTube domains only (`isYouTubeUrl` must reject look-alike hosts). The project never asks for or stores passwords and does not bypass DRM or age gates.
- Only `http(s)` URLs are accepted. `--start-time`/`--end-time` must be given together; the size limit is computed from the clip's duration.
- **`host` command**: stdout carries only framed messages (4-byte native-endian length + UTF-8 JSON; in max 4 MiB, out max 1 MiB), never raw text; the host keeps reading stdin during a job and cancels (kills the yt-dlp/FFmpeg tree) on EOF. Keep `docs/NATIVE_HOST_PROTOCOL.md` in sync.
- **Downloads**: third-party tools come only from `engine/deps.json` (pinned version, URL, SHA-256, size); nothing is installed unless the hash matches, and `tools/bin` is untouched on failure.
- Default output is the Windows Videos known folder (`FOLDERID_Videos`) or `~/Videos` elsewhere.
- Supported platforms: Windows x64 and Linux x64. macOS was dropped.

## Releases

`.github/workflows/release.yml` runs on `v*` tags: a `test` job (types, Deno tests, extension tests) gates the `extension` job (AMO signing, once, via `tools/make-xpi.sh`); the `package` job (one, on ubuntu) rebuilds the `.xpi` (it reuses the signed one) and the Chromium zip, then assembles `MediaDownloader-<version>-Windows-x64.zip` and `MediaDownloader-<version>-Linux-x64.tar.gz` (tar keeps the exec bits): `engine/` without `test/`, the launcher, the installer scripts from `packaging/`, both extensions and `docs/RELEASE_*.md` as `README.txt`. **No third-party binary goes in an archive**: a size gate fails the job above 1 MiB and a check rejects `tools/`, `.exe` and `.dll`. The job attaches the archives, the `.xpi` and the Chromium zip with `softprops/action-gh-release` (no `upload-artifact`/`download-artifact`: GitHub artifact storage quota must not block releases). Install story (README and each RELEASE doc): unzip, run `Installer.bat` / `install.sh` (they download the pinned Deno, yt-dlp and FFmpeg, run `install-host`, then open the `.xpi` in Firefox), uninstall with `Desinstaller.bat` / `uninstall.sh`. FFmpeg is the BtbN autobuild `gpl` variant (built with `--enable-gpl --enable-version3`) downloaded at install time, not shipped; keep the LICENCES section of `docs/RELEASE_*.md` accurate when bumping it in `deps.json`. `.github/workflows/ci.yml` runs on PRs (Windows and Linux engine job with Deno pinned from `deps.json`, plus the extension job); there is no CI on pushes. When bumping the version, update `VERSION` in `release.yml`, `CHANGELOG.md`, `.hub/project.json`, `extension/manifest.json`, `extension/manifest.chromium.json`, the version string in `engine/main.ts` (`help`) and the title line of `docs/RELEASE_*.md`.
