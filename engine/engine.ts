// Download pipeline (doctor, probe, download, update) and the event serializer shared with the host.
// install-host/uninstall-host and the host protocol live elsewhere.
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDownloadSection,
  buildEncodeArguments,
  buildFormatSelector,
  calculateEncodePlan,
  cleanupOrphanedTemporaryDirectories,
  DownloadProgressSmoother,
  type EncodePlan,
  ensureOutputDirectory,
  isTwitterUrl,
  isYouTubeUrl,
  jsonEscape,
  type Options,
  parseDownloadProgressLine,
  parseFfmpegDuration,
  parsePostprocessorStart,
  sanitizeFileName,
  summarizeDownloadFailure,
} from "./core.ts";
import { isProcessRunning, runProcess, systemDirectory } from "./process.ts";

export interface DoctorTool {
  found: boolean;
  path: string;
}

// Mirrors the CLI protocol (docs/CLI_PROTOCOL.md).
export type EngineEvent =
  | { type: "started"; outputDirectory: string }
  | { type: "log"; level: string; message: string }
  | { type: "progress"; stage: string; percent: number; pass?: number } // pass 0/absent = no pass field
  | { type: "phase"; stage: string } // stage without a known percentage: inspection | download | merge
  | { type: "encodingPlan"; durationSeconds: number; videoKbps: number; audioKbps: number }
  | { type: "completed"; path: string; bytes: number }
  | { type: "error"; code: string; message: string }
  | { type: "doctor"; ytDlp: DoctorTool; ffmpeg: DoctorTool; javascriptRuntime: DoctorTool }
  | { type: "probe"; json: string }; // raw yt-dlp --dump-single-json object

export interface EventSink {
  on(event: EngineEvent): void;
}

// One JSON object (no trailing newline), shared by the CLI and the host.
export function serializeEvent(event: EngineEvent): string {
  const s = jsonEscape;
  const tool = (name: string, t: DoctorTool) =>
    `"${name}":{"found":${t.found}${t.found ? `,"path":"${s(t.path)}"` : ""}}`;
  switch (event.type) {
    case "started":
      return `{"type":"started","outputDirectory":"${s(event.outputDirectory)}"}`;
    case "log":
      return `{"type":"log","level":"${s(event.level)}","message":"${s(event.message)}"}`;
    case "progress":
      return `{"type":"progress","stage":"${event.stage}","percent":${event.percent.toFixed(1)}` +
        `${event.pass ? `,"pass":${event.pass}` : ""}}`;
    case "phase":
      return `{"type":"phase","stage":"${event.stage}"}`;
    case "encodingPlan":
      return `{"type":"encodingPlan","durationSeconds":${event.durationSeconds.toFixed(6)},` +
        `"videoKbps":${event.videoKbps},"audioKbps":${event.audioKbps}}`;
    case "completed":
      return `{"type":"completed","path":"${s(event.path)}","bytes":${event.bytes}}`;
    case "error":
      return `{"type":"error","code":"${s(event.code)}","message":"${s(event.message)}"}`;
    case "doctor":
      return `{"type":"doctor","tools":{${tool("yt-dlp", event.ytDlp)},${tool("ffmpeg", event.ffmpeg)},` +
        `${tool("javascript-runtime", event.javascriptRuntime)}}}`;
    case "probe":
      return `{"type":"probe","data":${event.json}}`;
  }
}

export interface EngineConfig {
  // Folder holding tools/bin (default: the parent of engine/, i.e. the launcher's folder).
  rootDirectory?: string;
  // Default output folder (default: the Windows Videos known folder, ~/Videos elsewhere). Tests inject it.
  videosDirectory?: () => Promise<string>;
}

const windows = Deno.build.os === "windows";
const executable = (name: string) => windows ? `${name}.exe` : name;

const isFile = (path: string) => {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
};

const exists = (path: string) => {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
};

function findOnPath(filename: string): string | undefined {
  for (const directory of (Deno.env.get("PATH") ?? "").split(delimiter)) {
    if (directory === "") continue;
    const candidate = join(directory, filename);
    try {
      const info = Deno.statSync(candidate);
      if (info.isFile && (windows || (info.mode! & 0o111) !== 0)) return resolve(candidate);
    } catch { /* next */ }
  }
  return undefined;
}

