// Timeline compiler: script + storyboard + measured timings → plan/timeline.json.
// The Remotion template reads only this file, so every timing decision lives here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeForMatch, spokenLength } from "./text.mjs";
import { styleDef } from "./project.mjs";
import { collectIcons, resolveIcon } from "./icons.mjs";
import { resolveCountry } from "./geo.mjs";
import { entryPath, isMonoDark, loadCatalog, resolveEntry, tintLottie } from "./library.mjs";
import { parseWav } from "./wav.mjs";
import { countFrames, depthPath, framesDir } from "./assets.mjs";
import { beatsFile, snapToBeat } from "./beats.mjs";

export const DIMENSIONS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
export const DEFAULT_HOLD = 0.5;
export const SILENT_SCENE_DEFAULT = 4;
// Phrase cues fire this much before the word is spoken: the eye should land on a number as the
// voice says it, and a reveal takes a few frames to read.
export const CUE_LEAD = 0.2;

// Find a phrase across a scene's caption lines and return its spoken time (scene-relative).
// Time inside a line is interpolated by spoken syllables (a digit takes longer to say than it
// takes to write), which is accurate to ~0.2s for TTS speech.
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
  const [li, pos] = map[idx];
  const l = lines[li];
  const n = normalizeForMatch(l.text);
  const share = spokenLength(n.slice(0, pos)) / Math.max(1e-6, spokenLength(n));
  return l.start + (l.end - l.start) * (Number.isFinite(share) ? Math.min(1, share) : 0);
}

export function resolveAt(at, lines, duration) {
  if (typeof at === "number") return { t: at < 0 ? duration + at : at };
  const spec = typeof at === "string" ? { phrase: at, offset: 0 } : at ?? {};
  if (typeof spec.phrase !== "string") return { error: `invalid cue ${JSON.stringify(at)}` };
  const t = phraseTime(lines, spec.phrase);
  if (t === null) return { error: `phrase "${spec.phrase}" not found in narration` };
  return { t: t - CUE_LEAD + (spec.offset ?? 0) };
}

// Seconds each transition overlaps the two scenes it joins (half before the cut, half after).
export const TRANSITION_DURATION = { fade: 0.5, slide: 0.45, push: 0.5, whip: 0.32, zoom: 0.45, punch: 0.36, iris: 0.6, wipe: 0.5, clock: 0.6, dip: 0.7, cut: 0 };
export const CAMERA_DEFAULT = { move: "drift", amount: 1 };

export const normTransition = (t) => (t == null ? null : typeof t === "string" ? { type: t } : t);

// The boundary between two scenes is one transition: the incoming scene's enter wins, then the
// outgoing scene's exit, then the style's default. Narration never moves; only visuals overlap.
export function boundaryTransition(prev, next, theme, fps) {
  const spec = normTransition(next.enter) ?? normTransition(prev.exit) ?? normTransition(theme.transition) ?? { type: "fade" };
  const want = Math.round((spec.duration ?? TRANSITION_DURATION[spec.type] ?? 0.5) * fps);
  // Never let a transition eat more than 40% of either scene.
  const frames = spec.type === "cut" ? 0 : Math.max(2, Math.min(want, Math.floor(prev.durationInFrames * 0.4), Math.floor(next.durationInFrames * 0.4)));
  const lead = Math.floor(frames / 2);
  return { type: spec.type, frames, lead, direction: spec.direction ?? "left", sfx: spec.sfx };
}

const clampT = (t, d) => Math.max(0, Math.min(d, t));
const r3 = (x) => Math.round(x * 1000) / 1000;
const normCamera = (c) => (c == null ? null : typeof c === "string" ? { move: c } : c);

// config.sfx.transition: one sound for every boundary, or a map by transition type ("*" = rest).
// sfx.transition: "auto" maps each transition type to a library category that fits its motion.
export const AUTO_TRANSITION_SFX = { "*": "whoosh-soft", fade: null, dip: null, slide: "whoosh-soft", push: "whoosh-fast", wipe: "swish", whip: "whip", zoom: "whoosh-cinematic", punch: "impact", iris: "swish", clock: "swish" };

// Sound name → public/ path: "synth:tick" (force the procedural sound) becomes sfx/synth-tick.wav.
export const sfxFile = (name) => `sfx/${name.replace(/[^a-z0-9-]/gi, "-")}.wav`;

export function transitionSfx(cfg, type) {
  if (!cfg || type === "cut") return null;
  if (cfg === "auto") cfg = AUTO_TRANSITION_SFX;
  if (typeof cfg === "string") return cfg;
  return cfg[type] !== undefined ? cfg[type] : cfg["*"] ?? null;
}

