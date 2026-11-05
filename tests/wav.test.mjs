import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWav, parseWav, toMono, trimSilence, concatWithGaps, rms } from "../cli/lib/wav.mjs";

test("encodeWav/parseWav round-trip", () => {
  const samples = Int16Array.from([0, 1000, -1000, 32767, -32768]);
  const w = parseWav(encodeWav({ samples, sampleRate: 24000, channels: 1 }));
  assert.equal(w.sampleRate, 24000);
  assert.equal(w.channels, 1);
  assert.deepEqual(Array.from(w.samples), Array.from(samples));
});

test("toMono resamples to the target rate", () => {
  const samples = new Int16Array(48000 * 2).fill(500);
  const m = toMono({ samples, sampleRate: 48000, channels: 2 }, 24000);
  assert.ok(Math.abs(m.length - 24000) <= 1);
  assert.ok(Math.abs(m[100] - 500) < 1);
});

test("trimSilence keeps a short margin around speech", () => {
  const sr = 1000;
  const x = new Float32Array(1000);
  for (let i = 400; i < 600; i++) x[i] = 5000;
  const t = trimSilence(x, sr, { keepMs: 40 });
  assert.ok(Math.abs(t.length - 280) <= 2);
});

test("concatWithGaps returns spans that include gaps", () => {
  const { spans, duration, samples } = concatWithGaps([new Float32Array(100).fill(1), new Float32Array(50).fill(2)], [0.1, 0], 1000);
  assert.deepEqual(spans, [[0, 0.1], [0.2, 0.25]]);
  assert.equal(duration, 0.25);
  assert.equal(samples[150], 0);
  assert.equal(rms(new Int16Array([3, -3])), 3);
});
