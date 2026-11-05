export type Format = { prefix?: string; suffix?: string; decimals?: number; compact?: "none" | "zh" | "en" };

export type Theme = {
  name: string;
  colors: {
    bg: string; bgAlt: string; surface: string; border: string; text: string; muted: string;
    accent: string; accent2: string; positive: string; negative: string; highlight: string;
  };
  palette: string[];
  fonts: { body: string; number: string };
  background: Background;
  radius: number;
  transition: Transition;
  motion?: { pace?: "slow" | "medium" | "fast"; spring?: { damping?: number } };
  captionBg?: string;
};

export type Transition = "fade" | "slide" | "zoom" | "wipe" | "cut";
export type Background = "default" | "plain" | "grid" | "stars" | "media";

export type Line = { text: string; start: number; end: number };

export type Scene = {
  id: string;
  type: string;
  from: number;
  durationInFrames: number;
  start: number;
  duration: number;
  audio: string | null;
  enter: Transition;
  exit: Transition;
  header: { title: string; subtitle?: string } | null;
  background: Background | null;
  backdrop: { asset: string; dim: number; blur: number; motion: "in" | "out" | "left" | "right" | "up" | "none"; startFrom: number } | null;
  captions: boolean;
  cues: Record<string, number>;
  lines: Line[];
  props: Record<string, any>;
};

export type Timeline = {
  version: number;
  title: string;
  fps: number;
  width: number;
  height: number;
  aspect: string;
  totalFrames: number;
  duration: number;
  theme: Theme;
  watermark: string | null;
  captions: { enabled: boolean; style: "line" | "karaoke" | "none"; items: { scene: string; text: string; start: number; end: number }[] };
  narration: [number, number][];
  music: { src: string; volume: number; duckTo: number; fade: number; credit?: string | null } | null;
  sfx: { sound: string; src: string; at: number; volume: number }[];
  chapters: { title: string; start: number }[];
  assets: Record<string, { src: string; kind: "image" | "video"; credit: string }>;
  scenes: Scene[];
};
