import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { useLayout, useTimeline } from "./context";
import { clamp01 } from "./motion";

// Captions run on absolute time from the measured TTS line spans.
// "line": the whole line; "karaoke": spoken characters brighten progressively.
export const Captions: React.FC = () => {
  const tl = useTimeline();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useLayout();
  const t = frame / fps;
  const hidden = new Set(tl.scenes.filter((s) => !s.captions).map((s) => s.id));
  const item = tl.captions.items.find((c) => t >= c.start - 0.05 && t < c.end + 0.25 && !hidden.has(c.scene));
  if (!item) return null;
  const { colors, captionBg } = tl.theme;
  const fadeIn = clamp01((t - (item.start - 0.05)) / 0.12);
  const fadeOut = clamp01((item.end + 0.25 - t) / 0.12);
  const chars = Array.from(item.text);
  const spoken = tl.captions.style === "karaoke" ? Math.floor(clamp01((t - item.start) / Math.max(0.1, item.end - item.start)) * chars.length + 0.5) : chars.length;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: (portrait ? 300 : 46) * u,
        display: "flex",
        justifyContent: "center",
        opacity: Math.min(fadeIn, fadeOut),
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: portrait ? "88%" : "80%",
          fontSize: (portrait ? 54 : 42) * u,
          fontWeight: 600,
          lineHeight: 1.35,
          textAlign: "center",
          color: colors.text,
          background: captionBg ?? "rgba(0,0,0,0.6)",
          padding: `${10 * u}px ${28 * u}px`,
          borderRadius: 12 * u,
          textShadow: "0 2px 6px rgba(0,0,0,0.75)",
          letterSpacing: 0.5 * u,
        }}
      >
        {tl.captions.style === "karaoke"
          ? chars.map((c, i) => (
              <span key={i} style={{ color: i < spoken ? colors.highlight : colors.text, opacity: i < spoken ? 1 : 0.78 }}>{c}</span>
            ))
          : item.text}
      </div>
    </div>
  );
};
