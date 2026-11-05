import React from "react";
import { useTimeline } from "../engine/context";

// Renders an icon the compiler inlined into timeline.icons (Lucide names or "flag:<iso2>").
export const Icon: React.FC<{ name: string; size: number; color?: string; style?: React.CSSProperties }> = ({ name, size, color, style }) => {
  const icon = useTimeline().icons?.[name];
  if (!icon) return null;
  return (
    <svg width={size} height={size} viewBox={icon.viewBox} style={{ color, display: "block", ...style }} dangerouslySetInnerHTML={{ __html: icon.body }} />
  );
};
