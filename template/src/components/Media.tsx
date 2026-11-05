import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile } from "remotion";
import { useLayout, useScene, useTheme, useTime, useTimeline } from "../engine/context";

export type Motion = "in" | "out" | "left" | "right" | "up" | "none";

// Full-bleed image/video with a slow Ken Burns move over the scene length.
export const MediaFill: React.FC<{ asset: string; motion?: Motion; fit?: "cover" | "contain"; dim?: number; startFrom?: number; muted?: boolean }> = ({
  asset, motion = "in", fit = "cover", dim = 0.35, startFrom = 0, muted = true,
}) => {
  const tl = useTimeline();
  const scene = useScene();
  const theme = useTheme();
  const t = useTime();
  const a = tl.assets[asset];
  if (!a) throw new Error(`asset "${asset}" not in timeline.assets`);
  const p = Math.min(1, t / Math.max(1, scene.duration));
  const z = 0.08;
  const tf =
    motion === "in" ? `scale(${1 + z * p})` :
    motion === "out" ? `scale(${1 + z * (1 - p)})` :
    motion === "left" ? `scale(${1 + z}) translateX(${(0.5 - p) * z * 50}%)` :
    motion === "right" ? `scale(${1 + z}) translateX(${(p - 0.5) * z * 50}%)` :
    motion === "up" ? `scale(${1 + z}) translateY(${(0.5 - p) * z * 50}%)` : "none";
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: fit, transform: tf };
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg, overflow: "hidden" }}>
      {a.kind === "video"
        ? <OffthreadVideo src={staticFile(a.src)} style={style} muted={muted} startFrom={Math.round(startFrom * tl.fps)} />
        : <Img src={staticFile(a.src)} style={style} />}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${dim * 0.6}) 0%, rgba(0,0,0,${dim}) 60%, rgba(0,0,0,${Math.min(0.9, dim + 0.3)}) 100%)` }} />
    </AbsoluteFill>
  );
};

export const Credit: React.FC<{ asset: string }> = ({ asset }) => {
  const tl = useTimeline();
  const { u, pad, portrait } = useLayout();
  const c = tl.assets[asset]?.credit;
  if (!c) return null;
  return (
    <div style={{ position: "absolute", left: pad, top: (portrait ? 64 : 24) * u, fontSize: 16 * u, color: "rgba(255,255,255,0.6)", textShadow: "0 1px 3px rgba(0,0,0,0.8)", maxWidth: "60%" }}>
      {c}
    </div>
  );
};
