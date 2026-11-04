// Pure core tests. Run: deno test engine/test/core.test.ts
// (add -A, or --allow-read --allow-write, to also run the real-filesystem tests).
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  buildChromiumNativeManifest,
  buildDownloadSection,
  buildEncodeArguments,
  buildFormatSelector,
  buildNativeManifest,
  calculateEncodePlan,
  chromiumExtensionId,
  chromiumManifestPaths,
  chromiumRegistryKeys,
  cleanupOrphanedTemporaryDirectories,
  denoFs,
  DownloadProgressSmoother,
  ensureOutputDirectory,
  type FsOps,
  isNativeHostLaunch,
  isSupportedUrl,
  isTwitterUrl,
  isYouTubeUrl,
  jsonEscape,
  nativeManifestPath,
  type Options,
  parseArguments,
  parseDownloadProgressLine,
  parseFfmpegDuration,
  parsePostprocessorStart,
  sanitizeFileName,
  summarizeDownloadFailure,
  tryParseTemporaryDirectoryName,
} from "../core.ts";

const canWrite = Deno.permissions.querySync({ name: "write" }).state === "granted" &&
  Deno.permissions.querySync({ name: "read" }).state === "granted";

const V = "https://example.test/v";
const ok = (...args: string[]): Options => {
  const r = parseArguments(args);
  assert.ok(r.options, `attendu valide : ${args.join(" ")} (${r.error})`);
  return r.options;
};
const bad = (...args: string[]) => assert.equal(parseArguments(args).options, undefined, args.join(" "));

Deno.test("URLs", () => {
  assert.ok(isSupportedUrl("https://www.youtube.com/watch?v=test"));
  assert.ok(isSupportedUrl("HTTP://example.test/video"));
  assert.ok(!isSupportedUrl("file:///C:/secret.mp4"));
  assert.ok(!isSupportedUrl("javascript:alert(1)"));
  assert.ok(!isSupportedUrl("ftp://example.test/x"));
  assert.ok(!isSupportedUrl(""));
  assert.ok(isYouTubeUrl("https://www.youtube.com/watch?v=test"));
  assert.ok(isYouTubeUrl("https://youtu.be/test"));
  assert.ok(!isYouTubeUrl("https://youtube.com.example.test/video"));
  assert.ok(isTwitterUrl("https://x.com/u/status/1"));
  assert.ok(isTwitterUrl("https://twitter.com/u/status/1"));
  assert.ok(isTwitterUrl("https://www.x.com/u/status/1") && isTwitterUrl("https://mobile.twitter.com/u/status/1"));
  assert.ok(!isTwitterUrl("https://x.com.evil.test/u/status/1") && !isTwitterUrl("https://evilx.com/u/status/1"));
});

Deno.test("URL look-alikes", () => {
  assert.ok(isYouTubeUrl("HTTPS://WWW.YOUTUBE.COM/watch"));
  assert.ok(isYouTubeUrl("https://music.youtube.com"));
  assert.ok(isYouTubeUrl("https://www.youtube-nocookie.com/embed/x"));
  assert.ok(isYouTubeUrl("https://youtube.com:443/x?y"));
  assert.ok(isYouTubeUrl("https://user:pw@youtube.com/x"));
  assert.ok(!isYouTubeUrl("https://youtube.com@evil.test/x"), "userinfo trick");
  assert.ok(!isYouTubeUrl("https://evil.test/?u=https://youtube.com/x"), "host in the query");
  assert.ok(!isYouTubeUrl("https://evil.test#@youtube.com"), "host after #");
  assert.ok(!isYouTubeUrl("https://notyoutube.com/x") && !isYouTubeUrl("https://youtube.com.evil.test"));
  assert.ok(!isYouTubeUrl("https://youtu.be.evil.test/x") && !isYouTubeUrl("https://myoutu.be/x"));
  assert.ok(!isYouTubeUrl("youtube.com/watch"), "no scheme");
  assert.ok(!isTwitterUrl("https://x.com@evil.test/") && !isTwitterUrl("https://twitter.com.evil.test/"));
});

