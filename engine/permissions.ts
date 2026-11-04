// Deno permissions the engine needs at runtime: the launchers pass exactly these (contract.test.ts checks the
// launchers, process.test.ts and the CLI/host tests run with exactly this set).
// read/write/run cannot be narrowed: the output folder and the tool paths are chosen by the user.
export const enginePermissions = [
  "--allow-read",
  "--allow-write",
  "--allow-run",
  "--allow-sys=setPriority",
  "--allow-env=PATH,HOME,SystemRoot,MEDIADOWNLOADER_YTDLP,MEDIADOWNLOADER_FFMPEG,MEDIADOWNLOADER_DENO,MEDIADOWNLOADER_NODE",
];
