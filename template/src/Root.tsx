import React from "react";
import { Composition } from "remotion";
import { Video } from "./engine/Video";
import { DEMO_TIMELINE } from "./engine/demo";
import type { Timeline } from "./engine/types";

// One composition renders every project: size, fps and length come from the timeline props.
export const Root: React.FC = () => (
  <Composition
    id="OneVideo"
    component={Video as unknown as React.FC<Record<string, unknown>>}
    defaultProps={DEMO_TIMELINE as unknown as Record<string, unknown>}
    durationInFrames={DEMO_TIMELINE.totalFrames}
    fps={DEMO_TIMELINE.fps}
    width={DEMO_TIMELINE.width}
    height={DEMO_TIMELINE.height}
    calculateMetadata={({ props }) => {
      const t = props as unknown as Timeline;
      return { durationInFrames: Math.max(1, t.totalFrames), fps: t.fps, width: t.width, height: t.height };
    }}
  />
);
