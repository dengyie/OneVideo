import { test } from "node:test";
import assert from "node:assert/strict";
import { compileTimeline } from "../cli/lib/timeline.mjs";
import { schemaGate } from "../cli/lib/gates.mjs";
import { resolveCountry } from "../cli/lib/geo.mjs";
import { collectIcons, resolveIcon } from "../cli/lib/icons.mjs";
import { example } from "./helpers.mjs";

const scenes = [
  { id: "k", type: "kinetic", duration: 3, props: { lines: [{ text: "一行", style: "slam", emphasis: ["一"] }], number: { value: 3 } } },
  { id: "h", type: "headline", duration: 3, props: { items: [{ outlet: "报", title: "标题", highlight: "标" }] } },
  { id: "u", type: "unit-grid", duration: 3, props: { icon: "rocket", groups: [{ count: 3, label: "a" }] } },
  { id: "s", type: "scale-compare", duration: 3, props: { items: [{ label: "a", value: 1 }, { label: "b", value: 9 }] } },
  { id: "p", type: "price-chart", duration: 3, props: { points: [["1", 1], ["2", 2]], events: [{ x: "2", label: "e" }] } },
  { id: "m", type: "map", duration: 3, props: { mode: "globe", highlight: [{ id: "美国" }, { id: "cn" }], pins: [{ lon: 1, lat: 2, label: "x" }], routes: [{ from: [0, 0], to: [10, 10] }] } },
  { id: "f", type: "focus", duration: 3, props: { asset: "a", regions: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.3, label: "这里" }] } },
  { id: "sp", type: "split", duration: 3, props: { mode: "pip", left: { title: "L" }, right: { value: 5 } } },
  { id: "ps", type: "photo-stack", duration: 3, props: { items: [{ asset: "a", caption: "c" }] } },
];

test("storyboard schema accepts every new scene type and rejects bad props", () => {
  assert.deepEqual(schemaGate("storyboard", { scenes }), []);
  const bad = schemaGate("storyboard", { scenes: [{ id: "x", type: "kinetic", props: { lines: [{ text: "a", style: "spin" }] } }] });
  assert.ok(bad.some((i) => /style/.test(i.msg)));
  const badRegion = schemaGate("storyboard", { scenes: [{ id: "x", type: "focus", props: { asset: "a", regions: [{ x: 2, y: 0, w: 0.1, h: 0.1 }] } }] });
  assert.ok(badRegion.some((i) => /x/.test(i.msg)));
});

test("resolveCountry: numeric, ISO alpha-2, Chinese and Natural Earth names", () => {
  assert.equal(resolveCountry("156"), "156");
  assert.equal(resolveCountry("76"), "076");
  assert.equal(resolveCountry("CN"), "156");
  assert.equal(resolveCountry("美国"), "840");
  assert.equal(resolveCountry("Germany"), "276");
  assert.equal(resolveCountry("Atlantis"), null);
});

test("icons: Lucide names and aliases, namespaced flags, unknown names", () => {
  const rocket = resolveIcon("rocket");
  assert.ok(rocket.body.includes("<path") && rocket.viewBox === "0 0 24 24");
  const cn = resolveIcon("flag:cn");
  assert.ok(cn && !/id="(?!flag-cn-)/.test(cn.body));
  assert.equal(resolveIcon("no-such-icon-xyz"), null);
  assert.equal(resolveIcon("flag:../x"), null);
  assert.deepEqual([...collectIcons({ a: [{ icon: "x" }, { b: { icon: "y" } }], icon: 3 })], ["x", "y"]);
});

test("compileTimeline inlines icons, resolves map countries without mutating the storyboard", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  sb.scenes[1] = { ...sb.scenes[1], type: "unit-grid", props: { icon: "rocket", groups: [{ count: 2, label: "a", icon: "flag:us" }] } };
  sb.scenes[2] = { ...sb.scenes[2], type: "map", props: { highlight: [{ id: "日本" }] } };
  const before = JSON.stringify(sb);
  const { timeline, errors } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(timeline.icons).sort(), ["flag:us", "rocket"]);
  assert.equal(timeline.scenes[2].props.highlight[0].id, "392");
  assert.equal(JSON.stringify(sb), before);
  sb.scenes[1].props.icon = "nope-nope";
  sb.scenes[2].props.highlight[0].id = "Atlantis";
  const bad = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets }).errors;
  assert.ok(bad.some((e) => /unknown icon "nope-nope"/.test(e)));
  assert.ok(bad.some((e) => /unknown country "Atlantis"/.test(e)));
});

test("compileTimeline marks full-frame scene types opaque", () => {
  const ex = example();
  const sb = structuredClone(ex.storyboard);
  const asset = ex.fetchedAssets.items[0].id;
  sb.scenes[1] = { ...sb.scenes[1], type: "focus", backdrop: undefined, props: { asset, regions: [{ x: 0, y: 0, w: 0.5, h: 0.5 }] } };
  sb.scenes[2] = { ...sb.scenes[2], type: "photo-stack", backdrop: undefined, props: { items: [{ asset }] } };
  const { timeline } = compileTimeline({ ...ex, storyboard: sb, assets: ex.fetchedAssets });
  assert.equal(timeline.scenes[1].opaque, true);
  assert.equal(timeline.scenes[2].opaque, false);
});
