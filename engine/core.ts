// Pure core of the engine: argument parsing, URL checks, format selector, encode plan, manifests, temp dir cleanup.
// User-facing strings stay in French (they are part of the CLI/host contract).
import { join, posix, resolve, win32 } from "node:path";

export type Command =
  | "help"
  | "doctor"
  | "probe"
  | "download"
  | "host"
  | "install-host"
  | "update"
  | "uninstall-host";

export type HostPlatform = "windows" | "linux";

export interface Options {
  command: Command;
  url: string;
  outputDirectory: string;
  quality: string;
  format: string;
  title: string;
  cookiesFromBrowser?: string;
  maxSizeMb?: number;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
  ytDlp?: string;
  ffmpeg?: string;
  ffprobe?: string; // parsed and ignored (there is no ffprobe)
  overwrite: boolean;
  lowResources: boolean; // FFmpeg with 2 threads (--low-resources)
}

export interface ParseResult {
  options?: Options;
  error: string;
}

export interface EncodePlan {
  targetBytes: number;
  audioKbps: number;
  videoKbps: number;
}

const lower = (value: string) => value.toLowerCase();

// Strict decimal number (no hex floats, inf or nan). Overflow gives Infinity -> rejected.
function parseFinite(value: string): number | undefined {
  if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePositive(value: string): number | undefined {
  const parsed = parseFinite(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function parseNonNegative(value: string): number | undefined {
  const parsed = parseFinite(value);
  return parsed !== undefined && !(parsed < 0) ? parsed : undefined;
}

const isResolution = (value: string) => /^[0-9]+$/.test(value);

const browsers = ["auto", "brave", "chrome", "chromium", "edge", "firefox", "opera", "vivaldi"];

export function parseArguments(args: readonly string[]): ParseResult {
  const result: Options = {
    command: "help",
    url: "",
    outputDirectory: "",
    quality: "best",
    format: "mp4",
    title: "",
    cookiesFromBrowser: "auto",
    overwrite: false,
    lowResources: false,
  };
  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    return { options: result, error: "" };
  }

  const command = lower(args[0]);
  const noArgs = (name: Command): ParseResult => {
    if (args.length > 1) return { error: `${name} n'accepte aucun argument : ${args[1]}` };
    return { options: { ...result, command: name }, error: "" };
  };
  if (command === "doctor" || command === "probe" || command === "download") result.command = command;
  else if (command === "install-host" || command === "uninstall-host" || command === "update") return noArgs(command);
  else if (command === "host") return { options: { ...result, command: "host" }, error: "" }; // Firefox appends extra argv: ignored
  else return { error: `Commande inconnue : ${args[0]}` };

  for (let index = 1; index < args.length; ++index) {
    const name = args[index];
    if (name === "--overwrite") {
      result.overwrite = true;
      continue;
    }
    if (name === "--low-resources") {
      result.lowResources = true;
      continue;
    }
    if (index + 1 >= args.length) return { error: `Valeur manquante après ${name}` };
    const value = args[++index];
    if (name === "--url") result.url = value;
    else if (name === "--output") result.outputDirectory = value;
    else if (name === "--quality") result.quality = lower(value);
    else if (name === "--format") result.format = lower(value);
    else if (name === "--title") result.title = value;
    else if (name === "--start-time") {
      const parsed = parseNonNegative(value);
      if (parsed === undefined) return { error: "Le début de la plage doit être un nombre fini supérieur ou égal à 0." };
      result.startTimeSeconds = parsed;
    } else if (name === "--end-time") {
      const parsed = parseNonNegative(value);
      if (parsed === undefined) return { error: "La fin de la plage doit être un nombre fini supérieur ou égal à 0." };
      result.endTimeSeconds = parsed;
    } else if (name === "--cookies-from-browser") result.cookiesFromBrowser = lower(value);
    else if (name === "--max-size-mb") {
      const parsed = parsePositive(value);
      if (parsed === undefined) return { error: "La taille maximale doit être un nombre strictement positif." };
      result.maxSizeMb = parsed;
    } else if (name === "--yt-dlp") result.ytDlp = value;
    else if (name === "--ffmpeg") result.ffmpeg = value;
    else if (name === "--ffprobe") result.ffprobe = value;
    else return { error: `Option inconnue : ${name}` };
  }

  if ((result.command === "probe" || result.command === "download") && result.url === "") {
    return { error: "L'option --url est obligatoire." };
  }
  if (result.url !== "" && !isSupportedUrl(result.url)) return { error: "Seules les URL HTTP et HTTPS sont acceptées." };
  if (result.quality !== "best" && !isResolution(result.quality)) {
    return { error: "La qualité doit être best ou une hauteur telle que 720 ou 1080." };
  }
  if (!["mp4", "mkv", "webm"].includes(result.format)) return { error: "Le format doit être mp4, mkv ou webm." };
  if (result.maxSizeMb !== undefined && result.format !== "mp4") {
    return { error: "La limitation de taille produit actuellement un fichier MP4." };
  }
  if (result.title.length > 180) return { error: "Le titre personnalisé est limité à 180 caractères." };
  const { startTimeSeconds: start, endTimeSeconds: end } = result;
  if ((start === undefined) !== (end === undefined)) {
    return { error: "Les options --start-time et --end-time doivent être fournies ensemble." };
  }
  if (start !== undefined && end! <= start) return { error: "La fin de la plage doit être strictement supérieure au début." };
  if (result.cookiesFromBrowser !== undefined && !browsers.includes(result.cookiesFromBrowser)) {
    return { error: "Navigateur non pris en charge pour l'authentification." };
  }
  return { options: result, error: "" };
}

// Firefox launches the host with the manifest path and/or the extension id as first argument; Chromium with the origin.
export function isNativeHostLaunch(args: readonly string[]): boolean {
  if (args.length === 0) return false;
  const first = lower(args[0]);
  if (first === "" || first[0] === "-" || /[ \t]/.test(first)) return false;
  if (first.length > 5 && first.endsWith(".json")) return true;
  if (first.startsWith("chrome-extension://")) return true;
  const at = first.indexOf("@");
  if (at > 0 && at + 1 < first.length) return true;
  return first.length > 2 && first[0] === "{" && first[first.length - 1] === "}";
}

const manifestDescription = "MediaDownloader : télécharge et convertit des vidéos avec yt-dlp et FFmpeg.";

// Extension id derived from the public key in extension/manifest.chromium.json (checked in JS tests).
export const chromiumExtensionId = "jjclljkpbmlceplpicnjkmkjifhhghne";

// Firefox native-messaging manifest; `exePath` is the launcher itself.
export function buildNativeManifest(exePath: string, extensionId: string): string {
  return `{\n  "name": "media_downloader",\n  "description": "${manifestDescription}",\n` +
    `  "path": "${jsonEscape(exePath)}",\n  "type": "stdio",\n` +
    `  "allowed_extensions": ["${jsonEscape(extensionId)}"]\n}\n`;
}

// Chrome, Brave and Opera use allowed_origins instead of allowed_extensions.
export function buildChromiumNativeManifest(exePath: string): string {
  return `{\n  "name": "media_downloader",\n  "description": "${manifestDescription}",\n` +
    `  "path": "${jsonEscape(exePath)}",\n  "type": "stdio",\n` +
    `  "allowed_origins": ["chrome-extension://${chromiumExtensionId}/"]\n}\n`;
}

// Windows: one file next to the launcher (registry keys point to it); Linux: one per browser under ~/.config.
export function chromiumManifestPaths(platform: HostPlatform, home: string, exeDirectory: string): string[] {
  if (platform === "windows") return [win32.join(exeDirectory, "native-host", "media_downloader.chromium.json")];
  return ["google-chrome", "chromium", "BraveSoftware/Brave-Browser", "opera"]
    .map((browser) => posix.join(home, ".config", browser, "NativeMessagingHosts", "media_downloader.json"));
}

// HKCU keys whose default value is the Chromium manifest path.
export function chromiumRegistryKeys(): string[] {
  return [
    "Software\\Google\\Chrome\\NativeMessagingHosts\\media_downloader",
    "Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\media_downloader",
    "Software\\Opera Software\\Opera Stable\\NativeMessagingHosts\\media_downloader",
  ];
}

export function nativeManifestPath(platform: HostPlatform, home: string, exeDirectory: string): string {
  // Joined with the target platform's separator, not the machine's.
  return platform === "windows"
    ? win32.join(exeDirectory, "native-host", "media_downloader.json")
    : posix.join(home, ".mozilla", "native-messaging-hosts", "media_downloader.json");
}

export function isSupportedUrl(value: string): boolean {
  const v = lower(value);
  return v.startsWith("https://") || v.startsWith("http://");
}

function isHostOrSubdomainOf(value: string, domains: readonly string[]): boolean {
  const v = lower(value);
  const scheme = v.indexOf("://");
  if (scheme < 0) return false;
  const start = scheme + 3;
  const end = v.slice(start).search(/[/?#]/);
  let authority = end < 0 ? v.slice(start) : v.slice(start, start + end);
  authority = authority.slice(authority.lastIndexOf("@") + 1); // drop userinfo (look-alike trick)
  const colon = authority.indexOf(":");
  if (colon >= 0) authority = authority.slice(0, colon);
  return domains.some((domain) => authority === domain || authority.endsWith("." + domain));
}

export const isYouTubeUrl = (value: string) =>
  isHostOrSubdomainOf(value, ["youtube.com", "youtu.be", "youtube-nocookie.com"]);

export const isTwitterUrl = (value: string) => isHostOrSubdomainOf(value, ["x.com", "twitter.com"]);

// Duration in seconds from the "Duration: HH:MM:SS.xx" line of `ffmpeg -i`; undefined if absent, N/A or zero.
export function parseFfmpegDuration(output: string): number | undefined {
  const key = "Duration:";
  const at = output.indexOf(key);
  if (at < 0) return undefined;
  const text = output.slice(at + key.length, at + key.length + 16); // 16-char window after the key
  const match = /^\s*(\d+):(\d+):(\d+(?:\.\d*)?|\.\d+)/.exec(text);
  if (!match) return undefined;
  const total = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

export function buildFormatSelector(quality: string): string {
  if (quality === "best") return "bestvideo+bestaudio/best";
  return `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
}

// yt-dlp --download-sections value. Shortest round-trip number text (the former C++ engine printed 17 significant digits).
export function buildDownloadSection(startTimeSeconds: number, endTimeSeconds: number): string {
  return `*${startTimeSeconds}-${endTimeSeconds}`;
}

const reservedNames = new Set([
  "CON", "PRN", "AUX", "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

export function sanitizeFileName(value: string): string {
  let result = "";
  for (let i = 0; i < value.length && result.length < 140; ++i) { // UTF-16 units, as wchar_t on Windows
    const c = value.charCodeAt(i);
    const invalid = c < 32 || '<>:"/\\|?*'.includes(value[i]);
    result += invalid ? "_" : value[i];
  }
  result = result.replace(/^[ .]+/, "").replace(/[ .]+$/, "");
  if (result === "") result = "video";
  if (reservedNames.has(result.toUpperCase().split(".")[0])) result = "_" + result;
  return result;
}

export function summarizeDownloadFailure(output: string): string {
  const text = output.toLowerCase();
  const has = (s: string) => text.includes(s);
  if (has("could not copy") && has("cookie")) {
    return "Impossible de lire les cookies du navigateur. Fermez complètement le navigateur sélectionné, puis réessayez.";
  }
  if (has("failed to decrypt with dpapi") || ((has("decrypt") || has("dpapi")) && has("cookie"))) {
    return "Windows n'a pas pu déchiffrer les cookies de ce navigateur Chromium. Utilisez de préférence Firefox connecté à YouTube, puis fermez-le avant de réessayer.";
  }
  if (has("sign in to confirm your age") || has("confirm your age")) {
    return "YouTube n'a pas reconnu une session autorisée pour cette vidéo. Vérifiez le navigateur sélectionné et l'âge du compte.";
  }
  if (has("sign in to confirm you're not a bot") || has("sign in to confirm you’re not a bot")) {
    return "YouTube demande une session connectée valide. Sélectionnez le navigateur où YouTube est ouvert avec votre compte.";
  }
  if (has("requested format is not available")) {
    return "La qualité ou le format demandé n'est pas disponible pour cette vidéo. Essayez la qualité Best.";
  }
  if (has("video unavailable")) return "Cette vidéo est indisponible pour le compte ou la région actuellement utilisés.";
  if (has("challenge solving failed") || has("page needs to be reloaded")) {
    return "Le challenge JavaScript de YouTube n'a pas pu être résolu. Vérifiez qu'un runtime Node ou Deno récent est disponible.";
  }

  let lastError = "";
  for (const raw of output.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("ERROR:")) lastError = line.slice(6);
  }
  lastError = lastError.replace(/^[ \t]+/, "");
  return lastError === "" ? "yt-dlp n'a pas pu télécharger cette vidéo." : lastError;
}

// Two-pass x264 plan: 3 % of the limit is kept for the container; audio tier depends on the total budget.
export function calculateEncodePlan(durationSeconds: number, maxSizeMb: number): EncodePlan | undefined {
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(maxSizeMb) || durationSeconds <= 0 || maxSizeMb <= 0) {
    return undefined;
  }
  const targetBytes = maxSizeMb * 1024 * 1024 * 0.97; // MiB, as Windows displays sizes
  if (targetBytes > 2 ** 64) return undefined;
  const totalKbps = targetBytes * 8 / durationSeconds / 1000;
  const audioKbps = totalKbps >= 320 ? 128 : totalKbps >= 200 ? 96 : 48;
  const minimumVideoKbps = 80;
  if (totalKbps <= audioKbps + minimumVideoKbps) return undefined;
  return { targetBytes: Math.floor(targetBytes), audioKbps, videoKbps: Math.floor(totalKbps - audioKbps) };
}

// FFmpeg arguments of one x264 pass (1 or 2). `lowResources` only adds "-threads 2"; priority is the caller's concern.
export function buildEncodeArguments(
  source: string,
  destination: string,
  passLog: string,
  videoKbps: number,
  audioKbps: number,
  quality: string,
  pass: 1 | 2,
  lowResources: boolean,
  platform: HostPlatform = hostPlatform(),
): string[] {
  const args = [
    "-y", "-i", source, "-map", "0:v:0", "-c:v", "libx264", "-preset", "medium",
    "-b:v", `${videoKbps}k`, "-pass", String(pass), "-passlogfile", passLog,
  ];
  if (lowResources) args.push("-threads", "2");
  args.push("-progress", "pipe:1", "-nostats");
  if (quality !== "best") args.splice(5, 0, "-vf", `scale=-2:min(ih\\,${quality})`);
  if (pass === 1) args.push("-an", "-f", "null", platform === "windows" ? "NUL" : "/dev/null");
  else {
    args.push("-map", "0:a:0?", "-c:a", "aac", "-b:a", `${audioKbps}k`, "-movflags", "+faststart", destination);
  }
  return args;
}

export function hostPlatform(): HostPlatform {
  return Deno.build.os === "windows" ? "windows" : "linux";
}

// --- yt-dlp progress lines (frozen contract, see docs/CLI_PROTOCOL.md) ---

const progressPrefix = "__MD_PROGRESS__:";
const postprocessPrefix = "__MD_POST__:";

export interface DownloadProgressLine {
  status: string; // downloading | finished | error
  downloadedBytes?: number;
  totalBytes?: number;
  fragmentIndex?: number;
  fragmentCount?: number;
  formatId: string;
}

// "NA" (yt-dlp's marker for a missing field), empty, negative or non-numeric -> undefined.
function parseField(text: string): number | undefined {
  if (text === "" || text === "NA") return undefined;
  const value = parseNonNegative(text);
  return value;
}

export function parseDownloadProgressLine(line: string): DownloadProgressLine | undefined {
  if (!line.startsWith(progressPrefix)) return undefined;
  // status|downloaded_bytes|total_bytes|total_bytes_estimate|fragment_index|fragment_count|format_id
  const fields = line.slice(progressPrefix.length).split("|");
  if (fields.length !== 7 || fields[0] === "") return undefined;
  return {
    status: fields[0],
    downloadedBytes: parseField(fields[1]),
    totalBytes: parseField(fields[2]) ?? parseField(fields[3]),
    fragmentIndex: parseField(fields[4]),
    fragmentCount: parseField(fields[5]),
    formatId: fields[6] === "NA" ? "" : fields[6],
  };
}

// "__MD_POST__:started|Merger" -> "Merger"; any other line (including "finished") -> undefined.
export function parsePostprocessorStart(line: string): string | undefined {
  if (!line.startsWith(postprocessPrefix)) return undefined;
  const fields = line.slice(postprocessPrefix.length).split("|");
  return fields.length === 2 && fields[0] === "started" && fields[1] !== "" ? fields[1] : undefined;
}

// Turns per-stream yt-dlp progress into one monotonic 0-100 percent: first stream (video) covers 0-85,
// the following ones (audio) 85-100.
// shortcut: stream sizes are unknown up front, so a single-file download stops at 85 until the real end.
export class DownloadProgressSmoother {
  #formatId = "";
  #started = false;
  #stream = 0;
  #last = 0;

  update(line: DownloadProgressLine): number | undefined {
    if (this.#started && line.formatId !== this.#formatId) ++this.#stream;
    this.#started = true;
    this.#formatId = line.formatId;

    let fraction: number | undefined;
    if (line.status === "finished") fraction = 1;
    else if (line.downloadedBytes !== undefined && line.totalBytes !== undefined && line.totalBytes > 0) {
      fraction = line.downloadedBytes / line.totalBytes;
    } else if (line.fragmentIndex !== undefined && line.fragmentCount !== undefined && line.fragmentCount > 0) {
      fraction = line.fragmentIndex / line.fragmentCount;
    }
    if (fraction === undefined) return undefined;

    const within = Math.min(Math.max(fraction, 0), 1);
    const percent = this.#stream === 0 ? within * 85 : 85 + within * 15;
    this.#last = Math.max(this.#last, percent);
    return this.#last;
  }
}

// Escapes for embedding in a JSON string. Non-ASCII (including non-BMP) passes through untouched.
export function jsonEscape(value: string): string {
  let out = "";
  for (const ch of value) {
    switch (ch) {
      case '"': out += '\\"'; break;
      case "\\": out += "\\\\"; break;
      case "\b": out += "\\b"; break;
      case "\f": out += "\\f"; break;
      case "\n": out += "\\n"; break;
      case "\r": out += "\\r"; break;
      case "\t": out += "\\t"; break;
      default:
        out += ch < " " ? "\\u00" + ch.charCodeAt(0).toString(16).padStart(2, "0") : ch;
    }
  }
  return out;
}

// --- filesystem (thin seam so tests can inject a fake) ---

export interface FsOps {
  readDir(path: string): { name: string; isDirectory: boolean }[]; // throws if unreadable
  removeAll(path: string): void; // throws on failure
  makeDirs(path: string): void;
  isDirectory(path: string): boolean;
  writeFile(path: string, text: string): void;
  removeFile(path: string): void;
}

export const denoFs: FsOps = {
  readDir: (path) => [...Deno.readDirSync(path)].map((e) => ({ name: e.name, isDirectory: e.isDirectory })),
  removeAll: (path) => Deno.removeSync(path, { recursive: true }),
  makeDirs: (path) => Deno.mkdirSync(path, { recursive: true }),
  isDirectory: (path) => Deno.statSync(path).isDirectory,
  writeFile: (path, text) => Deno.writeTextFileSync(path, text),
  removeFile: (path) => Deno.removeSync(path),
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Resolves `requested` to an absolute path, creates it and checks it is writable (probe file created then removed).
// Returns undefined when unusable (file, rights, read-only, invalid path). Never throws.
export function ensureOutputDirectory(requested: string, fs: FsOps = denoFs): string | undefined {
  try {
    const resolved = resolve(requested);
    fs.makeDirs(resolved);
    // mkdir -p succeeds silently when the path already exists as a directory only; still verify.
    if (!fs.isDirectory(resolved)) return undefined;
    const probe = join(resolved, `.mediadownloader-probe-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
    fs.writeFile(probe, "x");
    try {
      fs.removeFile(probe);
    } catch { /* a leftover probe must not fail an otherwise writable folder */ }
    return resolved;
  } catch {
    return undefined;
  }
}

// --- temporary directory cleanup ---

export interface TemporaryCleanupResult {
  removed: string[];
  failures: { path: string; message: string }[];
}

// ".mediadownloader-<pid>-<timestamp>" -> pid; undefined for anything else.
export function tryParseTemporaryDirectoryName(name: string): number | undefined {
  const match = /^\.mediadownloader-([0-9]+)-([0-9]+)$/.exec(name);
  if (!match) return undefined;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

// Removes temp directories left by processes that are gone. `isProcessRunning` is required: the real
// implementation belongs to the process layer.
export function cleanupOrphanedTemporaryDirectories(
  outputDirectory: string,
  isProcessRunning: (pid: number) => boolean,
  fs: FsOps = denoFs,
): TemporaryCleanupResult {
  const result: TemporaryCleanupResult = { removed: [], failures: [] };
  let entries;
  try {
    entries = fs.readDir(outputDirectory);
  } catch (e) {
    result.failures.push({ path: outputDirectory, message: errorMessage(e) });
    return result;
  }
  for (const entry of entries) {
    if (!entry.isDirectory) continue; // symlinks are not followed (and so never removed through)
    const pid = tryParseTemporaryDirectoryName(entry.name);
    if (pid === undefined || isProcessRunning(pid)) continue;
    const path = join(outputDirectory, entry.name);
    try {
      fs.removeAll(path);
      result.removed.push(path);
    } catch (e) {
      result.failures.push({ path, message: errorMessage(e) });
    }
  }
  return result;
}
