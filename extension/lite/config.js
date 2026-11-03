// Lite mode settings (ES module, read by engine.js and worker.mjs).
// 'x264' (2-pass, same arguments as the native engine) or 'webcodecs' (VideoEncoder, one pass; not qualified).
export const ENCODER = 'x264';
export const X264_PRESET = 'superfast'; // spike #58: only superfast keeps a 30 s clip near 1 min
export const MAX_HEIGHT = 720; // format selection and scaling, like the native `quality` 720
// Refused before download when 2 x the estimated source size exceeds this (the intermediate lives in the
// wasm heap, capped at 2 GiB, while it is written). Peak measured in the spikes: 0.8 to 1.2 GB per process.
export const MEMORY_BUDGET_MB = 600;
export const EXTRACT_RETRIES = 2; // extra attempts after an extraction timeout (TikTok: 5/20 in spike #58)
