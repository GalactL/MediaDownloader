// Native messaging host (docs/NATIVE_HOST_PROTOCOL.md). On stdin and stdout every message is a
// 4-byte native-endian length followed by that many bytes of UTF-8 JSON; stdout carries nothing else.
import { dirname, join } from "node:path";
import { jsonEscape, type Options, parseArguments } from "./core.ts";
import { Engine, type EngineEvent, serializeEvent } from "./engine.ts";
import { runProcess, systemDirectory } from "./process.ts";

const maxIncoming = 4 * 1024 * 1024; // protocol limit for requests
const maxOutgoing = 1024 * 1024; // Firefox limit for native host responses
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const windows = Deno.build.os === "windows";
const encoder = new TextEncoder();
// fatal: invalid UTF-8 makes the whole message invalid; ignoreBOM keeps a BOM so JSON.parse rejects it.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorJson = (code: string, message: string) => serializeEvent({ type: "error", code, message });

// Strict parse of one request body; undefined on any error (invalid UTF-8, lone surrogate escapes, bad JSON).
export function parseRequest(body: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(body), (key, value) => {
      if (!key.isWellFormed() || (typeof value === "string" && !value.isWellFormed())) throw new Error("surrogate");
      return value;
    });
  } catch {
    return undefined;
  }
}

// 15 significant digits, shortest text (keeps the wire format of the former C++ engine).
const formatNumber = (value: number) => String(Number(value.toPrecision(15)));

// Keeps the probe response far below the 1 MiB native messaging limit.
export function compactProbe(raw: string): string | undefined {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isObject(document)) return undefined;
  let out = "{";
  for (const key of ["id", "title", "duration", "uploader", "thumbnail", "webpage_url"]) {
    const value = document[key];
    if (typeof value === "string") out += `"${key}":"${jsonEscape(value)}",`;
    else if (typeof value === "number" && Number.isFinite(value)) out += `"${key}":${formatNumber(value)},`;
  }
  const heights = new Set<number>();
  if (Array.isArray(document.formats)) {
    for (const format of document.formats) {
      const height = isObject(format) ? format.height : undefined;
      if (typeof height === "number" && height >= 1 && height < 1e6) heights.add(Math.trunc(height));
    }
  }
  return out + `"heights":[${[...heights].sort((a, b) => a - b).join(",")}]}`;
}

// Inserts "id" right after the "type" member of a serialized event.
function withId(json: string, id: string | undefined): string {
  if (id === undefined) return json;
  const end = json.indexOf('"', '{"type":"'.length) + 1;
  return `${json.slice(0, end)},"id":"${jsonEscape(id)}"${json.slice(end)}`;
}

class Output {
  failed = false;
  #queue = Promise.resolve();

  constructor(readonly onFailure: () => void) {}

  // Frames are queued so concurrent senders never interleave; a broken stdout only sets `failed`.
  send(json: string, id?: string) {
    const tooLarge = errorJson("message_too_large", "La réponse dépasse la taille maximale autorisée.");
    let body = encoder.encode(withId(json, id));
    if (body.length > maxOutgoing) body = encoder.encode(withId(tooLarge, id));
    if (body.length > maxOutgoing) body = encoder.encode(tooLarge); // a huge id must not break the limit either
    const frame = new Uint8Array(4 + body.length);
    new DataView(frame.buffer).setUint32(0, body.length, littleEndian);
    frame.set(body, 4);
    this.#queue = this.#queue.then(async () => {
      if (this.failed) return;
      try {
        for (let offset = 0; offset < frame.length;) offset += await Deno.stdout.write(frame.subarray(offset));
      } catch {
        this.failed = true; // stdout is gone: nobody is listening any more
        this.onFailure();
      }
    });
  }

  flush() {
    return this.#queue;
  }
}

// Fills `buffer` from stdin; returns the number of bytes read, less than its length only at EOF.
async function readExact(buffer: Uint8Array): Promise<number> {
  let filled = 0;
  while (filled < buffer.length) {
    // A read error (broken pipe) counts as EOF, so the running job is still cancelled.
    const count = await Deno.stdin.read(buffer.subarray(filled)).catch(() => null);
    if (count === null) break;
    filled += count;
  }
  return filled;
}

