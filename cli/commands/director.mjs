// The director's eyes on a render: contact sheets (every Nth second tiled into one image), the
// same against an earlier version, and a second opinion from a vision model that reads them
// against the timeline.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { UserError, loadProject, readJson, writeJson, log, warn } from "../lib/project.mjs";
import { ask, imagePart, llmConfig } from "../lib/llm.mjs";
import { cellTime, sceneAt, sheetPlan, writeSheets } from "../lib/sheet.mjs";
import { resolveVideo } from "../lib/renders.mjs";
import { videoPath } from "./render.mjs";
import { buildHandoff, handoffPath, handoffRel } from "../lib/handoff.mjs";

export { sceneAt, sheetPlan, writeSheets };

// The video to read: --video (v3, prev, a path) or the newest render; a part render starts later
// on the timeline, so its cells are shifted by its offset when they are matched to scenes.
function target(project, arg) {
  const v = resolveVideo(project, arg, videoPath(project));
  if (!existsSync(v.file)) throw new UserError(`no video at ${v.file}; run: onevideo render`);
  return v;
}
const range = (args, offset) => ({ from: Math.max(0, Number(args.from ?? offset) - offset), to: args.to !== undefined ? Number(args.to) - offset : undefined });

export async function sheet(args) {
  const project = loadProject();
  const cur = target(project, args.video);
  const tl = existsSync(project.paths.timeline) ? readJson(project.paths.timeline) : null;
  // --vs v3: each cell shows that version on top and this one below, at the same timeline moment.
  const vs = args.vs !== undefined ? target(project, args.vs) : null;
  const { sheets } = await writeSheets(cur.file, join(project.paths.out, "qc"), {
    fps: args.fps !== undefined ? Number(args.fps) : undefined, ...range(args, cur.offset),
    cols: Number(args.cols ?? (vs ? 4 : 6)), width: Number(args.width ?? 480),
    ...(vs ? { prefix: "compare", pair: { video: vs.file, shift: cur.offset - vs.offset } } : {}),
  });
  const name = (v) => (v.entry ? `v${v.entry.v}` : relative(project.root, v.file));
  if (vs) log(`top: ${name(vs)} · bottom: ${name(cur)}`);
  for (const s of sheets) {
    const t0 = +(s.t0 + cur.offset).toFixed(3);
    log(`✓ ${relative(project.root, s.file)}  ${s.cols}×${s.rows}, cell i = ${+(t0 + s.step / 2).toFixed(2)}s + i×${s.step}s`);
    // Where each scene starts on the sheet, so a cell can be named without counting.
    const marks = (tl?.scenes ?? []).map((sc) => [sc.id, Math.ceil((sc.start - t0) / s.step - 0.5)]).filter(([, i]) => i >= 0 && i < s.cells);
    if (marks.length) log(`  scenes from cell: ${marks.map(([id, i]) => `${id}@${i}`).join("  ")}`);
  }
}

// One sheet per call: relays cap a reply's tokens (reasoning included), so a whole-video review
// in one answer comes back cut off.
const LOOK_PROMPT = (s, scenes, focus) => `You are reviewing a rendered narrated video as a film editor. The image is a contact sheet: each cell is one frame, read row by row, left to right, cell 0 first. ${s.cells} cells; cell i shows t = ${s.t0 + s.step / 2}s + i×${s.step}s.

Timeline around this stretch (scene id, type, start–end seconds, narration lines with their times):
${scenes}

Judge what a viewer sees: stretches where nothing new happens on screen (more than ~4 s), text that is hard to read or collides with other text or covers the subject, awkward composition or cropping, a visual that does not match its narration line, jarring or repetitive transitions, blank/black/broken frames, inconsistent look between scenes. Ignore things that are fine. ${focus ? `Pay extra attention to: ${focus}.` : ""}
Keep it short: at most 5 notes, the most important first, each issue and fix under 40 characters.
Reply only JSON: {"score": <1-10 for this stretch>, "summary": "<one sentence, Chinese>", "notes": [{"cell": <i>, "severity": "high|medium|low", "issue": "<Chinese>", "fix": "<concrete change, Chinese>"}]}`;