Deno.test("format selector and file names", () => {
  assert.equal(buildFormatSelector("best"), "bestvideo+bestaudio/best");
  assert.equal(buildFormatSelector("2160"), "bestvideo[height<=2160]+bestaudio/best[height<=2160]/best");
  assert.equal(buildFormatSelector("1440"), "bestvideo[height<=1440]+bestaudio/best[height<=1440]/best");
  assert.equal(buildFormatSelector("1080"), "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best");
  assert.equal(sanitizeFileName(" Mon titre: test? "), "Mon titre_ test_");
  assert.equal(sanitizeFileName("CON"), "_CON");
  assert.equal(sanitizeFileName("... "), "video");
  // edge cases
  assert.equal(sanitizeFileName("con.txt"), "_con.txt");
  assert.equal(sanitizeFileName("Lpt9"), "_Lpt9");
  assert.equal(sanitizeFileName("COM10"), "COM10");
  assert.equal(sanitizeFileName("a\x00b\x1fc<>:\"/\\|?*"), "a_b_c_________");
  assert.equal(sanitizeFileName("x".repeat(200)).length, 140);
  assert.equal(sanitizeFileName("é".repeat(10)), "é".repeat(10));
  assert.equal(sanitizeFileName("fin. . "), "fin");
  assert.equal(sanitizeFileName(""), "video");
});

Deno.test("download section", () => {
  assert.equal(buildDownloadSection(30, 95.5), "*30-95.5");
  assert.equal(buildDownloadSection(0, 30), "*0-30");
});

Deno.test("encode plan", () => {
  const plan = calculateEncodePlan(60, 10);
  assert.ok(plan);
  assert.ok(plan.targetBytes < 10 * 1024 * 1024);
  assert.equal(plan.audioKbps, 128);
  assert.ok(plan.videoKbps > 1000);
  assert.equal(calculateEncodePlan(7200, 1), undefined);
  assert.equal(calculateEncodePlan(0, 10), undefined);
  // spec numbers
  assert.deepEqual(calculateEncodePlan(30, 10), { targetBytes: 10171187, audioKbps: 128, videoKbps: 2584 });
  // invalid inputs
  assert.equal(calculateEncodePlan(-1, 10), undefined);
  assert.equal(calculateEncodePlan(10, 0), undefined);
  assert.equal(calculateEncodePlan(NaN, 10), undefined);
  assert.equal(calculateEncodePlan(10, Infinity), undefined);
  assert.equal(calculateEncodePlan(10, 1e300), undefined);
  // tier boundaries: total kbps = mb * 1024*1024*0.97*8/1000/seconds. Pick duration so total hits the threshold.
  const duration = (mb: number, kbps: number) => mb * 1024 * 1024 * 0.97 * 8 / 1000 / kbps;
  assert.equal(calculateEncodePlan(duration(10, 320), 10)?.audioKbps, 128, "exactly 320 -> 128");
  assert.equal(calculateEncodePlan(duration(10, 319.9), 10)?.audioKbps, 96, "just under 320 -> 96");
  assert.equal(calculateEncodePlan(duration(10, 200), 10)?.audioKbps, 96, "exactly 200 -> 96");
  assert.equal(calculateEncodePlan(duration(10, 199.9), 10)?.audioKbps, 48, "just under 200 -> 48");
  // audio + 80 floor: the 48 tier refuses at total <= 128 kbps (strictly more is needed)
  assert.equal(calculateEncodePlan(duration(10, 128.01), 10)?.videoKbps, 80);
  assert.equal(calculateEncodePlan(duration(10, 127.9), 10), undefined, "under 48+80 refused");
  assert.equal(calculateEncodePlan(duration(10, 200), 10)?.videoKbps, 104, "96 tier: 200 - 96");
  // 320 tier: video is total - 128
  assert.equal(calculateEncodePlan(duration(10, 320), 10)?.videoKbps, 192);
});

