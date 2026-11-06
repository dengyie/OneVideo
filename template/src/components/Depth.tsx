import React, { useLayoutEffect, useRef, useState } from "react";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";
import type { Asset } from "../engine/types";
import { seqIndex } from "./Media";

// Depth-driven effects drawn on a 2D canvas in plain JS (no WebGL: the render node has no GPU):
// a 2.5D parallax warp of a photo, and a foreground cut-out so text can sit behind the subject.
// Pixels are read once per source image and cached; every frame waits for its images via
// delayRender, so renders stay deterministic.

type Pixels = { w: number; h: number; data: Uint8ClampedArray };
const cache = new Map<string, Promise<Pixels>>();

// Decode an image to w×h RGBA, cropped like object-fit: cover so a depth map or a cut-out lines
// up with the <Img> it accompanies.
function load(src: string, w: number, h: number): Promise<Pixels> {
  const key = `${src}@${w}x${h}`;
  let p = cache.get(key);
  if (!p) {
    p = new Promise<Pixels>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const sw = w / k, sh = h / k;
        g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
        resolve({ w, h, data: g.getImageData(0, 0, w, h).data });
      };
      img.onerror = () => reject(new Error(`could not load ${src}`));
      img.src = src;
    });
    cache.set(key, p);
    // Video frames stream through: keep the cache small.
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
  }
  return p;
}

// Pixels for the current sources, or null while loading. The frame is held (delayRender) until
// the caller has drawn them and calls `drawn()`.
function usePixels(srcs: [string, number, number][]): { px: Pixels[] | null; drawn: () => void } {
  const key = srcs.map((s) => s.join("|")).join(",");
  const [state, setState] = useState<{ key: string; px: Pixels[] } | null>(null);
  const pending = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (state?.key === key) return;
    const id = delayRender(`depth pixels ${key.slice(0, 80)}`);
    pending.current = id;
    let live = true;
    Promise.all(srcs.map(([s, w, h]) => load(s, w, h)))
      .then((px) => { if (live) setState({ key, px }); else continueRender(id); })
      .catch((e) => cancelRender(e));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const drawn = () => {
    if (pending.current !== null) { continueRender(pending.current); pending.current = null; }
  };
  return { px: state?.key === key ? state.px : null, drawn };
}

// Depth map that goes with an asset at source time s (video depth runs every `depthStep` frames).
export function depthSrc(a: Asset, s = 0): string | null {
  if (!a.depth) return null;
  if (a.kind !== "video") return staticFile(a.depth);
  const step = a.depthStep ?? 2;
  const i = Math.min(a.depthFrames ?? 1, Math.max(1, Math.floor((seqIndex(a, s) - 1) / step) + 1));
  return staticFile(`${a.depth}/${String(i).padStart(4, "0")}.png`);
}

// Synthetic depth for photos without a map: the bottom of the frame is near, the top far.
function gradientDepth(w: number, h: number): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = Math.round(255 * Math.min(1, Math.max(0, (y / h - 0.25) / 0.75)));
    for (let x = 0; x < w; x++) data[(y * w + x) * 4] = v;
  }
  return { w, h, data };
}

export type ParallaxMove = { dx: number; dy: number; zoom: number; focus: number };

