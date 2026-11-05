// render / stills / studio / qc / publish / build / doctor
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { UserError, loadProject, readJson, writeJson, log, warn, ONEVIDEO_ROOT } from "../lib/project.mjs";
import { checkProject, printIssues } from "../lib/check.mjs";
import { REMOTION_BIN, TEMPLATE_DIR, requireRemotion, run, ffmpeg } from "../lib/ffmpeg.mjs";
import { runQc } from "../lib/qc.mjs";
import { buildPublishKit } from "../lib/publish.mjs";
import { resolveApiKey } from "../lib/http.mjs";
import { ttsConfig } from "../lib/tts.mjs";
import * as media from "./media.mjs";

const ENTRY = "src/index.ts";
const COMPOSITION = "OneVideo";

export const videoPath = (project) => join(project.paths.out, `${project.config.name}.mp4`);

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
  const tl = freshTimeline(project, { force: Boolean(args.force) });
  const dir = join(project.paths.out, "stills");
  mkdirSync(dir, { recursive: true });
  const only = typeof args.scene === "string" ? args.scene.split(",") : null;
  const at = args.at !== undefined ? Number(args.at) : 0.7;
  for (const [i, s] of tl.scenes.entries()) {
    if (only && !only.includes(s.id)) continue;
    const frame = s.from + Math.min(s.durationInFrames - 1, Math.floor(s.durationInFrames * at));
    const file = join(dir, `${String(i + 1).padStart(2, "0")}-${s.id}.jpg`);
    await run(REMOTION_BIN, ["still", ENTRY, COMPOSITION, file, ...commonFlags(project), `--frame=${frame}`, "--image-format=jpeg", "--scale=0.5"], { cwd: TEMPLATE_DIR });
    log(`✓ ${file}`);
  }
}

export async function studio(args) {
  requireRemotion();
  const project = loadProject();
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

export async function publish() {
  const project = loadProject();
  const tl = readJson(project.paths.timeline);
  const script = readJson(project.paths.script);
  const research = existsSync(project.paths.research) ? readJson(project.paths.research) : null;
  const review = existsSync(project.paths.review) ? readJson(project.paths.review) : null;
  if (!review) warn("no QC review yet; run: onevideo qc");
  else if (review.verdict === "fail") throw new UserError("QC verdict is FAIL; fix and re-render before publishing");
  const kit = buildPublishKit({ timeline: tl, research, config: project.config, script });
  const dir = join(project.paths.out, "publish");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(kit.files)) writeFileSync(join(dir, name), content);
  writeJson(project.paths.publish, kit.publish);
  for (const w of kit.publish.warnings) warn(w);
  log(`publish kit → ${dir} (${Object.keys(kit.files).join(", ")})`);
}

// Full non-creative pass: voice → music → timeline → render → qc → publish.
export async function build(args) {
  await media.tts({ _: [], force: args.forceTts });
  await media.music({ _: [] });
  await media.timeline({ _: [] });
  await render({ _: [], draft: args.draft });
  if (args.draft) return;
  const review = await qc({ _: [] });
  if (review.verdict !== "fail") await publish();
}

export async function doctor() {
  const checks = [];
  const add = (ok, name, detail) => checks.push([ok, name, detail]);
  const major = Number(process.versions.node.split(".")[0]);
  add(major >= 20, "node", `v${process.versions.node} (need ≥ 20)`);
  try { execFileSync("curl", ["--version"], { stdio: "pipe" }); add(true, "curl", "available"); } catch { add(false, "curl", "not found (needed for API calls)"); }
  add(existsSync(REMOTION_BIN), "remotion", existsSync(REMOTION_BIN) ? TEMPLATE_DIR : `run: npm install --prefix ${TEMPLATE_DIR}`);
  if (existsSync(REMOTION_BIN)) {
    try { await ffmpeg(["-version"]); add(true, "ffmpeg", "bundled with Remotion"); } catch (e) { add(false, "ffmpeg", e.message.split("\n")[0]); }
  }
  let cfg = {};
  try { cfg = loadProject().config; add(true, "project", cfg.name); } catch { add(true, "project", "not inside a project (ok)"); }
  const t = ttsConfig(cfg);
  const key = resolveApiKey(t.keyEnv);
  add(Boolean(key), "tts key", key ? `found via ${key.source}` : `missing: set ${t.keyEnv}`);
  add(true, "pexels", process.env.PEXELS_API_KEY ? "PEXELS_API_KEY set" : "optional; unset (NASA/Wikimedia/Openverse still work)");
  add(existsSync(join(ONEVIDEO_ROOT, "template", "src", "index.ts")), "template", join(ONEVIDEO_ROOT, "template"));
  for (const [ok, name, detail] of checks) log(`${ok ? "✓" : "✗"} ${name.padEnd(9)} ${detail}`);
  if (checks.some(([ok]) => !ok)) process.exitCode = 1;
}
