"use strict";
// Pure encode planning, a port of CalculateEncodePlan (src/Core.cpp); usable in a worker (importScripts) and in Node.
(function (root) {
  const MIN_VIDEO_KBPS = 80;

  const LiteErrorCode = Object.freeze({
    size_unreachable: "size_unreachable",
    out_of_memory: "out_of_memory",
    extract_timeout: "extract_timeout",
    permission_denied: "permission_denied",
    unsupported_site: "unsupported_site",
  });

  function planEncode(durationSeconds, maxSizeMb) {
    if (!Number.isFinite(durationSeconds) || !Number.isFinite(maxSizeMb) || durationSeconds <= 0 || maxSizeMb <= 0) return null;
    // 97 % of the MiB limit: 3 % margin for the container.
    const target = maxSizeMb * 1024 * 1024 * 0.97;
    const totalKbps = target * 8 / durationSeconds / 1000;
    const audioKbps = totalKbps >= 320 ? 128 : totalKbps >= 200 ? 96 : 48;
    if (totalKbps <= audioKbps + MIN_VIDEO_KBPS) return null;
    return { targetBytes: Math.floor(target), audioKbps, videoKbps: Math.floor(totalKbps - audioKbps) };
  }

  function checkFeasible(durationSeconds, maxSizeMb) {
    const plan = planEncode(durationSeconds, maxSizeMb);
    return plan ? { ok: true, plan } : { ok: false, code: LiteErrorCode.size_unreachable, durationSeconds, maxSizeMb };
  }

  // Rough size in MB of the source before encoding: bitrate (kbit/s) * duration / 8 / 1024.
  function estimateMemoryMb({ tbrKbps, durationSeconds }) {
    return tbrKbps * durationSeconds / 8 / 1024;
  }

  const api = { planEncode, checkFeasible, estimateMemoryMb, LiteErrorCode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDLitePlan = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