Deno.test("ffmpeg duration", () => {
  assert.equal(parseFfmpegDuration("  Duration: 01:02:03.50, start: 0.000000, bitrate: 800 kb/s"), 3723.5);
  assert.equal(parseFfmpegDuration("  Duration: N/A, bitrate: N/A"), undefined);
  assert.equal(parseFfmpegDuration("  Duration: 00:00:00.00, start: 0"), undefined);
  assert.equal(parseFfmpegDuration("pas de durée"), undefined);
  assert.equal(parseFfmpegDuration("Duration: 00:00:30"), 30);
  assert.equal(parseFfmpegDuration("Duration:00:01:00.00,"), 60);
  assert.equal(parseFfmpegDuration("Duration: 10:00"), undefined);
});

Deno.test("arguments: download", () => {
  const o = ok("download", "--url", V, "--quality", "720", "--max-size-mb", "10");
  assert.equal(o.command, "download");
  assert.equal(o.quality, "720");
  assert.equal(o.maxSizeMb, 10);
  assert.equal(o.cookiesFromBrowser, "auto");
  bad("download", "--url", "file:///x");
  bad("download", "--quality", "4k");
  const a = ok("download", "--url", "https://youtube.test/v", "--title", "Titre", "--cookies-from-browser", "edge");
  assert.equal(a.title, "Titre");
  assert.equal(a.cookiesFromBrowser, "edge");
  ok("download", "--url", "https://youtube.test/v", "--cookies-from-browser", "auto");
  bad("download", "--url", "https://youtube.test/v", "--cookies-from-browser", "inconnu");
});

Deno.test("arguments: time range", () => {
  const zero = ok("download", "--url", V, "--start-time", "0", "--end-time", "30");
  assert.ok(zero.startTimeSeconds === 0 && zero.endTimeSeconds === 30);
  const dec = ok("download", "--url", V, "--start-time", "30", "--end-time", "95.5");
  assert.ok(dec.startTimeSeconds === 30 && dec.endTimeSeconds === 95.5);
  bad("download", "--url", V, "--end-time", "30");
  bad("download", "--url", V, "--start-time", "30");
  bad("download", "--url", V, "--start-time", "-1", "--end-time", "30");
  bad("download", "--url", V, "--start-time", "30", "--end-time", "30");
  bad("download", "--url", V, "--start-time", "30", "--end-time", "20");
  for (const invalid of ["NaN", "inf", "texte"]) {
    bad("download", "--url", V, "--start-time", invalid, "--end-time", "30");
    bad("download", "--url", V, "--start-time", "0", "--end-time", invalid);
  }
  const normal = ok("download", "--url", V, "--quality", "1080");
  assert.ok(normal.startTimeSeconds === undefined && normal.endTimeSeconds === undefined);
  ok(
    "download", "--url", V, "--start-time", "30", "--end-time", "95.5", "--quality", "720", "--format", "mp4",
    "--title", "Extrait", "--max-size-mb", "10", "--cookies-from-browser", "firefox", "--output", "output",
    "--overwrite", "--yt-dlp", "yt-dlp", "--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe",
  );
  // edge cases
  assert.equal(ok("download", "--url", V, "--start-time", "1e1", "--end-time", "1e2").endTimeSeconds, 100);
  assert.equal(ok("download", "--url", V, "--start-time", ".5", "--end-time", "2.").startTimeSeconds, 0.5);
  bad("download", "--url", V, "--start-time", "1e999", "--end-time", "1e999");
  bad("download", "--url", V, "--start-time", "10abc", "--end-time", "30");
  bad("download", "--url", V, "--start-time", "", "--end-time", "30");
});

