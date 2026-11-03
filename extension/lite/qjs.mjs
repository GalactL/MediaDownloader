// Minimal WASI preview1 shim to run quickjs-ng's qjs-wasi.wasm synchronously (no eval, no subprocess).
// Only what `qjs -e <code>` needs: argv, stdout/stderr capture, clocks. Everything else -> ENOSYS.
const ENOSYS = 52, EBADF = 8;
class Exit { constructor(code) { this.code = code; } }

export function runQjs(module, code) {
  const enc = new TextEncoder();
  const argv = ['qjs', '--stack-size', '67108864', '-e', code].map(a => enc.encode(a + '\0'));
  const out = [], err = [];
  let mem;
  const dv = () => new DataView(mem.buffer);
  const wasi = {
    args_sizes_get(pc, ps) { const v = dv(); v.setUint32(pc, argv.length, true); v.setUint32(ps, argv.reduce((s, b) => s + b.length, 0), true); return 0; },
    args_get(pp, pb) { const v = dv(), u = new Uint8Array(mem.buffer); for (const b of argv) { v.setUint32(pp, pb, true); pp += 4; u.set(b, pb); pb += b.length; } return 0; },
    environ_sizes_get(pc, ps) { const v = dv(); v.setUint32(pc, 0, true); v.setUint32(ps, 0, true); return 0; },
    environ_get() { return 0; },
    clock_time_get(id, _prec, pt) { dv().setBigUint64(pt, BigInt(Math.round((id === 0 ? Date.now() : performance.now()) * 1e6)), true); return 0; },
    fd_write(fd, iovs, n, pw) {
      const v = dv(); let t = 0;
      for (let i = 0; i < n; i++) {
        const p = v.getUint32(iovs + 8 * i, true), l = v.getUint32(iovs + 8 * i + 4, true);
        (fd === 1 ? out : err).push(new Uint8Array(mem.buffer, p, l).slice()); t += l;
      }
      v.setUint32(pw, t, true); return 0;
    },
    fd_read(_fd, _iovs, _n, pr) { dv().setUint32(pr, 0, true); return 0; },
    fd_fdstat_get(fd, p) { if (fd > 2) return EBADF; const v = dv(); v.setUint8(p, 2); v.setUint16(p + 2, 0, true); v.setBigUint64(p + 8, 0n, true); v.setBigUint64(p + 16, 0n, true); return 0; },
    fd_prestat_get() { return EBADF; },
    proc_exit(c) { throw new Exit(c); },
  };
  const imports = { wasi_snapshot_preview1: new Proxy(wasi, { get: (t, k) => t[k] || (() => ENOSYS) }) };
  const inst = new WebAssembly.Instance(module, imports);
  mem = inst.exports.memory;
  let status = 0;
  try { inst.exports._start(); } catch (e) { if (e instanceof Exit) status = e.code; else throw e; }
  const dec = parts => {
    const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
    return new TextDecoder().decode(all);
  };
  return { status, stdout: dec(out), stderr: dec(err) };
}
