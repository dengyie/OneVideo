// Licensed media sourcing. Keyless providers: NASA Images (photos + video), Wikimedia Commons
// (photos + video), Openverse (photos). Optional: Pexels (PEXELS_API_KEY, photos + video) and
// AI image and video generation (OpenAI-compatible relay). Videos are cut to a short silent H.264 clip.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg, ffprobe } from "./ffmpeg.mjs";
import { getJson, download, request, requireApiKey } from "./http.mjs";
import { ask, imagePart } from "./llm.mjs";

const stripHtml = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const enc = encodeURIComponent;

export const PROVIDERS = {
  async nasa(query, { limit = 12, kind = "image" } = {}) {
    const j = await getJson(`https://images-api.nasa.gov/search?q=${enc(query)}&media_type=${kind === "video" ? "video" : "image"}&page_size=${limit}`);
    return (j.collection?.items ?? []).slice(0, limit).map((it) => {
      const d = it.data?.[0] ?? {};
      return {
        provider: "nasa", pid: d.nasa_id, kind: kind === "video" ? "video" : "image", title: d.title, author: d.photographer || d.secondary_creator || d.center || "NASA",
        license: "PD (NASA)", source: `https://images.nasa.gov/details/${enc(d.nasa_id)}`, preview: it.links?.[0]?.href, width: null, height: null,
        date: d.date_created?.slice(0, 10),
      };
    });
  },
  async wikimedia(query, { limit = 12, kind = "image" } = {}) {
    if (kind === "video") return wikimediaVideo(query, limit);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${enc(`${query} filetype:bitmap`)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=3840`;
    const j = await getJson(url);
    return Object.values(j.query?.pages ?? {})
      .sort((a, b) => a.index - b.index)
      .map((p) => {
        const ii = p.imageinfo?.[0] ?? {};
        const m = ii.extmetadata ?? {};
        return {
          provider: "wikimedia", pid: p.title, kind: "image", title: stripHtml(m.ObjectName?.value) || p.title.replace(/^File:/, ""),
          author: stripHtml(m.Artist?.value), license: stripHtml(m.LicenseShortName?.value) || "unknown", source: ii.descriptionurl,
          url: ii.thumburl || ii.url, width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height, mime: ii.mime,
        };
      })
      .filter((c) => /^image\/(jpeg|png|webp)/.test(c.mime ?? "") && !/\b(NC|ND)\b|non-?commercial/i.test(c.license));
  },
  async openverse(query, { limit = 12 } = {}) {
    const j = await getJson(`https://api.openverse.org/v1/images/?q=${enc(query)}&license_type=commercial,modification&page_size=${limit}`);
    return (j.results ?? []).map((r) => ({
      provider: "openverse", pid: r.id, kind: "image", title: r.title, author: r.creator,
      license: r.license === "cc0" ? "CC0" : r.license === "pdm" ? "PD" : `CC ${r.license.toUpperCase()} ${r.license_version ?? ""}`.trim(),
      source: r.foreign_landing_url, url: r.url, width: r.width, height: r.height,
    }));
  },
  async pexels(query, { limit = 12, kind = "image" } = {}) {
    const key = process.env.PEXELS_API_KEY;
    if (!key) throw new Error("pexels needs PEXELS_API_KEY");
    const headers = { Authorization: key };
    if (kind === "video") {
      const j = await getJson(`https://api.pexels.com/videos/search?query=${enc(query)}&per_page=${limit}`, { headers });
      return (j.videos ?? []).map((v) => {
        const f = (v.video_files ?? []).filter((x) => x.file_type === "video/mp4" && x.width <= 1920).sort((a, b) => b.width - a.width)[0];
        return { provider: "pexels", pid: String(v.id), kind: "video", title: v.url.split("/").filter(Boolean).pop(), author: v.user?.name, license: "Pexels License", source: v.url, url: f?.link, width: f?.width, height: f?.height, duration: v.duration };
      }).filter((c) => c.url);
    }
    const j = await getJson(`https://api.pexels.com/v1/search?query=${enc(query)}&per_page=${limit}`, { headers });
    return (j.photos ?? []).map((p) => ({ provider: "pexels", pid: String(p.id), kind: "image", title: p.alt, author: p.photographer, license: "Pexels License", source: p.url, url: p.src?.large2x ?? p.src?.original, width: p.width, height: p.height }));
  },
};

// Commons serves transcodes of every video; take the sharpest WebM at or under 1080p.
async function wikimediaVideo(query, limit) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${enc(`${query} filetype:video`)}&prop=videoinfo&viprop=url|size|mime|extmetadata|derivatives`;
  const j = await getJson(url);
  return Object.values(j.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .map((p) => {
      const v = p.videoinfo?.[0] ?? {};
      const m = v.extmetadata ?? {};
      const d = (v.derivatives ?? []).filter((x) => /^video\/webm/.test(x.type ?? "") && (x.height ?? 0) <= 1080).sort((a, b) => b.height - a.height)[0];
      return {
        provider: "wikimedia", pid: p.title, kind: "video", title: stripHtml(m.ObjectName?.value) || p.title.replace(/^File:/, ""),
        author: stripHtml(m.Artist?.value), license: stripHtml(m.LicenseShortName?.value) || "unknown", source: v.descriptionurl,
        url: d?.src ?? v.url, width: d?.width ?? v.width, height: d?.height ?? v.height, duration: v.duration,
      };
    })
    .filter((c) => c.url && !/\b(NC|ND)\b|non-?commercial/i.test(c.license));
}

export const DEFAULT_PROVIDER_ORDER = ["nasa", "wikimedia", "openverse"];
export const DEFAULT_VIDEO_PROVIDERS = () => ["nasa", "wikimedia", ...(process.env.PEXELS_API_KEY ? ["pexels"] : [])];

// NASA search results only carry thumbnails; the asset manifest lists the full renditions.
// Video: ~large is ~1080p at a sane size; ~orig can run to gigabytes.
async function nasaFullUrl(nasaId, kind = "image") {
  const j = await getJson(`https://images-api.nasa.gov/asset/${enc(nasaId)}`);
  const hrefs = (j.collection?.items ?? []).map((i) => i.href.replace(/^http:/, "https:"));
  if (kind === "video") {
    const mp4 = hrefs.filter((h) => /\.mp4$/i.test(h));
    return mp4.find((h) => /~large\./.test(h)) ?? mp4.find((h) => /~medium\./.test(h)) ?? mp4.find((h) => /~orig\./.test(h)) ?? mp4[0];
  }
  const img = hrefs.filter((h) => /\.(jpe?g|png)$/i.test(h));
  return img.find((h) => /~large\./.test(h)) ?? img.find((h) => /~orig\./.test(h)) ?? img.find((h) => /~medium\./.test(h)) ?? img[0];
}

