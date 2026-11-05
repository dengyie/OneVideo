import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUTO_SHOTS, compileShots, compileTimeline, resolveWhen } from "../cli/lib/timeline.mjs";
import { beatsFile, detectBeats, gridBeats, snapToBeat } from "../cli/lib/beats.mjs";
import { schemaGate } from "../cli/lib/gates.mjs";
import { example } from "./helpers.mjs";

const lines = [{ start: 0, end: 1.8 }, { start: 2, end: 3.9 }, { start: 4.1, end: 6 }];
const ctx = (over = {}) => ({ cues: { boom: 1.5 }, lines, duration: 6, start: 10, beats: [], snap: true, ...over });

test("resolveWhen: cue, seconds, and the nth beat from the scene start", () => {
  assert.deepEqual(resolveWhen({ cue: "boom", offset: 0.2 }, ctx()), { t: 1.7 });
  assert.equal(resolveWhen({ at: 2.5 }, ctx()).t, 2.5);
  const c = ctx({ beats: [9.5, 10.25, 10.75, 11.25] });
  assert.equal(resolveWhen({ at: { beat: 1 } }, c).t, 0.75);
  assert.match(resolveWhen({ at: { beat: 9 } }, c).error, /past the music/);
  assert.match(resolveWhen({ cue: "nope" }, c).error, /unknown cue/);
});

test("compileShots auto: one framing per caption line, alternating moves and cuts", () => {
  const { shots, errors } = compileShots("auto", ctx());
  assert.deepEqual(errors, []);
  assert.equal(shots.length, 3);
  assert.equal(shots[0].t, 0);
  assert.equal(shots[1].zoom, AUTO_SHOTS[1].zoom);
  assert.deepEqual(shots.map((s) => s.cut), [false, false, true]);
  assert.ok(shots[1].t < lines[1].start);
});

test("compileShots: focus fits a region, times snap to a near beat only", () => {
  const { shots } = compileShots([{ at: 0 }, { at: 1.96, focus: [0.6, 0.2, 0.2, 0.25] }, { at: 4, zoom: 1.3, snap: false }], ctx({ beats: [12, 14.05] }));
  assert.equal(shots[1].t, 2); // 11.96 → beat at 12
  assert.equal(shots[1].zoom, 3); // 0.8 / 0.25 = 3.2, capped
  assert.equal(shots[1].x, 0.7);
  assert.equal(shots[1].y, 0.325);
  assert.equal(shots[2].t, 4); // snap: false keeps 14.0, not 14.05
  const loose = compileShots([{ at: 1 }], ctx({ beats: [11.5] })).shots;
  assert.equal(loose[0].t, 1); // beat 0.5 s away is out of the window
});

test("beats: synth grid, snapping, and tempo detection on a click track", () => {
  assert.deepEqual(gridBeats(120, 2), [0, 0.5, 1, 1.5, 2]);
  assert.equal(snapToBeat(1.08, [0, 1, 2]), 1);
  assert.equal(snapToBeat(1.4, [0, 1, 2]), 1.4);
  const sr = 22050, bpm = 100, dur = 12, offset = 0.21;
  const mono = new Float32Array(sr * dur);
  for (let t = offset; t < dur; t += 60 / bpm) {
    const i0 = Math.round(t * sr);
    for (let k = 0; k < 400 && i0 + k < mono.length; k++) mono[i0 + k] = Math.sin(k * 0.9) * Math.exp(-k / 80);
  }
  const res = detectBeats(mono, sr);
  assert.ok(Math.abs(res.bpm - bpm) <= 1, `bpm ${res.bpm}`);
  assert.ok(Math.abs(res.beats[0] - offset) < 0.03 || Math.abs(res.beats[1] - offset) < 0.03, `first beats ${res.beats.slice(0, 2)}`);
});

test("schema accepts shots, word overlays and the footage / parallax / canvas scenes", () => {
  const scenes = [
    { id: "a", type: "footage", shots: "auto", overlays: [{ type: "word", text: "IPO", style: "slam", at: 1 }], props: { asset: "v", ramp: [{ at: 1, speed: 0.35 }, { at: { beat: 4 }, speed: 1.6 }], title: { text: "SpaceX", behind: true, matte: { mode: "subject" } } } },
    { id: "b", type: "parallax", shots: [{ at: 0, focus: [0.2, 0.2, 0.4, 0.4] }, { at: 2, zoom: 1.2, cut: true }], props: { asset: "p", move: "orbit" } },
    { id: "c", type: "canvas", props: { items: [{ id: "x", type: "stat", x: 960, y: 540, value: 1.75, morph: [{ at: 2, type: "bar", max: 2 }] }], path: [{ focus: "x" }, { at: 3, focus: { x: 2400, y: 540 }, fly: 1.2 }], links: [{ from: "x", to: "x" }] } },
    { id: "d", type: "canvas", props: { inherit: true } },
  ];
  assert.deepEqual(schemaGate("storyboard", { scenes }), []);
  const bad = schemaGate("storyboard", { scenes: [{ id: "x", type: "parallax", props: { asset: "p", move: "spin" } }] });
  assert.ok(bad.some((i) => /move/.test(i.msg)));
});

test("compileTimeline: shot track, prop times, beats, canvas inherit", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const sb = structuredClone(ex.storyboard);
  writeFileSync(beatsFile(join(ex.root, "public", ex.config.music.file)), JSON.stringify({ bpm: 120, beats: gridBeats(120, 200) }));
  sb.scenes[0] = {
    ...sb.scenes[0], type: "canvas", backdrop: undefined, shots: "auto",
    props: { items: [{ id: "cap", type: "stat", value: 1.75, at: 0.5, morph: [{ at: 1.5, type: "bar", value: 1.75, max: 2 }] }], path: [{ focus: "cap" }, { at: { beat: 2 }, focus: { x: 2400, y: 540 } }] },
  };
  sb.scenes[1] = { ...sb.scenes[1], type: "canvas", backdrop: undefined, props: { inherit: true, items: [{ id: "next", type: "dot", x: 2400, y: 540 }] } };
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  const [a, b] = timeline.scenes;
  assert.ok(a.shots.length >= 1 && a.shots[0].t === 0);
  assert.equal(a.props.items[0].t, 0.5);
  assert.equal(a.props.items[0].morph[0].t, 1.5);
  assert.equal(a.props.path[1].t, 1);
  assert.ok(timeline.beats.length > 100);
  const cap = b.props.items.find((it) => it.id === "cap");
  assert.equal(cap.type, "bar");
  assert.equal(cap.settled, true);
  assert.equal(cap.morph, undefined);
  assert.equal(b.props.path[0].cut, true);
  assert.equal(b.props.path[0].t, 0);
  assert.deepEqual(b.props.path[0].focus, { x: 2400, y: 540 });
});
