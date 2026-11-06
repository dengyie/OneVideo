// The director's eyes on a render: contact sheets (every Nth second tiled into one image) and a
// second opinion from a vision model that reads them against the timeline.
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { UserError, loadProject, readJson, writeJson, log, warn } from "../lib/project.mjs";
import { ffmpeg, ffprobe } from "../lib/ffmpeg.mjs";
import { ask, imagePart, llmConfig } from "../lib/llm.mjs";
import { videoPath } from "./render.mjs";

const CELLS_PER_SHEET = 24;

// Frame grid geometry for [from, to): one cell every 1/fps seconds, sheets of ≤ `per` cells.
export function sheetPlan(duration, { fps, from = 0, to = duration, cols = 6, per = CELLS_PER_SHEET } = {}) {
  const span = Math.max(0, Math.min(to, duration) - from);
  const rate = fps ?? (span <= 75 ? 1 : span <= 150 ? 0.5 : 0.25);
  const step = 1 / rate;
  const total = Math.max(1, Math.ceil(span * rate - 1e-6));
  const sheets = [];
  for (let k = 0; k * per < total; k++) {
    const cells = Math.min(per, total - k * per);
    sheets.push({ t0: +(from + k * per * step).toFixed(3), step, cells, cols: Math.min(cols, cells), rows: Math.ceil(cells / Math.min(cols, cells)) });
  }
  return sheets;
}

// The scene playing at t (seconds) on a compiled timeline.
export const sceneAt = (timeline, t) => timeline?.scenes?.findLast((s) => s.start <= t + 1e-6)?.id ?? null;

async function writeSheets(video, outDir, opts) {
  const probe = await ffprobe(video);
  const duration = +probe.format.duration;
  const plan = sheetPlan(duration, opts);
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^sheet-\d+\.jpg$/.test(f)) rmSync(join(outDir, f));
  const width = opts.width ?? 480;
  for (const [k, s] of plan.entries()) {
    s.file = join(outDir, `sheet-${String(k + 1).padStart(2, "0")}.jpg`);
    // Sample mid-interval so a cell shows its second, not the cut at its edge.
    await ffmpeg(["-y", "-ss", String(s.t0 + s.step / 2), "-t", String(s.cells * s.step), "-i", video, "-frames:v", "1", "-vf", `fps=${1 / s.step},scale=${width}:-2,tile=${s.cols}x${s.rows}:padding=4:color=black`, "-q:v", "4", s.file]);
  }
  return { duration, sheets: plan };
}

const cellTime = (s, i) => +(s.t0 + s.step * (i + 0.5)).toFixed(2);

export async function sheet(args) {
  const project = loadProject();
  const video = args.video ?? videoPath(project);
  if (!existsSync(video)) throw new UserError(`no video at ${video}; run: onevideo render`);
  const tl = existsSync(project.paths.timeline) ? readJson(project.paths.timeline) : null;
  const { sheets } = await writeSheets(video, join(project.paths.out, "qc"), {
    fps: args.fps !== undefined ? Number(args.fps) : undefined, from: Number(args.from ?? 0), to: args.to !== undefined ? Number(args.to) : undefined,
    cols: Number(args.cols ?? 6), width: Number(args.width ?? 480),
  });
  for (const s of sheets) {
    log(`✓ ${relative(project.root, s.file)}  ${s.cols}×${s.rows}, cell i = ${s.t0 + s.step / 2}s + i×${s.step}s`);
    // Where each scene starts on the sheet, so a cell can be named without counting.
    const marks = (tl?.scenes ?? []).map((sc) => [sc.id, Math.ceil((sc.start - s.t0) / s.step - 0.5)]).filter(([, i]) => i >= 0 && i < s.cells);
    if (marks.length) log(`  scenes from cell: ${marks.map(([id, i]) => `${id}@${i}`).join("  ")}`);
  }
}

