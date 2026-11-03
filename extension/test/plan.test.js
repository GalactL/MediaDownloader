"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const plan = require("../lite/plan.js");

test("planEncode: 60 s / 10 Mo (CoreTests.cpp)", () => {
  const p = plan.planEncode(60, 10);
  assert.ok(p.targetBytes < 10 * 1024 * 1024);
  assert.equal(p.audioKbps, 128);
  assert.ok(p.videoKbps > 1000);
});

test("planEncode: 30 s / 10 Mo", () => {
  assert.deepEqual(plan.planEncode(30, 10), { targetBytes: 10171187, audioKbps: 128, videoKbps: 2584 });
});

test("planEncode: unrealistic or invalid inputs", () => {
  assert.equal(plan.planEncode(7200, 1), null);
  for (const d of [0, -1, NaN, Infinity]) assert.equal(plan.planEncode(d, 10), null);
  for (const s of [0, -1, NaN, Infinity]) assert.equal(plan.planEncode(60, s), null);
});

test("planEncode: audio tiers", () => {
  // 10 Mo * 0.97 over 400 s ~ 203 kbit/s -> 96; over 600 s ~ 135 -> 48
  assert.equal(plan.planEncode(400, 10).audioKbps, 96);
  assert.equal(plan.planEncode(600, 10).audioKbps, 48);
});

test("checkFeasible", () => {
  assert.equal(plan.checkFeasible(30, 10).ok, true);
  assert.deepEqual(plan.checkFeasible(888, 10), { ok: false, code: "size_unreachable", durationSeconds: 888, maxSizeMb: 10 });
});

test("estimateMemoryMb", () => {
  assert.equal(plan.estimateMemoryMb({ tbrKbps: 8192, durationSeconds: 10 }), 10);
});

test("LiteErrorCode is frozen", () => {
  assert.ok(Object.isFrozen(plan.LiteErrorCode));
  assert.deepEqual(Object.keys(plan.LiteErrorCode), Object.values(plan.LiteErrorCode));
});
