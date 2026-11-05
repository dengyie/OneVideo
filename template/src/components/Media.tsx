import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { useLayout, useScene, useTheme, useTime, useTimeline } from "../engine/context";
import type { Asset } from "../engine/types";

// A video clip: its JPEG sequence frame by frame when extracted (light, deterministic), otherwise
// <OffthreadVideo>. Holds the last frame once the clip runs out. `startFrom` is in seconds.
export const ClipVideo: React.FC<{ a: Asset; style: React.CSSProperties; startFrom?: number; muted?: boolean }> = ({ a, style, startFrom = 0, muted = true }) => {
  const frame = useCurrentFrame();
  const tl = useTimeline();
  if (a.seq && a.frames) {
    const i = Math.min(a.frames, Math.max(1, Math.floor((startFrom + frame / tl.fps) * (a.fps ?? 30)) + 1));
    return <Img src={staticFile(`${a.seq}/${String(i).padStart(4, "0")}.jpg`)} style={style} />;
  }
  return <OffthreadVideo src={staticFile(a.src)} style={style} muted={muted} startFrom={Math.round(startFrom * tl.fps)} />;
};

export type Motion = "in" | "out" | "left" | "right" | "up" | "none";

// Full-bleed image/video with a slow Ken Burns move over the scene length.
export const MediaFill: React.FC<{ asset: string; motion?: Motion; fit?: "cover" | "contain"; dim?: number; blur?: number; startFrom?: number; muted?: boolean }> = ({
  asset, motion = "in", fit = "cover", dim = 0.35, blur = 0, startFrom = 0, muted = true,
}) => {
  const tl = useTimeline();
  const scene = useScene();
  const theme = useTheme();
  const t = useTime();
  const { u } = useLayout();
  const a = tl.assets[asset];
  if (!a) throw new Error(`asset "${asset}" not in timeline.assets`);
  const p = Math.max(0, Math.min(1, t / Math.max(1, scene.duration)));
  const z = 0.05; // 5% travel over the scene (references/motion-rules.md: 3–6%)
  const tf =
    motion === "in" ? `scale(${1 + z * p})` :
    motion === "out" ? `scale(${1 + z * (1 - p)})` :
    motion === "left" ? `scale(${1 + z}) translateX(${(0.5 - p) * z * 50}%)` :
    motion === "right" ? `scale(${1 + z}) translateX(${(p - 0.5) * z * 50}%)` :
    motion === "up" ? `scale(${1 + z}) translateY(${(0.5 - p) * z * 50}%)` : "none";
  // A blurred backdrop is scaled a little more so the soft edge never shows.
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: fit, transform: blur > 0 ? `${tf === "none" ? "" : tf} scale(1.06)` : tf, filter: blur > 0 ? `blur(${blur * u}px)` : undefined };
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg, overflow: "hidden" }}>
      {a.kind === "video"
        ? <ClipVideo a={a} style={style} startFrom={startFrom} muted={muted} />
        : <Img src={staticFile(a.src)} style={style} />}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${dim * 0.6}) 0%, rgba(0,0,0,${dim}) 60%, rgba(0,0,0,${Math.min(0.9, dim + 0.3)}) 100%)` }} />
    </AbsoluteFill>
  );
};

export const Credit: React.FC<{ asset: string; corner?: "top-left" | "bottom-right" }> = ({ asset, corner = "top-left" }) => {
  const tl = useTimeline();
  const { u, pad, portrait } = useLayout();
  const c = tl.assets[asset]?.credit;
  if (!c) return null;
  // bottom-right sits under the caption band, clear of the header and the watermark.
  const place: React.CSSProperties = corner === "bottom-right"
    ? { right: pad, bottom: (portrait ? 40 : 12) * u, fontSize: 14 * u, textAlign: "right" }
    : { left: pad, top: (portrait ? 64 : 24) * u, fontSize: 16 * u };
  return (
    <div style={{ position: "absolute", ...place, color: "rgba(255,255,255,0.6)", textShadow: "0 1px 3px rgba(0,0,0,0.8)", maxWidth: "60%" }}>
      {c}
    </div>
  );
};
