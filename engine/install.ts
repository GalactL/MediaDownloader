// install-host / uninstall-host: port of Engine::InstallHost / Engine::UninstallHost (src/Engine.cpp).
// The manifests point at the launcher (MediaDownloader.Cli.bat / MediaDownloader.Cli) next to engine/.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildChromiumNativeManifest,
  buildNativeManifest,
  chromiumManifestPaths,
  chromiumRegistryKeys,
  type HostPlatform,
  hostPlatform,
  nativeManifestPath,
} from "./core.ts";
import { systemDirectory } from "./process.ts";

const extensionId = "mediadownloader@localhost"; // id of extension/manifest.json
const firefoxRegistryKey = "Software\\Mozilla\\NativeMessagingHosts\\media_downloader";

// HKCU keys whose default value is a manifest path.
export interface Registry {
  set(key: string, value: string): void; // throws on failure
  remove(key: string): boolean; // true if the key existed and was deleted; throws on failure
}

export interface InstallContext {
  platform: HostPlatform;
  root: string; // folder holding the launcher, engine/ and tools/
  home: () => string; // only called on Linux
  registry: Registry; // only used on Windows
  report: (line: string) => void; // success messages (stderr: stdout stays empty)
}

// reg.exe from System32 with an argument array (no shell); its localized output never reaches our stdout.
function reg(args: string[]) {
  return new Deno.Command(join(systemDirectory(), "reg.exe"), { args, stdin: "null", stdout: "null", stderr: "null" })
    .outputSync().success;
}

export const windowsRegistry: Registry = {
  set(key, value) {
    if (!reg(["add", `HKCU\\${key}`, "/ve", "/t", "REG_SZ", "/d", value, "/f"])) {
      throw new Error("Impossible de créer la clé de registre de l'hôte natif");
    }
  },
  remove(key) {
    if (!reg(["query", `HKCU\\${key}`])) return false;
    if (!reg(["delete", `HKCU\\${key}`, "/f"])) throw new Error("Impossible de supprimer la clé de registre de l'hôte natif");
    return true;
  },
};

export function defaultInstallContext(): InstallContext {
  return {
    platform: hostPlatform(),
    root: dirname(dirname(fileURLToPath(import.meta.url))),
    home: () => {
      const home = Deno.env.get("HOME");
      if (!home) throw new Error("Le dossier personnel est indisponible");
      return home;
    },
    registry: windowsRegistry,
    report: (line) => console.error(line),
  };
}

const launcherPath = (context: InstallContext) =>
  join(context.root, context.platform === "windows" ? "MediaDownloader.Cli.bat" : "MediaDownloader.Cli");

function writeManifest(path: string, content: string) {
  try {
    Deno.mkdirSync(dirname(path), { recursive: true });
  } catch (error) {
    throw new Error(`Impossible de créer le dossier du manifeste : ${(error as Error).message}`);
  }
  try {
    Deno.writeTextFileSync(path, content);
  } catch {
    throw new Error(`Impossible d'écrire le manifeste : ${path}`);
  }
}

// Returns the exit code (0); failures throw (the CLI reports them as processing_failed, exit 4).
export function installHost(context = defaultInstallContext()): number {
  const launcher = launcherPath(context);
  const home = context.platform === "windows" ? "" : context.home();
  const manifest = nativeManifestPath(context.platform, home, context.root);
  writeManifest(manifest, buildNativeManifest(launcher, extensionId));
  const chromiumManifests = chromiumManifestPaths(context.platform, home, context.root);
  for (const path of chromiumManifests) writeManifest(path, buildChromiumNativeManifest(launcher));
  if (context.platform === "windows") {
    context.registry.set(firefoxRegistryKey, manifest);
    for (const key of chromiumRegistryKeys()) context.registry.set(key, chromiumManifests[0]);
  }
  context.report(`Hôte natif installé : ${manifest}`);
  for (const path of chromiumManifests) context.report(`Hôte natif Chromium installé : ${path}`);
  return 0;
}

// Nothing to remove is a success.
export function uninstallHost(context = defaultInstallContext()): number {
  const home = context.platform === "windows" ? "" : context.home();
  const manifest = nativeManifestPath(context.platform, home, context.root);
  let removed = false;
  for (const path of [manifest, ...chromiumManifestPaths(context.platform, home, context.root)]) {
    try {
      Deno.removeSync(path);
      removed = true;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw new Error(`Impossible de supprimer le manifeste : ${(error as Error).message}`);
      }
    }
  }
  if (context.platform === "windows") {
    for (const key of [...chromiumRegistryKeys(), firefoxRegistryKey]) removed = context.registry.remove(key) || removed;
  }
  context.report(`${removed ? "Hôte natif retiré : " : "Hôte natif déjà absent : "}${manifest}`);
  return 0;
}
