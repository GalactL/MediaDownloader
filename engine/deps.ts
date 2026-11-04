// Downloads, verifies and installs the pinned third-party tools (engine/deps.json) into <root>/tools/bin.
// Run by the already-installed Deno: deno run --no-check --no-config --no-prompt <permissions> engine/deps.ts
//   [--check] [--root DIR] [--manifest FILE]
// Guarantees: HTTPS only (redirects included), SHA-256 verified before anything leaves the temporary folder
// tools/.tmp-<pid>, tools/bin untouched on any failure. Exit codes: 0 ok, 1 failure or --check mismatch.
import { createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Entry {
  name: string;
  version: string;
  url: string;
  size: number;
  sha256: string; // of the downloaded file
  archive: "none" | "zip" | "tar";
  member?: string; // path inside the archive
  dest: string; // file name in tools/bin
  fileSha256?: string; // of the installed file when it differs from sha256
  smoke?: string[]; // arguments of the post-download `--version` run
}

export interface Options {
  root: string; // folder holding tools/
  entries: Entry[];
  check?: boolean;
  report?: (line: string) => void; // progress and messages (stderr)
  allowLoopbackHttp?: boolean; // tests only: lets http://127.0.0.1 and http://localhost through
  smoke?: boolean; // default true
  retries?: number; // default 3
  backoffMs?: number; // default 2000, multiplied by the attempt number
}

export class DepsError extends Error {
  retry = false; // transient (network, 5xx, truncation)
}

const windows = Deno.build.os === "windows";
const sha256File = async (path: string) => {
  const hash = createHash("sha256");
  using file = await Deno.open(path);
  for await (const chunk of file.readable) hash.update(chunk);
  return hash.digest("hex");
};
const wanted = (e: Entry) => e.fileSha256 ?? e.sha256;
const mb = (n: number) => `${(n / 1048576).toFixed(0)} Mo`;

export function platformKey(): string {
  return `${Deno.build.os}-${Deno.build.arch}`;
}

export async function loadEntries(manifestPath: string, key = platformKey()): Promise<Entry[]> {
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  const entries = manifest.platforms?.[key];
  if (!entries) {
    throw new DepsError(`Plateforme non prise en charge : ${key} (seuls Windows x64 et Linux x64 le sont).`);
  }
  return entries;
}

function checkUrl(url: URL, options: Options) {
  const loopback = options.allowLoopbackHttp && url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !loopback) {
    throw new DepsError(`Adresse refusée (HTTPS obligatoire) : ${url.protocol}//${url.host}`);
  }
}

// fetch that follows at most 5 redirects, each one re-checked for HTTPS.
async function open(url: string, options: Options): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    checkUrl(new URL(current), options);
    let response: Response;
    try {
      response = await fetch(current, { redirect: "manual" });
    } catch (error) {
      const failure = new DepsError(`connexion impossible (${(error as Error).message})`);
      failure.retry = true;
      throw failure;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new DepsError("redirection sans destination");
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      const failure = new DepsError(`le serveur a répondu HTTP ${response.status}`);
      failure.retry = response.status >= 500 || response.status === 429;
      throw failure;
    }
    return response;
  }
  throw new DepsError("trop de redirections");
}

