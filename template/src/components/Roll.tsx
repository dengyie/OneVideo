import React from "react";
import { clamp01, easeOut } from "../engine/motion";

// Odometer count-up: each digit of the final string spins on its own reel and lands left to
// right, the low digits spinning more turns, so a number arrives with a mechanical rattle instead
// of a float sliding. Non-digits (sign, unit, separators) stand still. `p` is count progress 0→1.
// Reels are one line box tall (`lh`), so digits sit on the same baseline as the plain text.
// `was`: progress one frame earlier; reels blur (vertically, by their travel per frame) while fast.
export const Roll: React.FC<{ text: string; p: number; was?: number }> = ({ text, p, was = p }) => {
  const chars = Array.from(text);
  const digits = chars.filter((c) => c >= "0" && c <= "9").length;
  let n = 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-start", whiteSpace: "nowrap" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <filter key={n} id={`roll-blur-${n}`} x="-5%" y="-20%" width="110%" height="140%">
            <feGaussianBlur stdDeviation={`0 ${n * 1.6}`} />
          </filter>
        ))}
      </svg>
      {chars.map((c, i) => {
        if (c < "0" || c > "9") return <span key={i}>{c}</span>;
        const k = n++;
        // Reel k lands at 55% + 45% × k/(digits-1) of the count, after 1–3 extra turns.
        const land = digits > 1 ? 0.55 + (0.45 * k) / (digits - 1) : 1;
        const q = easeOut(clamp01(p / land));
        const turns = 1 + Math.round((2 * k) / Math.max(1, digits - 1));
        const pos = q * (turns * 10 + Number(c));
        const speed = (q - easeOut(clamp01(was / land))) * (turns * 10 + Number(c));
        return (
          <span key={i} style={{ display: "inline-block", height: "1lh", overflow: "hidden" }}>
            <span style={{ display: "flex", flexDirection: "column", transform: `translateY(${-(pos % 10)}lh)`, filter: speed > 0.05 ? `url(#roll-blur-${Math.min(8, Math.round(speed * 2))})` : undefined }}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, j) => <span key={j} style={{ height: "1lh" }}>{d}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
};
