import { test } from "node:test";
import assert from "node:assert/strict";
import { schemaGate, numbersGate, captionGate, storyboardGate, rateGate, assetsGate, budgetGate, normalizeLicense, summarize } from "../cli/lib/gates.mjs";
import { example } from "./helpers.mjs";

const msgs = (issues, gate) => issues.filter((i) => !gate || i.gate === gate).map((i) => i.msg);

test("the SpaceX example passes every pre-compose gate", () => {
  const ex = example();
  const issues = [
    ...schemaGate("project", ex.config), ...schemaGate("research", ex.research), ...schemaGate("script", ex.script), ...schemaGate("storyboard", ex.storyboard),
    ...numbersGate(ex.script, ex.research), ...captionGate(ex.script, ex.config), ...budgetGate(ex.script, ex.config),
    ...storyboardGate(ex.storyboard, ex.script, ex.config, null), ...rateGate(ex.script, ex.timings, ex.config),
  ];
  assert.deepEqual(summarize(issues).errors, []);
  assert.deepEqual(msgs(issues, "rate"), []);
});

test("numbersGate rejects unsourced numbers and dangling claim ids", () => {
  const research = { facts: [{ id: "a", claim: "收入约187亿美元", source: { title: "t" } }], allowNumbers: ["36年"] };
  const script = { scenes: [{ id: "s", narration: "收入约187亿美元，36年后增长到999亿。", claims: ["a", "zzz"] }] };
  const m = msgs(numbersGate(script, research));
  assert.ok(m.some((x) => /"999亿"/.test(x)));
  assert.ok(!m.some((x) => /187|36/.test(x)));
  assert.ok(m.some((x) => /claim "zzz"/.test(x)));
});

test("numbersGate requires a source on every fact", () => {
  assert.ok(msgs(numbersGate({ scenes: [] }, { facts: [{ id: "x", claim: "c" }] })).some((x) => /no source/.test(x)));
});

test("schemaGate validates storyboard props per scene type", () => {
  const sb = { scenes: [{ id: "a", type: "bar-race", props: { periods: "1990" } }] };
  assert.ok(schemaGate("storyboard", sb).length > 0);
});

test("storyboardGate: periodCues must reference defined cues", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes.find((s) => s.id === "race").props.periodCues = ["y1990", "nope", null, "y2026"];
  assert.ok(msgs(storyboardGate(sb, ex.script, ex.config, null), "cues").some((x) => /"nope"/.test(x)));
});

test("rateGate flags speech outside the syllables/s band", () => {
  const timings = { scenes: { s: { lines: [{ text: "一二三四五六七八九十", start: 0, end: 0.5 }] } } };
  assert.ok(msgs(rateGate({ scenes: [{ id: "s" }] }, timings, {})).some((x) => /syllables\/s/.test(x)));
});

test("budgetGate errors when narration is far from targetSeconds", () => {
  const script = { scenes: [{ id: "s", narration: "很短。" }] };
  assert.equal(budgetGate(script, { targetSeconds: 120 })[0].level, "error");
  assert.deepEqual(budgetGate(script, {}), []);
});

test("normalizeLicense is an allowlist", () => {
  assert.equal(normalizeLicense("PD (NASA)"), "pd");
  assert.equal(normalizeLicense("CC BY-SA 4.0"), "cc-by-sa");
  assert.equal(normalizeLicense("CC BY 2.0"), "cc-by");
  assert.equal(normalizeLicense("CC BY-NC 4.0"), null);
  assert.equal(normalizeLicense("All rights reserved"), null);
});

test("assetsGate requires attribution for CC BY and blocks unknown licenses", () => {
  const issues = assetsGate({ items: [
    { id: "a", file: "assets/a.jpg", license: "CC BY 4.0" },
    { id: "b", file: "assets/b.jpg", license: "Editorial use only" },
    { id: "c", license: "CC0", width: 640, height: 480 },
  ] });
  const m = msgs(issues);
  assert.ok(m.some((x) => /"a".*author and source/.test(x)));
  assert.ok(m.some((x) => /"b".*allowlist/.test(x)));
  assert.ok(m.some((x) => /"c" not fetched/.test(x)));
  assert.ok(m.some((x) => /"c" is 640x480/.test(x)));
});
