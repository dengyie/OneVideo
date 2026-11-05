// tts / music / timeline / assets / decide
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { UserError, loadProject, readJson, writeJson, log, warn } from "../lib/project.mjs";
import { runTts, ttsConfig, sceneLines } from "../lib/tts.mjs";
import { writeMusic, synthSfx, SFX, MUSIC_PRESETS } from "../lib/synth.mjs";
import { writeWav } from "../lib/wav.mjs";
import { checkProject, printIssues } from "../lib/check.mjs";
import { search, fetchAsset, scoreCandidate, assetFileExists } from "../lib/assets.mjs";
import { DIMENSIONS } from "../lib/timeline.mjs";

const list = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export async function tts(args) {
  const project = loadProject();
  const script = readJson(project.paths.script);
  if (args.sample) {
    // Synthesize only the first line so voice and pacing can be approved before the batch.
    const first = script.scenes.find((s) => sceneLines(s, project.config).length);
    if (!first) throw new UserError("script has no narration");
    const line = sceneLines(first, project.config)[0];
    const sampleScript = { ...script, scenes: [{ id: "_sample", lines: [line] }] };
    const res = await runTts(project, sampleScript, { force: Boolean(args.force) });
    const s = res.scenes._sample;
    const rate = line.text.length / Math.max(0.1, s.lines[0].end - s.lines[0].start);
    log(`sample: public/${s.file} (${s.duration.toFixed(2)}s, ${rate.toFixed(1)} chars/s) — "${line.text}"`);
    log(`voice ${ttsConfig(project.config).voice}; listen, then run: onevideo tts`);
    return;
  }
  const res = await runTts(project, script, { force: Boolean(args.force), only: list(args.only), dry: Boolean(args.dry) });
  if (!res) return;
  writeJson(project.paths.timings, res);
  const n = Object.values(res.scenes).reduce((k, s) => k + s.lines.length, 0);
  log(`timings: ${Object.keys(res.scenes).length} scenes, ${n} lines, narration ${res.totalNarration.toFixed(1)}s → plan/timings.json`);
}

export async function music(args) {
  const project = loadProject();
  const { config, paths } = project;
  const pre = checkProject(project);
  const sfxNames = new Set(list(args.sfx));
  if (config.sfx?.transition) sfxNames.add(config.sfx.transition);
  for (const sb of pre.plan.storyboard?.scenes ?? []) for (const fx of sb.sfx ?? []) sfxNames.add(fx.sound);
  for (const name of sfxNames) {
    if (!SFX[name]) throw new UserError(`unknown sfx "${name}" (${Object.keys(SFX).join(", ")})`);
    const file = join(paths.sfxDir, `${name}.wav`);
    if (!existsSync(file) || args.force) writeWav(file, synthSfx(name));
  }
  if (sfxNames.size) log(`sfx: ${[...sfxNames].join(", ")} → public/sfx/`);

  if (config.music?.enabled === false) return log("music disabled in onevideo.json");
  if (config.music?.file) return log(`using provided music file ${config.music.file}`);
  const preset = args.preset ?? config.music?.preset ?? "ambient";
  if (!MUSIC_PRESETS[preset]) throw new UserError(`unknown preset "${preset}" (${Object.keys(MUSIC_PRESETS).join(", ")})`);
  const duration = args.duration ? Number(args.duration) : pre.timeline ? pre.timeline.duration + 2 : null;
  if (!duration) throw new UserError("need timings to size the music; run: onevideo tts (or pass --duration <sec>)");
  mkdirSync(paths.musicDir, { recursive: true });
  writeMusic(join(paths.musicDir, "bgm.wav"), duration, { preset, seed: config.music?.seed ?? 7 });
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