Deno.test("arguments: commands and options", () => {
  assert.equal(ok().command, "help");
  assert.equal(ok("--help").command, "help");
  assert.equal(ok("-h").command, "help");
  assert.equal(ok("DOCTOR").command, "doctor");
  assert.equal(ok("doctor").command, "doctor");
  assert.equal(ok("host", "extra", "argv").command, "host");
  assert.match(parseArguments(["nope"]).error, /^Commande inconnue : nope$/);
  assert.equal(parseArguments(["HELP"]).options, undefined, "help is case-sensitive");
  assert.match(parseArguments(["probe"]).error, /--url est obligatoire/);
  assert.match(parseArguments(["download", "--url"]).error, /^Valeur manquante après --url$/);
  assert.match(parseArguments(["download", "--bogus", "x"]).error, /^Option inconnue : --bogus$/);
  assert.match(parseArguments(["download", "--url", V, "--format", "avi"]).error, /mp4, mkv ou webm/);
  assert.match(parseArguments(["download", "--url", V, "--format", "mkv", "--max-size-mb", "5"]).error, /MP4/);
  bad("download", "--url", V, "--max-size-mb", "0");
  bad("download", "--url", V, "--max-size-mb", "-3");
  assert.equal(ok("download", "--url", V, "--title", "x".repeat(180)).title.length, 180);
  bad("download", "--url", V, "--title", "x".repeat(181));
  assert.equal(ok("download", "--url", V, "--quality", "BEST").quality, "best");
  assert.equal(ok("download", "--url", V, "--format", "MKV").format, "mkv");
  assert.equal(ok("download", "--url", V, "--cookies-from-browser", "FIREFOX").cookiesFromBrowser, "firefox");
  bad("download", "--url", V, "--quality", "7.5");
  assert.equal(ok("probe", "--url", V).command, "probe");
  // --low-resources
  assert.equal(ok("download", "--url", V).lowResources, false);
  assert.equal(ok("download", "--url", V, "--low-resources").lowResources, true);
  assert.equal(ok("download", "--url", V).overwrite, false);
  assert.equal(ok("download", "--url", V, "--overwrite").overwrite, true);
  // host-management commands
  assert.equal(ok("install-host").command, "install-host");
  bad("install-host", "--x");
  assert.equal(ok("uninstall-host").command, "uninstall-host");
  bad("uninstall-host", "--x");
  assert.equal(ok("update").command, "update");
  bad("update", "--x");
  assert.equal(parseArguments(["update", "--x"]).error, "update n'accepte aucun argument : --x");
});

Deno.test("json escape and failure summary", () => {
  assert.equal(jsonEscape('a"b\\c\n'), 'a\\"b\\\\c\\n');
  assert.equal(jsonEscape("\b\f\n\r\t"), "\\b\\f\\n\\r\\t");
  assert.equal(jsonEscape("\x00\x01\x1f"), "\\u0000\\u0001\\u001f");
  assert.equal(jsonEscape("\x7f é 日本 😀"), "\x7f é 日本 😀", "non-ASCII and non-BMP pass through");
  assert.equal(JSON.parse(`"${jsonEscape('\x02"\\\u2028😀')}"`), '\x02"\\\u2028😀', "round-trips through JSON.parse");
  assert.equal(jsonEscape(""), "");

  assert.equal(
    summarizeDownloadFailure("ERROR: Could not copy Chrome cookie database"),
    "Impossible de lire les cookies du navigateur. Fermez complètement le navigateur sélectionné, puis réessayez.",
  );
  assert.equal(
    summarizeDownloadFailure("ERROR: Sign in to confirm your age"),
    "YouTube n'a pas reconnu une session autorisée pour cette vidéo. Vérifiez le navigateur sélectionné et l'âge du compte.",
  );
  assert.equal(
    summarizeDownloadFailure("ERROR: Failed to decrypt with DPAPI. See issue 10927"),
    "Windows n'a pas pu déchiffrer les cookies de ce navigateur Chromium. Utilisez de préférence Firefox connecté à YouTube, puis fermez-le avant de réessayer.",
  );
  assert.equal(summarizeDownloadFailure("noise\nERROR: panne précise\n"), "panne précise");
  assert.equal(
    summarizeDownloadFailure("WARNING: n challenge solving failed\nERROR: The page needs to be reloaded"),
    "Le challenge JavaScript de YouTube n'a pas pu être résolu. Vérifiez qu'un runtime Node ou Deno récent est disponible.",
  );
  // edge cases
  assert.equal(summarizeDownloadFailure(""), "yt-dlp n'a pas pu télécharger cette vidéo.");
  assert.equal(summarizeDownloadFailure("ERROR:   \r\n"), "yt-dlp n'a pas pu télécharger cette vidéo.");
  assert.equal(summarizeDownloadFailure("ERROR: first\r\nERROR: last\r\n"), "last");
  assert.match(summarizeDownloadFailure("ERROR: Sign in to confirm you’re not a bot"), /session connectée valide/);
  assert.match(summarizeDownloadFailure("ERROR: Requested format is not available"), /Essayez la qualité Best/);
  assert.match(summarizeDownloadFailure("ERROR: Video unavailable"), /indisponible/);
});

