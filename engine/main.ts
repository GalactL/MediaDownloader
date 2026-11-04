// CLI entry point. stdout is the CLI protocol (docs/CLI_PROTOCOL.md): one JSON object per
// line, except the help text. Exit codes: 0 ok, 2 bad arguments, 3 missing tool, 4 failure or cancellation.
import { isNativeHostLaunch, jsonEscape, parseArguments } from "./core.ts";
import { Engine, serializeEvent } from "./engine.ts";
import { runHost } from "./host.ts";
import { installHost, uninstallHost } from "./install.ts";

const encoder = new TextEncoder();

function print(text: string) {
  const bytes = encoder.encode(text);
  for (let offset = 0; offset < bytes.length;) offset += Deno.stdout.writeSync(bytes.subarray(offset));
}

const emitError = (code: string, message: string) =>
  print(`{"type":"error","code":"${jsonEscape(code)}","message":"${jsonEscape(message)}"}\n`);

const help = `MediaDownloader 0.6.0

Usage:
  MediaDownloader doctor [chemins des outils]
  MediaDownloader probe --url URL
  MediaDownloader download --url URL [options]
  MediaDownloader host   Messagerie native Firefox (stdin/stdout)
  MediaDownloader install-host   Enregistre l'hote natif pour Firefox
  MediaDownloader uninstall-host   Retire l'hote natif de Firefox
  MediaDownloader update   Met a jour yt-dlp (yt-dlp -U)

Options:
  --quality best|720|1080    Qualite ou hauteur maximale
  --format mp4|mkv|webm      Conteneur final (mp4 par defaut)
  --title TITRE               Nom personnalise du fichier final
  --start-time SECONDES       Debut facultatif de la plage
  --end-time SECONDES         Fin facultative de la plage
  --max-size-mb N            Taille maximale, en Mio
  --cookies-from-browser NOM Utiliser auto, Firefox, Edge, Chrome…
  --output DOSSIER           Dossier cible (Videos par defaut)
  --overwrite                Remplacer un fichier homonyme
  --low-resources            FFmpeg en priorite basse, 2 threads
  --yt-dlp CHEMIN            Chemin de yt-dlp
  --ffmpeg CHEMIN            Chemin de ffmpeg
  --ffprobe CHEMIN           Ignore (compatibilite)
`;

export async function main(args: string[]): Promise<number> {
  // Ctrl+C (and SIGTERM on Linux) cancels the running command.
  const shutdown = new AbortController();
  const abort = () => shutdown.abort();
  for (const signal of Deno.build.os === "windows" ? ["SIGINT", "SIGBREAK"] as const : ["SIGINT", "SIGTERM"] as const) {
    Deno.addSignalListener(signal, abort);
  }

  // Firefox and Chromium launch the host with a manifest path, an extension id or an origin. The manifest path
  // may contain spaces (a user folder such as "Jean Dupont"), which isNativeHostLaunch rejects: the extension id
  // Firefox passes after it still identifies the launch.
  const hostLaunch = isNativeHostLaunch(args) || (/\.json$/i.test(args[0] ?? "") && isNativeHostLaunch(args.slice(1)));
  const parsed = parseArguments(hostLaunch ? ["host"] : args);
  const options = parsed.options;
  if (!options) {
    emitError("invalid_arguments", parsed.error);
    return 2;
  }
  const engine = new Engine({ on: (event) => print(serializeEvent(event) + "\n") }, shutdown.signal);
  try {
    switch (options.command) {
      case "help":
        print(help);
        return 0;
      case "doctor":
        return engine.doctor(options);
      case "probe":
        return await engine.probe(options);
      case "download":
        return await engine.download(options);
      case "install-host":
        return installHost();
      case "uninstall-host":
        return uninstallHost();
      case "update":
        return await engine.update(options);
      case "host":
        // Never a JSON line on stdout in host mode: it would corrupt the frames.
        return await runHost(shutdown.signal).catch((error) => (console.error(error), 1));
    }
  } catch (error) {
    if (error instanceof Error) emitError(shutdown.signal.aborted ? "cancelled" : "processing_failed", error.message);
    else emitError("processing_failed", "Une erreur inattendue est survenue");
    return 4;
  }
}

if (import.meta.main) Deno.exit(await main(Deno.args));