export const CLIP_MAX = 20;

// A downloaded video becomes a short, silent, ≤1080p H.264 clip: `clip: [start, seconds]`
// picks the window (default the first CLIP_MAX seconds). Returns the clip's dimensions.
export async function cutClip(src, dest, clip) {
  const [start, seconds] = Array.isArray(clip) ? [clip[0] ?? 0, clip[1] ?? CLIP_MAX] : [0, CLIP_MAX];
  await ffmpeg(["-y", "-ss", String(start), "-i", src, "-t", String(Math.min(seconds, 60)), "-an",
    "-vf", "scale=min(1920\\,iw):-2:flags=lanczos", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dest]);
  const v = (await ffprobe(dest)).streams.find((x) => x.codec_type === "video");
  if (!v) throw new Error(`clip ${dest} has no video stream (start ${start}s past the end?)`);
  return { width: v.width, height: v.height, duration: +(+v.duration || seconds).toFixed(2) };
}

// Clips render from a JPEG sequence next to the mp4 (assets/<id>.frames/0001.jpg…): <Img> per frame
// is deterministic and light, where <OffthreadVideo>'s frame cache shrinks with free memory and on
// a 2 GB render node evicts frames as soon as they are decoded ("No frame found at position").
export const framesDir = (file) => file.replace(/\.mp4$/i, ".frames");
// Depth map made by `onevideo depth`: one PNG for an image, a PNG sequence dir for a video.
export const depthPath = (a) => (a.kind === "video" ? a.file.replace(/\.mp4$/i, ".depth") : a.file.replace(/\.[a-z0-9]+$/i, ".depth.png"));
// Coarse luma grid written alongside it, for text legibility (see cli/py/luma.py).
export const lumaPath = (a) => a.file.replace(/\.[a-z0-9]+$/i, ".luma.json");
export const countFrames = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}\.jpg$/.test(f)).length : 0);

export async function clipFrames(mp4, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await ffmpeg(["-y", "-i", mp4, "-an", "-q:v", "4", "-start_number", "1", join(dir, "%04d.jpg")]);
  const n = countFrames(dir);
  if (!n) throw new Error(`no frames extracted from ${mp4}`);
  return n;
}

const LICENSE_RANK = (l) => (/^(pd|public domain|cc0|pdm)/i.test(l) ? 0 : /pexels/i.test(l) ? 0.5 : /by-sa|by sa/i.test(l) ? 1.5 : /by/i.test(l) ? 1 : 3);

