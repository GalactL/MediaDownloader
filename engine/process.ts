// Child processes: port of src/Process.cpp (Windows) and src/ProcessPosix.cpp (Linux).
import { setPriority } from "node:os";
import { join } from "node:path";

export interface ProcessResult {
  exitCode: number;
  output: string; // every line of stdout and stderr, in arrival order, each followed by "\n"
  cancelled: boolean;
}

export interface RunProcessOptions {
  command: string;
  args: string[];
  cwd?: string;
  // stdout and stderr lines (split on \n, \r\n and lone \r), UTF-8 decoded.
  onLine?: (line: string) => void;
  // Abort kills the whole process tree.
  signal?: AbortSignal;
  // Lowest scheduling priority (nice 19 / IDLE_PRIORITY_CLASS), inherited by the child's own children.
  lowPriority?: boolean;
  // Non-fatal problems (the engine turns them into "warning" log events).
  onWarning?: (message: string) => void;
}

const windows = Deno.build.os === "windows";
const terminateGraceMs = 3000;

export const systemDirectory = () => join(Deno.env.get("SystemRoot") ?? "C:\\Windows", "System32");

// Two pipes instead of the C++ single merged pipe (Deno cannot merge them): lines stay whole and keep
// their arrival order, but two writes a few microseconds apart on different streams may swap.
export async function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  if (options.signal?.aborted) return { exitCode: 1, output: "", cancelled: true };
  let { command, args } = options;
  // Like setpriority(19) before exec in the C++: nice applies to every thread from the start.
  if (options.lowPriority && !windows) [command, args] = ["nice", ["-n", "19", command, ...args]];

  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(command, {
      args,
      cwd: options.cwd,
      // Children must not share our stdin: in host mode it carries the framed protocol.
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      // POSIX: own process group, so cancellation reaches grandchildren. Never on Windows: a detached
      // child has no console and its console children (ffmpeg under yt-dlp) would open a window.
      detached: !windows,
    }).spawn();
  } catch (error) {
    throw new Error("Impossible de lancer le processus externe", { cause: error });
  }
  // shortcut: Windows cannot set the priority class before the start without FFI, so the child runs a few
  // milliseconds at normal priority; children it creates afterwards inherit IDLE.
  if (options.lowPriority && windows) {
    try {
      setPriority(child.pid, 19); // needs --allow-sys=setPriority (see permissions.ts)
    } catch (error) {
      options.onWarning?.(`Impossible de passer le processus en priorité basse : ${(error as Error).message}`);
    }
  }

  const lines: string[] = [];
  const emit = (line: string) => {
    lines.push(line);
    options.onLine?.(line);
  };
  const read = async (stream: ReadableStream<Uint8Array>) => {
    let pending = "";
    for await (const text of stream.pipeThrough(new TextDecoderStream())) {
      // A trailing \r stays pending: the \n of a \r\n may be in the next chunk.
      const parts = (pending + text).split(/\r\n|\r(?!$)|\n/);
      pending = parts.pop()!;
      parts.forEach(emit);
    }
    if (pending.endsWith("\r")) pending = pending.slice(0, -1);
    if (pending !== "") emit(pending);
  };

  let exited = false;
  const status = child.status.finally(() => exited = true);
  const tasks = [read(child.stdout), read(child.stderr), status] as const;

  let cancelled = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const signalGroup = (signal: Deno.Signal) => {
    try {
      Deno.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch { /* already gone */ }
    }
  };
  const terminate = async () => {
    if (windows) {
      if (exited) return;
      // No job object without FFI: taskkill walks the tree from the (still running) child.
      try {
        await new Deno.Command(join(systemDirectory(), "taskkill.exe"), {
          args: ["/PID", String(child.pid), "/T", "/F"],
          stdin: "null",
          stdout: "null",
          stderr: "null",
        }).output();
      } catch { /* fall back below */ }
      try {
        child.kill("SIGKILL");
      } catch { /* already gone */ }
    } else if (killTimer === undefined) {
      // SIGTERM to the whole group, grace period, then SIGKILL to the group. Also after the leader exited:
      // descendants may still hold the pipes (the C++ keeps polling the group too).
      signalGroup("SIGTERM");
      killTimer = setTimeout(() => signalGroup("SIGKILL"), terminateGraceMs);
    }
  };
  const onAbort = () => {
    if (windows && exited) return;
    cancelled = true;
    void terminate();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let code: number, signal: Deno.Signal | null;
    try {
      [, , { code, signal }] = await Promise.all(tasks);
    } catch (error) {
      // A throwing onLine must not leave the tree running (nor its files locked).
      await terminate();
      await Promise.allSettled(tasks);
      throw error;
    } finally {
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
        signalGroup("SIGKILL"); // group members that closed their pipes before the grace period ended
      }
    }
    return { exitCode: signal ? 128 : code, output: lines.map((line) => line + "\n").join(""), cancelled };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

// For cleanupOrphanedTemporaryDirectories. When in doubt the process counts as running (its directory is kept).
export function isProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0xffffffff) return false;
  if (!windows) {
    try {
      Deno.statSync(`/proc/${pid}`);
      return true;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) return true;
      try {
        Deno.statSync("/proc/self");
        return false;
      } catch {
        return true; // no procfs: cannot tell
      }
    }
  }
  // Deno cannot open a process handle on Windows; tasklist sees every process, including other users'.
  try {
    const result = new Deno.Command(join(systemDirectory(), "tasklist.exe"), {
      args: ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    return !result.success || new TextDecoder().decode(result.stdout).includes(`,"${pid}",`);
  } catch {
    return true;
  }
}
