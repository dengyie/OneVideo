import React from "react";
import { useLayout, useTheme } from "../engine/context";

export const Watermark: React.FC<{ text: string }> = ({ text }) => {
  const theme = useTheme();
  const { u, portrait } = useLayout();
  return (
    <div style={{ position: "absolute", right: (portrait ? 48 : 60) * u, top: (portrait ? 60 : 40) * u, fontSize: 20 * u, color: theme.colors.muted, opacity: 0.55, letterSpacing: 2 * u }}>
      {text}
    </div>
  );
};