// Lower is better: license openness, aspect fit to the frame, and resolution.
export function scoreCandidate(c, targetAspect = 16 / 9) {
  let s = LICENSE_RANK(c.license);
  if (c.width && c.height) {
    s += Math.abs(Math.log(c.width / c.height / targetAspect)) * 2;
    if (Math.max(c.width, c.height) < 1280) s += 1.5;
  } else s += 0.6;
  return s;
}

export async function search(query, { providers = DEFAULT_PROVIDER_ORDER, kind = "image", limit = 12 } = {}) {
  const results = [];
  const errors = [];
  for (const name of providers) {
    const fn = PROVIDERS[name];
    if (!fn) { errors.push(`unknown provider "${name}"`); continue; }
    try {
      results.push(...(await fn(query, { limit, kind })));
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { results, errors };
}

const extOf = (url, fallback) => (String(url).match(/\.(jpe?g|png|webp|mp4|webm|mov)(?:$|[?#])/i)?.[1].toLowerCase().replace("jpeg", "jpg") ?? fallback);

// Resolve one manifest item to a local file; returns the updated item.
// `gen` carries generation settings: { aspect: "16:9", image, video, llm, lookup, onWarn }. A failed
// generation falls back to the stock search when the item also has a query.
export async function fetchAsset(item, { publicDir, aspect = 16 / 9, gen = {} }) {
  const dir = join(publicDir, "assets");
  mkdirSync(dir, { recursive: true });

  if (item.generate) {
    const opts = { dir, publicDir, aspect: gen.aspect, llm: gen.llm, lookup: gen.lookup, onWarn: gen.onWarn ?? (() => {}) };
    try {
      return item.kind === "video" ? await generateVideo(item, { ...opts, defaults: gen.video ?? {} }) : await generateImage(item, { ...opts, defaults: gen.image ?? {} });
    } catch (e) {
      if (!item.query && !item.url) throw e;
      opts.onWarn(`${item.id}: ${e.message}; falling back to ${item.url ? "url" : `search "${item.query}"`}`);
    }
  }

  let chosen = null;
  if (item.url) chosen = { url: item.url, license: item.license, author: item.author, title: item.title, source: item.source ?? item.url, provider: "url", kind: item.kind ?? "image" };
  else {
    if (!item.query) throw new Error(`asset "${item.id}" needs one of: url, query, generate`);
    const providers = item.provider ? [].concat(item.provider) : item.kind === "video" ? DEFAULT_VIDEO_PROVIDERS() : DEFAULT_PROVIDER_ORDER;
    const { results, errors } = await search(item.query, { providers, kind: item.kind ?? "image" });
    const ranked = results.filter((c) => c.kind === (item.kind ?? "image")).sort((a, b) => scoreCandidate(a, aspect) - scoreCandidate(b, aspect));
    chosen = ranked[item.pick ?? 0];
    if (!chosen) throw new Error(`no ${item.kind ?? "image"} results for "${item.query}"${errors.length ? ` (${errors.join("; ")})` : ""}`);
  }
  if (chosen.provider === "nasa") chosen.url = await nasaFullUrl(chosen.pid, chosen.kind);
  if (!chosen.url) throw new Error(`asset "${item.id}": candidate has no downloadable URL`);
  const buf = await download(chosen.url, chosen.kind === "video" ? { timeoutSec: 900 } : undefined);
  let file;
  if (chosen.kind === "video") {
    file = `assets/${item.id}.mp4`;
    const raw = join(dir, `${item.id}.src.${extOf(chosen.url, "mp4")}`);
    writeFileSync(raw, buf);
    try { Object.assign(chosen, await cutClip(raw, join(publicDir, file), item.clip)); } finally { rmSync(raw, { force: true }); }
    await clipFrames(join(publicDir, file), join(publicDir, framesDir(file)));
  } else {
    file = `assets/${item.id}.${extOf(chosen.url, "jpg")}`;
    writeFileSync(join(publicDir, file), buf);
  }
  return {
    ...item,
    file,
    kind: chosen.kind,
    via: chosen.provider,
    title: item.title ?? chosen.title,
    author: item.author ?? chosen.author,
    license: item.license ?? chosen.license,
    source: item.source ?? chosen.source,
    width: chosen.width ?? item.width,
    height: chosen.height ?? item.height,
    ...(chosen.kind === "video" ? { duration: chosen.duration ?? null } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

export const IMAGE_DEFAULTS = { baseUrl: "https://api.mangoqwq.com/v1", models: ["gpt-image-2.5", "grok-imagine-image-quality"], keyEnv: "MANGO_API_KEY" };
export const VIDEO_DEFAULTS = { baseUrl: "https://api.mangoqwq.com/v1", models: ["grok-imagine-video", "grok-imagine-video-1.5"], duration: 6, resolution: "720p", keyEnv: "MANGO_API_KEY", pollSec: 5, timeoutSec: 900 };
const IMAGE_SIZE = { "16:9": "1536x1024", "9:16": "1024x1536", "1:1": "1024x1024" };

// item.generate (string prompt or object) over project defaults; `model` pins one model, `models` is
// the fallback order. Relay channels come and go, so each model is tried until one delivers.
function genConfig(item, base, defaults) {
  const own = typeof item.generate === "object" ? item.generate : { prompt: item.generate };
  const cfg = { ...base, ...defaults, ...own };
  cfg.models = [].concat(own.model ?? own.models ?? defaults.model ?? defaults.models ?? base.models);
  if (!cfg.prompt) throw new Error(`asset "${item.id}": generate.prompt is required`);
  return cfg;
}

const imageExt = (buf) => (buf[0] === 0x89 ? "png" : buf[0] === 0xff ? "jpg" : "webp");

// An image as a JPEG data-URL part at most `width` px wide: full-size PNG takes run to megabytes,
// which vision calls and video submits time out on. Undecodable input goes as is.
async function jpegPart(file, width) {
  const tmp = mkdtempSync(join(tmpdir(), "ov-jpeg-"));
  try {
    const out = join(tmp, "x.jpg");
    await ffmpeg(["-y", "-v", "error", "-i", file, "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-q:v", "3", out]);
    return imagePart(readFileSync(out), "image/jpeg");
  } catch {
    return imagePart(file);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function firstModel(cfg, what, fn) {
  const failures = [];
  for (const model of cfg.models) {
    try { return { model, ...(await fn(model)) }; } catch (e) { failures.push(`${model}: ${e.message.split("\n")[0].slice(0, 200)}`); }
  }
  throw new Error(`${what} failed on every model (${failures.join("; ")})`);
}

async function imageTake(cfg, key, model) {
  // OpenAI image models always answer in base64; others (grok) are asked to, since their URLs can
  // point at the relay's loopback.
  const json = { model, prompt: cfg.prompt, size: cfg.size, n: 1, ...(/^gpt-image|^dall-e/.test(model) ? {} : { response_format: "b64_json" }) };
  const res = await request(`${cfg.baseUrl.replace(/\/$/, "")}/images/generations`, { method: "POST", key, json, timeoutSec: 300, retries: 1 });
  const d = JSON.parse(res.body.toString()).data?.[0];
  if (d?.b64_json) return { buf: Buffer.from(d.b64_json, "base64") };
  if (d?.url) return { buf: await download(d.url) };
  throw new Error(`no image in reply: ${res.body.subarray(0, 200).toString()}`);
}

// `variants: N` makes N takes and lets a vision model pick the one that fits the brief (`pick`
// overrides with an index); every take stays on disk as <id>.take<k>.<ext> for the director.
export async function generateImage(item, { dir, defaults = {}, aspect = "16:9", llm = {}, onWarn = () => {} }) {
  const cfg = genConfig(item, { ...IMAGE_DEFAULTS, size: IMAGE_SIZE[aspect] ?? IMAGE_SIZE["16:9"] }, defaults);
  const key = requireApiKey(cfg.keyEnv, cfg.baseUrl);
  const n = Math.max(1, Math.min(4, cfg.variants ?? 1));
  const takes = [];
  for (let k = 0; k < n; k++) {
    try {
      const t = await firstModel(cfg, `image "${item.id}"`, (model) => imageTake(cfg, key, model));
      const file = n > 1 ? `assets/${item.id}.take${k}.${imageExt(t.buf)}` : `assets/${item.id}.${imageExt(t.buf)}`;
      writeFileSync(join(dir, file.slice("assets/".length)), t.buf);
      takes.push({ ...t, file });
    } catch (e) {
      if (k === n - 1 && !takes.length) throw e;
      onWarn(`${item.id} take ${k}: ${e.message}`);
    }
  }
  let best = 0, pickedBy = null, pickReason = null;
  if (takes.length > 1 && Number.isInteger(cfg.pick)) best = Math.min(cfg.pick, takes.length - 1);
  else if (takes.length > 1) {
    try {
      const { data, model } = await ask({
        prompt: `These are ${takes.length} takes (in order, 0-based) for one shot of a narrated video, framed ${aspect}.\nBrief: ${cfg.prompt}${cfg.brief ? `\nWhat the shot must do: ${cfg.brief}` : ""}\nPick the take that best fits the brief: clear subject, believable detail, no garbled text, logos or watermarks, room for an on-screen title. Reply only JSON {"best": <index>, "reason": "<one sentence>"}.`,
        images: await Promise.all(takes.map((t) => jpegPart(join(dir, t.file.slice("assets/".length)), 768))), json: true, maxTokens: 2000, config: { llm },
      });
      if (Number.isInteger(data.best) && data.best >= 0 && data.best < takes.length) [best, pickedBy, pickReason] = [data.best, model, data.reason ?? null];
    } catch (e) {
      onWarn(`${item.id}: vision pick failed, keeping take 0 (${e.message})`);
    }
  }
  const chosen = takes[best];
  let file = chosen.file;
  if (takes.length > 1) {
    file = `assets/${item.id}.${imageExt(chosen.buf)}`;
    writeFileSync(join(dir, file.slice("assets/".length)), chosen.buf);
  }
  return {
    ...item, file, kind: "image", via: "generate", license: "generated", author: chosen.model, title: item.title ?? cfg.prompt.slice(0, 80),
    ...(takes.length > 1 ? { takes: takes.map((t) => t.file), picked: best, ...(pickedBy ? { pickedBy, pickReason } : {}) } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

// Text- or image-to-video through the relay's /videos task API: submit, poll, download, then the
// same cut + frame sequence as any fetched clip. `from: <asset id>` animates that (already
// fetched) image as the first frame.
export async function generateVideo(item, { publicDir, defaults = {}, aspect = "16:9", lookup = () => null }) {
  const cfg = genConfig(item, VIDEO_DEFAULTS, defaults);
  const key = requireApiKey(cfg.keyEnv, cfg.baseUrl);
  const base = cfg.baseUrl.replace(/\/$/, "");
  let image;
  if (cfg.from) {
    const src = lookup(cfg.from);
    if (!src?.file || !existsSync(join(publicDir, src.file))) throw new Error(`asset "${item.id}": generate.from "${cfg.from}" is not fetched yet`);
    image = { url: (await jpegPart(join(publicDir, src.file), 1280)).image_url.url };
  }
  const t = await firstModel(cfg, `video "${item.id}"`, async (model) => {
    const json = { model, prompt: cfg.prompt, duration: Math.round(cfg.duration), aspect_ratio: aspect, resolution: cfg.resolution, ...(image ? { image } : {}) };
    const sub = JSON.parse((await request(`${base}/videos`, { method: "POST", key, json, timeoutSec: 120, retries: 1 })).body.toString());
    if (!sub.id) throw new Error(`no task id: ${JSON.stringify(sub).slice(0, 200)}`);
    const deadline = Date.now() + cfg.timeoutSec * 1000;
    for (;;) {
      const st = JSON.parse((await request(`${base}/videos/${sub.id}`, { key, timeoutSec: 60, retries: 2 })).body.toString());
      if (/^(completed|succeeded|done)$/.test(st.status ?? st.state)) break;
      if (/^(failed|error|cancelled|canceled)$/.test(st.status ?? st.state)) throw new Error(st.error?.message ?? `task ${st.status}`);
      if (Date.now() > deadline) throw new Error(`task ${sub.id} still ${st.status} after ${cfg.timeoutSec}s`);
      await sleep(cfg.pollSec);
    }
    return { buf: (await request(`${base}/videos/${sub.id}/content`, { key, timeoutSec: 600, retries: 2 })).body, task: sub.id };
  });
  const dir = join(publicDir, "assets");
  const file = `assets/${item.id}.mp4`;
  const raw = join(dir, `${item.id}.src.mp4`);
  writeFileSync(raw, t.buf);
  let dims;
  try { dims = await cutClip(raw, join(publicDir, file), item.clip); } finally { rmSync(raw, { force: true }); }
  await clipFrames(join(publicDir, file), join(publicDir, framesDir(file)));
  return { ...item, file, kind: "video", via: "generate", license: "generated", author: t.model, title: item.title ?? cfg.prompt.slice(0, 80), ...dims, fetchedAt: new Date().toISOString() };
}

export const assetFileExists = (publicDir, item) => Boolean(item.file) && existsSync(join(publicDir, item.file));

// Frames between depth maps of a clip: every 2nd only where a footage title is cut out behind the
// subject; dives, word dodging and scrims sample a few moments, so every 8th does.
export function depthStep(storyboard, id) {
  if (!storyboard) return 2;
  return storyboard.scenes.some((s) => s.type === "footage" && s.props?.asset === id && s.props?.title?.behind) ? 2 : 8;
}
