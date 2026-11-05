import React from "react";
import { Img, staticFile, useVideoConfig } from "remotion";
import { useLayout, useScene, useTheme, useTime, useTimeline } from "../engine/context";
import { clamp01, easeInOut, easeOut, easeOutBack, lerp } from "../engine/motion";
import { fmtCount } from "../engine/format";
import type { Format } from "../engine/types";
import { MotionBlur } from "../components/MotionBlur";

// Infinite canvas: one world of items (in layout units, 1u = 1px at 1080 on the short edge) that a
// continuous camera flies across. Items enter, then morph — a stat card can become a bar, a dot can
// grow into a card — so the eye follows one object instead of reading a new slide.
// Times (`t`) are compiled from `at`/`cue`; a scene with `inherit` starts from the previous canvas.

type Kind = "stat" | "text" | "bar" | "dot" | "image";
type State = {
  type?: Kind; x?: number; y?: number; w?: number; h?: number; radius?: number; color?: string; opacity?: number;
  value?: number; max?: number; label?: string; text?: string; size?: number; asset?: string; format?: Format;
};
type Item = State & { id: string; t?: number; settled?: boolean; morph?: (State & { t?: number; dur?: number })[] };
type Focus = string | string[] | { x: number; y: number };
type Stop = { t?: number; focus?: Focus; zoom?: number; cut?: boolean; fly?: number };
type Link = { from: string; to: string; t?: number; color?: string; dashed?: boolean };
type Cam = { x: number; y: number; zoom: number };

const NUM: (keyof State)[] = ["x", "y", "w", "h", "radius", "opacity", "value", "max", "size"];
const DEFAULTS: Record<Kind, Partial<State>> = {
  stat: { w: 520, h: 300 }, text: { w: 900, h: 140 }, bar: { w: 760, h: 120 }, dot: { w: 60, h: 60 }, image: { w: 640, h: 400 },
};