const LOOK_PROMPT = (sheets, scenes, focus) => `You are reviewing a rendered narrated video as a film editor. The images are contact sheets: each cell is one frame, read row by row, left to right, cell 0 first.
${sheets.map((s, k) => `Sheet ${k}: ${s.cells} cells, cell i shows t = ${s.t0 + s.step / 2}s + i×${s.step}s.`).join("\n")}

Timeline (scene id, type, start–end seconds, narration lines):
${scenes}

Judge what a viewer sees: stretches where nothing new happens on screen (more than ~4 s), text that is hard to read or collides with other text or covers the subject, awkward composition or cropping, a visual that does not match its narration line, jarring or repetitive transitions, blank/black/broken frames, inconsistent look between scenes. Ignore things that are fine. ${focus ? `Pay extra attention to: ${focus}.` : ""}
Reply only JSON: {"score": <1-10 overall>, "summary": "<two sentences, Chinese>", "notes": [{"sheet": <k>, "cell": <i>, "severity": "high|medium|low", "issue": "<Chinese>", "fix": "<concrete change, Chinese>"}]}`;

export async function look(args) {
  const project = loadProject();
  const video = args.video ?? videoPath(project);
  if (!existsSync(video)) throw new UserError(`no video at ${video}; run: onevideo render`);
  const tl = existsSync(project.paths.timeline) ? readJson(project.paths.timeline) : null;
  const outDir = join(project.paths.out, "qc");
  const { sheets } = await writeSheets(video, outDir, { fps: args.fps !== undefined ? Number(args.fps) : undefined, from: Number(args.from ?? 0), to: args.to !== undefined ? Number(args.to) : undefined, width: 400 });
  const scenes = (tl?.scenes ?? [])
    .map((s) => `- ${s.id} (${s.type}) ${s.start.toFixed(1)}–${(s.start + s.duration).toFixed(1)}s: ${(s.lines ?? []).map((l) => `[${(s.start + l.start).toFixed(1)}s] ${l.text}`).join(" ")}`)
    .join("\n") || "(no timeline)";
  const config = { llm: { ...project.config.llm, ...(args.models ? { models: String(args.models).split(",") } : {}) } };
  log(`look: ${sheets.length} sheet(s) → ${llmConfig(config).models.join(" / ")}`);
  const { data, model } = await ask({ prompt: LOOK_PROMPT(sheets, scenes, args.focus), images: sheets.map((s) => imagePart(s.file)), json: true, maxTokens: 4000, config });
  const notes = (Array.isArray(data.notes) ? data.notes : [])
    .map((n) => {
      const s = sheets[n.sheet] ?? sheets[0];
      const cell = Math.max(0, Math.min(s.cells - 1, Number(n.cell) || 0));
      const t = cellTime(s, cell);
      return { t, scene: sceneAt(tl, t), severity: ["high", "medium", "low"].includes(n.severity) ? n.severity : "medium", issue: String(n.issue ?? ""), fix: String(n.fix ?? "") };
    })
    .sort((a, b) => a.t - b.t);
  const result = { at: new Date().toISOString(), model, video: relative(project.root, video), score: data.score ?? null, summary: data.summary ?? "", sheets: sheets.map((s) => relative(project.root, s.file)), notes };
  writeJson(join(outDir, "look.json"), result);
  log(`score ${result.score ?? "?"}/10 (${model}) — ${result.summary}`);
  const icon = { high: "✗", medium: "⚠", low: "·" };
  for (const n of notes) log(`${icon[n.severity]} ${n.t.toFixed(1).padStart(5)}s ${String(n.scene ?? "").padEnd(10)} ${n.issue}${n.fix ? `\n         → ${n.fix}` : ""}`);
  if (!notes.length) warn("no notes returned; check the sheets yourself");
  log(`→ ${relative(project.root, join(outDir, "look.json"))} (a second opinion: confirm on the sheets or with stills before changing the storyboard)`);
}