async function defaultVideosDirectory(): Promise<string> {
  if (!windows) {
    const home = Deno.env.get("HOME");
    if (!home) throw new Error("Le dossier personnel est indisponible");
    return join(home, "Videos");
  }
  // FOLDERID_Videos without FFI: .NET asks the shell for the known folder (and creates it, like KF_FLAG_CREATE).
  const result = await new Deno.Command(join(systemDirectory(), "WindowsPowerShell", "v1.0", "powershell.exe"), {
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8;[Environment]::GetFolderPath('MyVideos','Create')",
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  }).output();
  const path = new TextDecoder().decode(result.stdout).trim();
  if (!result.success || path === "") throw new Error("Le dossier Windows Vidéos est indisponible");
  return path;
}

function uniqueDestination(desired: string, overwrite: boolean): string {
  if (overwrite || !exists(desired)) return desired;
  const extension = extname(desired);
  const stem = basename(desired, extension);
  for (let index = 2; index < 10000; ++index) {
    const candidate = join(dirname(desired), `${stem} (${index})${extension}`);
    if (!exists(candidate)) return candidate;
  }
  throw new Error("Impossible de générer un nom de fichier unique");
}

function findDownloadedFile(directory: string): string | undefined {
  let result: string | undefined;
  let newest = 0;
  try {
    for (const entry of Deno.readDirSync(directory)) {
      if (!entry.isFile || [".part", ".ytdl", ".log"].includes(extname(entry.name).toLowerCase())) continue;
      const path = join(directory, entry.name);
      const timestamp = Deno.statSync(path).mtime?.getTime() ?? 0;
      if (result === undefined || timestamp > newest) [result, newest] = [path, timestamp];
    }
  } catch { /* unreadable: nothing found */ }
  return result;
}

const stem = (path: string) => basename(path, extname(path));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Each method returns the CLI exit code (0 ok, 3 missing tool, 4 failure/cancel). download/probe may throw for
// unexpected failures: callers report "cancelled" if the signal is aborted, "processing_failed" otherwise.
export class Engine {
  readonly #sink: EventSink;
  readonly #signal: AbortSignal;
  readonly #root: string;
  readonly #videos: () => Promise<string>;

  constructor(sink: EventSink, signal: AbortSignal = new AbortController().signal, config: EngineConfig = {}) {
    this.#sink = sink;
    this.#signal = signal;
    this.#root = config.rootDirectory ?? fileURLToPath(new URL("..", import.meta.url));
    this.#videos = config.videosDirectory ?? defaultVideosDirectory;
  }