async function download(entry: Entry, target: string, options: Options, report: (line: string) => void) {
  const response = await open(entry.url, options);
  const announced = Number(response.headers.get("content-length") ?? entry.size);
  const hash = createHash("sha256");
  let received = 0;
  let lastReport = Date.now();
  try {
    using file = await Deno.open(target, { write: true, create: true, truncate: true });
    for await (const chunk of response.body!) {
      hash.update(chunk);
      await file.write(chunk);
      received += chunk.length;
      if (Date.now() - lastReport > 2000) {
        lastReport = Date.now();
        report(`  ${entry.name} : ${mb(received)} / ${mb(announced)}`);
      }
    }
  } catch (error) {
    if (error instanceof DepsError) throw error;
    if ((error as { code?: string }).code === "ENOSPC" || error instanceof Deno.errors.PermissionDenied) throw error;
    const failure = new DepsError(`téléchargement interrompu (${(error as Error).message})`);
    failure.retry = true;
    throw failure;
  }
  if (received !== announced || (entry.size > 0 && received !== entry.size)) {
    const failure = new DepsError(`téléchargement incomplet (${received} octets reçus sur ${entry.size})`);
    failure.retry = true;
    throw failure;
  }
  if (hash.digest("hex") !== entry.sha256) {
    throw new DepsError(`SHA-256 incorrect : le fichier est corrompu ou a été modifié`);
  }
}

async function run(command: string, args: string[]) {
  const result = await new Deno.Command(command, { args, stdout: "null", stderr: "piped" }).output();
  if (!result.success) {
    throw new DepsError(`${command} a échoué : ${new TextDecoder().decode(result.stderr).trim().slice(0, 300)}`);
  }
}

