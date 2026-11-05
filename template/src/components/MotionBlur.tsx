import React from "react";
import { AbsoluteFill } from "remotion";

// Cheap motion blur: one directional Gaussian sized from how far the layer moves this frame
// (a 180° shutter smears about half the per-frame travel), instead of sampling sub-frames, which
// would multiply render cost on the 2 GB render node. Below ~0.6px it is skipped entirely.
export const MotionBlur: React.FC<{ id: string; vx: number; vy: number; radial?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  id, vx, vy, radial = 0, style, children,
}) => {
  const k = 0.35;
  const r = radial * 0.25 * k;
  const sx = Math.min(40, Math.abs(vx) * k + r);
  const sy = Math.min(40, Math.abs(vy) * k + r);
  const on = sx > 0.6 || sy > 0.6;
  const fid = `mb-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return (
    <AbsoluteFill style={{ ...style, filter: on ? `url(#${fid})` : style?.filter }}>
      {on && (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={fid} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`${sx.toFixed(2)} ${sy.toFixed(2)}`} edgeMode="duplicate" />
          </filter>
        </svg>
      )}
      {children}
    </AbsoluteFill>
  );
};
