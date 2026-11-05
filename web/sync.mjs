#!/usr/bin/env node
// Pull published OneVideo projects from the render host into web/site/v/<slug>/ and write
// web/site/videos.json. Only projects that ran `onevideo publish` (review approved) are listed.
//   ONEVIDEO_HOST      ssh host of the render node   (required)
//   ONEVIDEO_PROJECTS  projects root on that host     (default: /srv/onevideo)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = process.env.ONEVIDEO_HOST;
const ROOT = process.env.ONEVIDEO_PROJECTS ?? "/srv/onevideo";
if (!HOST) {
  console.error("ONEVIDEO_HOST is required: set it to the ssh host of your render node, e.g. `ONEVIDEO_HOST=render-box npm run web:sync`.");
  process.exit(1);
}
const SITE = join(dirname(fileURLToPath(import.meta.url)), "site");
const MAX_ASSET = 25 * 1024 * 1024; // Workers static assets per-file limit

// Runs on the host: one JSON line per published project.
const LIST = `
const fs = require("fs"), path = require("path");
const root = process.argv[2];
for (const slug of fs.readdirSync(root)) {
  const dir = path.join(root, slug);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, "onevideo.json"), "utf8"));
    const pub = JSON.parse(fs.readFileSync(path.join(dir, "plan/publish.json"), "utf8"));
    const st = fs.statSync(path.join(dir, "out", cfg.name + ".mp4"));
    console.log(JSON.stringify({ slug, name: cfg.name, publish: pub, size: st.size, mtime: st.mtimeMs }));
  } catch {}
}`;

const ssh = (args, input) => execFileSync("ssh", [HOST, ...args], { input, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
const scp = (remote, local) => execFileSync("scp", ["-q", `${HOST}:${remote}`, local], { stdio: "inherit" });
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const remote = ssh(["node", "-", q(ROOT)], LIST).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const vdir = join(SITE, "v");
mkdirSync(vdir, { recursive: true });
const videos = [];

for (const p of remote) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(p.slug)) { console.warn(`skip ${p.slug}: slug must be [a-z0-9-]`); continue; }
  if (p.size > MAX_ASSET) { console.warn(`skip ${p.slug}: ${(p.size / 2 ** 20).toFixed(1)} MiB exceeds the 25 MiB asset limit`); continue; }
  const src = `${ROOT}/${p.slug}`;
  const dst = join(vdir, p.slug);
  const stamp = join(dst, ".mtime");
  mkdirSync(dst, { recursive: true });
  const fresh = existsSync(stamp) && readFileSync(stamp, "utf8") === String(p.mtime) && statSync(join(dst, "video.mp4"), { throwIfNoEntry: false })?.size === p.size;
  if (!fresh) {
    const chapters = p.publish.chapters ?? [];
    const at = chapters[1] ? chapters[1].start + 4 : p.publish.duration * 0.2;
    const ff = "$(find /opt/onevideo/template/node_modules/@remotion -name ffmpeg -type f -perm -u+x | head -1)";
    const tmp = `/tmp/onevideo-poster-${p.slug}.jpg`;
    ssh(["bash", "-c", q(`set -e; ${ff} -v error -y -ss ${at.toFixed(2)} -i ${src}/out/${p.name}.mp4 -frames:v 1 -vf scale=1280:-2 -q:v 3 ${tmp}`)]);
    scp(tmp, join(dst, "poster.jpg"));
    scp(`${src}/out/${p.name}.mp4`, join(dst, "video.mp4"));
    scp(`${src}/out/publish/captions.vtt`, join(dst, "captions.vtt"));
    scp(`${src}/out/publish/description.txt`, join(dst, "description.txt"));
    writeFileSync(stamp, String(p.mtime));
    console.log(`↓ ${p.slug} (${(p.size / 2 ** 20).toFixed(1)} MiB)`);
  } else console.log(`= ${p.slug}`);
  const v = Math.round(p.mtime).toString(36);
  videos.push({
    slug: p.slug,
    title: p.publish.title,
    summary: p.publish.summary ?? "",
    duration: p.publish.duration,
    chapters: p.publish.chapters ?? [],
    tags: p.publish.tags ?? [],
    date: new Date(p.mtime).toISOString().slice(0, 10),
    size: p.size,
    video: `v/${p.slug}/video.mp4?v=${v}`,
    poster: `v/${p.slug}/poster.jpg?v=${v}`,
    captions: `v/${p.slug}/captions.vtt?v=${v}`,
    description: readFileSync(join(dst, "description.txt"), "utf8"),
    mtime: p.mtime,
  });
}

const keep = new Set(videos.map((v) => v.slug));
for (const d of readdirSync(vdir)) if (!keep.has(d)) { rmSync(join(vdir, d), { recursive: true, force: true }); console.log(`✗ ${d} (no longer published)`); }

videos.sort((a, b) => b.mtime - a.mtime);
writeFileSync(join(SITE, "videos.json"), JSON.stringify({ generatedAt: new Date().toISOString(), videos: videos.map(({ mtime, ...v }) => v) }, null, 2));
console.log(`videos.json: ${videos.length} video(s)`);
