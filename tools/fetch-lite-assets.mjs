// Fetches the lite mode's embedded runtimes into extension/lite/vendor/ (gitignored), at pinned versions, and
// verifies their SHA-256. Run at packaging time only: the extension never loads remote code.
//   node tools/fetch-lite-assets.mjs           download what is missing or wrong, then verify
//   node tools/fetch-lite-assets.mjs --check   verify only (exit 1 if a file is missing or differs)
// Sums computed on the downloaded files (2026-11-03), equal to the files of the lite spikes (#54, #55, #58)
// and, for the wheels, to the digests published by PyPI.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
const FFMPEG = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/';
const ASSETS = [
  ['pyodide/pyodide.mjs', PYODIDE + 'pyodide.mjs', '6f1d60f7bf529beb300f0f47983c921d3982363640ba20af0e38efdddbc66109'],
  ['pyodide/pyodide.asm.mjs', PYODIDE + 'pyodide.asm.mjs', 'f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635'],
  ['pyodide/pyodide.asm.wasm', PYODIDE + 'pyodide.asm.wasm', 'cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6'],
  ['pyodide/python_stdlib.zip', PYODIDE + 'python_stdlib.zip', 'fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a'],
  ['pyodide/pyodide-lock.json', PYODIDE + 'pyodide-lock.json', '5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010'],
  ['wheels/yt_dlp-2026.10.26-py3-none-any.whl',
    'https://files.pythonhosted.org/packages/7f/3d/16ea7d5638cf585991f2c5705e8083688dde633d32d0871f2404e0f4d827/yt_dlp-2026.10.26-py3-none-any.whl',
    'a05c5b5d8562f7e8a62f5334348b406af4930d56d3a65f8021d14af0e22339ae'],
  ['wheels/yt_dlp_ejs-0.8.0-py3-none-any.whl',
    'https://files.pythonhosted.org/packages/e3/bd/520769863744b669440a924271a6159ddd82ad5ae26b4ac4d4b69e9f8d44/yt_dlp_ejs-0.8.0-py3-none-any.whl',
    '79300e5fca7f937a1eeede11f0456862c1b41107ce1d726871e0207424f4bdb4'],
  ['qjs/qjs-wasi.wasm', 'https://github.com/quickjs-ng/quickjs/releases/download/v0.18.0/qjs-wasi.wasm',
    '2c218412cb8b17e46ee91bea7556ec38f5b9b6bd6312fddd3ceeed14aa71eaaa'],
  ['ffmpeg/ffmpeg-core.js', FFMPEG + 'ffmpeg-core.js', '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3'],
  ['ffmpeg/ffmpeg-core.wasm', FFMPEG + 'ffmpeg-core.wasm', '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7'],
];

const vendor = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'lite', 'vendor');
const checkOnly = process.argv.includes('--check');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const current = file => readFile(file).then(sha256, () => null);

let failures = 0;
for (const [name, url, expected] of ASSETS) {
  const file = path.join(vendor, name);
  let actual = await current(file);
  if (actual !== expected && !checkOnly) {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`ÉCHEC ${name} : HTTP ${response.status} (${url})`);
      failures++;
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    actual = sha256(bytes);
    if (actual === expected) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file + '.part', bytes);
      await rename(file + '.part', file);
    }
  }
  if (actual === expected) console.log(`ok ${name}`);
  else {
    console.error(actual ? `ÉCHEC ${name} : SHA-256 ${actual}, attendu ${expected}` : `ÉCHEC ${name} : absent`);
    failures++;
  }
}
if (failures) {
  console.error(`${failures} fichier(s) en échec dans ${vendor}`);
  process.exit(1);
}
