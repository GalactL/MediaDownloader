// Deno permissions the engine needs at runtime: the launchers pass exactly these (checked by process.test.ts).
// read/write/run cannot be narrowed: the output folder and the tool paths are chosen by the user.
export const enginePermissions = [
  "--allow-read",
  "--allow-write",
  "--allow-run",
  "--allow-sys=setPriority",
  "--allow-env=PATH,HOME,SystemRoot,MEDIADOWNLOADER_YTDLP,MEDIADOWNLOADER_FFMPEG,MEDIADOWNLOADER_DENO,MEDIADOWNLOADER_NODE",
];
