import { test } from "node:test";
import assert from "node:assert/strict";
import { compileTimeline, phraseTime, resolveAt, mergeTheme, researchSources, sourceList, credit, CUE_LEAD } from "../cli/lib/timeline.mjs";
import { example } from "./helpers.mjs";

const lines = [{ text: "1990年，全球第一", start: 0.2, end: 2.2 }, { text: "36年后，苹果排第一", start: 2.5, end: 4.5 }];

test("phraseTime interpolates inside a line and spans punctuation", () => {
  assert.equal(phraseTime(lines, "1990年"), 0.2);
  const t = phraseTime(lines, "苹果");
  assert.ok(t > 2.5 && t < 4.5);
  assert.equal(phraseTime(lines, "不存在"), null);
  // Digits weigh 1.6 syllables: "36年后" is 5.2 of the line's 10.2, so 苹果 lands past the middle.
  const share = (phraseTime(lines, "苹果") - 2.5) / 2;
  assert.ok(Math.abs(share - 5.2 / 10.2) < 1e-9);
});

test("resolveAt accepts seconds, negative seconds, phrases and {phrase, offset}", () => {
  assert.deepEqual(resolveAt(1.5, lines, 6), { t: 1.5 });
  assert.deepEqual(resolveAt(-1, lines, 6), { t: 5 });
  assert.ok(Math.abs(resolveAt({ phrase: "36年后", offset: -0.4 }, lines, 6).t - (2.1 - CUE_LEAD)) < 1e-9, "phrase cues lead the voice");
  assert.match(resolveAt("缺失", lines, 6).error, /not found/);
  assert.match(resolveAt({ offset: 1 }, lines, 6).error, /invalid cue/);
});

test("mergeTheme merges nested objects one level deep", () => {
  const m = mergeTheme({ colors: { a: 1, b: 2 }, background: "grid" }, { colors: { b: 3 }, background: "stars" });
  assert.deepEqual(m, { colors: { a: 1, b: 3 }, background: "stars" });
});

test("researchSources dedupes and keeps sources without URLs", () => {
  const src = researchSources({
    facts: [
      { source: { publisher: "Reuters", title: "定价", date: "2026-06-11" } },
      { source: { publisher: "Reuters", title: "定价", date: "2026-06-11", url: "https://x" } },
    ],
    sources: [{ publisher: "FT", title: "Global 500" }],
  });
  assert.deepEqual(src, [{ line: "Reuters · 定价 · 2026-06-11", url: "https://x" }, { line: "FT · Global 500", url: null }]);
});

test("sourceList appends asset credits; generated assets credit the model", () => {
  const list = sourceList({ facts: [] }, { items: [{ title: "Falcon", author: "NASA", license: "PD (NASA)" }, { license: "generated", author: "gpt-image-2.5" }] });
  assert.deepEqual(list, ["图片：Falcon · NASA · PD (NASA)", "图片：AI 生成 · gpt-image-2.5"]);
  assert.equal(credit({ license: "generated" }), "AI 生成 · image model");
});

test("compileTimeline on the SpaceX example: frames, captions, cues, chapters, music credit", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/inspired.mp3"] });
  const { timeline, errors } = compileTimeline({ ...ex, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  assert.equal(timeline.width, 1920);
  assert.deepEqual(timeline.scenes.find((s) => s.id === "race").backdrop, { asset: "pad-night", dim: 0.8, blur: 12, motion: "none", startFrom: 0 });
  assert.ok(timeline.scenes.filter((s) => s.id !== "credits").every((s) => s.backdrop), "every content scene has footage behind it");
  assert.equal(timeline.scenes.length, ex.storyboard.scenes.length);
  let frame = 0;
  for (const s of timeline.scenes) {
    assert.equal(s.from, frame, `scene ${s.id} is contiguous`);
    frame += s.durationInFrames;
  }
  assert.equal(timeline.totalFrames, frame);
  const nLines = Object.values(ex.timings.scenes).reduce((n, s) => n + s.lines.length, 0);
  assert.equal(timeline.captions.items.length, nLines);
  for (const c of timeline.captions.items) assert.ok(c.end > c.start && c.end <= timeline.duration + 1e-6);
  const race = timeline.scenes.find((s) => s.id === "race");
  assert.ok(race.cues.y1990 < race.cues.y2026);
  assert.deepEqual(timeline.chapters.map((c) => c.title).slice(0, 2), ["上市", "36 年市值榜"]);
  assert.equal(timeline.music.credit, ex.config.music.credit);
  const synth = compileTimeline({ ...example(), config: { ...ex.config, music: { preset: "pulse" } }, assets: ex.fetchedAssets });
  assert.equal(synth.timeline.music.credit, "OneVideo 程序化合成");
});

test("compileTimeline reports a cue phrase missing from narration", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes.find((s) => s.id === "race").cues.bogus = "没有这句";
  const { errors } = compileTimeline({ ...ex, storyboard: sb, assets: null });
  assert.ok(errors.some((e) => /cue "bogus"/.test(e)));
});

test("compileTimeline: a provided music file needs a credit", () => {
  const ex = example({ media: ["sfx/whoosh.wav", "sfx/pop.wav", "music/track.mp3"] });
  const config = { ...ex.config, music: { file: "music/track.mp3" } };
  const { timeline, warnings } = compileTimeline({ ...ex, config, assets: null });
  assert.equal(timeline.music.src, "music/track.mp3");
  assert.ok(warnings.some((w) => /credit/.test(w)));
});

test("compileTimeline reports an unfetched asset instead of throwing", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes[0] = { ...sb.scenes[0], props: { ...sb.scenes[0].props, asset: "rocket" } };
  const { errors } = compileTimeline({ ...ex, storyboard: sb, assets: { items: [{ id: "rocket", query: "falcon 9" }] } });
  assert.ok(errors.some((e) => /asset "rocket" not fetched/.test(e)));
});