// Extracts only `member`. Windows: the System32 tar (bsdtar, reads zip); Linux: unzip / tar (detects xz).
async function extract(entry: Entry, archive: string, into: string) {
  const member = entry.member!;
  if (entry.archive === "zip" && !windows) return await run("unzip", ["-q", "-o", archive, member, "-d", into]);
  const tar = windows ? join(Deno.env.get("SystemRoot") ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  await run(tar, ["-xf", archive, "-C", into, member]);
}

async function sweepStale(tools: string, report: (line: string) => void) {
  try {
    for await (const item of Deno.readDir(tools)) {
      if (!item.isDirectory || !item.name.startsWith(".tmp-")) continue;
      const path = join(tools, item.name);
      if (Date.now() - (await Deno.stat(path)).mtime!.getTime() > 3600_000) {
        report(`Nettoyage d'un dossier temporaire abandonné : ${item.name}`);
        await Deno.remove(path, { recursive: true });
      }
    }
  } catch { /* no tools folder yet, or a race: best effort */ }
}

/** Installs what is missing or different; returns the names installed. Throws DepsError (French message). */
export async function installDependencies(options: Options): Promise<string[]> {
  const report = options.report ?? ((line: string) => console.error(line));
  const tools = join(options.root, "tools");
  const bin = join(tools, "bin");
  await sweepStale(tools, report);

  const todo: Entry[] = [];
  for (const entry of options.entries) {
    let current = "";
    try {
      current = await sha256File(join(bin, entry.dest));
    } catch { /* missing */ }
    if (current === wanted(entry)) report(`${entry.name} ${entry.version} : déjà installé.`);
    else todo.push(entry);
  }
  if (todo.length === 0) return [];

  const tmp = join(tools, `.tmp-${Deno.pid}`);
  const staged = new Map<Entry, string>();
  try {
    await Deno.mkdir(tmp, { recursive: true });
    for (const entry of todo) {
      const archive = join(tmp, `dl-${entry.dest}`); // keeps the .exe extension of direct downloads
      report(`Téléchargement de ${entry.name} ${entry.version} (${mb(entry.size)})...`);
      const attempts = options.retries ?? 3;
      for (let attempt = 1;; attempt++) {
        try {
          await download(entry, archive, options, report);
          break;
        } catch (error) {
          if (!(error instanceof DepsError)) throw error;
          if (!error.retry || attempt >= attempts) {
            error.message = `${entry.name} : ${error.message}`;
            throw error;
          }
          report(`  nouvel essai (${attempt}/${attempts - 1}) : ${error.message}`);
          await new Promise((r) => setTimeout(r, (options.backoffMs ?? 2000) * attempt));
        }
      }
      let file = archive;
      if (entry.archive !== "none") {
        report(`Extraction de ${entry.name}...`);
        const out = join(tmp, `x-${entry.name}`);
        await Deno.mkdir(out);
        await extract(entry, archive, out);
        file = join(out, entry.member!);
      }
      if ((await sha256File(file)) !== wanted(entry)) {
        throw new DepsError(`SHA-256 incorrect pour ${entry.dest} extrait de l'archive`);
      }
      if (!windows) chmodSync(file, 0o755);
      staged.set(entry, file);
    }

    if (options.smoke !== false) {
      for (const [entry, file] of staged) {
        // async wrapper: a spawn failure may throw synchronously
        const result = await (async () =>
          new Deno.Command(file, { args: entry.smoke ?? ["--version"], stdout: "null", stderr: "null" }).output())()
          .catch(() => null);
        if (!result?.success) throw new DepsError(`${entry.name} téléchargé ne démarre pas sur cette machine`);
      }
    }

    // Commit: every file is verified. Rename into place; previous versions are kept aside to roll back.
    await Deno.mkdir(bin, { recursive: true });
    const done: Array<{ dest: string; backup?: string }> = [];
    try {
      for (const [entry, file] of staged) {
        const dest = join(bin, entry.dest);
        let backup: string | undefined;
        try {
          await Deno.stat(dest);
          backup = join(tmp, `old-${entry.dest}`);
          await Deno.rename(dest, backup);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
        done.push({ dest, backup });
        await Deno.rename(file, dest);
      }
    } catch (error) {
      for (const { dest, backup } of done.reverse()) {
        await Deno.remove(dest).catch(() => {});
        if (backup) await Deno.rename(backup, dest).catch(() => {});
      }
      throw error;
    }
    return todo.map((e) => e.name);
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

/** Problems found in the installed files (empty = all good). */
export async function checkDependencies(options: Options): Promise<string[]> {
  const problems: string[] = [];
  for (const entry of options.entries) {
    try {
      if ((await sha256File(join(options.root, "tools", "bin", entry.dest))) !== wanted(entry)) {
        problems.push(`${entry.dest} : somme SHA-256 différente de la version ${entry.version} attendue`);
      }
    } catch {
      problems.push(`${entry.dest} : absent`);
    }
  }
  return problems;
}

function explain(error: unknown): string {
  if (error instanceof DepsError) return error.message;
  const code = (error as { code?: string }).code;
  if (code === "ENOSPC") return "espace disque insuffisant";
  if (error instanceof Deno.errors.PermissionDenied || code === "EACCES" || code === "EPERM" || code === "EBUSY") {
    return `accès refusé ou fichier utilisé par un autre programme (${(error as Error).message})`;
  }
  return (error as Error).message ?? String(error);
}

async function main(args: string[]): Promise<number> {
  const here = dirname(fileURLToPath(import.meta.url));
  const value = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const root = resolve(value("--root") ?? join(here, ".."));
  try {
    const options: Options = { root, entries: await loadEntries(value("--manifest") ?? join(here, "deps.json")) };
    if (args.includes("--check")) {
      const problems = await checkDependencies(options);
      for (const problem of problems) console.error(problem);
      console.error(problems.length ? "Vérification échouée : relancez l'installateur." : "Dépendances conformes.");
      return problems.length ? 1 : 0;
    }
    const installed = await installDependencies(options);
    console.error(installed.length ? `Installé : ${installed.join(", ")}.` : "Rien à faire : tout est à jour.");
    return 0;
  } catch (error) {
    console.error(`\nÉchec : ${explain(error)}`);
    console.error(
      error instanceof DepsError && error.retry === false && /SHA-256/.test(error.message)
        ? "Rien n'a été installé. Le fichier reçu ne correspond pas à la version attendue : relancez plus tard ou depuis un autre réseau."
        : "Rien n'a été modifié. Vérifiez votre connexion (proxy : variable HTTPS_PROXY), l'espace disque et vos droits, puis relancez l'installateur.",
    );
    return 1;
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
