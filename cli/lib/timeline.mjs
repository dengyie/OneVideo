// Timeline compiler: script + storyboard + measured timings → plan/timeline.json.
// The Remotion template reads only this file, so every timing decision lives here.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeForMatch } from "./text.mjs";
import { styleDef } from "./project.mjs";

export const DIMENSIONS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
export const DEFAULT_HOLD = 0.5;
export const SILENT_SCENE_DEFAULT = 4;

// Find a phrase across a scene's caption lines and return its spoken time (scene-relative).
// Time inside a line is interpolated by character position, which is accurate to ~0.2s for TTS speech.
export function phraseTime(lines, phrase) {
  const needle = normalizeForMatch(phrase);
  if (!needle) return null;
  const map = [];
  let hay = "";
  lines.forEach((l, li) => {
    const n = normalizeForMatch(l.text);
    for (let i = 0; i < n.length; i++) map.push([li, i, n.length]);
    hay += n;
  });
  const idx = hay.indexOf(needle);
  if (idx < 0) return null;
  const [li, pos, len] = map[idx];
  const l = lines[li];
  return l.start + (l.end - l.start) * (pos / Math.max(1, len));
}

export function resolveAt(at, lines, duration) {
  if (typeof at === "number") return { t: at < 0 ? duration + at : at };
  const spec = typeof at === "string" ? { phrase: at, offset: 0 } : at ?? {};
  if (typeof spec.phrase !== "string") return { error: `invalid cue ${JSON.stringify(at)}` };
  const t = phraseTime(lines, spec.phrase);
  if (t === null) return { error: `phrase "${spec.phrase}" not found in narration` };
  return { t: t + (spec.offset ?? 0) };
}

const clampT = (t, d) => Math.max(0, Math.min(d, t));
const r3 = (x) => Math.round(x * 1000) / 1000;

