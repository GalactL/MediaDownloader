// install-host / uninstall-host with a temporary root and home and an in-memory registry: the real registry and
// the user's manifest folders are never written. Run: deno test -A engine/test
import assert from "node:assert/strict";
import { join } from "node:path";
import { chromiumRegistryKeys, jsonEscape } from "../core.ts";
import { type InstallContext, installHost, uninstallHost, windowsRegistry } from "../install.ts";

const windows = Deno.build.os === "windows";
const firefoxKey = "Software\\Mozilla\\NativeMessagingHosts\\media_downloader";

function context(platform: "windows" | "linux") {
  const tmp = Deno.makeTempDirSync({ prefix: "md-install-" });
  const registry = new Map<string, string>();
  const lines: string[] = [];
  const value: InstallContext = {
    platform,
    root: join(tmp, "Média Downloader"),
    home: () => join(tmp, "home"),
    registry: {
      set: (key, path) => void registry.set(key, path),
      remove: (key) => registry.delete(key),
    },
    report: (line) => void lines.push(line),
  };
  return { tmp, registry, lines, context: value };
}

const exists = (path: string) => {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
};

Deno.test({
  name: "Windows: manifests next to the launcher, HKCU keys point at them, uninstall undoes it",
  ignore: !windows, // the manifest paths are joined with Windows separators
  fn: () => {
    const { tmp, registry, lines, context: c } = context("windows");
    try {
      assert.equal(installHost(c), 0);
      const manifest = join(c.root, "native-host", "media_downloader.json");
      const chromium = join(c.root, "native-host", "media_downloader.chromium.json");
      const launcher = jsonEscape(join(c.root, "MediaDownloader.Cli.bat"));
      const firefox = Deno.readTextFileSync(manifest);
      assert.ok(firefox.includes(`"path": "${launcher}"`), firefox);
      assert.ok(firefox.includes('"allowed_extensions": ["mediadownloader@localhost"]'));
      assert.ok(Deno.readTextFileSync(chromium).includes(`"path": "${launcher}"`));
      assert.deepEqual(
        Object.fromEntries(registry),
        Object.fromEntries([[firefoxKey, manifest], ...chromiumRegistryKeys().map((key) => [key, chromium])]),
      );
      assert.deepEqual(lines, [`Hôte natif installé : ${manifest}`, `Hôte natif Chromium installé : ${chromium}`]);

      lines.length = 0;
      assert.equal(uninstallHost(c), 0);
      assert.ok(!exists(manifest) && !exists(chromium) && registry.size === 0);
      assert.deepEqual(lines, [`Hôte natif retiré : ${manifest}`]);
      lines.length = 0;
      assert.equal(uninstallHost(c), 0, "nothing to remove is a success");
      assert.deepEqual(lines, [`Hôte natif déjà absent : ${manifest}`]);
    } finally {
      Deno.removeSync(tmp, { recursive: true });
    }
  },
});

Deno.test("Linux: Firefox and Chromium manifests under HOME, no registry", () => {
  const { tmp, registry, lines, context: c } = context("linux");
  try {
    assert.equal(installHost(c), 0);
    const home = c.home();
    const manifest = join(home, ".mozilla", "native-messaging-hosts", "media_downloader.json");
    const chromium = ["google-chrome", "chromium", join("BraveSoftware", "Brave-Browser"), "opera"]
      .map((browser) => join(home, ".config", browser, "NativeMessagingHosts", "media_downloader.json"));
    const launcher = jsonEscape(join(c.root, "MediaDownloader.Cli"));
    for (const path of [manifest, ...chromium]) {
      assert.ok(Deno.readTextFileSync(path).includes(`"path": "${launcher}"`), path);
    }
    assert.ok(Deno.readTextFileSync(chromium[0]).includes('"allowed_origins": ["chrome-extension://'));
    assert.equal(registry.size, 0);
    assert.equal(lines.length, 5);

    assert.equal(uninstallHost(c), 0);
    assert.ok([manifest, ...chromium].every((path) => !exists(path)));
    assert.match(lines.at(-1)!, /^Hôte natif retiré : /);
    assert.equal(uninstallHost(c), 0);
    assert.match(lines.at(-1)!, /^Hôte natif déjà absent : /);
  } finally {
    Deno.removeSync(tmp, { recursive: true });
  }
});

Deno.test("a registry failure fails install-host", () => {
  const { tmp, context: c } = context(windows ? "windows" : "linux");
  try {
    c.registry.set = () => {
      throw new Error("Impossible de créer la clé de registre de l'hôte natif");
    };
    if (windows) assert.throws(() => installHost(c), /clé de registre/);
    else assert.equal(installHost(c), 0, "Linux never touches the registry");
  } finally {
    Deno.removeSync(tmp, { recursive: true });
  }
});

// Read-only: reg.exe query of a key that does not exist; nothing is written.
Deno.test({
  name: "reg.exe: removing a missing key reports nothing removed",
  ignore: !windows,
  fn: () => {
    assert.equal(windowsRegistry.remove(`Software\\MediaDownloader-absent-${crypto.randomUUID()}`), false);
  },
});
