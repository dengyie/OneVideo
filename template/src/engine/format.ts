import type { Format } from "./types";

const fixed = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// Compact display without an explicit decimals setting: 3 significant digits, trailing zeros dropped.
const auto = (x: number) => {
  const d = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return Number(x.toFixed(d)).toLocaleString("en-US", { maximumFractionDigits: d });
};

// Number → display string. compact "zh" uses 万/亿/万亿, "en" uses K/M/B/T.
export function fmt(value: number, f: Format = {}): string {
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  const prefix = f.prefix ?? "";
  const suffix = f.suffix ?? "";
  let body: string;
  let unit = "";
  if (f.compact === "zh") {
    const [div, u] = v >= 1e12 ? [1e12, "万亿"] : v >= 1e8 ? [1e8, "亿"] : v >= 1e4 ? [1e4, "万"] : [1, ""];
    body = f.decimals !== undefined ? fixed(v / div, f.decimals) : div === 1 ? fixed(v, 0) : auto(v / div);
    unit = u;
  } else if (f.compact === "en") {
    const [div, u] = v >= 1e12 ? [1e12, "T"] : v >= 1e9 ? [1e9, "B"] : v >= 1e6 ? [1e6, "M"] : v >= 1e3 ? [1e3, "K"] : [1, ""];
    body = f.decimals !== undefined ? fixed(v / div, f.decimals) : div === 1 ? fixed(v, 0) : auto(v / div);
    unit = u;
  } else body = fixed(v, f.decimals ?? (Number.isInteger(v) ? 0 : 1));
  return `${sign}${prefix}${body}${unit}${suffix}`;
}

// Same as fmt, but keeps the decimal count of the final value while counting up,
// so the width of an animating number does not jitter.
export function fmtCount(current: number, target: number, f: Format = {}): string {
  if (f.decimals !== undefined || f.compact === "zh" || f.compact === "en") return fmt(current, f);
  const d = Number.isInteger(target) ? 0 : Math.min(4, (String(target).split(".")[1] ?? "").length);
  return fmt(current, { ...f, decimals: d });
}
