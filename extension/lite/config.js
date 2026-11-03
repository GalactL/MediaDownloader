// Lite mode settings (ES module, read by engine.js and worker.mjs).
// Video: x264, 2 passes, same arguments as the native engine. WebCodecs was measured and rejected in #59 T4
// (frames shifted/dropped, SSIM 0.025 to 0.18 under x264); the GPL ffmpeg-core.wasm is shipped either way.
export const X264_PRESET = 'superfast'; // #59 T4: SSIM within 0.0005 of veryfast, encode 1.4 to 1.6x faster
export const MAX_HEIGHT = 720; // format selection and scaling, like the native `quality` 720
// Refused before download when 2 x the estimated source size exceeds this (the intermediate lives in the
// wasm heap, capped at 2 GiB, while it is written). Peak measured in the spikes: 0.8 to 1.2 GB per process.
export const MEMORY_BUDGET_MB = 600;
export const EXTRACT_RETRIES = 2; // extra attempts after an extraction timeout (TikTok: 5/20 in spike #58)
