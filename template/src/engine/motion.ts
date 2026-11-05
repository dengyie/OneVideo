export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOutBack = (t: number) => {
  const x = clamp01(t);
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Progress 0→1 of an entrance that starts at `at` seconds and lasts `dur` seconds.
export const progress = (t: number, at: number, dur = 0.6) => easeOut((t - at) / dur);

export const PACE = { slow: 1.35, medium: 1, fast: 0.7 } as const;
