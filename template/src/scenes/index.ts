import type React from "react";
import { BulletsScene, ChapterScene, QuoteScene, SourcesScene, TitleScene } from "./Text";
import { BarCompareScene, BarRaceScene, LineChartScene, ShareScene, StatCardsScene } from "./Data";
import { CompareScene, MediaScene, TimelineScene } from "./Story";

// Scene registry: keys must match the storyboard schema's scene type enum.
export const SCENES: Record<string, React.FC<any>> = {
  title: TitleScene,
  chapter: ChapterScene,
  "stat-cards": StatCardsScene,
  "bar-compare": BarCompareScene,
  "bar-race": BarRaceScene,
  "line-chart": LineChartScene,
  share: ShareScene,
  timeline: TimelineScene,
  quote: QuoteScene,
  bullets: BulletsScene,
  media: MediaScene,
  compare: CompareScene,
  sources: SourcesScene,
};
