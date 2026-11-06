// render / stills / studio / qc / publish / build / doctor
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { UserError, loadProject, pipelineDef, readJson, writeJson, log, warn, ONEVIDEO_ROOT } from "../lib/project.mjs";
import { stageStatus } from "../lib/state.mjs";
import { checkProject, printIssues } from "../lib/check.mjs";
import { REMOTION_BIN, TEMPLATE_DIR, requireRemotion, run, ffmpeg } from "../lib/ffmpeg.mjs";
import { runQc } from "../lib/qc.mjs";
import { buildPublishKit } from "../lib/publish.mjs";
import { resolveApiKey, trustedKeyHost } from "../lib/http.mjs";
import { ttsConfig } from "../lib/tts.mjs";
import * as media from "./media.mjs";
import { assetFileExists, clipFrames, countFrames, framesDir } from "../lib/assets.mjs";
import { ensureBeats } from "../lib/beats.mjs";

const ENTRY = "src/index.ts";
const COMPOSITION = "OneVideo";

export const videoPath = (project) => join(project.paths.out, `${project.config.name}.mp4`);

// Projects fetched before frame sequences existed get them on first render.
async function ensureClipFrames(project) {
  if (!existsSync(project.paths.assets)) return;
  for (const a of readJson(project.paths.assets).items ?? []) {
    if (a.kind !== "video" || !a.file) continue;
    const mp4 = project.p("public", a.file), dir = project.p("public", framesDir(a.file));
    if (!existsSync(mp4) || countFrames(dir)) continue;
    log(`extracting frames: ${a.id} → public/${framesDir(a.file)}/`);
    await clipFrames(mp4, dir);
  }
}

// Beat grid for shot snapping; synthesized music writes its own, a provided track is analysed once.
async function ensureMusicBeats(project) {
  const m = project.config.music;
  if (m?.enabled === false) return;
  const b = await ensureBeats(project.root, { src: m?.file ?? "music/bgm.wav" });
  if (b) log(`beats: ~${b.bpm} BPM (${b.source})`);
}

// Compile + gate the timeline; renders never start from a stale or failing plan.
function freshTimeline(project, { force = false } = {}) {
  const res = checkProject(project, { needTimings: true });
  printIssues(res.issues);
  if (res.errors.length && !force) throw new UserError(`${res.errors.length} pre-compose error(s); fix them before rendering (or --force)`);
  writeJson(project.paths.timeline, res.timeline);
  return res.timeline;
}

function commonFlags(project) {
  return [`--props=${project.paths.timeline}`, `--public-dir=${project.p("public")}`];
}

export async function render(args) {
  requireRemotion();
  const project = loadProject();
  await ensureClipFrames(project);
  await ensureMusicBeats(project);
  const tl = freshTimeline(project, { force: Boolean(args.force) });
  mkdirSync(project.paths.out, { recursive: true });
  const draft = Boolean(args.draft);
  const out = args.out ?? (draft ? join(project.paths.out, `${project.config.name}.draft.mp4`) : videoPath(project));
  const flags = [
    "render", ENTRY, COMPOSITION, out, ...commonFlags(project),
    "--codec=h264", "--audio-codec=aac", "--audio-bitrate=192k",
    `--concurrency=${args.concurrency ?? project.config.render?.concurrency ?? 4}`,
    `--crf=${draft ? 30 : project.config.render?.crf ?? 18}`,
    "--image-format=jpeg", `--jpeg-quality=${draft ? 70 : 90}`,
  ];
  if (draft) flags.push("--scale=0.5");
  // OffthreadVideo's frame cache defaults to a share of free memory; on a small render node it
  // evicts frames as soon as they are extracted ("No frame found at position"). Pin it when the
  // timeline plays video (render.videoCacheMB, default 512).
  if (Object.values(tl.assets ?? {}).some((a) => a.kind === "video")) {
    flags.push(`--offthreadvideo-cache-size-in-bytes=${Math.round((project.config.render?.videoCacheMB ?? 512) * 1024 * 1024)}`);
  }
  if (args.frames) flags.push(`--frames=${args.frames}`);
  log(`rendering ${tl.duration.toFixed(1)}s ${tl.width}x${tl.height}${draft ? " (draft, half scale)" : ""} → ${out}`);
  const t0 = Date.now();
  await run(REMOTION_BIN, flags, { cwd: TEMPLATE_DIR, stdio: "inherit" });
  log(`rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${out}`);
  return out;
}

