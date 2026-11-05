import React from "react";
import { useLayout, useTheme } from "../engine/context";

// Entrance-aware surface: `o` is the reveal progress 0→1.
export const Card: React.FC<{ o: number; children: React.ReactNode; style?: React.CSSProperties; accent?: string }> = ({ o, children, style, accent }) => {
  const theme = useTheme();
  const { u } = useLayout();
  return (
    <div
      style={{
        opacity: o,
        transform: `translateY(${(1 - o) * 30 * u}px)`,
        background: theme.colors.surface,
        border: `1px solid ${theme.colors.border}`,
        borderTop: accent ? `${4 * u}px solid ${accent}` : undefined,
        borderRadius: theme.radius * u,
        padding: `${28 * u}px ${32 * u}px`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