// Overlay sounds: an overlay's `sfx` names one, "auto" picks by type, null mutes; with
// config.sfx.overlays = "auto" every overlay without its own `sfx` gets the auto sound.
export const OVERLAY_SFX = { word: "ui-pop", icon: "ui-pop", burst: "ui-pop", confetti: "success-sting", arrow: "swish", mark: "marker", callout: "click", stamp: "impact", "lower-third": "whoosh-soft", spotlight: "swell", flash: "boom", image: "ui-pop", lottie: "ui-pop" };
export function overlaySound(ov, cfg) {
  const s = ov.sfx === undefined ? (cfg?.overlays === "auto" ? "auto" : null) : ov.sfx;
  if (!s) return null;
  const name = typeof s === "object" ? s.sound : s;
  return { sound: name === "auto" ? OVERLAY_SFX[ov.type] ?? null : name, volume: typeof s === "object" ? s.volume : undefined };
}

// Scene types that paint the whole frame themselves (no theme background shows through).
const OPAQUE_TYPES = new Set(["media", "focus", "split", "footage", "parallax"]);

// Auto shot track: one framing per caption line, alternating moves and hard cuts, never far
// enough in to lose a header or a card at the edge.
export const AUTO_SHOTS = [
  { zoom: 1, x: 0.5, y: 0.5 },
  { zoom: 1.12, x: 0.44, y: 0.47 },
  { zoom: 1.07, x: 0.56, y: 0.53, rotate: 0.4 },
  { zoom: 1.16, x: 0.5, y: 0.45 },
];

// When something happens inside a scene: a named cue, a phrase / seconds (`at`), or the nth
// music beat counted from the scene start ({ beat: n }). Returns scene-relative seconds.
export function resolveWhen(spec, { cues, lines, duration, start = 0, beats = [] }) {
  if (spec?.cue !== undefined) return cues[spec.cue] !== undefined ? { t: cues[spec.cue] + (spec.offset ?? 0) } : { error: `unknown cue "${spec.cue}"` };
  const at = spec?.at ?? 0;
  if (at && typeof at === "object" && at.beat !== undefined) {
    const local = beats.filter((b) => b >= start - 1e-3).map((b) => b - start);
    return local[at.beat] !== undefined ? { t: local[at.beat] + (at.offset ?? 0) } : { error: `beat ${at.beat} is past the music` };
  }
  return resolveAt(at, lines, duration);
}

// Storyboard shots → compiled Shot[]: `focus: [x, y, w, h]` frames a region (zoom to fit it with
// a margin), otherwise x/y/zoom directly. Times snap to a beat within 0.12 s when beats exist.
export function compileShots(spec, ctx) {
  const { lines, duration, start, beats, snap } = ctx;
  const out = [];
  const errors = [];
  const list = spec === "auto" || spec?.auto
    ? lines.map((l, i) => ({ ...AUTO_SHOTS[i % AUTO_SHOTS.length], at: i ? Math.max(0, l.start - CUE_LEAD) : 0, cut: i % 2 === 0 && i > 0, ...(typeof spec === "object" ? spec.each ?? {} : {}) }))
    : Array.isArray(spec) ? spec : [];
  for (const [k, sh] of list.entries()) {
    const res = resolveWhen(sh, ctx);
    if (res.error) { errors.push(`shot ${k}: ${res.error}`); continue; }
    let t = clampT(res.t, duration);
    if (snap && beats.length && sh.snap !== false) t = snapToBeat(start + t, beats, 0.12) - start;
    let { zoom = 1, x = 0.5, y = 0.5 } = sh;
    if (Array.isArray(sh.focus)) {
      const [fx, fy, fw, fh] = sh.focus;
      zoom = sh.zoom ?? Math.min(3, Math.max(1, 0.8 / Math.max(fw, fh)));
      x = fx + fw / 2; y = fy + fh / 2;
    }
    out.push({ t: r3(clampT(t, duration)), zoom: r3(zoom), x: r3(x), y: r3(y), rotate: r3(sh.rotate ?? 0), cut: Boolean(sh.cut), ease: r3(sh.ease ?? 0.6) });
  }
  out.sort((a, b) => a.t - b.t);
  return { shots: out, errors };
}

// An inherited canvas item arrives in its final form: already shown, morphs applied.
const settled = (it) => {
  const { morph = [], at: _a, cue: _c, ...rest } = it;
  const last = morph.length ? morph[morph.length - 1] : {};
  const { at: _ma, cue: _mc, t: _mt, ...state } = last;
  return { ...rest, ...state, t: 0, settled: true };
};

