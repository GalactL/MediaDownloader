import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanEnvironment = {};
let processPath = '';

for (const [key, value] of Object.entries(process.env)) {
  if (key.toLowerCase() === 'path') {
    processPath ||= value;
  } else {
    cleanEnvironment[key] = value;
  }
}
cleanEnvironment.Path = processPath;

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: projectRoot,
    env: cleanEnvironment,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const engineOnly = process.argv.includes('--engine-only');
run('cmake', ['--fresh', '-S', '.', '-B', 'build']);
run('cmake', engineOnly
  ? ['--build', 'build', '--config', 'Release', '--target', 'MediaDownloaderCli', 'MediaDownloaderTests']
  : ['--build', 'build', '--config', 'Release']);
