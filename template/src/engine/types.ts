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
  transition: Transition | TransitionSpec;
  camera?: CameraMove | Camera;
  motion?: { pace?: "slow" | "medium" | "fast"; spring?: { damping?: number } };
  captionBg?: string;
};

export type Transition = "fade" | "slide" | "push" | "whip" | "zoom" | "punch" | "iris" | "wipe" | "clock" | "dip" | "cut";
export type Direction = "left" | "right" | "up" | "down";
export type TransitionSpec = { type: Transition; duration?: number; direction?: Direction; sfx?: string | null };
// A boundary as compiled: `frames` of overlap, `lead` of them before this scene's own start (in)
// or `tail` of them after its end (out).
export type TransitionIn = { type: Transition; frames: number; lead: number; direction: Direction };
export type TransitionOut = { type: Transition; frames: number; tail: number; direction: Direction; nextOpaque: boolean };
export type CameraMove = "static" | "drift" | "push" | "pull" | "pan-left" | "pan-right" | "rise" | "handheld";
export type Camera = { move: CameraMove; amount?: number };
export type Background = "default" | "plain" | "grid" | "stars" | "media";

export type Overlay = {
  type: "lottie" | "icon" | "burst" | "confetti" | "arrow" | "mark" | "callout" | "stamp" | "lower-third" | "spotlight" | "flash" | "image";
  t: number; end: number;
  x?: number; y?: number; size?: number; color?: string;
  src?: string; loop?: boolean; speed?: number;
  icon?: string; label?: string; ring?: boolean; count?: number; origin?: "top" | "point";
  from?: [number, number]; to?: [number, number]; curve?: number;
  kind?: "circle" | "box" | "underline" | "highlight" | "strike"; rect?: [number, number, number, number];
  text?: string; subtitle?: string; side?: "left" | "right"; rotate?: number;
  asset?: string; shape?: "circle" | "rounded";
};
export type Look = { grain?: number; vignette?: number; leak?: number };

export type Line = { text: string; start: number; end: number };

export type Scene = {
  id: string;
  type: string;
  from: number;
  durationInFrames: number;
  start: number;
  duration: number;
  audio: string | null;
  enter: Transition | TransitionSpec | null;
  exit: Transition | TransitionSpec | null;
  transitionIn: TransitionIn | null;
  transitionOut: TransitionOut | null;
  camera: Camera;
  opaque: boolean;
  header: { title: string; subtitle?: string } | null;
  background: Background | null;
  backdrop: { asset: string; dim: number; blur: number; motion: "in" | "out" | "left" | "right" | "up" | "none"; startFrom: number } | null;
  captions: boolean;
  cues: Record<string, number>;
  lines: Line[];
  props: Record<string, any>;
  overlays?: Overlay[];
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
  sfx: { sound: string; src: string; at: number; volume: number; duration?: number }[];
  chapters: { title: string; start: number }[];
  assets: Record<string, { src: string; kind: "image" | "video"; credit: string }>;
  icons?: Record<string, { body: string; viewBox: string }>;
  lottie?: Record<string, any>;
  libraryCredits?: string[];
  look?: Look | null;
  scenes: Scene[];
};