export async function stills(args) {
  requireRemotion();
  const project = loadProject();
  await ensureClipFrames(project);
  await ensureMusicBeats(project);
  const tl = freshTimeline(project, { force: Boolean(args.force) });
  const dir = join(project.paths.out, "stills");
  mkdirSync(dir, { recursive: true });
  const only = typeof args.scene === "string" ? args.scene.split(",") : null;
  // --at 0.7 or a list (--at 0.3,0.6,0.9): fractions of each scene; a list adds the fraction to the file name.
  const ats = args.at !== undefined ? String(args.at).split(",").map(Number) : [0.7];
  if (ats.some((a) => !Number.isFinite(a) || a < 0 || a > 1)) throw new UserError(`--at takes fractions 0–1, got "${args.at}"`);
  for (const [i, s] of tl.scenes.entries()) {
    if (only && !only.includes(s.id)) continue;
    for (const at of ats) {
      const frame = s.from + Math.min(s.durationInFrames - 1, Math.floor(s.durationInFrames * at));
      const file = join(dir, `${String(i + 1).padStart(2, "0")}-${s.id}${ats.length > 1 ? `@${at}` : ""}.jpg`);
      await run(REMOTION_BIN, ["still", ENTRY, COMPOSITION, file, ...commonFlags(project), `--frame=${frame}`, "--image-format=jpeg", "--scale=0.5"], { cwd: TEMPLATE_DIR });
      log(`✓ ${file}`);
    }
  }
}

export async function studio(args) {
  requireRemotion();
  const project = loadProject();
  await ensureClipFrames(project);
  await ensureMusicBeats(project);
  freshTimeline(project, { force: true });
  await run(REMOTION_BIN, ["studio", ENTRY, ...commonFlags(project), ...(args.port ? [`--port=${args.port}`] : [])], { cwd: TEMPLATE_DIR, stdio: "inherit" });
}

export async function qc(args) {
  const project = loadProject();
  const video = args.video ?? videoPath(project);
  if (!existsSync(video)) throw new UserError(`no video at ${video}; run: onevideo render`);
  const tl = readJson(project.paths.timeline);
  const review = await runQc({ video, timeline: tl, outDir: join(project.paths.out, "qc"), thresholds: project.config.qc });
  writeJson(project.paths.review, review);
  const icon = { pass: "✓", warn: "⚠", fail: "✗" };
  for (const c of review.checks) log(`${icon[c.status]} ${c.id.padEnd(22)} ${c.detail}`);
  log(`verdict: ${review.verdict.toUpperCase()} · ${review.frames.length} review frames in out/qc/frames/ → plan/review.json`);
  log("next: look at every frame in out/qc/frames/ before approving review");
  if (review.verdict === "fail") process.exitCode = 1;
  return review;
}

// Publishing needs the human review sign-off on the current QC report (onevideo approve review).
export async function publish(args = {}) {
  const project = loadProject();
  const tl = readJson(project.paths.timeline);
  const script = readJson(project.paths.script);
  const research = existsSync(project.paths.research) ? readJson(project.paths.research) : null;
  const review = existsSync(project.paths.review) ? readJson(project.paths.review) : null;
  if (!review) throw new UserError("no QC review yet; run: onevideo qc");
  if (review.verdict === "fail") throw new UserError("QC verdict is FAIL; fix and re-render before publishing");
  const reviewStage = stageStatus(project, pipelineDef(project.config.pipeline)).find((s) => s.id === "review");
  if (reviewStage && reviewStage.status !== "approved") {
    if (!args.force) throw new UserError(`review stage is ${reviewStage.status}; look at out/qc/frames/, then: onevideo approve review (or publish --force)`);
    warn(`publishing without review approval (review stage is ${reviewStage.status})`);
  }
  const kit = buildPublishKit({ timeline: tl, research, config: project.config, script });
  const dir = join(project.paths.out, "publish");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(kit.files)) writeFileSync(join(dir, name), content);
  writeJson(project.paths.publish, kit.publish);
  for (const w of kit.publish.warnings) warn(w);
  log(`publish kit → ${dir} (${Object.keys(kit.files).join(", ")})`);
}

