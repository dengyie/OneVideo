// Asset library: curated, normalized sound effects (and later scene recipes) shared by every
// project. library/catalog.json is the index; audio lives in one of two stores:
//   repo — library/<file>, committed (CC0 / no-attribution sources such as Kenney, Remotion)
//   ext  — $ONEVIDEO_LIBRARY_EXT/<file> (default /srv/onevideo/library), for licenses that forbid
//          redistribution (Sonniss GDC bundles); only the metadata is committed.
// Projects name a sound by entry id ("impact-02") or category ("impact" → catalog default).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { ONEVIDEO_ROOT, UserError } from "./project.mjs";
import { ffmpeg } from "./ffmpeg.mjs";
import { readWav, writeWav } from "./wav.mjs";
import { integratedLoudness, normalizeLoudness } from "./loudness.mjs";

export const LIB_ROOT = join(ONEVIDEO_ROOT, "library");
export const CATALOG = join(LIB_ROOT, "catalog.json");
export const extRoot = () => process.env.ONEVIDEO_LIBRARY_EXT || "/srv/onevideo/library";

// Loudness targets for ingest: effects sit under narration (-16 LUFS) by default.
export const SFX_TARGET = { lufs: -20, ceilingDb: -1.5, sampleRate: 48000 };
// Longest kept length per category (seconds); beds and loops get more room.
const MAX_DURATION = { crowd: 8, tick: 4, rocket: 7, impact: 4, boom: 4, swell: 5, riser: 5, typewriter: 3, keyboard: 3 };
const DEFAULT_MAX = 3;

// Licenses whose files may be committed; anything else goes to the ext store.
const REDISTRIBUTABLE = [/^kenney/i, /^remotion/i, /cc0/i];

export function loadCatalog(file = CATALOG) {
  if (!existsSync(file)) return { version: 1, defaults: {}, entries: [] };
  const c = JSON.parse(readFileSync(file, "utf8"));
  return { version: 1, defaults: {}, entries: [], ...c };
}

export function saveCatalog(catalog, file = CATALOG) {
  const entries = [...catalog.entries].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...catalog, entries }, null, 2) + "\n");
}

export const entryPath = (e) => join(e.store === "ext" ? extRoot() : LIB_ROOT, e.file);
export const entryAvailable = (e) => existsSync(entryPath(e));

// name → {entry, fallback} | null. A category resolves to catalog.defaults[category] when that
// file is on this host, otherwise to the first available entry of the category (fallback: true,
// so callers can warn that renders on another host may sound different).
export function resolveSfx(name, catalog = loadCatalog()) {
  const byId = catalog.entries.find((e) => e.id === name);
  if (byId) return entryAvailable(byId) ? { entry: byId, fallback: false } : null;
  const inCat = catalog.entries.filter((e) => e.category === name);
  if (!inCat.length) return null;
  const def = inCat.find((e) => e.id === catalog.defaults[name]);
  if (def && entryAvailable(def)) return { entry: def, fallback: false };
  const any = inCat.find(entryAvailable);
  return any ? { entry: any, fallback: true } : null;
}

export const categories = (catalog = loadCatalog()) => [...new Set(catalog.entries.map((e) => e.category))].sort();