// Builds the CLI-equivalent argument vector so validation is exactly parseArguments. Returns the error otherwise.
function buildArguments(type: string, request: JsonObject): string[] | string {
  const args = [type];
  if (type === "doctor") return args;
  const fields: [string, string, "string" | "number"][] = type === "probe"
    ? [["url", "--url", "string"], ["cookiesFromBrowser", "--cookies-from-browser", "string"]]
    : [
      ["url", "--url", "string"],
      ["quality", "--quality", "string"],
      ["format", "--format", "string"],
      ["title", "--title", "string"],
      ["startTime", "--start-time", "number"],
      ["endTime", "--end-time", "number"],
      ["maxSizeMb", "--max-size-mb", "number"],
      ["cookiesFromBrowser", "--cookies-from-browser", "string"],
      ["outputDirectory", "--output", "string"],
    ];
  for (const [key, flag, kind] of fields) {
    const value = request[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== kind) return `Le champ ${key} doit être ${kind === "string" ? "une chaîne" : "un nombre"}.`;
    args.push(flag, String(value));
  }
  if (type === "download") {
    for (const [key, flag] of [["overwrite", "--overwrite"], ["lowResources", "--low-resources"]]) {
      const value = request[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== "boolean") return `Le champ ${key} doit être un booléen.`;
      if (value) args.push(flag);
    }
  }
  return args;
}

// Opens a folder in the system file manager.
async function openFolder(directory: string): Promise<boolean> {
  const opener = windows ? join(systemDirectory(), "..", "explorer.exe") : "/usr/bin/xdg-open";
  try {
    const result = await runProcess({ command: opener, args: [directory], cwd: directory });
    return result.exitCode === 0 || (windows && result.exitCode === 1); // explorer returns 1 on success
  } catch {
    return false; // e.g. the folder was deleted
  }
}

type Pick = { outcome: "picked"; path: string } | { outcome: "cancelled" | "failed" };

// Runs one external chooser. Success prints the folder on its last line; a silent exit 1 (zenity, kdialog) is the
// user cancelling. `last` keeps the last line accepted by `accept`.
async function runChooser(
  command: string,
  args: string[],
  signal: AbortSignal,
  accept: (line: string) => boolean,
): Promise<Pick> {
  let last = "";
  let result;
  try {
    result = await runProcess({ command, args, signal, onLine: (line) => accept(line) && (last = line) });
  } catch {
    return { outcome: "failed" };
  }
  if (result.cancelled) return { outcome: "cancelled" };
  if (result.exitCode === 0 && last !== "") return { outcome: "picked", path: last };
  if (windows && result.exitCode === 0) return { outcome: "cancelled" }; // the script prints nothing on cancel
  return result.exitCode === 1 && result.output.trim() === "" ? { outcome: "cancelled" } : { outcome: "failed" };
}

// Blocks until the user answers the system folder chooser; `signal` closes it.
async function pickFolder(signal: AbortSignal): Promise<Pick> {
  if (windows) {
    // shortcut: FolderBrowserDialog through PowerShell (IFileOpenDialog needs COM, i.e. FFI); a TopMost owner keeps
    // it above the browser. Upgrade to the modern dialog if users complain about the tree view.
    const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;Add-Type -AssemblyName System.Windows.Forms;" +
      "$o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true};" +
      "$d=New-Object System.Windows.Forms.FolderBrowserDialog;if($d.ShowDialog($o) -eq 'OK'){$d.SelectedPath}";
    const powershell = join(systemDirectory(), "WindowsPowerShell", "v1.0", "powershell.exe");
    return await runChooser(
      powershell,
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      signal,
      (line) => /^[A-Za-z]:\\|^\\\\/.test(line),
    );
  }
  for (const [name, args] of [["zenity", ["--file-selection", "--directory"]], ["kdialog", ["--getexistingdirectory"]]] as const) {
    for (const directory of ["/usr/bin", "/usr/local/bin", "/bin"]) {
      const executable = join(directory, name);
      try {
        Deno.statSync(executable);
      } catch {
        continue;
      }
      const pick = await runChooser(executable, [...args], signal, (line) => line.startsWith("/"));
      if (pick.outcome === "picked") {
        let path = pick.path;
        while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
        return { outcome: "picked", path };
      }
      if (pick.outcome !== "failed") return pick;
      break; // this chooser is broken (e.g. no display): try the next one
    }
  }
  return { outcome: "failed" };
}

interface Task {
  controller: AbortController;
  done: Promise<void>;
}