const hex = (c: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
};
function mixColor(a: string, b: string, p: number) {
  const x = hex(a), y = hex(b);
  if (!x || !y) return p < 0.5 ? a : b;
  return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], p))).join(",")})`;
}

// The item's state at time t: base, then each due morph blended in over its `dur`.
// `prev` is the content it is morphing away from, for the crossfade.
export function itemAt(it: Item, t: number): { s: State; prev: State | null; p: number } {
  const base = { ...DEFAULTS[it.type ?? "stat"], ...it } as State;
  let s: State = base, prev: State | null = null, p = 1;
  for (const m of it.morph ?? []) {
    const mt = m.t ?? 0;
    if (t < mt) break;
    const k = easeInOut(clamp01((t - mt) / (m.dur ?? 0.8)));
    const target = { ...s, ...(m.type && m.type !== s.type ? DEFAULTS[m.type] : {}), ...m } as State;
    const next: State = { ...target };
    for (const key of NUM) {
      const a = s[key] as number | undefined, b = target[key] as number | undefined;
      if (a !== undefined && b !== undefined) (next as any)[key] = lerp(a, b, k);
    }
    if (s.color && target.color) next.color = mixColor(s.color, target.color, k);
    prev = k < 1 ? s : null;
    p = k;
    s = next;
  }
  return { s, prev, p };
}

function focusOf(f: Focus | undefined, items: Item[], t: number, screen: { w: number; h: number }, zoom?: number): Cam {
  const boxes = (Array.isArray(f) ? f : typeof f === "string" ? [f] : [])
    .map((id) => items.find((it) => it.id === id))
    .filter((it): it is Item => Boolean(it))
    .map((it) => itemAt(it, t).s);
  if (!boxes.length) {
    const c = f && typeof f === "object" && !Array.isArray(f) ? f : { x: screen.w / 2, y: screen.h / 2 };
    return { x: c.x, y: c.y, zoom: zoom ?? 1 };
  }
  const x0 = Math.min(...boxes.map((b) => b.x! - b.w! / 2)), x1 = Math.max(...boxes.map((b) => b.x! + b.w! / 2));
  const y0 = Math.min(...boxes.map((b) => b.y! - b.h! / 2)), y1 = Math.max(...boxes.map((b) => b.y! + b.h! / 2));
  const fit = Math.min((screen.w * 0.62) / (x1 - x0), (screen.h * 0.62) / (y1 - y0));
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: zoom ?? Math.min(2.5, Math.max(0.35, fit)) };
}

// Camera along the path: cut = jump, otherwise fly in `fly` s with an easeInOut, pulling back
// (zoom dip) on long hops so the viewer sees where it is going.
export function cameraAt(path: Stop[], items: Item[], t: number, screen: { w: number; h: number }): Cam {
  let cam: Cam = { x: screen.w / 2, y: screen.h / 2, zoom: 1 };
  for (const [i, st] of path.entries()) {
    const st0 = st.t ?? 0;
    if (t < st0 && i > 0) break;
    // Track the target as it is when the move ends, so a morphing item lands centred.
    const to = focusOf(st.focus, items, st0 + (st.fly ?? 0.9), screen, st.zoom);
    if (st.cut || i === 0) { cam = to; continue; }
    const p = easeInOut(clamp01((t - st0) / Math.max(0.05, st.fly ?? 0.9)));
    const hop = Math.hypot(to.x - cam.x, to.y - cam.y) / Math.hypot(screen.w, screen.h);
    const dip = 1 - Math.min(0.45, hop * 0.6) * Math.sin(Math.PI * p);
    cam = {
      x: lerp(cam.x, to.x, p), y: lerp(cam.y, to.y, p),
      zoom: Math.exp(lerp(Math.log(cam.zoom), Math.log(to.zoom), p)) * dip,
    };
  }
  return cam;
}

const Content: React.FC<{ s: State; scale: number; theme: ReturnType<typeof useTheme>; t: number; enter: number }> = ({ s, scale, theme, t, enter }) => {
  const tl = useTimeline();
  const color = s.color ?? theme.colors.accent;
  const fs = (n: number) => n * scale;
  switch (s.type) {
    case "text":
      return <div style={{ fontSize: fs(s.size ?? 88), fontWeight: 800, color: s.color ?? theme.colors.text, lineHeight: 1.1, textAlign: "center", whiteSpace: "pre-wrap" }}>{s.text}</div>;
    case "dot":
      return <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: color, boxShadow: `0 0 ${fs(40)}px ${color}` }} />;
    case "image": {
      const a = s.asset ? tl.assets[s.asset] : null;
      return a ? <Img src={staticFile(a.src)} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: fs(s.radius ?? theme.radius) }} /> : null;
    }
    case "bar": {
      const fill = clamp01((s.value ?? 0) / (s.max || s.value || 1)) * easeOut((t - enter) / 0.9);
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: fs(10), padding: `0 ${fs(28)}px` }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: fs(30), color: theme.colors.muted }}>
            <span>{s.label}</span>
            <span style={{ fontFamily: theme.fonts.number, fontWeight: 800, color }}>{fmtCount(s.value ?? 0, s.value ?? 0, s.format)}</span>
          </div>
          <div style={{ height: fs(26), borderRadius: fs(13), background: theme.colors.border, overflow: "hidden" }}>
            <div style={{ width: `${fill * 100}%`, height: "100%", background: color, borderRadius: fs(13) }} />
          </div>
        </div>
      );
    }
    default:
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: `0 ${fs(40)}px` }}>
          {s.label && <div style={{ fontSize: fs(30), color: theme.colors.muted }}>{s.label}</div>}
          <div style={{ fontFamily: theme.fonts.number, fontSize: fs(s.size ?? 110), fontWeight: 800, color, lineHeight: 1.05, whiteSpace: "nowrap" }}>
            {fmtCount(s.value ?? 0, s.value ?? 0, s.format)}
          </div>
        </div>
      );
  }
};

const boxed = (k?: Kind) => k === "stat" || k === "bar";

export const CanvasScene: React.FC<{ items?: Item[]; path?: Stop[]; links?: Link[]; inherit?: boolean }> = ({ items = [], path = [], links = [] }) => {
  const theme = useTheme();
  const scene = useScene();
  const { fps } = useVideoConfig();
  const { width, height, u } = useLayout();
  const t = useTime();
  const screen = { w: width / u, h: height / u };
  const cam = cameraAt(path, items, t, screen);
  const before = cameraAt(path, items, t - 1 / fps, screen);
  const jumped = path.some((st, i) => i > 0 && st.cut && (st.t ?? 0) > t - 1 / fps && (st.t ?? 0) <= t);
  const k = cam.zoom * u;
  const toScreen = (x: number, y: number) => ({ x: (x - cam.x) * k + width / 2, y: (y - cam.y) * k + height / 2 });
  const vx = jumped ? 0 : (cam.x - before.x) * k, vy = jumped ? 0 : (cam.y - before.y) * k;
  const radial = jumped ? 0 : (Math.abs(cam.zoom - before.zoom) / cam.zoom) * Math.hypot(width, height) * 0.5;

  // Counting: a stat counts from 0 when it enters; a morph's value change already interpolates.
  const shown = items.map((it) => {
    const enter = it.t ?? 0;
    const { s, prev, p } = itemAt(it, t);
    const e = it.settled ? 1 : clamp01((t - enter) / 0.5);
    const count = it.settled || (it.morph ?? []).some((m) => (m.t ?? 0) <= t) ? 1 : easeOut((t - enter) / 1.1);
    return { it, s: { ...s, value: s.value !== undefined ? s.value * count : undefined }, prev, p, e, enter };
  });
  const pos = new Map(shown.map((x) => [x.it.id, x]));

  return (
    <MotionBlur id={`${scene.id}-canvas`} vx={vx} vy={vy} radial={radial}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {links.map((l, i) => {
          const a = pos.get(l.from), b = pos.get(l.to);
          if (!a || !b || t < (l.t ?? 0)) return null;
          const p = easeInOut((t - (l.t ?? 0)) / 0.7) * Math.min(a.e, b.e);
          const A = toScreen(a.s.x!, a.s.y!), B = toScreen(b.s.x!, b.s.y!);
          const len = Math.hypot(B.x - A.x, B.y - A.y);
          return (
            <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={l.color ?? theme.colors.muted} strokeWidth={4 * k} strokeLinecap="round"
              strokeDasharray={l.dashed ? `${12 * k} ${12 * k}` : `${len} ${len}`} strokeDashoffset={l.dashed ? 0 : len * (1 - p)} opacity={l.dashed ? p : 0.8} />
          );
        })}
      </svg>
      {shown.map(({ it, s, prev, p, e, enter }) => {
        if (e <= 0) return null;
        const c = toScreen(s.x!, s.y!);
        const w = s.w! * k, h = s.h! * k;
        if (c.x + w / 2 < -width * 0.2 || c.x - w / 2 > width * 1.2 || c.y + h / 2 < -height * 0.2 || c.y - h / 2 > height * 1.2) return null;
        const pop = it.settled ? 1 : lerp(0.82, 1, easeOutBack(e));
        const card = boxed(s.type) || (prev && boxed(prev.type));
        const cardO = boxed(s.type) ? (prev && !boxed(prev.type) ? p : 1) : prev && boxed(prev.type) ? 1 - p : 0;
        const accent = s.color ?? theme.colors.accent;
        return (
          <div key={it.id} style={{
            position: "absolute", left: c.x - w / 2, top: c.y - h / 2, width: w, height: h,
            transform: `scale(${pop})`, opacity: e * (s.opacity ?? 1),
          }}>
            {card && (
              <div style={{
                position: "absolute", inset: 0, opacity: cardO, background: theme.colors.surface, border: `${Math.max(1, 2 * k)}px solid ${theme.colors.border}`,
                borderRadius: (s.radius ?? theme.radius) * k, boxShadow: `inset ${6 * k}px 0 0 ${accent}`,
              }} />
            )}
            {prev && (
              <div style={{ position: "absolute", inset: 0, opacity: 1 - p, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Content s={{ ...prev, w: s.w, h: s.h }} scale={k} theme={theme} t={t} enter={enter} />
              </div>
            )}
            <div style={{ position: "absolute", inset: 0, opacity: prev ? p : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Content s={s} scale={k} theme={theme} t={t} enter={prev ? t - 0.9 * p : it.settled ? -99 : enter} />
            </div>
          </div>
        );
      })}
    </MotionBlur>
  );
};
