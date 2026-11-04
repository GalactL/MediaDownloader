// Port of tests/ProcessTests.cpp, made cross-platform with `deno eval` children. Run: deno test -A engine/test
import assert from "node:assert/strict";
import { join } from "node:path";
import { isProcessRunning, type ProcessResult, runProcess, systemDirectory } from "../process.ts";

const windows = Deno.build.os === "windows";
const deno = Deno.execPath();

function runScript(script: string, onLine?: (line: string) => void, signal?: AbortSignal, lowPriority = false) {
  return runProcess({ command: deno, args: ["eval", "--no-config", script], onLine, signal, lowPriority });
}

async function waitUntil(condition: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

Deno.test("exit code, stdout and stderr lines are streamed in order", async () => {
  const lines: string[] = [];
  const result = await runScript(
    `const out = (s) => Deno.stdout.writeSync(new TextEncoder().encode(s));
     const err = (s) => Deno.stderr.writeSync(new TextEncoder().encode(s));
     const pause = () => new Promise((r) => setTimeout(r, 100));
     out("one\\n"); await pause(); err("two\\n"); await pause(); out("partial"); Deno.exit(7);`,
    (line) => lines.push(line),
  );
  assert.equal(result.exitCode, 7);
  assert.equal(result.cancelled, false);
  assert.deepEqual(lines, ["one", "two", "partial"]);
  assert.equal(result.output, "one\ntwo\npartial\n");
});

Deno.test("lines split on \\n, \\r\\n and lone \\r, across chunks, UTF-8 decoded", async () => {
  const lines: string[] = [];
  await runScript(
    `const out = (b) => Deno.stdout.writeSync(new Uint8Array(b));
     const pause = () => new Promise((r) => setTimeout(r, 50));
     const e = new TextEncoder();
     out([...e.encode("a\\rb\\r")]); await pause(); out([...e.encode("\\nc\\n\\n")]); await pause();
     const accent = [...e.encode("é日")]; out(accent.slice(0, 1)); await pause(); out([...accent.slice(1), 10]);
     out([...e.encode("end\\r")]);`,
    (line) => lines.push(line),
  );
  assert.deepEqual(lines, ["a", "b", "c", "", "é日", "end"]);
});

Deno.test("working directory is applied; a missing program throws", async () => {
  const directory = Deno.makeTempDirSync();
  try {
    const inDirectory = await runProcess({ command: deno, args: ["eval", "console.log(Deno.cwd())"], cwd: directory });
    assert.equal(Deno.realPathSync(inDirectory.output.trim()), Deno.realPathSync(directory));
    await assert.rejects(runProcess({ command: join(directory, "missing-tool"), args: [] }), /Impossible de lancer/);
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("child stdin is empty (null device)", async () => {
  const result = await runScript("console.log((await new Response(Deno.stdin.readable).arrayBuffer()).byteLength)");
  assert.equal(result.output, "0\n");
});

Deno.test("cancel kills the whole process tree", async () => {
  const directory = Deno.makeTempDirSync();
  const pidFile = join(directory, "grandchild.pid");
  try {
    const controller = new AbortController();
    const started = Date.now();
    const sleeper = join(directory, "sleeper.ts");
    Deno.writeTextFileSync(
      sleeper,
      `await Deno.writeTextFile(${JSON.stringify(pidFile)}, String(Deno.pid)); console.log("ready");` +
        "await new Promise((r) => setTimeout(r, 300000));",
    );
    // Windows: through cmd.exe, because a killed deno parent takes its own deno children down with it and
    // would hide a missing tree kill. POSIX: a deno child that starts the sleeper in the same process group.
    const result = await runProcess({
      ...(windows
        ? { command: join(systemDirectory(), "cmd.exe"), args: ["/c", deno, "run", "-A", sleeper] }
        : {
          command: deno,
          args: ["eval", `new Deno.Command(Deno.execPath(), { args: ["run", "-A", ${JSON.stringify(sleeper)}] }).spawn();
            await new Promise((r) => setTimeout(r, 300000));`],
        }),
      onLine: (line) => line === "ready" && controller.abort(),
      signal: controller.signal,
    });
    assert.equal(result.cancelled, true);
    assert.ok(Date.now() - started < 8000, "cancel completes after the grace period, not forever");
    const pid = Number(Deno.readTextFileSync(pidFile));
    assert.ok(pid > 0, "grandchild pid was recorded");
    assert.ok(await waitUntil(() => !isProcessRunning(pid)), "grandchild is gone after cancel");
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test({
  name: "cancel escalates to SIGKILL for a group that ignores SIGTERM",
  ignore: windows,
  async fn() {
    const pidFile = join(Deno.makeTempDirSync(), "pid");
    const controller = new AbortController();
    const started = Date.now();
    const result = await runProcess({
      command: "/bin/sh",
      args: ["-c", `trap '' TERM; sleep 300 & echo $! > '${pidFile}'; echo ready; wait`],
      onLine: (line) => line === "ready" && controller.abort(),
      signal: controller.signal,
    });
    assert.equal(result.cancelled, true);
    assert.ok(Date.now() - started < 8000);
    const pid = Number(Deno.readTextFileSync(pidFile));
    assert.ok(await waitUntil(() => !isProcessRunning(pid) || isZombie(pid)), "grandchild is gone after cancel");
  },
});

// A zombie (killed but not yet reaped by init) counts as gone.
function isZombie(pid: number) {
  try {
    const stat = Deno.readTextFileSync(`/proc/${pid}/stat`);
    return stat[stat.lastIndexOf(")") + 2] === "Z";
  } catch {
    return true;
  }
}

Deno.test("an already aborted signal does not start the process", async () => {
  const result: ProcessResult = await runScript("console.log('ran')", undefined, AbortSignal.abort());
  assert.equal(result.cancelled, true);
  assert.equal(result.output, "");
});

Deno.test("low priority runs at the lowest priority, normal keeps the parent's", async () => {
  const script = "await new Promise((r) => setTimeout(r, 300)); console.log((await import('node:os')).getPriority())";
  assert.equal((await runScript(script, undefined, undefined, true)).output.trim(), "19");
  assert.notEqual((await runScript(script)).output.trim(), "19");
});

Deno.test("isProcessRunning", async () => {
  assert.equal(isProcessRunning(Deno.pid), true);
  assert.equal(isProcessRunning(0), false);
  assert.equal(isProcessRunning(-1), false);
  assert.equal(isProcessRunning(2 ** 40), false);
  const child = new Deno.Command(deno, { args: ["eval", "0"], stdout: "null", stderr: "null" }).spawn();
  await child.status;
  assert.equal(isProcessRunning(child.pid), false);
});