// Runs the host until stdin ends. Returns the exit code: 0 on EOF, 1 on a truncated frame. Aborting `shutdown`
// (SIGINT/SIGTERM) cancels the running job and exits the process.
export async function runHost(shutdown: AbortSignal): Promise<number> {
  // stdout carries only frames: any stray console output goes to stderr.
  console.log = console.info = console.debug = console.error;

  let job: Task | undefined;
  let picker: Task | undefined;
  let busy = false;
  let picking = false;
  let lastFolder = ""; // folder of the latest completed download: the only folder a client can ask to open
  const output = new Output(() => job?.controller.abort());

  shutdown.addEventListener("abort", () => {
    job?.controller.abort();
    picker?.controller.abort();
    const pending = Promise.all([job?.done, picker?.done]);
    void Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 10000))]).then(() => Deno.exit(0));
  }, { once: true });

  // Per-job sink: adds the request id, summarizes probes and reports the end of the job before its terminal
  // event so the client can immediately send the next request.
  async function runJob(options: Options, id: string | undefined, signal: AbortSignal, inline: boolean) {
    const sink = {
      on(event: EngineEvent) {
        const terminal = event.type === "completed" || event.type === "error" || event.type === "probe";
        if (event.type === "completed") lastFolder = dirname(event.path);
        let json: string;
        if (event.type === "probe") {
          const compact = compactProbe(event.json);
          json = compact ? `{"type":"probe","data":${compact}}` : errorJson("processing_failed", "Réponse yt-dlp illisible.");
        } else json = serializeEvent(event);
        if (terminal && !inline) busy = false;
        output.send(json, id);
      },
    };
    const engine = new Engine(sink, signal);
    try {
      if (options.command === "doctor") engine.doctor(options);
      else if (options.command === "probe") await engine.probe(options);
      else await engine.download(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Une erreur inattendue est survenue";
      sink.on({ type: "error", code: signal.aborted ? "cancelled" : "processing_failed", message });
    }
    if (inline) return;
    busy = false;
    if (output.failed) Deno.exit(1); // stdout is gone and the job has been cancelled and cleaned up
  }

  async function handle(body: Uint8Array) {
    const request = parseRequest(body);
    const type = isObject(request) ? request.type : undefined;
    if (!isObject(request) || typeof type !== "string") {
      return output.send(errorJson("invalid_message", "Message JSON invalide ou sans type."));
    }
    const id = typeof request.id === "string" ? request.id : undefined;

    if (type === "cancel") {
      if (busy) job?.controller.abort();
      if (picking) picker?.controller.abort(); // closes the chooser: answered like a user cancel
      return;
    }
    if (type === "pickFolder") {
      if (busy || picking) return output.send(errorJson("busy", "Un traitement est déjà en cours."), id);
      await picker?.done;
      const controller = new AbortController();
      picking = true;
      const done = pickFolder(controller.signal).catch((): Pick => ({ outcome: "failed" })).then((pick) => {
        picking = false; // before the reply, so the client can immediately send the next request
        if (pick.outcome === "picked") output.send(`{"type":"folderPicked","path":"${jsonEscape(pick.path)}"}`, id);
        else if (pick.outcome === "cancelled") output.send('{"type":"folderPicked"}', id);
        else output.send(errorJson("pick_failed", "Impossible d'ouvrir le sélecteur de dossier."), id);
      });
      picker = { controller, done };
      return;
    }
    if (type === "openFolder") {
      if (lastFolder === "") return output.send(errorJson("no_folder", "Aucun dossier de téléchargement à ouvrir."), id);
      // The file manager may stay alive: never wait for it here.
      void openFolder(lastFolder).then((opened) =>
        output.send(opened ? '{"type":"opened"}' : errorJson("open_failed", "Impossible d'ouvrir le dossier."), id)
      );
      return;
    }
    if (type !== "doctor" && type !== "probe" && type !== "download") {
      return output.send(errorJson("invalid_message", `Type de message inconnu : ${type}`), id);
    }

    const args = buildArguments(type, request);
    const parsed = typeof args === "string" ? { options: undefined, error: args } : parseArguments(args);
    if (!parsed.options) return output.send(errorJson("invalid_arguments", parsed.error), id);

    if (type === "doctor") return await runJob(parsed.options, id, new AbortController().signal, true);
    if (busy || picking) return output.send(errorJson("busy", "Un traitement est déjà en cours."), id);
    await job?.done; // the previous job may still be removing its temporary folder
    const controller = new AbortController();
    busy = true;
    job = { controller, done: runJob(parsed.options, id, controller.signal, false) };
  }

  // Keeps reading while a job runs: EOF (the browser is gone, possibly crashed) must cancel it.
  let exitCode = 0;
  const header = new Uint8Array(4);
  const scratch = new Uint8Array(65536);
  for (;;) {
    const got = await readExact(header);
    if (got < 4) {
      exitCode = got === 0 ? 0 : 1; // EOF between messages is the normal end; inside one, a truncated frame
      break;
    }
    const length = new DataView(header.buffer).getUint32(0, littleEndian);
    if (length > maxIncoming) {
      let left = length;
      while (left > 0) {
        const chunk = Math.min(left, scratch.length);
        if (await readExact(scratch.subarray(0, chunk)) < chunk) break;
        left -= chunk;
      }
      if (left > 0) {
        exitCode = 1;
        break;
      }
      output.send(errorJson("message_too_large", "Le message dépasse 4 Mio."));
    } else {
      const body = new Uint8Array(length);
      if (await readExact(body) < length) {
        exitCode = 1;
        break;
      }
      try {
        await handle(body);
      } catch { // never let an exception escape unframed
        output.send(errorJson("processing_failed", "Une erreur inattendue est survenue"));
      }
    }
    if (output.failed) break;
  }

  job?.controller.abort();
  picker?.controller.abort();
  await job?.done;
  await picker?.done;
  await output.flush();
  return exitCode;
}
