// Licensed media sourcing. Keyless providers: NASA Images, Wikimedia Commons, Openverse.
// Optional: Pexels (PEXELS_API_KEY, photos + video) and AI image generation (OpenAI-compatible relay).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getJson, download, request, requireApiKey } from "./http.mjs";

const stripHtml = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const enc = encodeURIComponent;

export const PROVIDERS = {
  async nasa(query, { limit = 12 } = {}) {
    const j = await getJson(`https://images-api.nasa.gov/search?q=${enc(query)}&media_type=image&page_size=${limit}`);
    return (j.collection?.items ?? []).slice(0, limit).map((it) => {
      const d = it.data?.[0] ?? {};
      return {
        provider: "nasa", pid: d.nasa_id, kind: "image", title: d.title, author: d.photographer || d.secondary_creator || d.center || "NASA",
        license: "PD (NASA)", source: `https://images.nasa.gov/details/${enc(d.nasa_id)}`, preview: it.links?.[0]?.href, width: null, height: null,
        date: d.date_created?.slice(0, 10),
      };
    });
  },
  async wikimedia(query, { limit = 12 } = {}) {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${enc(`${query} filetype:bitmap`)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=2400`;
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

export const DEFAULT_PROVIDER_ORDER = ["nasa", "wikimedia", "openverse"];

// NASA search results only carry thumbnails; the asset manifest lists the full renditions.
async function nasaFullUrl(nasaId) {
  const j = await getJson(`https://images-api.nasa.gov/asset/${enc(nasaId)}`);
  const hrefs = (j.collection?.items ?? []).map((i) => i.href).filter((h) => /\.(jpe?g|png)$/i.test(h));
  return hrefs.find((h) => /~large\./.test(h)) ?? hrefs.find((h) => /~orig\./.test(h)) ?? hrefs.find((h) => /~medium\./.test(h)) ?? hrefs[0];
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
export async function fetchAsset(item, { publicDir, aspect = 16 / 9, imageDefaults = {} }) {
  const dir = join(publicDir, "assets");
  mkdirSync(dir, { recursive: true });

  if (item.generate) return generateImage(item, { dir, defaults: imageDefaults });

  let chosen = null;
  if (item.url) chosen = { url: item.url, license: item.license, author: item.author, title: item.title, source: item.source ?? item.url, provider: "url", kind: item.kind ?? "image" };
  else {
    if (!item.query) throw new Error(`asset "${item.id}" needs one of: url, query, generate`);
    const providers = item.provider ? [].concat(item.provider) : item.kind === "video" ? ["pexels"] : DEFAULT_PROVIDER_ORDER;
    const { results, errors } = await search(item.query, { providers, kind: item.kind ?? "image" });
    const ranked = results.filter((c) => c.kind === (item.kind ?? "image")).sort((a, b) => scoreCandidate(a, aspect) - scoreCandidate(b, aspect));
    chosen = ranked[item.pick ?? 0];
    if (!chosen) throw new Error(`no ${item.kind ?? "image"} results for "${item.query}"${errors.length ? ` (${errors.join("; ")})` : ""}`);
  }
  if (chosen.provider === "nasa") chosen.url = await nasaFullUrl(chosen.pid);
  if (!chosen.url) throw new Error(`asset "${item.id}": candidate has no downloadable URL`);
  const buf = await download(chosen.url);
  const ext = extOf(chosen.url, chosen.kind === "video" ? "mp4" : "jpg");
  const file = `assets/${item.id}.${ext}`;
  writeFileSync(join(publicDir, file), buf);
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
    fetchedAt: new Date().toISOString(),
  };
}

export const IMAGE_DEFAULTS = { baseUrl: "https://api.mangoqwq.com/v1", model: "gpt-image-2.5", size: "1536x1024", keyEnv: "MANGO_API_KEY" };

export async function generateImage(item, { dir, defaults = {} }) {
  const cfg = { ...IMAGE_DEFAULTS, ...defaults, ...(typeof item.generate === "object" ? item.generate : { prompt: item.generate }) };
  if (!cfg.prompt) throw new Error(`asset "${item.id}": generate.prompt is required`);
  const key = requireApiKey(cfg.keyEnv, cfg.baseUrl);
  const res = await request(`${cfg.baseUrl.replace(/\/$/, "")}/images/generations`, { method: "POST", key, json: { model: cfg.model, prompt: cfg.prompt, size: cfg.size, n: 1 }, timeoutSec: 300, retries: 2 });
  const j = JSON.parse(res.body.toString());
  const d = j.data?.[0];
  let buf;
  if (d?.b64_json) buf = Buffer.from(d.b64_json, "base64");
  else if (d?.url) buf = await download(d.url);
  else throw new Error(`image API returned no image: ${res.body.subarray(0, 200).toString()}`);
  const ext = buf[0] === 0x89 ? "png" : buf[0] === 0xff ? "jpg" : "webp";
  const file = `assets/${item.id}.${ext}`;
  writeFileSync(join(dir, `${item.id}.${ext}`), buf);
  return { ...item, file, kind: "image", via: "generate", license: "generated", author: cfg.model, title: item.title ?? cfg.prompt.slice(0, 80), fetchedAt: new Date().toISOString() };
}

export const assetFileExists = (publicDir, item) => Boolean(item.file) && existsSync(join(publicDir, item.file));
