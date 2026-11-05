// Sentence-level TTS: every caption line is synthesized separately, so measured
// durations give exact caption timing; lines are then joined per scene with pauses.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request, requireApiKey, pool } from "./http.mjs";
import { parseWav, readWav, toMono, trimSilence, concatWithGaps, writeWav } from "./wav.mjs";
import { splitLines, speakable } from "./text.mjs";
import { log } from "./project.mjs";
import { integratedLoudness, normalizeLoudness } from "./loudness.mjs";

export const TTS_DEFAULTS = {
  baseUrl: "https://api.mangoqwq.com/v1",
  model: "mimo-v2.5-tts",
  voice: "mimo_default",
  keyEnv: "MANGO_API_KEY",
  sampleRate: 24000,
  concurrency: 3,
  pause: { sentence: 0.32, clause: 0.16 },
  leadIn: 0.15,
  tail: 0.35,
  // Narration is normalized as a whole (one gain for every scene) to this integrated loudness.
  loudness: -16,
};

export function ttsConfig(config) {
  const t = { ...TTS_DEFAULTS, ...(config.tts ?? {}) };
  t.pause = { ...TTS_DEFAULTS.pause, ...(config.tts?.pause ?? {}) };
  return t;
}

export function captionMaxChars(config) {
  return config.captions?.maxChars ?? (config.aspect === "9:16" ? 13 : 22);
}

// Resolve a scene's narration into caption/TTS lines.
export function sceneLines(scene, config) {
  if (Array.isArray(scene.lines)) return scene.lines.map((l) => (typeof l === "string" ? { text: l, pause: "sentence" } : { pause: "sentence", ...l }));
  if (!scene.narration) return [];
  return splitLines(scene.narration, captionMaxChars(config));
}

export function lineHash(speak, t) {
  return createHash("sha1").update([t.model, t.voice, t.instructions ?? "", t.speed ?? "", speak].join("\u0001")).digest("hex").slice(0, 16);
}

async function synthesize(speak, t, key) {
  const json = { model: t.model, input: speak, voice: t.voice, response_format: "wav" };
  if (t.speed) json.speed = t.speed;
  if (t.instructions) json.instructions = t.instructions;
  const res = await request(`${t.baseUrl.replace(/\/$/, "")}/audio/speech`, { method: "POST", json, key, timeoutSec: 180, retries: 3 });
  if (res.body.subarray(0, 4).toString() !== "RIFF") throw new Error(`TTS returned non-WAV data: ${res.body.subarray(0, 200).toString()}`);
  parseWav(res.body); // fail fast on a truncated file
  return res.body;
}

// Build plan/timings.json from the script. Lines are cached by content hash, so editing
// one sentence re-synthesizes only that sentence.
export async function runTts(project, script, { force = false, only = [], dry = false } = {}) {
  const { config, paths } = project;
  const t = ttsConfig(config);
  const lexicon = { ...(config.lexicon ?? {}), ...(script.lexicon ?? {}) };
  const jobs = [];
  const scenes = script.scenes.map((scene) => {
    const lines = sceneLines(scene, config).map((l) => {
      const speak = l.speak ?? speakable(l.text, lexicon);
      const hash = lineHash(speak, t);
      const file = join(paths.linesDir, `${hash}.wav`);
      const job = { scene: scene.id, text: l.text, speak, hash, file, pause: l.pause };
      const forced = force && (only.length === 0 || only.includes(scene.id));
      if (forced || !existsSync(file)) jobs.push(job);
      return job;
    });
    return { id: scene.id, lines };
  });

  if (dry) {
    for (const s of scenes) for (const l of s.lines) log(`${s.id}\t${l.pause}\t${l.text}${l.speak !== l.text ? `\t→ ${l.speak}` : ""}`);
    log(`${jobs.length} line(s) would be synthesized`);
    return null;
  }

  if (jobs.length) {
    const key = requireApiKey(t.keyEnv);
    mkdirSync(paths.linesDir, { recursive: true });
    let done = 0;
    await pool(jobs, t.concurrency, async (job) => {
      const buf = await synthesize(job.speak, t, key);
      writeFileSync(job.file, buf);
      done++;
      log(`  [${done}/${jobs.length}] ${job.scene}: ${job.text}`);
    });
  } else log("all lines cached");

  const out = { sampleRate: t.sampleRate, voice: { model: t.model, voice: t.voice }, scenes: {} };
  const joinedById = {};
  for (const s of scenes) {
    if (!s.lines.length) continue;
    const clips = s.lines.map((l) => trimSilence(toMono(readWav(l.file), t.sampleRate), t.sampleRate));
    const gaps = s.lines.map((l, i) => (i === s.lines.length - 1 ? t.tail : t.pause[l.pause] ?? t.pause.sentence));
    const lead = new Float32Array(Math.round(t.leadIn * t.sampleRate));
    joinedById[s.id] = concatWithGaps([lead, ...clips], [0, ...gaps], t.sampleRate);
  }
  // One shared gain keeps the voice level consistent between scenes.
  const parts = Object.values(joinedById).map((j) => j.samples);
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
  const measured = integratedLoudness(all, t.sampleRate, { fullScale: 32768 });
  const target = t.loudness === false ? measured : t.loudness;
  let total = 0;
  for (const s of scenes) {
    if (!s.lines.length) {
      out.scenes[s.id] = { file: null, duration: 0, lines: [] };
      continue;
    }
    const joined = joinedById[s.id];
    const samples = Number.isFinite(measured) ? normalizeLoudness(joined.samples, t.sampleRate, { target, measuredOverride: measured, fullScale: 32768 }).samples : joined.samples;
    const rel = `audio/${s.id}.wav`;
    writeWav(join(paths.audioDir, `${s.id}.wav`), { samples, sampleRate: t.sampleRate, channels: 1 });
    out.scenes[s.id] = {
      file: rel,
      duration: round(joined.duration),
      lines: s.lines.map((l, i) => ({ text: l.text, speak: l.speak, hash: l.hash, start: round(joined.spans[i + 1][0]), end: round(joined.spans[i + 1][1]) })),
    };
    total += joined.duration;
  }
  if (Number.isFinite(measured)) out.loudness = { measured: round(measured), target, gainDb: round(target - measured) };
  out.totalNarration = round(total);
  return out;
}

const round = (x) => Math.round(x * 1000) / 1000;