  #log(level: string, message: string) {
    this.#sink.on({ type: "log", level, message });
  }

  #error(code: string, message: string) {
    this.#sink.on({ type: "error", code, message });
  }

  #progress(stage: string, percent: number, pass = 0) {
    this.#sink.on({ type: "progress", stage, percent: Math.min(Math.max(percent, 0), 100), pass });
  }

  #phase(stage: string) {
    this.#sink.on({ type: "phase", stage });
  }

  // Order: explicit option, environment variable, tools/bin then the root folder, PATH.
  #findTool(explicit: string | undefined, environmentName: string, filename: string): string | undefined {
    if (explicit && isFile(explicit)) return resolve(explicit);
    const fromEnvironment = Deno.env.get(environmentName);
    // Absolute, because tools run with another working directory.
    if (fromEnvironment && isFile(fromEnvironment)) return resolve(fromEnvironment);
    for (const candidate of [join(this.#root, "tools", "bin", filename), join(this.#root, filename)]) {
      if (isFile(candidate)) return resolve(candidate);
    }
    return findOnPath(filename);
  }

  #ytDlp(options: Options) {
    return this.#findTool(options.ytDlp, "MEDIADOWNLOADER_YTDLP", executable("yt-dlp"));
  }

  #ffmpeg(options: Options) {
    return this.#findTool(options.ffmpeg, "MEDIADOWNLOADER_FFMPEG", executable("ffmpeg"));
  }

  // yt-dlp needs a JavaScript runtime for YouTube challenges.
  #appendJavaScriptRuntime(args: string[]): string | undefined {
    for (const [name, environmentName] of [["deno", "MEDIADOWNLOADER_DENO"], ["node", "MEDIADOWNLOADER_NODE"]]) {
      const runtime = this.#findTool(undefined, environmentName, executable(name));
      if (runtime) {
        args.push("--js-runtimes", `${name}:${runtime}`);
        return runtime;
      }
    }
    return undefined;
  }

  // "auto" means Firefox cookies for YouTube only; the project never handles passwords.
  #appendAuthentication(args: string[], options: Options) {
    let browser = options.cookiesFromBrowser;
    if (browser === undefined) return;
    if (browser === "auto") {
      if (!isYouTubeUrl(options.url)) return;
      browser = "firefox";
    }
    args.push("--cookies-from-browser", browser);
  }

  doctor(options: Options): number {
    const ytDlp = this.#ytDlp(options);
    const ffmpeg = this.#ffmpeg(options);
    const javascriptRuntime = this.#appendJavaScriptRuntime([]);
    const tool = (path: string | undefined): DoctorTool => ({ found: path !== undefined, path: path ?? "" });
    this.#sink.on({ type: "doctor", ytDlp: tool(ytDlp), ffmpeg: tool(ffmpeg), javascriptRuntime: tool(javascriptRuntime) });
    // The JS runtime only matters for YouTube; without a YouTube URL it is reported but not required.
    return ytDlp && ffmpeg && (javascriptRuntime || !isYouTubeUrl(options.url)) ? 0 : 3;
  }

  async probe(options: Options): Promise<number> {
    const ytDlp = this.#ytDlp(options);
    if (!ytDlp) {
      this.#error("tool_missing", "yt-dlp est introuvable");
      return 3;
    }
    const args = ["--dump-single-json", "--no-playlist", "--no-warnings", "--quiet"];
    this.#appendJavaScriptRuntime(args);
    this.#appendAuthentication(args, options);
    args.push(options.url);
    const result = await runProcess({ command: ytDlp, args, signal: this.#signal });
    if (result.cancelled) {
      this.#error("cancelled", "Inspection annulée");
      return 4;
    }
    const payload = result.output.trim();
    if (result.exitCode !== 0 || !payload.startsWith("{")) {
      this.#error("probe_failed", payload === "" ? "yt-dlp n'a retourné aucune information" : payload);
      return 4;
    }
    this.#sink.on({ type: "probe", json: payload });
    return 0;
  }

  // Runs `yt-dlp -U`; its output is relayed as log events.
  async update(options: Options): Promise<number> {
    const ytDlp = this.#ytDlp(options);
    if (!ytDlp) {
      this.#error("tool_missing", "yt-dlp est introuvable");
      return 3;
    }
    const result = await runProcess({
      command: ytDlp,
      args: ["-U"],
      onLine: (line) => line.trim() !== "" && this.#log("info", line),
      signal: this.#signal,
    });
    if (result.cancelled) {
      this.#error("cancelled", "Mise à jour annulée");
      return 4;
    }
    if (result.exitCode !== 0) {
      this.#error("update_failed", "La mise à jour de yt-dlp a échoué");
      return 4;
    }
    return 0;
  }

  async download(options: Options): Promise<number> {
    const ytDlp = this.#ytDlp(options);
    if (!ytDlp) {
      this.#error("tool_missing", "yt-dlp est introuvable");
      return 3;
    }
    const ffmpeg = this.#ffmpeg(options);
    if (!ffmpeg) {
      this.#error("tool_missing", "ffmpeg est requis pour assembler les flux vidéo et audio");
      return 3;
    }

    const requested = options.outputDirectory;
    let output = requested === "" ? undefined : ensureOutputDirectory(requested);
    if (output === undefined) {
      // An unusable requested folder does not fail the download: fall back to the Videos folder.
      let videos = "";
      try {
        videos = await this.#videos();
      } catch { /* reported below */ }
      output = videos === "" ? undefined : ensureOutputDirectory(videos);
      if (output === undefined) {
        this.#error(
          "invalid_output_directory",
          "Le dossier Vidéos est inutilisable (ce n'est pas un dossier, il ne peut pas être créé ou il n'est pas accessible en écriture) : " +
            videos,
        );
        return 4;
      }
      if (requested !== "") {
        this.#log(
          "warning",
          `Dossier de sortie inutilisable (${requested}), enregistrement dans le dossier Vidéos : ${output}`,
        );
      }
    }
    const cleanup = cleanupOrphanedTemporaryDirectories(output, isProcessRunning);
    for (const removed of cleanup.removed) this.#log("info", `Dossier temporaire orphelin supprimé : ${removed}`);
    for (const { path, message } of cleanup.failures) this.#log("warning", `Impossible de nettoyer ${path} : ${message}`);

    const ticks = Math.round((performance.timeOrigin + performance.now()) * 1000);
    const temporary = join(output, `.mediadownloader-${Deno.pid}-${ticks}`);
    Deno.mkdirSync(temporary, { recursive: true });
    try {
      return await this.#downloadInto(options, ytDlp, ffmpeg, output, temporary);
    } finally {
      await this.#removeTemporary(temporary);
    }
  }

  async #removeTemporary(path: string) {
    // shortcut: Windows keeps a killed tree's files and working directory locked for a moment, so retry for 2 s.
    for (let attempt = 0;; ++attempt) {
      try {
        await Deno.remove(path, { recursive: true });
        return;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return;
        if (attempt >= 20) {
          this.#log("warning", `Impossible de supprimer le dossier temporaire ${path} : ${(error as Error).message}`);
          return;
        }
        await sleep(100);
      }
    }
  }

  async #downloadInto(options: Options, ytDlp: string, ffmpeg: string, output: string, temporary: string) {
    this.#sink.on({ type: "started", outputDirectory: output });
    this.#phase("inspection");

    const args = [
      "--newline", "--no-color", "--no-playlist", "--windows-filenames", "--no-overwrites",
      "--format", buildFormatSelector(options.quality),
      "--ffmpeg-location", dirname(ffmpeg),
      "--merge-output-format", options.format,
      // The folder is literal text inside a yt-dlp template, where % must be doubled.
      "--output", join(temporary.replaceAll("%", "%%"), "%(title).180B [%(id)s].%(ext)s"),
      // --print implies --quiet, which also silences the progress lines: --progress brings them back and the
      // templates give them a stable, parseable shape (parseDownloadProgressLine / parsePostprocessorStart).
      "--progress",
      "--progress-template",
      "download:__MD_PROGRESS__:%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|" +
      "%(progress.total_bytes_estimate)s|%(progress.fragment_index)s|%(progress.fragment_count)s|%(info.format_id)s",
      "--progress-template", "postprocess:__MD_POST__:%(progress.status)s|%(progress.postprocessor)s",
      "--print", "before_dl:__MD_DL__:%(id)s",
      "--print", "after_move:__MD_FILE__:%(filepath)s",
    ];
    if (!this.#appendJavaScriptRuntime(args) && isYouTubeUrl(options.url)) {
      this.#log("warning", "Aucun runtime JavaScript compatible n'a été trouvé ; certains liens YouTube peuvent échouer.");
    }
    this.#appendAuthentication(args, options);
    // yt-dlp returns [tweet videos..., quoted tweet videos] even with --no-playlist: keep the first one.
    if (isTwitterUrl(options.url)) args.push("--playlist-items", "1");
    if (options.startTimeSeconds !== undefined && options.endTimeSeconds !== undefined) {
      args.push(
        "--download-sections",
        buildDownloadSection(options.startTimeSeconds, options.endTimeSeconds),
        "--force-keyframes-at-cuts",
      );
    }
    args.push(options.url);

    const smoother = new DownloadProgressSmoother();
    let stage = "inspection";
    let lastTenth = -1;
    let reportedPath = "";
    const enter = (next: string) => {
      if (stage !== next) {
        stage = next;
        this.#phase(stage);
      }
    };
    const download = await runProcess({
      command: ytDlp,
      args,
      cwd: temporary,
      signal: this.#signal,
      onLine: (line) => {
        const progress = parseDownloadProgressLine(line);
        if (progress) {
          const percent = smoother.update(progress);
          if (percent === undefined) return enter("download");
          stage = "download";
          // One event per 0.1 % at most: yt-dlp reports far more often than a UI can use.
          const tenth = Math.round(percent * 10);
          if (tenth !== lastTenth) {
            lastTenth = tenth;
            this.#progress(stage, percent);
          }
        } else if (line.startsWith("__MD_DL__:")) enter("download"); // metadata done, the transfer starts
        else if (line.startsWith("__MD_POST__:")) {
          if (parsePostprocessorStart(line) === "Merger") enter("merge");
        } else if (line.startsWith("__MD_FILE__:")) reportedPath = line.slice(12);
        else if (line !== "" && !line.startsWith("[download] Destination:")) this.#log("info", line);
      },
    });
    if (download.cancelled) {
      this.#error("cancelled", "Téléchargement annulé");
      return 4;
    }
    if (download.exitCode !== 0) {
      this.#error("download_failed", summarizeDownloadFailure(download.output));
      return 4;
    }

    const source = reportedPath !== "" && isFile(reportedPath) ? reportedPath : findDownloadedFile(temporary);
    if (source === undefined) {
      this.#error("download_failed", "Le fichier téléchargé est introuvable");
      return 4;
    }

    let completedSource = source;
    const { maxSizeMb } = options;
    if (maxSizeMb !== undefined) {
      const duration = await this.#probeDuration(ffmpeg, source);
      const plan = calculateEncodePlan(duration, maxSizeMb);
      if (!plan) {
        this.#error("size_unreachable", "La durée est trop importante pour la taille demandée");
        return 4;
      }
      completedSource = join(temporary, `${stem(source)}.compressed.mp4`);
      this.#sink.on({ type: "encodingPlan", durationSeconds: duration, videoKbps: plan.videoKbps, audioKbps: plan.audioKbps });
      await this.#encodeToSize(ffmpeg, source, completedSource, duration, plan, options);
      if (!isFile(completedSource)) throw new Error("FFmpeg n'a pas produit le fichier attendu");
      if (Deno.statSync(completedSource).size > Math.floor(maxSizeMb * 1024 * 1024)) {
        this.#error("size_exceeded", "Le fichier encodé dépasse encore la taille maximale demandée");
        return 4;
      }
    }

    let desiredName = basename(completedSource);
    if (maxSizeMb !== undefined) desiredName = `${stem(source)}.mp4`;
    if (options.title !== "") desiredName = sanitizeFileName(options.title) + extname(completedSource);
    const destination = uniqueDestination(join(output, desiredName), options.overwrite);
    if (options.overwrite) {
      try {
        Deno.removeSync(destination);
      } catch { /* absent */ }
    }
    try {
      Deno.renameSync(completedSource, destination);
    } catch {
      throw new Error("Impossible de déplacer le fichier final vers le dossier Vidéos");
    }
    const bytes = Deno.statSync(destination).size;
    this.#progress(maxSizeMb !== undefined ? "encode" : "download", 100, maxSizeMb !== undefined ? 2 : 0);
    this.#sink.on({ type: "completed", path: destination, bytes });
    return 0;
  }

  // `ffmpeg -i` without output exits non-zero but prints the Duration line, so the exit code is ignored.
  async #probeDuration(ffmpeg: string, source: string): Promise<number> {
    const result = await runProcess({
      command: ffmpeg,
      args: ["-hide_banner", "-i", source],
      cwd: dirname(source),
      signal: this.#signal,
    });
    if (result.cancelled) throw new Error("Traitement annulé");
    const duration = parseFfmpegDuration(result.output);
    if (duration === undefined) throw new Error("FFmpeg n'a pas pu déterminer la durée de la vidéo");
    return duration;
  }

  async #encodeToSize(
    ffmpeg: string,
    source: string,
    destination: string,
    duration: number,
    plan: EncodePlan,
    options: Options,
  ) {
    const passLog = join(dirname(source), "ffmpeg-pass");
    for (const pass of [1, 2] as const) {
      const args = buildEncodeArguments(
        source, destination, passLog, plan.videoKbps, plan.audioKbps, options.quality, pass, options.lowResources,
      );
      this.#progress("encode", (pass - 1) * 50, pass); // announces the pass before FFmpeg's first progress line
      const result = await runProcess({
        command: ffmpeg,
        args,
        cwd: dirname(source),
        signal: this.#signal,
        lowPriority: options.lowResources,
        onWarning: (message) => this.#log("warning", message),
        onLine: (line) => {
          if (!line.startsWith("out_time_us=")) return;
          const microseconds = Number.parseFloat(line.slice(12));
          if (Number.isNaN(microseconds)) return;
          const passPercent = microseconds / (duration * 1_000_000) * 100;
          this.#progress("encode", (pass - 1) * 50 + Math.min(Math.max(passPercent, 0), 100) * 0.5, pass);
        },
      });
      if (result.cancelled) throw new Error("Traitement annulé");
      if (result.exitCode !== 0) throw new Error(`FFmpeg a échoué pendant l'encodage passe ${pass}`);
    }
  }
}
