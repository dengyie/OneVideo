import React from "react";
import { useLayout, useScene } from "../engine/context";

// Content box between the header (if any) and the caption band.
export const Stage: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; center?: boolean }> = ({ children, style, center }) => {
  const scene = useScene();
  const { pad, top, bottom, u } = useLayout();
  return (
    <div
      style={{
        position: "absolute",
        left: pad,
        right: pad,
        top: scene.header ? top + 20 * u : pad,
        bottom,
        display: "flex",
        flexDirection: "column",
        justifyContent: center ? "center" : "flex-start",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Title: React.FC<{ text?: string }> = ({ text }) => {
  const { u, portrait } = useLayout();
  if (!text) return null;
  return <div style={{ fontSize: (portrait ? 40 : 32) * u, fontWeight: 600, marginBottom: 24 * u, opacity: 0.92 }}>{text}</div>;
};