// Resolve every `at`/`cue` in a canvas / footage scene's props to `t` (scene seconds).
function resolvePropTimes(type, props, ctx, errors, where) {
  const fix = (o, label) => {
    if (!o || (o.at === undefined && o.cue === undefined)) return;
    const res = resolveWhen(o, ctx);
    if (res.error) errors.push(`${where} ${label}: ${res.error}`); else o.t = r3(clampT(res.t, ctx.duration));
  };
  if (type === "canvas") {
    for (const [i, it] of (props.items ?? []).entries()) { fix(it, `item ${it.id ?? i}`); for (const [j, m] of (it.morph ?? []).entries()) fix(m, `item ${it.id ?? i} morph ${j}`); }
    for (const [i, v] of (props.path ?? []).entries()) fix(v, `path ${i}`);
    for (const [i, l] of (props.links ?? []).entries()) fix(l, `link ${i}`);
  }
  if (type === "footage") {
    for (const [i, r] of (props.ramp ?? []).entries()) fix(r, `ramp ${i}`);
    fix(props.title, "title");
  }
  if (type === "parallax") fix(props.title, "title");
}

export function compileTimeline({ config, script, storyboard, timings, assets, research, root }) {
  const errors = [];
  const warnings = [];
  const fps = config.fps ?? 30;
  const [width, height] = config.width && config.height ? [config.width, config.height] : DIMENSIONS[config.aspect ?? "16:9"] ?? DIMENSIONS["16:9"];
  const theme = mergeTheme(styleDef(config.style ?? "midnight-data"), config.theme);
  const scriptById = new Map(script.scenes.map((s) => [s.id, s]));
  const assetById = new Map((assets?.items ?? []).map((a) => [a.id, a]));
  const usedAssets = {};
  const icons = {};
  const lottie = {};
  const libraryCredits = [];
  let catalog = null;
  const scenes = [];
  const captions = [];
  const narration = [];
  const sfx = [];
  const chapters = [];
  let frame = 0;

  const sfxCfg = { transition: null, volume: 0.5, ...(config.sfx ?? {}) };
  // Beat grid of the music, cached by `onevideo music` / render (see beats.mjs).
  const musicSrc = config.music?.file ?? "music/bgm.wav";
  const beatsAt = root ? beatsFile(join(root, "public", musicSrc)) : null;
  const beats = config.music?.enabled !== false && beatsAt && existsSync(beatsAt) ? JSON.parse(readFileSync(beatsAt, "utf8")).beats ?? [] : [];
  const snap = config.beats?.snap !== false;
  let lastCanvas = null;

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
      sfx.push({ sound: fx.sound, src: sfxFile(fx.sound), at: r3(start + clampT(res.t, duration)), volume: fx.volume ?? sfxCfg.volume });
    }

    const overlays = [];
    for (const [k, ov] of (sb.overlays ?? []).entries()) {
      const where = `scene "${sb.id}" overlay ${k} (${ov.type})`;
      const res = resolveAt(ov.at ?? 0, lines, duration);
      if (res.error) { errors.push(`${where}: ${res.error}`); continue; }
      const t = clampT(res.t, duration);
      const { at, duration: d, sfx: _sfx, ...rest } = ov;
      const o = { ...structuredClone(rest), t: r3(t), end: r3(d ? Math.min(duration + 0.5, t + d) : duration + 0.5) };
      if (ov.type === "lottie") {
        const src = ov.src;
        if (!lottie[src]) {
          catalog ??= loadCatalog();
          const hit = typeof src === "string" ? resolveEntry(src, catalog, "lottie") : null;
          const file = hit ? entryPath(hit.entry) : root && typeof src === "string" && src.endsWith(".json") ? join(root, "public", src) : null;
          if (!file || !existsSync(file)) { errors.push(`${where}: unknown lottie "${src}" (library id/category, see onevideo lib list --kind lottie, or a .json under public/)`); continue; }
          lottie[src] = JSON.parse(readFileSync(file, "utf8"));
          const line = hit && libraryCredit(hit.entry);
          if (line && !libraryCredits.includes(line)) libraryCredits.push(line);
        }
        // Explicit tint, or black line icons tinted to the theme's text colour so they read on dark backgrounds.
        const tint = ov.tint ?? (isMonoDark(lottie[src]) ? theme.colors?.text : null);
        if (tint) {
          const key = `${src}#${tint}`;
          try { lottie[key] ??= tintLottie(lottie[src], tint); } catch (e) { errors.push(`${where}: ${e.message}`); continue; }
          o.src = key;
          delete o.tint;
        }
      }
      const snd = overlaySound(ov, sfxCfg);
      if (snd?.sound) sfx.push({ sound: snd.sound, src: sfxFile(snd.sound), at: r3(start + t), volume: snd.volume ?? sfxCfg.volume });
      overlays.push(o);
    }

    const props = structuredClone(sb.props ?? {});
    const ctx = { cues, lines, duration, start, beats, snap };
    // A canvas scene with `inherit` continues the previous canvas: same world, camera picks up
    // where it left off (cut into it for a seamless join).
    if (sb.type === "canvas" && props.inherit) {
      if (!lastCanvas) errors.push(`scene "${sb.id}": canvas inherit needs an earlier canvas scene`);
      else {
        const own = new Map((props.items ?? []).map((it) => [it.id, it]));
        props.items = [...lastCanvas.items.filter((it) => !own.has(it.id)).map(settled), ...(props.items ?? [])];
        const end = lastCanvas.path?.[lastCanvas.path.length - 1];
        if (end) props.path = [{ ...end, at: 0, cue: undefined, cut: true }, ...(props.path ?? [])];
      }
    }
    resolvePropTimes(sb.type, props, ctx, errors, `scene "${sb.id}"`);
    if (sb.type === "canvas") lastCanvas = { items: props.items ?? [], path: props.path ?? [] };
    let shots;
    if (sb.shots) {
      const res = compileShots(sb.shots, ctx);
      res.errors.forEach((e) => errors.push(`scene "${sb.id}" ${e}`));
      if (res.shots.length) shots = res.shots;
    }
    if (sb.type === "sources" && !props.items?.length && props.auto !== false) props.items = sourceList(research, assets, libraryCredits);
    if (sb.type === "map") for (const h of props.highlight ?? []) {
      const id = resolveCountry(h.id);
      if (id) h.id = id; else errors.push(`scene "${sb.id}" map highlight: unknown country "${h.id}" (use a Natural Earth numeric id, ISO alpha-2 or English name)`);
    }
    for (const name of collectIcons([props, overlays])) {
      if (icons[name]) continue;
      const icon = resolveIcon(name);
      if (icon) icons[name] = icon; else errors.push(`scene "${sb.id}" uses unknown icon "${name}" (Lucide name or flag:<iso2>)`);
    }
    if (sb.type === "unit-grid" && !icons[props.icon ?? "user-round"]) { const icon = resolveIcon(props.icon ?? "user-round"); if (icon) icons[props.icon ?? "user-round"] = icon; }
    const refs = collectAssetRefs([props, overlays]);
    if (sb.backdrop) refs.add(sb.backdrop.asset);
    for (const id of refs) {
      const a = assetById.get(id);
      if (!a) { errors.push(`scene "${sb.id}" references unknown asset "${id}"`); continue; }
      if (!a.file) { errors.push(`asset "${id}" not fetched yet; run: onevideo assets fetch`); continue; }
      if (root && !existsSync(join(root, "public", a.file))) errors.push(`asset "${id}" file missing: public/${a.file}; run: onevideo assets fetch`);
      usedAssets[id] = { src: a.file, kind: a.kind, credit: credit(a) };
      if (root && existsSync(join(root, "public", depthPath(a)))) {
        usedAssets[id].depth = depthPath(a);
        const meta = join(root, "public", depthPath(a), "meta.json");
        if (a.kind === "video" && existsSync(meta)) { const m = JSON.parse(readFileSync(meta, "utf8")); Object.assign(usedAssets[id], { depthStep: m.step, depthFrames: m.frames }); }
      }
      if (a.kind === "video" && root) {
        const frames = countFrames(join(root, "public", framesDir(a.file)));
        if (frames) Object.assign(usedAssets[id], { seq: framesDir(a.file), frames, fps: 30 });
        else warnings.push(`asset "${id}": no frame sequence, falls back to <OffthreadVideo> (needs memory); run: onevideo render (extracts it)`);
      }
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
      enter: sb.enter ?? null,
      exit: sb.exit ?? null,
      transitionIn: null,
      transitionOut: null,
      camera: { ...CAMERA_DEFAULT, ...(normCamera(theme.camera) ?? {}), ...(normCamera(sb.camera) ?? {}) },
      opaque: Boolean(sb.backdrop) || OPAQUE_TYPES.has(sb.type),
      header: sb.header ?? null,
      background: sb.background ?? null,
      backdrop: sb.backdrop ? { dim: 0.62, blur: 0, motion: "in", startFrom: 0, ...sb.backdrop } : null,
      captions: sb.captions !== false,
      cues,
      lines: lines.map((l) => ({ text: l.text, start: l.start, end: l.end })),
      props,
      ...(overlays.length ? { overlays } : {}),
      ...(shots ? { shots } : {}),
    });
    frame += durationInFrames;
  }

  const totalFrames = frame;
  // Opening fades up from the background, closing fades out; inner boundaries overlap.
  const edge = (type, d) => ({ type: type === "cut" ? "cut" : "fade", frames: type === "cut" ? 0 : Math.round(d * fps), lead: 0, direction: "left" });
  scenes.forEach((sc, i) => {
    const prev = scenes[i - 1];
    if (!prev) { sc.transitionIn = edge(normTransition(sc.enter)?.type ?? "fade", 0.45); return; }
    const b = boundaryTransition(prev, sc, theme, fps);
    sc.transitionIn = { type: b.type, frames: b.frames, lead: b.lead, direction: b.direction };
    prev.transitionOut = { type: b.type, frames: b.frames, tail: b.frames - b.lead, direction: b.direction, nextOpaque: sc.opaque };
    const sound = b.sfx !== undefined ? b.sfx : transitionSfx(sfxCfg.transition, b.type);
    if (sound) sfx.push({ sound, src: sfxFile(sound), at: r3(Math.max(0, (sc.from - b.lead) / fps - 0.06)), volume: sfxCfg.volume * 0.7 });
  });
  const last = scenes[scenes.length - 1];
  if (last) last.transitionOut = { type: normTransition(last.exit)?.type === "cut" ? "cut" : "fade", frames: normTransition(last.exit)?.type === "cut" ? 0 : Math.round(0.6 * fps), tail: 0, direction: "left", nextOpaque: false };
  sfx.sort((a, b) => a.at - b.at);
  // music.file is a path under public/ (own or licensed track); otherwise the synthesized bgm.wav.
  const music = config.music?.enabled === false ? null : root && existsSync(join(root, "public", musicSrc))
    ? { src: musicSrc, volume: config.music?.volume ?? 0.22, duckTo: config.music?.duckTo ?? 0.07, fade: 1.2, credit: config.music?.file ? config.music?.credit ?? null : "OneVideo 程序化合成" }
    : null;
  if (config.music?.enabled !== false && !music) warnings.push(`no background music (public/${musicSrc})${config.music?.file ? "" : "; run: onevideo music"}`);
  if (config.music?.file && !config.music?.credit) warnings.push("music.file has no music.credit; add the track title/author/license for the publish credits");
  const usedSfx = [...new Set(sfx.map((s) => s.sound))];
  if (root) for (const name of usedSfx) if (!existsSync(join(root, "public", sfxFile(name)))) errors.push(`sfx "${name}" missing: public/${sfxFile(name)}; run: onevideo music`);
  // Library sounds run up to 8 s; the player keeps each one mounted for its real length.
  const sfxLen = {};
  if (root) for (const s of sfx) {
    const f = join(root, "public", s.src);
    if (sfxLen[s.src] === undefined && existsSync(f)) { try { sfxLen[s.src] = r3(parseWav(readFileSync(f)).duration); } catch { sfxLen[s.src] = null; } }
    if (sfxLen[s.src]) s.duration = sfxLen[s.src];
  }

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
    icons,
    // Only the variants overlays reference (a tinted copy replaces its untinted source).
    lottie: Object.fromEntries(Object.entries(lottie).filter(([k]) => scenes.some((sc) => sc.overlays?.some((o) => o.src === k)))),
    libraryCredits,
    look: config.look ?? theme.look ?? null,
    beats: music ? beats.filter((b) => b <= totalFrames / fps) : [],
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
export function sourceList(research, assets, extra = []) {
  const out = researchSources(research).map((s) => s.line);
  for (const a of assets?.items ?? []) {
    const line = `${a.kind === "video" ? "视频" : "图片"}：${credit(a)}`;
    if (!out.includes(line)) out.push(line);
  }
  for (const line of extra) if (!out.includes(line)) out.push(line);
  return out;
}

// Library entries under an attribution licence (CC BY) owe a credit line in every video using them.
export function libraryCredit(entry) {
  const p = entry?.provenance ?? {};
  if (!/cc[- ]?by/i.test(p.license ?? "")) return null;
  return `动画：${[p.author ?? p.source, "CC BY 4.0"].filter(Boolean).join(" · ")}`;
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