// Missing licensed files are fetched, clips get their frame sequences, and depth / luma maps are
// made when the depth tools exist: subject-aware dives, word dodging and scrims all read them.
async function prepareMedia(project) {
  if (!existsSync(project.paths.assets)) return;
  const items = readJson(project.paths.assets).items ?? [];
  if (items.some((a) => !assetFileExists(project.p("public"), a))) await media.assets({ _: ["fetch"] });
  await ensureClipFrames(project);
  const { missing } = media.depthTools();
  if (missing) warn(`depth skipped: ${missing}; text dodging, scrims and subject dives fall back to defaults`);
  else await media.depth({ _: [] });
}

// Full non-creative pass: voice → music → timeline → render → qc. Publishing waits for the
// human review sign-off, so build stops at the QC report.
export async function build(args) {
  await media.tts({ _: [], force: args.forceTts });
  await media.music({ _: [] });
  await prepareMedia(loadProject());
  await media.timeline({ _: [] });
  await render({ _: [], draft: args.draft });
  if (args.draft) return;
  const review = await qc({ _: [] });
  if (review.verdict !== "fail") log("next: review out/qc/frames/, then: onevideo approve review && onevideo publish");
}

export async function doctor() {
  const checks = [];
  const add = (ok, name, detail) => checks.push([ok, name, detail]);
  const major = Number(process.versions.node.split(".")[0]);
  add(major >= 20, "node", `v${process.versions.node} (need ≥ 20)`);
  try { execFileSync("curl", ["--version"], { stdio: "pipe" }); add(true, "curl", "available"); } catch { add(false, "curl", "not found (needed for API calls)"); }
  add(existsSync(REMOTION_BIN), "remotion", existsSync(REMOTION_BIN) ? TEMPLATE_DIR : `run: npm ci --prefix ${TEMPLATE_DIR}`);
  if (existsSync(REMOTION_BIN)) {
    try { await ffmpeg(["-version"]); add(true, "ffmpeg", "bundled with Remotion"); } catch (e) { add(false, "ffmpeg", e.message.split("\n")[0]); }
  }
  let cfg = {};
  try { cfg = loadProject().config; add(true, "project", cfg.name); } catch { add(true, "project", "not inside a project (ok)"); }
  const t = ttsConfig(cfg);
  const key = resolveApiKey(t.keyEnv, t.baseUrl);
  add(Boolean(key), "tts key", key ? `found via ${key.source}` : trustedKeyHost(t.baseUrl) ? `missing: set ${t.keyEnv}` : `missing: ${new URL(t.baseUrl).host} needs its own keyEnv variable`);
  add(true, "pexels", process.env.PEXELS_API_KEY ? "PEXELS_API_KEY set" : "optional; unset (NASA/Wikimedia/Openverse still work)");
  add(existsSync(join(ONEVIDEO_ROOT, "template", "src", "index.ts")), "template", join(ONEVIDEO_ROOT, "template"));
  const depth = media.depthTools();
  add(true, "depth", depth.missing ? `optional; ${depth.missing}` : `${depth.py} + ${depth.model}`);
  for (const [ok, name, detail] of checks) log(`${ok ? "✓" : "✗"} ${name.padEnd(9)} ${detail}`);
  if (checks.some(([ok]) => !ok)) process.exitCode = 1;
}
