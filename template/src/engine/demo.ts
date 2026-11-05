// Silent showcase timeline: used by `remotion studio` when no project props are passed,
// and as the default props so every scene type can be previewed in isolation.
import style from "../../../styles/midnight-data.json";
import type { Scene, Theme, Timeline } from "./types";

const FPS = 30;
type Spec = Pick<Scene, "id" | "type" | "props"> & { seconds: number; header?: Scene["header"] };

const specs: Spec[] = [
  { id: "title", type: "title", seconds: 4, props: { kicker: "ONEVIDEO", title: "数据驱动的视频引擎", subtitle: "脚本 → 配音 → 时间轴 → 渲染 → 质检", date: "2026" } },
  { id: "chapter", type: "chapter", seconds: 3, props: { index: 1, title: "场景目录", subtitle: "13 种可组合场景" } },
  { id: "stats", type: "stat-cards", seconds: 5, header: { title: "关键数字" }, props: { cards: [
    { value: 1.75e12, format: { prefix: "$", compact: "en", decimals: 2 }, label: "估值" },
    { value: 155, format: { suffix: " 亿" }, label: "年收入（美元）" },
    { value: 38.5, format: { suffix: "%" }, label: "增速" },
  ] } },
  { id: "bars", type: "bar-compare", seconds: 5, header: { title: "对比" }, props: { format: { compact: "zh" }, items: [
    { label: "甲", value: 32e8 }, { label: "乙", value: 21e8, highlight: true }, { label: "丙", value: 9e8 }, { label: "丁", value: 4e8 },
  ] } },
  { id: "race", type: "bar-race", seconds: 7, header: { title: "排名变化" }, props: { top: 5, periods: ["2020", "2022", "2024", "2026"], series: [
    { name: "A", values: [10, 14, 20, 26] }, { name: "B", values: [16, 15, 14, 13] }, { name: "C", values: [5, 12, 22, 30] },
    { name: "D", values: [12, 11, 9, 8] }, { name: "E", values: [8, 9, 12, 15] }, { name: "F", values: [3, 4, 6, 18] },
  ] } },
  { id: "line", type: "line-chart", seconds: 6, header: { title: "趋势" }, props: { format: { suffix: "%" }, series: [
    { name: "收入增速", points: [["2021", 12], ["2022", 18], ["2023", 25], ["2024", 31], ["2025", 38]] },
  ], annotations: [{ x: "2024", label: "拐点" }] } },
  { id: "share", type: "share", seconds: 5, header: { title: "构成" }, props: { segments: [
    { label: "发射服务", value: 42 }, { label: "星链", value: 48 }, { label: "其他", value: 10 },
  ] } },
  { id: "timeline", type: "timeline", seconds: 6, header: { title: "时间线" }, props: { events: [
    { date: "2002", title: "成立" }, { date: "2008", title: "首次入轨" }, { date: "2015", title: "首次回收", highlight: true }, { date: "2020", title: "载人飞行" },
  ] } },
  { id: "quote", type: "quote", seconds: 4, props: { text: "精确的文字放在原生文字卡里，不交给 AI 生图。", author: "OneVideo 规则" } },
  { id: "bullets", type: "bullets", seconds: 5, header: { title: "三条原则" }, props: { items: ["每个数字都有来源", { text: "按句配音，时间轴实测", note: "字幕和动画对齐到真实语音" }, "渲染后自动质检"] } },
  { id: "compare", type: "compare", seconds: 5, props: { title: "两种做法", left: { title: "手工剪辑", items: ["慢", "难复用"] }, right: { title: "OneVideo", items: ["声明式", "可复现"], value: 10, format: { suffix: "×" } } } },
  { id: "sources", type: "sources", seconds: 4, props: { items: ["示例数据，仅用于预览场景"] } },
];

let from = 0;
const scenes: Scene[] = specs.map((s) => {
  const durationInFrames = s.seconds * FPS;
  const scene: Scene = {
    id: s.id, type: s.type, from, durationInFrames, start: from / FPS, duration: s.seconds, audio: null,
    enter: "fade", exit: "fade", header: s.header ?? null, background: null, captions: true, cues: {}, lines: [], props: s.props,
  };
  from += durationInFrames;
  return scene;
});

export const DEMO_TIMELINE: Timeline = {
  version: 1,
  title: "OneVideo demo",
  fps: FPS,
  width: 1920,
  height: 1080,
  aspect: "16:9",
  totalFrames: from,
  duration: from / FPS,
  theme: style as unknown as Theme,
  watermark: "OneVideo",
  captions: { enabled: false, style: "line", items: [] },
  narration: [],
  music: null,
  sfx: [],
  chapters: [],
  assets: {},
  scenes,
};
