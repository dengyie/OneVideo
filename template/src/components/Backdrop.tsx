import React, { useMemo } from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";
import { useTheme } from "../engine/context";
import type { Background } from "../engine/types";

const Stars: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const stars = useMemo(
    () =>
      Array.from({ length: Math.round((width * height) / 15000) }, (_, i) => ({
        x: random(`x${i}`) * width,
        y: random(`y${i}`) * height,
        r: 0.6 + random(`r${i}`) * 1.6,
        p: random(`p${i}`) * Math.PI * 2,
        s: 0.05 + random(`s${i}`) * 0.25,
      })),
    [width, height],
  );
  return (
    <svg width={width} height={height} style={{ position: "absolute" }}>
      {stars.map((s, i) => (
        <circle key={i} cx={(s.x - frame * s.s + width * 10) % width} cy={s.y} r={s.r} fill="#fff" opacity={0.12 + 0.3 * (0.5 + 0.5 * Math.sin(frame / 40 + s.p))} />
      ))}
    </svg>
  );
};

const Grid: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const theme = useTheme();
  const step = Math.min(width, height) / 12;
  const off = (frame * 0.25) % step;
  return (
    <svg width={width} height={height} style={{ position: "absolute", opacity: 0.5 }}>
      <defs>
        <radialGradient id="ov-grid-fade" cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="ov-grid-mask"><rect width={width} height={height} fill="url(#ov-grid-fade)" /></mask>
      </defs>
      <g mask="url(#ov-grid-mask)" stroke={theme.colors.border} strokeWidth={1}>
        {Array.from({ length: Math.ceil(width / step) + 2 }, (_, i) => <line key={`v${i}`} x1={i * step - off} y1={0} x2={i * step - off} y2={height} />)}
        {Array.from({ length: Math.ceil(height / step) + 2 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * step - off} x2={width} y2={i * step - off} />)}
      </g>
    </svg>
  );
};

// Slowly drifting light blobs keep "static" scenes from reading as frozen frames.
const Glow: React.FC = () => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const a = frame / 300;
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(circle at ${50 + 30 * Math.cos(a)}% ${30 + 15 * Math.sin(a * 1.3)}%, ${theme.colors.accent}22 0%, transparent 45%)`,
          `radial-gradient(circle at ${40 + 25 * Math.sin(a * 0.8)}% ${75 + 10 * Math.cos(a)}%, ${theme.colors.accent2}18 0%, transparent 40%)`,
        ].join(","),
      }}
    />
  );
};

export const Backdrop: React.FC<{ variant: Background }> = ({ variant }) => {
  const theme = useTheme();
  const v = variant === "default" ? theme.background : variant;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 70% 20%, ${theme.colors.bgAlt} 0%, ${theme.colors.bg} 70%)` }}>
      {v !== "plain" && <Glow />}
      {v === "stars" && <Stars />}
      {v === "grid" && <Grid />}
    </AbsoluteFill>
  );
};