Deno.test("temporary directory names", () => {
  assert.equal(tryParseTemporaryDirectoryName(".mediadownloader-42-123456"), 42);
  assert.equal(tryParseTemporaryDirectoryName(".mediadownloader-important"), undefined);
  assert.equal(tryParseTemporaryDirectoryName(".mediadownloader-42-123-extra"), undefined);
  // edge cases
  assert.equal(tryParseTemporaryDirectoryName(".mediadownloader-0-1"), undefined, "pid 0");
  assert.equal(tryParseTemporaryDirectoryName(".mediadownloader--1"), undefined);
  assert.equal(tryParseTemporaryDirectoryName(".mediadownloader-42-"), undefined);
  assert.equal(tryParseTemporaryDirectoryName(".mediadownloader-4a-1"), undefined);
  assert.equal(tryParseTemporaryDirectoryName("x.mediadownloader-42-1"), undefined);
  assert.equal(tryParseTemporaryDirectoryName(".mediadownloader-99999999999999999999999-1"), undefined, "pid overflow");
});

Deno.test("orphan cleanup with a fake filesystem", () => {
  const removed: string[] = [];
  const fs = {
    readDir: () => [
      { name: ".mediadownloader-101-1", isDirectory: true },
      { name: ".mediadownloader-202-2", isDirectory: true },
      { name: ".mediadownloader-not-ours", isDirectory: true },
      { name: ".mediadownloader-303-3", isDirectory: false },
      { name: ".mediadownloader-404-4", isDirectory: true },
    ],
    removeAll: (p: string) => {
      if (p.endsWith("404-4")) throw new Error("accès refusé");
      removed.push(p);
    },
  } as unknown as FsOps;
  const r = cleanupOrphanedTemporaryDirectories("/out", (pid) => pid === 202, fs);
  assert.deepEqual(removed, [join("/out", ".mediadownloader-101-1")]);
  assert.deepEqual(r.removed, removed);
  assert.deepEqual(r.failures, [{ path: join("/out", ".mediadownloader-404-4"), message: "accès refusé" }]);

  const missing = cleanupOrphanedTemporaryDirectories("/nope", () => false, { readDir: () => { throw new Error("introuvable"); } } as unknown as FsOps);
  assert.deepEqual(missing, { removed: [], failures: [{ path: "/nope", message: "introuvable" }] });
});

