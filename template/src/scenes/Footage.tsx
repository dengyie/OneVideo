import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { useLayout, useScene, useTheme, useTime, useTimeline } from "../engine/context";
import { clamp01, easeInOut, easeOut, lerp } from "../engine/motion";
import { ClipVideo, rampTime, seqSrc, type Ramp } from "../components/Media";
import { depthSrc, ForegroundCut, ParallaxCanvas, type Matte, type ParallaxMove } from "../components/Depth";

// Big title over footage. With `behind` and a depth map the subject is cut out and drawn again
// on top, so the title sits between the subject and the world behind it.
type Title = { text: string; t?: number; x?: number; y?: number; size?: number; color?: string; kicker?: string; behind?: boolean; matte?: Matte; style?: "rise" | "slam"; duration?: number };

const TitleText: React.FC<{ title: Title }> = ({ title }) => {
  const theme = useTheme();
  const { u, width, height } = useLayout();
  const t = useTime();
  const local = t - (title.t ?? 0.2);
  if (local < 0) return null;
  const gone = title.duration !== undefined ? clamp01((local - title.duration) / 0.3) : 0;
  if (gone >= 1) return null;
  const size = (title.size ?? 260) * u;
  const slam = title.style === "slam";
  const p = slam ? clamp01(local / 0.25) : easeOut(local / 0.7);
  const k = easeOut(clamp01((local - 0.25) / 0.5));
  return (
    <div style={{ position: "absolute", left: (title.x ?? 0.5) * width, top: (title.y ?? 0.42) * height, transform: "translate(-50%, -50%)", textAlign: "center", opacity: 1 - gone }}>
      {title.kicker && <div style={{ fontSize: size * 0.16, fontWeight: 700, letterSpacing: size * 0.04, whiteSpace: "nowrap", color: theme.colors.highlight, opacity: k, marginBottom: size * 0.04 }}>{title.kicker}</div>}
      <div style={{ overflow: slam ? "visible" : "hidden" }}>
        <div style={{
          fontSize: size, fontWeight: 900, lineHeight: 0.95, whiteSpace: "nowrap", letterSpacing: -0.03 * size, color: title.color ?? "#fff",
          transform: slam ? `scale(${lerp(1.5, 1, easeOut(p))})` : `translateY(${(1 - p) * 100}%)`, opacity: slam ? Math.min(1, p * 3) : 1,
          filter: slam && p < 1 ? `blur(${(1 - p) * 0.05 * size}px)` : undefined,
        }}>{title.text}</div>
      </div>
    </div>
  );
};

// ── footage ──────────────────────────────────────────────────────────────────
// Footage as the hero: full-bleed, light grade, speed ramps (slow-mo on the key moment, then
// back up to speed), optional title behind the subject. Punch-ins come from the scene's shots.

export const FootageScene: React.FC<{ asset: string; startFrom?: number; ramp?: Ramp; dim?: number; title?: Title; tint?: string }> = ({
  asset, startFrom = 0, ramp, dim = 0.12, title, tint,
}) => {
  const tl = useTimeline();
  const { width, height } = useVideoConfig();
  const t = useTime();
  const a = tl.assets[asset];
  if (!a) throw new Error(`asset "${asset}" not in timeline.assets`);
  const s = startFrom + rampTime(Math.max(0, t), ramp, tl.fps);
  const style: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" };
  const photo = a.kind === "video" ? (a.seq ? seqSrc(a, s) : null) : staticFile(a.src);
  const depth = depthSrc(a, s);
  const local = t - (title?.t ?? 0.2);
  const cut = title?.behind && photo && depth && local >= 0 && (title.duration === undefined || local < title.duration + 0.3);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {a.kind === "video" ? <ClipVideo a={a} style={style} time={s} /> : <Img src={staticFile(a.src)} style={style} />}
      {tint && <AbsoluteFill style={{ background: tint, mixBlendMode: "soft-light" }} />}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${dim * 0.5}) 0%, rgba(0,0,0,${dim}) 55%, rgba(0,0,0,${Math.min(0.85, dim + 0.35)}) 100%)` }} />
      {title && <TitleText title={title} />}
      {cut && <ForegroundCut photo={photo} depth={depth} width={width} height={height} matte={title.matte} />}
    </AbsoluteFill>
  );
};

// ── parallax ─────────────────────────────────────────────────────────────────
// A still photo given 2.5D depth: near pixels travel further than far ones as the camera dollies,
// trucks or cranes. Uses the asset's depth map (onevideo depth), else a ground-plane gradient.

type Move = "dolly-in" | "dolly-out" | "truck-left" | "truck-right" | "crane-up" | "orbit";

export function parallaxMove(move: Move, k: number, amount: number, w: number, h: number): ParallaxMove {
  const e = easeInOut(k);
  switch (move) {
    case "dolly-out": return { dx: 0, dy: 0, zoom: 0.22 * amount * (1 - e), focus: 0.15 };
    case "truck-left": return { dx: (e - 0.5) * 0.07 * w * amount, dy: 0, zoom: 0.04 * amount, focus: 0.45 };
    case "truck-right": return { dx: (0.5 - e) * 0.07 * w * amount, dy: 0, zoom: 0.04 * amount, focus: 0.45 };
    case "crane-up": return { dx: 0, dy: (e - 0.5) * 0.06 * h * amount, zoom: 0.04 * amount, focus: 0.45 };
    case "orbit": return { dx: Math.sin((e - 0.5) * Math.PI) * 0.05 * w * amount, dy: 0, zoom: 0.08 * amount * e, focus: 0.4 };
    default: return { dx: 0, dy: 0, zoom: 0.22 * amount * e, focus: 0.15 };
  }
}

export const ParallaxScene: React.FC<{ asset: string; move?: Move; amount?: number; dim?: number; title?: Title }> = ({
  asset, move = "dolly-in", amount = 1, dim = 0.12, title,
}) => {
  const tl = useTimeline();
  const scene = useScene();
  const { width, height } = useVideoConfig();
  const t = useTime();
  const a = tl.assets[asset];
  if (!a) throw new Error(`asset "${asset}" not in timeline.assets`);
  if (a.kind !== "image") throw new Error(`parallax scene "${scene.id}" needs an image asset, got ${a.kind}`);
  // Quantize the move to 1/1000 so near-identical frames share a cached warp.
  const k = Math.round(clamp01((t + 0.3) / (scene.duration + 0.6)) * 1000) / 1000;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <ParallaxCanvas photo={staticFile(a.src)} depth={a.depth ? staticFile(a.depth) : null} width={width} height={height} move={parallaxMove(move, k, amount, width, height)} />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${dim * 0.5}) 0%, rgba(0,0,0,${dim}) 55%, rgba(0,0,0,${Math.min(0.85, dim + 0.35)}) 100%)` }} />
      {title && <TitleText title={{ ...title, behind: false }} />}
    </AbsoluteFill>
  );
};
