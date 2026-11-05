import React from "react";
import { AbsoluteFill, Html5Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene, Timeline } from "./types";
import { SceneContext, TimelineContext } from "./context";
import { clamp01, easeOut, easeInOut } from "./motion";
import { Backdrop } from "../components/Backdrop";
import { Credit, MediaFill } from "../components/Media";
import { Header } from "../components/Header";
import { Watermark } from "../components/Watermark";
import { Captions } from "./Captions";
import { SCENES } from "../scenes";

const ENTER = 0.45;
const EXIT = 0.35;

// Music gain: full between lines, ducked under speech, with short ramps and fade in/out.
export function musicGain(t: number, total: number, m: NonNullable<Timeline["music"]>, narration: [number, number][]): number {
  const RAMP = 0.35;
  let d = Infinity;
  for (const [a, b] of narration) {
    if (t >= a && t <= b) { d = 0; break; }
    d = Math.min(d, t < a ? a - t : t - b);
  }
  const duck = m.duckTo + (m.volume - m.duckTo) * clamp01(d / RAMP);
  const fade = Math.min(clamp01(t / m.fade), clamp01((total - t) / m.fade));
  return duck * fade;
}

const SceneFrame: React.FC<{ scene: Scene; children: React.ReactNode }> = ({ scene, children }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const pIn = scene.enter === "cut" ? 1 : easeOut(t / ENTER);
  const pOut = scene.exit === "cut" ? 1 : easeInOut((scene.duration - t) / EXIT);
  const p = Math.min(pIn, pOut);
  const leaving = pOut < pIn;
  const kind = leaving ? scene.exit : scene.enter;
  let style: React.CSSProperties = { opacity: p };
  if (kind === "slide") style = { opacity: p, transform: `translateX(${(1 - p) * (leaving ? -1 : 1) * width * 0.06}px)` };
  else if (kind === "zoom") style = { opacity: p, transform: `scale(${leaving ? 1 + (1 - p) * 0.05 : 0.94 + 0.06 * p})` };
  else if (kind === "wipe") style = { clipPath: leaving ? `inset(0 0 0 ${(1 - p) * 100}%)` : `inset(0 ${(1 - p) * 100}% 0 0)` };
  else if (kind === "cut") style = {};
  // Text over a photo gets a soft shadow (inherited by every label in the scene).
  if (scene.backdrop) style = { ...style, textShadow: "0 2px 14px rgba(0,0,0,0.6)" };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

export const Video: React.FC<Timeline> = (timeline) => {
  const { fps } = useVideoConfig();
  const { theme, music } = timeline;
  return (
    <TimelineContext.Provider value={timeline}>
      <AbsoluteFill style={{ backgroundColor: theme.colors.bg, fontFamily: theme.fonts.body, color: theme.colors.text }}>
        <Backdrop variant={theme.background} />
        {timeline.scenes.map((scene) => {
          const Comp = SCENES[scene.type];
          if (!Comp) throw new Error(`unknown scene type "${scene.type}" in scene "${scene.id}"`);
          return (
            <Sequence key={scene.id} name={`${scene.id} · ${scene.type}`} from={scene.from} durationInFrames={scene.durationInFrames}>
              <SceneContext.Provider value={scene}>
                <SceneFrame scene={scene}>
                  {scene.backdrop
                    ? <><MediaFill asset={scene.backdrop.asset} motion={scene.backdrop.motion} dim={scene.backdrop.dim} blur={scene.backdrop.blur} startFrom={scene.backdrop.startFrom} /><Credit asset={scene.backdrop.asset} corner="bottom-right" /></>
                    : scene.background && scene.background !== "default" && scene.background !== theme.background && <Backdrop variant={scene.background} />}
                  {scene.header && <Header title={scene.header.title} subtitle={scene.header.subtitle} />}
                  <Comp {...scene.props} />
                </SceneFrame>
              </SceneContext.Provider>
              {scene.audio && <Html5Audio src={staticFile(scene.audio)} />}
            </Sequence>
          );
        })}
        {music && (
          <Html5Audio
            src={staticFile(music.src)}
            loop
            volume={(f) => musicGain(f / fps, timeline.duration, music, timeline.narration)}
          />
        )}
        {timeline.sfx.map((s, i) => (
          <Sequence key={`sfx-${i}`} name={`sfx ${s.sound}`} from={Math.max(0, Math.round(s.at * fps))} durationInFrames={Math.round(3 * fps)} layout="none">
            <Html5Audio src={staticFile(s.src)} volume={s.volume} />
          </Sequence>
        ))}
        {timeline.captions.enabled && timeline.captions.style !== "none" && <Captions />}
        {timeline.watermark && <Watermark text={timeline.watermark} />}
      </AbsoluteFill>
    </TimelineContext.Provider>
  );
};
