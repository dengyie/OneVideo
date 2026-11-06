// Where a scene's subject sits on its last frame, from the asset's depth map: the centroid of what
// stands out nearest. A "through" transition dives toward it instead of the frame centre.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeGrayPng } from "./qc.mjs";

// Source seconds played by scene time t under a speed ramp; mirrors rampTime() in Media.tsx.
export function rampTime(t, ramp, fps, blend = 0.3) {
  if (!ramp?.length) return t;
  const speedAt = (x) => {
    let v = 1;
    for (const k of ramp) {
      const at = k.t ?? 0;
      if (x < at) break;
      const p = Math.min(1, (x - at) / blend);
      v = v + (k.speed - v) * (p * p * (3 - 2 * p));
    }
    return v;
  };
  let s = 0;
  for (let i = 0, n = Math.round(t * fps); i < n; i++) s += speedAt((i + 0.5) / fps) / fps;
  return s;
}

// Centroid of the nearest `share` of pixels (near = white), weighted by how far past the cut each is.
// Depth is taken relative to its row median first, so a floor or water plane (near at the bottom,
// even across the row) doesn't count; null when nothing stands out by `min`.
export function nearCentroid(px, w, h, share = 0.08, min = 24) {
  const d = new Uint8Array(px.length);
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * w, (y + 1) * w), mid = [...row].sort((a, b) => a - b)[w >> 1];
    for (let x = 0; x < w; x++) d[y * w + x] = Math.max(0, row[x] - mid);
  }
  px = d;
  const hist = new Array(256).fill(0);
  for (const v of px) hist[v]++;
  let top = 255;
  while (top > 0 && !hist[top]) top--;
  if (top < min) return null;
  let thr = 255;
  for (let n = 0; thr > 0 && n + hist[thr] <= px.length * share; thr--) n += hist[thr];
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = px[y * w + x] - thr;
    if (v > 0) { sx += x * v; sy += y * v; sw += v; }
  }
  return sw ? { x: (sx / sw + 0.5) / w, y: (sy / sw + 0.5) / h } : null;
}

// A point of a cover-fitted aw×ah layer, in 0–1 coordinates of the fw×fh frame.
export function coverPoint(p, aw, ah, fw, fh) {
  const k = Math.max(fw / aw, fh / ah);
  return { x: (p.x * aw * k - (aw * k - fw) / 2) / fw, y: (p.y * ah * k - (ah * k - fh) / 2) / fh };
}

// Subject of a compiled scene at its end: { x, y, layer } with x/y in frame coordinates before the
// shot track ("content" for footage/parallax, "backdrop" for a scene's backdrop), or null.
export function subjectFocus(root, scene, assets, fps, fw, fh) {
  const fill = scene.type === "footage" || scene.type === "parallax";
  const id = fill ? scene.props?.asset : scene.backdrop?.asset;
  const a = id && assets[id];
  if (!root || !a?.depth) return null;
  let file = join(root, "public", a.depth);
  if (a.kind === "video") {
    const start = (fill ? scene.props.startFrom : scene.backdrop.startFrom) ?? 0;
    const s = start + (scene.type === "footage" ? rampTime(scene.duration, scene.props.ramp, fps) : scene.duration);
    const frame = Math.min(a.frames ?? Infinity, Math.max(1, Math.floor(s * (a.fps ?? 30)) + 1));
    const i = Math.min(a.depthFrames ?? 1, Math.max(1, Math.floor((frame - 1) / (a.depthStep ?? 2)) + 1));
    file = join(file, `${String(i).padStart(4, "0")}.png`);
  }
  if (!existsSync(file)) return null;
  const { width: w, height: h, pixels: px } = decodeGrayPng(readFileSync(file));
  const c = nearCentroid(px, w, h);
  if (!c) return null;
  // Pull 15% toward the centre and keep off the edges: the dive should still read as forward.
  const p = coverPoint(c, w, h, fw, fh);
  const keep = (v) => Math.round(Math.min(0.85, Math.max(0.15, 0.5 + (v - 0.5) * 0.85)) * 1000) / 1000;
  return { x: keep(p.x), y: keep(p.y), layer: fill ? "content" : "backdrop" };
}