// Backward warp: each output pixel reads the photo at a position shifted by its own depth, so near
// pixels travel further than far ones. `dx/dy` are px at full depth, `zoom` a dolly (near grows
// faster), `focus` the depth (0–1) that stays put. 6% overscan hides the stretched border.
export const ParallaxCanvas: React.FC<{ photo: string; depth: string | null; width: number; height: number; move: ParallaxMove; style?: React.CSSProperties }> = ({
  photo, depth, width, height, move, style,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = Math.round(width / 2), H = Math.round(height / 2);
  const { px, drawn } = usePixels(depth ? [[photo, width, height], [depth, W, H]] : [[photo, width, height]]);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !px) return;
    const [src, dm0] = px;
    const dm = dm0 ?? gradientDepth(W, H);
    const g = c.getContext("2d")!;
    const out = g.createImageData(width, height);
    const o = out.data, s = src.data, d = dm.data;
    const cx = width / 2, cy = height / 2, over = 1.06;
    for (let y = 0; y < height; y++) {
      const dy0 = Math.min(H - 1, y >> 1) * W;
      for (let x = 0; x < width; x++) {
        const z = d[(dy0 + Math.min(W - 1, x >> 1)) * 4] / 255 - move.focus;
        const k = over * (1 + move.zoom * z);
        let sx = cx + (x - cx - move.dx * z) / k;
        let sy = cy + (y - cy - move.dy * z) / k;
        sx = sx < 0 ? 0 : sx > width - 1.001 ? width - 1.001 : sx;
        sy = sy < 0 ? 0 : sy > height - 1.001 ? height - 1.001 : sy;
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * width + x0) * 4, i10 = i00 + 4, i01 = i00 + width * 4, i11 = i01 + 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        const j = (y * width + x) * 4;
        o[j] = s[i00] * w00 + s[i10] * w10 + s[i01] * w01 + s[i11] * w11;
        o[j + 1] = s[i00 + 1] * w00 + s[i10 + 1] * w10 + s[i01 + 1] * w01 + s[i11 + 1] * w11;
        o[j + 2] = s[i00 + 2] * w00 + s[i10 + 2] * w10 + s[i01 + 2] * w01 + s[i11 + 2] * w11;
        o[j + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
    drawn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px, move.dx, move.dy, move.zoom, move.focus, width, height, W, H]);
  return <canvas ref={ref} width={width} height={height} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", ...style }} />;
};

export type Matte = { mode?: "subject" | "near"; threshold?: number; soft?: number };

// The depth that best splits a frame into near and far (Otsu on a 64-bin histogram).
export function nearSplit(v: Float32Array): number {
  const bins = new Float64Array(64);
  for (let i = 0; i < v.length; i++) bins[Math.min(63, Math.floor(v[i] * 64))]++;
  let total = 0;
  for (let b = 0; b < 64; b++) total += b * bins[b];
  let wB = 0, sumB = 0, best = 0, cut = 32;
  for (let b = 0; b < 64; b++) {
    wB += bins[b];
    if (!wB || wB === v.length) continue;
    sumB += b * bins[b];
    const wF = v.length - wB, mB = sumB / wB, mF = (total - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; cut = b; }
  }
  return (cut + 1) / 64;
}

// The photo again, kept only where the matte says "subject", drawn above the text layer.
// "subject": nearer than its surroundings (depth minus a wide blur of itself), which isolates a
// rocket from the sea it stands on; "near": absolute depth above the threshold (default: the
// frame's own near/far split), which keeps a person who fills the frame whole.
export const ForegroundCut: React.FC<{ photo: string; depth: string; width: number; height: number; matte?: Matte; style?: React.CSSProperties }> = ({
  photo, depth, width, height, matte = {}, style,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = Math.round(width / 4), H = Math.round(height / 4);
  const { px, drawn } = usePixels([[photo, width, height], [depth, W, H]]);
  const { mode = "subject", threshold: given, soft = 0.06 } = matte;
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !px) return;
    const [src, dm] = px;
    const d = dm.data;
    const v = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) v[i] = d[i * 4] / 255;
    let m = v;
    if (mode === "subject") {
      // Wide separable box blur (radius ~1/8 of the frame) = the local background depth.
      const r = Math.max(2, Math.round(W / 8));
      const tmp = new Float32Array(W * H), bg = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) { s += v[y * W + k]; n++; }
        tmp[y * W + x] = s / n;
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) { s += tmp[k * W + x]; n++; }
        bg[y * W + x] = s / n;
      }
      m = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) m[i] = v[i] - bg[i];
    }
    const threshold = given ?? (mode === "subject" ? 0.12 : nearSplit(v));
    const mask = document.createElement("canvas");
    mask.width = W; mask.height = H;
    const mg = mask.getContext("2d")!;
    const md = mg.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const a = Math.min(1, Math.max(0, (m[i] - threshold) / soft + 0.5));
      md.data[i * 4 + 3] = Math.round(a * 255);
    }
    mg.putImageData(md, 0, 0);
    const g = c.getContext("2d")!;
    g.globalCompositeOperation = "source-over";
    g.putImageData(new ImageData(new Uint8ClampedArray(src.data), width, height), 0, 0);
    g.globalCompositeOperation = "destination-in";
    g.imageSmoothingEnabled = true;
    g.filter = "blur(1.5px)";
    g.drawImage(mask, 0, 0, width, height);
    g.filter = "none";
    g.globalCompositeOperation = "source-over";
    drawn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px, mode, given, soft, width, height, W, H]);
  return <canvas ref={ref} width={width} height={height} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", ...style }} />;
};