export function compileTimeline({ config, script, storyboard, timings, assets, research, root }) {
  const errors = [];
  const warnings = [];
  const fps = config.fps ?? 30;
  const [width, height] = config.width && config.height ? [config.width, config.height] : DIMENSIONS[config.aspect ?? "16:9"] ?? DIMENSIONS["16:9"];
  const theme = mergeTheme(styleDef(config.style ?? "midnight-data"), config.theme);
  const scriptById = new Map(script.scenes.map((s) => [s.id, s]));
  const assetById = new Map((assets?.items ?? []).map((a) => [a.id, a]));
  const usedAssets = {};
  const scenes = [];
  const captions = [];
  const narration = [];
  const sfx = [];
  const chapters = [];
  let frame = 0;

  const sfxCfg = { transition: null, volume: 0.5, ...(config.sfx ?? {}) };

  for (const sb of storyboard.scenes) {
    const sc = scriptById.get(sb.id);
    if (!sc) { errors.push(`storyboard scene "${sb.id}" has no script entry`); continue; }
    const tm = timings?.scenes?.[sb.id];
    if (!tm && (sc.narration || sc.lines)) { errors.push(`scene "${sb.id}" has narration but no audio; run: onevideo tts`); continue; }
    const lines = tm?.lines ?? [];
    const speech = tm?.duration ?? 0;
    let duration = speech ? speech + (sb.hold ?? DEFAULT_HOLD) : sb.duration ?? SILENT_SCENE_DEFAULT;
    if (sb.duration && speech && sb.duration < speech) warnings.push(`scene "${sb.id}": duration ${sb.duration}s is shorter than its narration (${speech.toFixed(2)}s); using narration length`);
    if (sb.duration) duration = Math.max(duration, sb.duration);
    if (sb.minDuration) duration = Math.max(duration, sb.minDuration);
    const durationInFrames = Math.ceil(duration * fps);
    duration = durationInFrames / fps;
    const from = frame;
    const start = from / fps;

    const cues = {};
    for (const [name, at] of Object.entries(sb.cues ?? {})) {
      const res = resolveAt(at, lines, duration);
      if (res.error) { errors.push(`scene "${sb.id}" cue "${name}": ${res.error}`); continue; }
      cues[name] = r3(clampT(res.t, duration));
    }
    for (const fx of sb.sfx ?? []) {
      const res = resolveAt(fx.at ?? 0, lines, duration);
      if (res.error) { errors.push(`scene "${sb.id}" sfx "${fx.sound}": ${res.error}`); continue; }
      sfx.push({ sound: fx.sound, src: `sfx/${fx.sound}.wav`, at: r3(start + clampT(res.t, duration)), volume: fx.volume ?? sfxCfg.volume });
    }
    if (sfxCfg.transition && scenes.length > 0 && sb.enter !== "cut") {
      sfx.push({ sound: sfxCfg.transition, src: `sfx/${sfxCfg.transition}.wav`, at: r3(Math.max(0, start - 0.12)), volume: sfxCfg.volume * 0.7 });
    }

    const props = { ...(sb.props ?? {}) };
    if (sb.type === "sources" && !props.items?.length && props.auto !== false) props.items = sourceList(research, assets);
    for (const id of collectAssetRefs(props)) {
      const a = assetById.get(id);
      if (!a) { errors.push(`scene "${sb.id}" references unknown asset "${id}"`); continue; }
      if (!a.file) { errors.push(`asset "${id}" not fetched yet; run: onevideo assets fetch`); continue; }
      if (root && !existsSync(join(root, "public", a.file))) errors.push(`asset "${id}" file missing: public/${a.file}; run: onevideo assets fetch`);
      usedAssets[id] = { src: a.file, kind: a.kind, credit: credit(a) };
    }

    for (const l of lines) {
      captions.push({ scene: sb.id, text: l.text, start: r3(start + l.start), end: r3(start + l.end) });
      narration.push([r3(start + l.start), r3(start + l.end)]);
    }
    const chapter = sb.chapter ?? sc.chapter;
    if (chapter) chapters.push({ title: chapter, start: r3(start) });

    scenes.push({
      id: sb.id,
      type: sb.type,
      from,
      durationInFrames,
      start: r3(start),
      duration: r3(duration),
      audio: tm?.file ?? null,
      enter: sb.enter ?? theme.transition ?? "fade",
      exit: sb.exit ?? theme.transition ?? "fade",
      header: sb.header ?? null,
      background: sb.background ?? null,
      captions: sb.captions !== false,
      cues,
      lines: lines.map((l) => ({ text: l.text, start: l.start, end: l.end })),
      props,
    });
    frame += durationInFrames;
  }

  const totalFrames = frame;
  // music.file is a path under public/ (own or licensed track); otherwise the synthesized bgm.wav.
  const musicSrc = config.music?.file ?? "music/bgm.wav";
  const music = config.music?.enabled === false ? null : root && existsSync(join(root, "public", musicSrc))
    ? { src: musicSrc, volume: config.music?.volume ?? 0.22, duckTo: config.music?.duckTo ?? 0.07, fade: 1.2, credit: config.music?.file ? config.music?.credit ?? null : "OneVideo 程序化合成" }
    : null;
  if (config.music?.enabled !== false && !music) warnings.push(`no background music (public/${musicSrc})${config.music?.file ? "" : "; run: onevideo music"}`);
  if (config.music?.file && !config.music?.credit) warnings.push("music.file has no music.credit; add the track title/author/license for the publish credits");
  const usedSfx = [...new Set(sfx.map((s) => s.sound))];
  if (root) for (const name of usedSfx) if (!existsSync(join(root, "public", "sfx", `${name}.wav`))) errors.push(`sfx "${name}" missing: public/sfx/${name}.wav; run: onevideo music`);

  const timeline = {
    version: 1,
    title: script.title ?? config.title ?? "",
    fps,
    width,
    height,
    aspect: config.aspect ?? "16:9",
    totalFrames,
    duration: r3(totalFrames / fps),
    theme,
    watermark: config.watermark ?? null,
    captions: { enabled: config.captions?.enabled !== false, style: config.captions?.style ?? "line", items: captions },
    narration,
    music,
    sfx,
    chapters,
    assets: usedAssets,
    scenes,
  };
  return { timeline, errors, warnings };
}

// Style JSON nests colors/fonts/motion; a project's theme override merges one level deep.
export function mergeTheme(base, over = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(base[k] ?? {}), ...v } : v;
  return out;
}

// One line per distinct source: "publisher · title · date". Facts first, then extra research.sources.
export function researchSources(research) {
  const seen = new Map();
  for (const s of [...(research?.facts ?? []).map((f) => f.source), ...(research?.sources ?? [])]) {
    if (!s?.title) continue;
    const line = [s.publisher, s.title, s.date].filter(Boolean).join(" · ");
    if (!seen.has(line)) seen.set(line, { line, url: s.url ?? null });
    else if (!seen.get(line).url && s.url) seen.get(line).url = s.url;
  }
  return [...seen.values()];
}

// On-screen credits for the sources scene: research sources, then every asset's attribution.
export function sourceList(research, assets) {
  const out = researchSources(research).map((s) => s.line);
  for (const a of assets?.items ?? []) {
    const line = `图片：${credit(a)}`;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

function collectAssetRefs(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => collectAssetRefs(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if ((k === "asset" || k === "avatar" || k === "logo") && typeof x === "string") out.add(x);
      else collectAssetRefs(x, out);
    }
  }
  return out;
}

export function credit(a) {
  if (a.license === "generated") return `AI 生成 · ${a.author ?? "image model"}`;
  return [a.title, a.author, a.license].filter(Boolean).join(" · ");
}