Deno.test({ name: "orphan cleanup on the real filesystem", ignore: !canWrite, fn: () => {
  const root = Deno.makeTempDirSync({ prefix: "mediadownloader-cleanup-tests-" });
  try {
    const orphan = join(root, ".mediadownloader-101-1");
    const active = join(root, ".mediadownloader-202-2");
    const unrelated = join(root, ".mediadownloader-not-ours");
    for (const d of [orphan, active, unrelated]) Deno.mkdirSync(d);
    Deno.writeTextFileSync(join(orphan, "partial.file"), "test");
    const cleanup = cleanupOrphanedTemporaryDirectories(root, (pid) => pid === 202);
    const exists = (p: string) => { try { Deno.statSync(p); return true; } catch { return false; } };
    assert.ok(!exists(orphan), "dossier orphelin supprimé");
    assert.ok(exists(active), "dossier d'une instance active conservé");
    assert.ok(exists(unrelated), "dossier non conforme conservé");
    assert.ok(cleanup.removed.length === 1 && cleanup.failures.length === 0);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
} });

Deno.test({ name: "ensureOutputDirectory on the real filesystem", ignore: !canWrite, fn: () => {
  const base = Deno.makeTempDirSync({ prefix: "md-out-" });
  try {
    const nested = join(base, "a", "b");
    const resolved = ensureOutputDirectory(nested);
    assert.ok(resolved && denoFs.isDirectory(nested), "dossier de sortie imbriqué créé");
    assert.equal(ensureOutputDirectory(nested), resolved, "already existing folder is fine");
    Deno.writeTextFileSync(join(base, "f.txt"), "x");
    assert.equal(ensureOutputDirectory(join(base, "f.txt")), undefined, "fichier refusé comme dossier de sortie");
    assert.equal(ensureOutputDirectory(join(base, "f.txt", "sub")), undefined, "dossier sous un fichier refusé");
    const leftover = [...Deno.readDirSync(nested)].some((e) => e.name.startsWith(".mediadownloader-probe-"));
    assert.ok(!leftover, "le fichier témoin d'écriture est supprimé");
    if (Deno.build.os !== "windows" && Deno.uid() !== 0) {
      const ro = join(base, "ro");
      Deno.mkdirSync(ro);
      Deno.chmodSync(ro, 0o500);
      assert.equal(ensureOutputDirectory(ro), undefined, "dossier en lecture seule refusé");
      assert.equal(ensureOutputDirectory(join(ro, "sub")), undefined, "création sous un dossier en lecture seule refusée");
      Deno.chmodSync(ro, 0o700);
    }
  } finally {
    Deno.removeSync(base, { recursive: true });
  }
} });

Deno.test("ensureOutputDirectory never throws", () => {
  const boom = () => { throw new Error("x"); };
  assert.equal(ensureOutputDirectory("/x", { makeDirs: boom } as unknown as FsOps), undefined);
  assert.equal(ensureOutputDirectory("\0bad"), undefined);
});

Deno.test("ffmpeg arguments", () => {
  const nullDevice = "/dev/null";
  const pass1 = buildEncodeArguments("/t/in.mp4", "/t/out.mp4", "/t/pass", 800, 96, "best", 1, false, "linux");
  const expected1 = ["-y", "-i", "/t/in.mp4", "-map", "0:v:0", "-c:v", "libx264", "-preset", "medium",
    "-b:v", "800k", "-pass:v", "1", "-passlogfile", "/t/pass", "-progress", "pipe:1", "-nostats", "-an", "-f", "null", nullDevice];
  assert.deepEqual(pass1, expected1);
  assert.equal(buildEncodeArguments("/t/in.mp4", "/t/out.mp4", "/t/pass", 800, 96, "best", 1, false, "windows").at(-1), "NUL");
  const pass2 = buildEncodeArguments("/t/in.mp4", "/t/out.mp4", "/t/pass", 800, 96, "720", 2, false, "linux");
  assert.deepEqual(pass2, ["-y", "-i", "/t/in.mp4", "-map", "0:v:0", "-vf", "scale=-2:min(ih\\,720)", "-c:v", "libx264",
    "-preset", "medium", "-b:v", "800k", "-pass:v", "2", "-passlogfile", "/t/pass", "-progress", "pipe:1", "-nostats",
    "-map", "0:a:0?", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "/t/out.mp4"]);
  const low = buildEncodeArguments("/t/in.mp4", "/t/out.mp4", "/t/pass", 800, 96, "best", 1, true, "linux");
  const withThreads = [...pass1];
  withThreads.splice(15, 0, "-threads", "2");
  assert.deepEqual(low, withThreads, "économie de ressources : seul -threads 2 est ajouté");
  // default platform argument follows the host
  const def = buildEncodeArguments("a", "b", "c", 1, 1, "best", 1, false);
  assert.equal(def.at(-1), Deno.build.os === "windows" ? "NUL" : "/dev/null");
});

Deno.test("progress lines and smoother", () => {
  const line = parseDownloadProgressLine("__MD_PROGRESS__:downloading|1024|2048|NA|NA|NA|137");
  assert.ok(line && line.status === "downloading" && line.downloadedBytes === 1024 && line.totalBytes === 2048 &&
    line.fragmentIndex === undefined && line.fragmentCount === undefined && line.formatId === "137");
  const estimate = parseDownloadProgressLine("__MD_PROGRESS__:downloading|10.5|NA|400|NA|NA|NA");
  assert.ok(estimate && estimate.totalBytes === 400 && estimate.formatId === "");
  const fragments = parseDownloadProgressLine("__MD_PROGRESS__:downloading|10|NA|NA|3|12|251");
  assert.ok(fragments && fragments.fragmentIndex === 3 && fragments.fragmentCount === 12 && fragments.totalBytes === undefined);
  assert.equal(parseDownloadProgressLine("[download]  42.0% of 1.00MiB"), undefined);
  assert.equal(parseDownloadProgressLine("__MD_PROGRESS__:downloading|1|2"), undefined);
  assert.equal(parseDownloadProgressLine("__MD_PROGRESS__:|1|2|3|4|5|6"), undefined);
  const garbage = parseDownloadProgressLine("__MD_PROGRESS__:downloading|abc|-5|NA|x|NA|18");
  assert.ok(garbage && garbage.downloadedBytes === undefined && garbage.totalBytes === undefined && garbage.fragmentIndex === undefined);
  assert.equal(parseDownloadProgressLine("__MD_PROGRESS__:downloading|1|2|3|4|5|6|7"), undefined, "too many fields");
  assert.equal(parseDownloadProgressLine("__MD_PROGRESS__:downloading|Infinity|NaN|NA|NA|NA|1")?.downloadedBytes, undefined);

  assert.equal(parsePostprocessorStart("__MD_POST__:started|Merger"), "Merger");
  assert.equal(parsePostprocessorStart("__MD_POST__:finished|Merger"), undefined);
  assert.equal(parsePostprocessorStart("[Merger] Merging formats"), undefined);
  assert.equal(parsePostprocessorStart("__MD_POST__:started|"), undefined);

  const smoother = new DownloadProgressSmoother();
  const at = (text: string) => smoother.update(parseDownloadProgressLine(text)!);
  assert.equal(at("__MD_PROGRESS__:downloading|0|1000|NA|NA|NA|137"), 0);
  assert.equal(at("__MD_PROGRESS__:downloading|500|1000|NA|NA|NA|137"), 42.5);
  assert.equal(at("__MD_PROGRESS__:finished|1000|1000|NA|NA|NA|137"), 85);
  assert.equal(at("__MD_PROGRESS__:downloading|0|100|NA|NA|NA|140"), 85, "le second flux ne fait pas reculer");
  assert.equal(at("__MD_PROGRESS__:downloading|50|100|NA|NA|NA|140"), 92.5);
  assert.equal(at("__MD_PROGRESS__:downloading|50|NA|NA|NA|NA|140"), undefined, "pas de pourcentage sans taille");
  assert.equal(at("__MD_PROGRESS__:finished|100|100|NA|NA|NA|140"), 100);
  // fragments and clamping
  const s2 = new DownloadProgressSmoother();
  assert.equal(s2.update(parseDownloadProgressLine("__MD_PROGRESS__:downloading|NA|NA|NA|6|12|251")!), 42.5);
  assert.equal(s2.update(parseDownloadProgressLine("__MD_PROGRESS__:downloading|2000|1000|NA|NA|NA|251")!), 85, "over 100 % clamped");
});

Deno.test("native host launch detection", () => {
  assert.ok(isNativeHostLaunch(["C:\\x\\media_downloader.json", "mediadownloader@localhost"]));
  assert.ok(isNativeHostLaunch(["/home/u/.mozilla/native-messaging-hosts/media_downloader.json"]));
  assert.ok(isNativeHostLaunch(["mediadownloader@localhost"]));
  assert.ok(isNativeHostLaunch(["{12345678-1234-1234-1234-123456789abc}"]));
  assert.ok(!isNativeHostLaunch([]));
  assert.ok(!isNativeHostLaunch(["download", "--url", "https://example.test/a@b.json"]));
  assert.ok(!isNativeHostLaunch(["host"]) && !isNativeHostLaunch(["doctor"]) && !isNativeHostLaunch(["--help"]));
  assert.ok(!isNativeHostLaunch(["n'importe-quoi"]));
  assert.ok(isNativeHostLaunch(["chrome-extension://jjclljkpbmlceplpicnjkmkjifhhghne/", "--parent-window=123"]));
  // edge cases
  assert.ok(!isNativeHostLaunch(["@x"]) && !isNativeHostLaunch(["x@"]), "@ at an end");
  assert.ok(!isNativeHostLaunch([".json"]), "too short");
  assert.ok(!isNativeHostLaunch(["my file.json"]), "space in first arg");
  assert.ok(!isNativeHostLaunch(["{}"]), "empty braces");
  assert.ok(isNativeHostLaunch(["X.JSON".padStart(8, "a")]), "case-insensitive .json");
  assert.ok(!isNativeHostLaunch(["--x@y.json"]));
});

Deno.test("native manifests", () => {
  const manifest = buildNativeManifest("C:\\Program Files\\MD\\MediaDownloader.Cli.exe", "mediadownloader@localhost");
  assert.ok(manifest.includes('"name": "media_downloader"'));
  assert.ok(manifest.includes('"path": "C:\\\\Program Files\\\\MD\\\\MediaDownloader.Cli.exe"'));
  assert.ok(manifest.includes('"type": "stdio"'));
  assert.ok(manifest.includes('"allowed_extensions": ["mediadownloader@localhost"]'));
  assert.ok(buildNativeManifest('/a"b', "x@y").includes('/a\\"b'));
  assert.equal(JSON.parse(manifest).path, "C:\\Program Files\\MD\\MediaDownloader.Cli.exe", "valid JSON");
  assert.match(JSON.parse(manifest).description, /télécharge/);
  assert.ok(manifest.endsWith("}\n"));

  const home = "/home/u", exeDir = "/opt/md";
  assert.equal(nativeManifestPath("linux", home, exeDir), "/home/u/.mozilla/native-messaging-hosts/media_downloader.json");
  assert.equal(nativeManifestPath("windows", "C:\\Users\\u", "C:\\md"), "C:\\md\\native-host\\media_downloader.json");

  const chromium = buildChromiumNativeManifest("C:\\MD\\MediaDownloader.Cli.exe");
  assert.ok(chromium.includes(`"allowed_origins": ["chrome-extension://${chromiumExtensionId}/"]`));
  assert.ok(!chromium.includes("allowed_extensions"));
  assert.ok(chromium.includes('"name": "media_downloader"') && chromium.includes('"type": "stdio"'));
  assert.ok(chromium.includes('"path": "C:\\\\MD\\\\MediaDownloader.Cli.exe"'));
  assert.ok(/^[a-p]{32}$/.test(chromiumExtensionId), "identifiant Chromium : 32 lettres a-p");
  JSON.parse(chromium);

  const linux = chromiumManifestPaths("linux", home, exeDir);
  assert.equal(linux.length, 4);
  for (
    const p of [
      "/home/u/.config/google-chrome/NativeMessagingHosts/media_downloader.json",
      "/home/u/.config/chromium/NativeMessagingHosts/media_downloader.json",
      "/home/u/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/media_downloader.json",
      "/home/u/.config/opera/NativeMessagingHosts/media_downloader.json",
    ]
  ) assert.ok(linux.includes(p), p);
  assert.deepEqual(chromiumManifestPaths("windows", "C:\\Users\\u", "C:\\md"), ["C:\\md\\native-host\\media_downloader.chromium.json"]);
  const keys = chromiumRegistryKeys();
  assert.deepEqual(keys, [
    "Software\\Google\\Chrome\\NativeMessagingHosts\\media_downloader",
    "Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\media_downloader",
    "Software\\Opera Software\\Opera Stable\\NativeMessagingHosts\\media_downloader",
  ]);
});
