// The director's eyes on a render: contact sheets (every Nth second tiled into one image) and a
// second opinion from a vision model that reads them against the timeline.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { deflateSync } from "node:zlib";
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

const cellTime = (s, i) => +(s.t0 + s.step * (i + 0.5)).toFixed(2);

// Remotion's ffmpeg build has scale but no fps/tile filters, so cells are pulled one by one as raw
// RGB and tiled here; the grid goes out as PNG and ffmpeg re-encodes it to JPEG.
const PAD = 4;

const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgb, w, h) {
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

async function frameRgb(video, t, w, h, tmp) {
  const f = join(tmp, `cell-${t}.rgb`);
  rmSync(f, { force: true });
  await ffmpeg(["-y", "-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-f", "image2", "-update", "1", f]);
  return existsSync(f) ? readFileSync(f) : null; // past the last frame: leave the cell black
}

export async function writeSheets(video, outDir, opts) {
  const probe = await ffprobe(video);
  const duration = +probe.format.duration;
  const vs = probe.streams.find((st) => st.codec_type === "video");
  const plan = sheetPlan(duration, opts);
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^sheet-\d+\.jpg$/.test(f)) rmSync(join(outDir, f));
  const w = opts.width ?? 480, h = Math.round((w * vs.height) / vs.width / 2) * 2;
  const tmp = mkdtempSync(join(tmpdir(), "ov-sheet-"));
  try {
    for (const [k, s] of plan.entries()) {
      s.file = join(outDir, `sheet-${String(k + 1).padStart(2, "0")}.jpg`);
      const W = s.cols * w + (s.cols + 1) * PAD, H = s.rows * h + (s.rows + 1) * PAD;
      const grid = Buffer.alloc(W * H * 3);
      // Sample mid-interval so a cell shows its second, not the cut at its edge; a few seeks at a time.
      for (let i0 = 0; i0 < s.cells; i0 += 4) {
        const idx = Array.from({ length: Math.min(4, s.cells - i0) }, (_, d) => i0 + d);
        const cells = await Promise.all(idx.map((i) => frameRgb(video, Math.min(cellTime(s, i), duration - 0.05), w, h, tmp)));
        for (const [n, cell] of cells.entries()) {
          if (!cell) continue;
          const i = idx[n], x0 = PAD + (i % s.cols) * (w + PAD), y0 = PAD + Math.floor(i / s.cols) * (h + PAD);
          for (let y = 0; y < h; y++) cell.copy(grid, ((y0 + y) * W + x0) * 3, y * w * 3, (y + 1) * w * 3);
        }
      }
      const png = join(tmp, "sheet.png");
      writeFileSync(png, encodePng(grid, W, H));
      await ffmpeg(["-y", "-v", "error", "-i", png, "-q:v", "4", s.file]);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { duration, sheets: plan };
}

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
  const video = args.video ?? videoPath(project);
  if (!existsSync(video)) throw new UserError(`no video at ${video}; run: onevideo render`);
  const tl = existsSync(project.paths.timeline) ? readJson(project.paths.timeline) : null;
  const outDir = join(project.paths.out, "qc");
  const { sheets } = await writeSheets(video, outDir, { fps: args.fps !== undefined ? Number(args.fps) : undefined, from: Number(args.from ?? 0), to: args.to !== undefined ? Number(args.to) : undefined, width: 400 });
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