export function searchCatalog(query, catalog = loadCatalog()) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return catalog.entries.filter((e) => {
    const hay = [e.id, e.category, e.note, e.provenance?.source, ...(e.tags ?? [])].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

// Leading silence trim, length cap with a fade-out, loudness to target with a soft peak ceiling.
// Works on interleaved 16-bit PCM; loudness is measured on the mono mix.
export function processSfx(wav, { maxDuration = DEFAULT_MAX, target = SFX_TARGET.lufs, ceilingDb = SFX_TARGET.ceilingDb } = {}) {
  const { channels: ch, sampleRate: sr } = wav;
  let s = wav.samples;
  const frames = s.length / ch;
  let first = 0;
  find: for (; first < frames; first++) for (let c = 0; c < ch; c++) if (Math.abs(s[first * ch + c]) > 160) break find;
  first = Math.max(0, first - Math.round(0.005 * sr));
  const keep = Math.min(frames - first, Math.round(maxDuration * sr));
  if (keep <= 0) throw new Error("clip is silent");
  s = s.slice(first * ch, (first + keep) * ch);
  if (frames - first > keep) {
    const fade = Math.min(keep, Math.max(Math.round(0.08 * sr), Math.round(keep * 0.15)));
    for (let i = 0; i < fade; i++) {
      const g = Math.cos(((i + 1) / fade) * Math.PI / 2) ** 2;
      for (let c = 0; c < ch; c++) s[(keep - fade + i) * ch + c] = Math.round(s[(keep - fade + i) * ch + c] * g);
    }
  }
  const mono = new Float32Array(keep);
  for (let i = 0; i < keep; i++) { let v = 0; for (let c = 0; c < ch; c++) v += s[i * ch + c]; mono[i] = v / ch; }
  const measured = integratedLoudness(mono, sr, { fullScale: 32768 });
  if (!Number.isFinite(measured)) throw new Error("clip is silent");
  const out = normalizeLoudness(s, sr, { target, ceilingDb, measuredOverride: measured, fullScale: 32768 });
  let peak = 0;
  for (const v of out.samples) if (Math.abs(v) > peak) peak = Math.abs(v);
  return {
    wav: { samples: out.samples, sampleRate: sr, channels: ch },
    duration: keep / sr,
    measured,
    peakDb: 20 * Math.log10(Math.max(1, peak) / 32768),
    limited: out.limited,
  };
}

// Decode any format ffmpeg reads to 48 kHz stereo 16-bit (surround is downmixed), then process.
export async function ingestSfx(src, dest, opts = {}) {
  const tmp = join(tmpdir(), `ov-lib-${process.pid}-${Date.now()}.wav`);
  try {
    await ffmpeg(["-y", "-v", "error", "-i", src, "-vn", "-ac", "2", "-ar", String(SFX_TARGET.sampleRate), "-c:a", "pcm_s16le", tmp]);
    const res = processSfx(readWav(tmp), opts);
    writeWav(dest, res.wav);
    return { ...res, sha256: sha256(dest) };
  } finally {
    rmSync(tmp, { force: true });
  }
}

// candidates: [{category, path, source, license, note, ...}] in preference order per category.
// Ids are <category>-<nn> by that order, so the same candidate file yields the same ids on
// every host; files not present on this host are skipped and their entries left untouched.
export async function importCandidates(candidates, { catalog = loadCatalog(), force = false, onEntry = () => {} } = {}) {
  const seen = {};
  let added = 0, skipped = 0, failed = 0;
  for (const c of candidates) {
    if (!c.category || !c.path) throw new UserError(`candidate needs category and path: ${JSON.stringify(c).slice(0, 120)}`);
    seen[c.category] = (seen[c.category] ?? 0) + 1;
    const id = `${c.category}-${String(seen[c.category]).padStart(2, "0")}`;
    if (!catalog.defaults[c.category]) catalog.defaults[c.category] = id;
    const existing = catalog.entries.find((e) => e.id === id);
    if (existing && !force && entryAvailable(existing)) { skipped++; onEntry({ id, status: "kept" }); continue; }
    if (!existsSync(c.path)) { skipped++; onEntry({ id, status: "absent" }); continue; }
    const store = REDISTRIBUTABLE.some((re) => re.test(c.source ?? "") || re.test(c.license ?? "")) ? "repo" : "ext";
    const file = `sfx/${c.category}/${id}.wav`;
    const entry = { id, kind: "sfx", category: c.category, store, file };
    try {
      const res = await ingestSfx(c.path, entryPath(entry), { maxDuration: MAX_DURATION[c.category] ?? DEFAULT_MAX });
      Object.assign(entry, {
        sha256: res.sha256,
        tags: c.tags ?? [],
        note: c.note ?? "",
        audio: { duration: +res.duration.toFixed(3), sampleRate: SFX_TARGET.sampleRate, channels: 2, lufs: SFX_TARGET.lufs, sourceLufs: +res.measured.toFixed(1), peakDb: +res.peakDb.toFixed(1) },
        provenance: { source: c.source, license: c.license, original: c.path.split("/").slice(-2).join("/"), url: c.url ?? null },
      });
      catalog.entries = catalog.entries.filter((e) => e.id !== id).concat(entry);
      added++;
      onEntry({ id, status: "added", entry });
    } catch (e) {
      failed++;
      onEntry({ id, status: "failed", error: e.message });
    }
  }
  return { catalog, added, skipped, failed };
}

// Union by id; incoming entries replace local ones (the host that ingested a file owns its entry).
export function mergeCatalogs(base, incoming) {
  const byId = new Map(base.entries.map((e) => [e.id, e]));
  for (const e of incoming.entries ?? []) byId.set(e.id, e);
  return { ...base, defaults: { ...(incoming.defaults ?? {}), ...base.defaults }, entries: [...byId.values()] };
}

// → [{id, status: ok|missing|mismatch|unavailable}] ; ext files absent from this host are
// "unavailable" (expected off the render VM), repo files absent are "missing" (an error).
export function verifyCatalog(catalog = loadCatalog()) {
  return catalog.entries.map((e) => {
    const p = entryPath(e);
    if (!existsSync(p)) return { id: e.id, status: e.store === "ext" ? "unavailable" : "missing" };
    return { id: e.id, status: e.sha256 && sha256(p) !== e.sha256 ? "mismatch" : "ok" };
  });
}
