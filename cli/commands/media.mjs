// tts / music / timeline / assets / decide
import { appendFileSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { download } from "../lib/http.mjs";
import { UserError, loadProject, readJson, writeJson, log, warn, ONEVIDEO_ROOT } from "../lib/project.mjs";
import { runTts, ttsConfig, sceneLines } from "../lib/tts.mjs";
import { writeMusic, synthSfx, SFX, MUSIC_PRESETS } from "../lib/synth.mjs";
import { writeWav } from "../lib/wav.mjs";
import { checkProject, printIssues } from "../lib/check.mjs";
import { search, fetchAsset, scoreCandidate, assetFileExists, depthPath, framesDir, countFrames } from "../lib/assets.mjs";
import { run } from "../lib/ffmpeg.mjs";
import { AUTO_TRANSITION_SFX, DIMENSIONS, overlaySound, sfxFile } from "../lib/timeline.mjs";
import { categories, entryPath, loadCatalog, resolveSfx } from "../lib/library.mjs";
import { spokenLength } from "../lib/text.mjs";
import { beatsFile, ensureBeats, gridBeats } from "../lib/beats.mjs";

const list = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export async function tts(args) {
  const project = loadProject();
  const script = readJson(project.paths.script);
  if (args.sample) {
    // Synthesize only the first scene (first line in line unit) so voice and pacing can be approved before the batch.
    const first = script.scenes.find((s) => sceneLines(s, project.config).length);
    if (!first) throw new UserError("script has no narration");
    const sample = ttsConfig(project.config).unit === "line" ? { id: "_sample", lines: [sceneLines(first, project.config)[0]] } : { ...first, id: "_sample" };
    const res = await runTts(project, { ...script, scenes: [sample] }, { force: Boolean(args.force) });
    const s = res.scenes._sample;
    const text = s.lines.map((l) => l.text).join(" / ");
    const rate = s.lines.reduce((n, l) => n + spokenLength(l.text), 0) / Math.max(0.1, s.lines.reduce((n, l) => n + l.end - l.start, 0));
    log(`sample: public/${s.file} (${s.duration.toFixed(2)}s, ${rate.toFixed(1)} syllables/s) — "${text}"`);
    log(`voice ${ttsConfig(project.config).voice}; listen, then run: onevideo tts`);
    return;
  }
  const res = await runTts(project, script, { force: Boolean(args.force), only: list(args.only), dry: Boolean(args.dry) });
  if (!res) return;
  writeJson(project.paths.timings, res);
  const n = Object.values(res.scenes).reduce((k, s) => k + s.lines.length, 0);
  log(`timings: ${Object.keys(res.scenes).length} scenes, ${n} lines, narration ${res.totalNarration.toFixed(1)}s → plan/timings.json`);
}

const SYNTH_NEAREST = [[/whoosh|swish|whip|page/, "whoosh"], [/impact|boom|rocket|glitch|error/, "impact"], [/riser|swell/, "riser"], [/pop|click|shutter|marker|cash/, "pop"], [/ding|sting|success|crowd/, "chime"], [/tick|type|keyboard/, "tick"]];

export async function music(args) {
  const project = loadProject();
  const { config, paths } = project;
  const pre = checkProject(project);
  const sfxNames = new Set(list(args.sfx));
  const tr = config.sfx?.transition;
  const trNames = tr === "auto" ? Object.values(AUTO_TRANSITION_SFX) : typeof tr === "string" ? [tr] : Object.values(tr ?? {});
  for (const name of trNames) if (name) sfxNames.add(name);
  for (const sb of pre.plan.storyboard?.scenes ?? []) {
    for (const fx of sb.sfx ?? []) sfxNames.add(fx.sound);
    for (const t of [sb.enter, sb.exit]) if (t?.sfx) sfxNames.add(t.sfx);
    for (const ov of sb.overlays ?? []) { const s = overlaySound(ov, config.sfx); if (s?.sound) sfxNames.add(s.sound); }
  }
  // Library entries first (recorded, normalized), then procedural sounds; synth:<name> forces procedural.
  const catalog = loadCatalog();
  const used = [];
  for (const name of sfxNames) {
    const file = join(project.p("public"), sfxFile(name));
    const synthName = name.startsWith("synth:") ? name.slice(6) : null;
    const lib = synthName ? null : resolveSfx(name, catalog);
    if (lib) {
      if (lib.fallback) warn(`sfx "${name}": default ${catalog.defaults[name]} is not on this host; using ${lib.entry.id} (renders elsewhere may differ)`);
      if (!existsSync(file) || args.force) { mkdirSync(dirname(file), { recursive: true }); copyFileSync(entryPath(lib.entry), file); }
      used.push(`${name}→${lib.entry.id}`);
      continue;
    }
    // A library category whose files all live on another host falls back to the nearest synth.
    const near = !synthName && !SFX[name] && categories(catalog).includes(name) ? SYNTH_NEAREST.find(([re]) => re.test(name))?.[1] : null;
    if (near) warn(`sfx "${name}": no library file on this host; using procedural ${near} (render on the VM for the recorded sound)`);
    const proc = synthName ?? near ?? name;
    if (!SFX[proc]) throw new UserError(`unknown sfx "${name}": not in the library (${categories(catalog).join(", ") || "empty; run: onevideo lib import"}) nor procedural (${Object.keys(SFX).join(", ")})`);
    if (!existsSync(file) || args.force) writeWav(file, synthSfx(proc));
    used.push(`${name}→synth`);
  }
  if (used.length) log(`sfx: ${used.join(", ")} → public/sfx/`);

  if (config.music?.enabled === false) return log("music disabled in onevideo.json");
  if (config.music?.file) {
    const file = join(project.p("public"), config.music.file);
    if (!existsSync(file) || args.force) {
      if (!config.music.url) throw new UserError(`music.file public/${config.music.file} is missing; put the track there or set music.url`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, await download(config.music.url));
      log(`music: downloaded ${config.music.url} → public/${config.music.file}`);
    }
    if (args.force) rmSync(beatsFile(file), { force: true });
    const b = await ensureBeats(project.root, { src: config.music.file });
    log(`using provided music file ${config.music.file}${config.music.credit ? ` (${config.music.credit})` : ""}${b ? `, ~${b.bpm} BPM, ${b.beats.length} beats` : ""}`);
    return;
  }
  const preset = args.preset ?? config.music?.preset ?? "ambient";
  if (!MUSIC_PRESETS[preset]) throw new UserError(`unknown preset "${preset}" (${Object.keys(MUSIC_PRESETS).join(", ")})`);
  const duration = args.duration ? Number(args.duration) : pre.timeline ? pre.timeline.duration + 2 : null;
  if (!duration) throw new UserError("need timings to size the music; run: onevideo tts (or pass --duration <sec>)");
  mkdirSync(paths.musicDir, { recursive: true });
  const bgm = join(paths.musicDir, "bgm.wav");
  writeMusic(bgm, duration, { preset, seed: config.music?.seed ?? 7 });
  // The synth knows its own tempo: the beat grid is exact, no detection needed.
  writeFileSync(beatsFile(bgm), JSON.stringify({ bpm: MUSIC_PRESETS[preset].bpm, beats: gridBeats(MUSIC_PRESETS[preset].bpm, duration), source: `synth:${preset}` }));
  log(`music: ${preset}, ${duration.toFixed(1)}s → public/music/bgm.wav`);
}

export async function timeline(args) {
  const project = loadProject();
  const res = checkProject(project, { needTimings: true });
  printIssues(res.issues);
  if (res.errors.length && !args.force) throw new UserError(`${res.errors.length} error(s); fix them (or --force to write anyway)`);
  writeJson(project.paths.timeline, res.timeline);
  const t = res.timeline;
  log(`timeline: ${t.scenes.length} scenes, ${t.duration.toFixed(1)}s (${t.totalFrames} frames @ ${t.fps}fps) → plan/timeline.json`);
}

export async function assets(args) {
  const sub = args._[0];
  const project = loadProject();
  const { paths, config } = project;
  const [w, h] = DIMENSIONS[config.aspect ?? "16:9"];
  if (sub === "search") {
    const query = args._.slice(1).join(" ");
    if (!query) throw new UserError("usage: onevideo assets search <query> [--provider nasa,wikimedia,openverse,pexels] [--kind image|video]");
    const { results, errors } = await search(query, { providers: args.provider ? list(args.provider) : undefined, kind: args.kind ?? "image", limit: Number(args.limit ?? 8) });
    for (const e of errors) warn(e);
    const ranked = results.sort((a, b) => scoreCandidate(a, w / h) - scoreCandidate(b, w / h));
    if (args.json) return log(JSON.stringify(ranked, null, 2));
    ranked.forEach((c, i) => log(`${String(i).padStart(2)} ${c.provider.padEnd(9)} ${(c.license ?? "").padEnd(14)} ${c.width ?? "?"}x${c.height ?? "?"}  ${(c.title ?? "").slice(0, 60)}\n     ${c.source}${c.author ? ` · ${c.author.slice(0, 40)}` : ""}`));
    return;
  }
  if (sub === "fetch") {
    const manifest = readJson(paths.assets, { items: [] });
    const only = list(args.only);
    let changed = 0, failed = 0;
    for (let i = 0; i < manifest.items.length; i++) {
      const item = manifest.items[i];
      if (only.length && !only.includes(item.id)) continue;
      if (assetFileExists(project.p("public"), item) && !args.force) continue;
      try {
        const updated = await fetchAsset(item, { publicDir: project.p("public"), aspect: w / h, imageDefaults: config.image });
        manifest.items[i] = updated;
        changed++;
        log(`✓ ${item.id}: ${updated.file} · ${updated.license}${updated.author ? ` · ${updated.author.slice(0, 40)}` : ""}`);
        writeJson(paths.assets, manifest);
      } catch (e) {
        failed++;
        warn(`${item.id}: ${e.message}`);
      }
    }
    log(`${changed} fetched, ${failed} failed`);
    if (failed) process.exitCode = 1;
    return;
  }
  throw new UserError("usage: onevideo assets <search|fetch> …");
}

// Append-only decision log: the latest entry per (category, subject) wins.
export async function decide(args) {
  const [category, subject] = args._;
  if (!category || !subject || !args.selected) throw new UserError('usage: onevideo decide <category> <subject> --selected X [--options a,b] [--reason "…"]');
  const project = loadProject();
  const entry = { at: new Date().toISOString(), category, subject, selected: args.selected, options: list(args.options), reason: args.reason ?? "" };
  appendFileSync(project.p("plan", "decisions.jsonl"), JSON.stringify(entry) + "\n");
  log(`decision recorded: ${category}/${subject} = ${args.selected}`);
}

// Depth maps for parallax and text-behind-subject: Depth Anything V2 (ONNX, CPU) through the
// helper venv. Images → <file>.depth.png; videos → <file>.depth/NNNN.png every --step frames.
export async function depth(args) {
  const project = loadProject();
  const items = existsSync(project.paths.assets) ? readJson(project.paths.assets).items ?? [] : [];
  const ids = args._.length ? args._.flatMap((x) => String(x).split(",")) : null;
  const py = process.env.ONEVIDEO_PY ?? "/opt/onevideo-py/bin/python";
  const model = process.env.ONEVIDEO_DEPTH_MODEL ?? "/srv/onevideo/library/models/depth-anything-v2-small.onnx";
  if (!existsSync(py)) throw new UserError(`python not found at ${py} (set ONEVIDEO_PY; needs numpy, pillow, onnxruntime)`);
  if (!existsSync(model)) throw new UserError(`depth model not found at ${model} (set ONEVIDEO_DEPTH_MODEL)`);
  const todo = items.filter((a) => a.file && (a.kind === "image" || a.kind === "video") && (!ids || ids.includes(a.id)));
  for (const id of ids ?? []) if (!items.some((a) => a.id === id)) throw new UserError(`unknown asset "${id}"`);
  if (!todo.length) return log("no image/video assets to process");
  const script = join(ONEVIDEO_ROOT, "cli", "py", "depth.py");
  for (const a of todo) {
    const out = project.p("public", depthPath(a));
    if (existsSync(out) && !args.force) { log(`✓ ${a.id}: public/${depthPath(a)} (exists; --force to redo)`); continue; }
    let src = project.p("public", a.file);
    const extra = [];
    if (a.kind === "video") {
      src = project.p("public", framesDir(a.file));
      if (!countFrames(src)) throw new UserError(`asset "${a.id}" has no frame sequence yet; run: onevideo stills (or render) once to extract it`);
      extra.push("--step", String(args.step ?? 2));
    }
    log(`depth: ${a.id} → public/${depthPath(a)}`);
    const t0 = Date.now();
    await run(py, [script, model, src, out, ...extra], { cwd: project.root, stdio: "inherit" });
    log(`✓ ${a.id} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