const sceneLine = (s) => `- ${s.id} (${s.type}) ${s.start.toFixed(1)}–${(s.start + s.duration).toFixed(1)}s: ${(s.lines ?? []).map((l) => `[${(s.start + l.start).toFixed(1)}s] ${l.text}`).join(" ")}`;

export async function look(args) {
  const project = loadProject();
  const { file: video, offset } = target(project, args.video);
  const tl = existsSync(project.paths.timeline) ? readJson(project.paths.timeline) : null;
  const outDir = join(project.paths.out, "qc");
  const { sheets: raw } = await writeSheets(video, outDir, { fps: args.fps !== undefined ? Number(args.fps) : undefined, ...range(args, offset), width: 400 });
  // Timeline time from here on: a part render's cells are shifted by where it starts.
  const sheets = raw.map((s) => ({ ...s, t0: +(s.t0 + offset).toFixed(3) }));
  const config = { llm: { ...project.config.llm, ...(args.models ? { models: String(args.models).split(",") } : {}) } };
  log(`look: ${sheets.length} sheet(s) → ${llmConfig(config).models.join(" / ")}`);
  const reviews = [], notes = [];
  for (const [k, s] of sheets.entries()) {
    const end = s.t0 + s.cells * s.step;
    const scenes = (tl?.scenes ?? []).filter((sc) => sc.start < end && sc.start + sc.duration > s.t0).map(sceneLine).join("\n") || "(no timeline)";
    try {
      const { data, model } = await ask({ prompt: LOOK_PROMPT(s, scenes, args.focus), images: [imagePart(s.file)], json: true, maxTokens: 4000, config });
      reviews.push({ sheet: relative(project.root, s.file), model, score: Number(data.score) || null, summary: String(data.summary ?? ""), truncated: !!data.truncated });
      for (const n of Array.isArray(data.notes) ? data.notes : []) {
        const t = cellTime(s, Math.max(0, Math.min(s.cells - 1, Number(n.cell) || 0)));
        notes.push({ t, scene: sceneAt(tl, t), severity: ["high", "medium", "low"].includes(n.severity) ? n.severity : "medium", issue: String(n.issue ?? ""), fix: String(n.fix ?? "") });
      }
      log(`  sheet ${k + 1}: ${data.score ?? "?"}/10 (${model})${data.truncated ? " [reply cut off; kept complete notes]" : ""} ${data.summary ?? ""}`);
    } catch (e) {
      warn(`sheet ${k + 1}: ${e.message}`);
    }
  }
  if (!reviews.length) throw new UserError("no sheet was reviewed; check the model list (onevideo doctor) or pass --models");
  notes.sort((a, b) => a.t - b.t);
  const scored = reviews.filter((r) => r.score);
  const score = scored.length ? +(scored.reduce((a, r) => a + r.score, 0) / scored.length).toFixed(1) : null;
  const result = { at: new Date().toISOString(), video: relative(project.root, video), score, reviews, notes };
  writeJson(join(outDir, "look.json"), result);
  log(`score ${score ?? "?"}/10 over ${reviews.length}/${sheets.length} sheet(s)`);
  const icon = { high: "✗", medium: "⚠", low: "·" };
  for (const n of notes) log(`${icon[n.severity]} ${n.t.toFixed(1).padStart(5)}s ${String(n.scene ?? "").padEnd(10)} ${n.issue}${n.fix ? `\n         → ${n.fix}` : ""}`);
  if (!notes.length) warn("no notes returned; check the sheets yourself");
  log(`→ ${relative(project.root, join(outDir, "look.json"))} (a second opinion: confirm on the sheets or with stills before changing the storyboard)`);
}

// Before switching sessions or handing a round to a subagent: write down where the cut stands.
export async function handoff(args) {
  const project = loadProject();
  const md = buildHandoff(project, { lock: typeof args.lock === "string" ? args.lock : undefined, next: typeof args.next === "string" ? args.next : undefined });
  mkdirSync(join(project.root, "plan"), { recursive: true });
  writeFileSync(handoffPath(project), md);
  log(`→ ${handoffRel(project)} (hand-written: 锁定 / 下一轮只改 / 备注 — edit them there or with --lock / --next)`);
}
