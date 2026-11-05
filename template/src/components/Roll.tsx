import React from "react";
import { clamp01, easeOut } from "../engine/motion";

// Odometer count-up: each digit of the final string spins on its own reel and lands left to
// right, the low digits spinning more turns, so a number arrives with a mechanical rattle instead
// of a float sliding. Non-digits (sign, unit, separators) stand still. `p` is count progress 0→1.
export const Roll: React.FC<{ text: string; p: number }> = ({ text, p }) => {
  const chars = Array.from(text);
  const digits = chars.filter((c) => c >= "0" && c <= "9").length;
  let n = 0;
  return (
    <span style={{ display: "inline-flex", whiteSpace: "nowrap" }}>
      {chars.map((c, i) => {
        if (c < "0" || c > "9") return <span key={i}>{c}</span>;
        const k = n++;
        // Reel k lands at 55% + 45% × k/(digits-1) of the count, after 1–3 extra turns.
        const land = digits > 1 ? 0.55 + (0.45 * k) / (digits - 1) : 1;
        const q = easeOut(clamp01(p / land));
        const turns = 1 + Math.round((2 * k) / Math.max(1, digits - 1));
        const pos = q * (turns * 10 + Number(c));
        return (
          <span key={i} style={{ display: "inline-block", height: "1.05em", overflow: "hidden", verticalAlign: "bottom" }}>
            <span style={{ display: "flex", flexDirection: "column", transform: `translateY(${-(pos % 10) * 1.05}em)`, filter: q < 1 && q > 0 ? `blur(${Math.min(0.06, (1 - q) * 0.08).toFixed(3)}em)` : undefined }}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, j) => <span key={j} style={{ height: "1.05em", lineHeight: "1.05em" }}>{d}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
};
