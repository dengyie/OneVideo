import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";
import { compileTimeline } from "../cli/lib/timeline.mjs";
import { resolveApiKey, requireApiKey } from "../cli/lib/http.mjs";

const CLI = join(ROOT, "cli", "onevideo.mjs");
const ov = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, HOME: cwd } });
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

function exampleProject() {
  const dir = join(mkdtempSync(join(tmpdir(), "ov-cli-")), "demo");
  const r = ov(ROOT, "init", dir, "--example", "spacex-ipo");
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

test("approve script blocks an unsourced number even before a storyboard exists", () => {
  const dir = exampleProject();
  rmSync(join(dir, "plan", "storyboard.json"));
  const script = json(join(dir, "plan", "script.json"));
  script.scenes[0].narration += "市场规模将达到777万亿。";
  writeFileSync(join(dir, "plan", "script.json"), JSON.stringify(script));
  const r = ov(dir, "approve", "script");
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /"777万亿" not found in research facts/);
});

test("validate reports an unfetched media asset instead of crashing", () => {
  const dir = exampleProject();
  const sb = json(join(dir, "plan", "storyboard.json"));
  sb.scenes.splice(1, 0, { id: "photo", type: "media", duration: 3, props: { asset: "rocket" } });
  const script = json(join(dir, "plan", "script.json"));
  script.scenes.splice(1, 0, { id: "photo" });
  writeFileSync(join(dir, "plan", "storyboard.json"), JSON.stringify(sb));
  writeFileSync(join(dir, "plan", "script.json"), JSON.stringify(script));
  writeFileSync(join(dir, "plan", "assets.json"), JSON.stringify({ items: [{ id: "rocket", query: "falcon 9", license: "PD" }] }));
  writeFileSync(join(dir, "plan", "timings.json"), readFileSync(join(ROOT, "tests", "fixtures", "spacex-timings.json")));
  const r = ov(dir, "validate");
  assert.doesNotMatch(r.stderr, /TypeError/);
  assert.match(r.stdout, /\[timeline\] asset "rocket" not fetched/);
});

test("approvals survive copying the project to another directory", () => {
  const dir = exampleProject();
  assert.equal(ov(dir, "approve", "research").status, 0);
  const copy = join(mkdtempSync(join(tmpdir(), "ov-cli-")), "copy");
  cpSync(dir, copy, { recursive: true });
  assert.match(ov(copy, "status").stdout, /research\s+approved/);
});

test("publish requires the review stage to be approved", () => {
  const dir = exampleProject();
  const read = (f) => json(join(dir, "plan", f));
  const { timeline } = compileTimeline({ config: json(join(dir, "onevideo.json")), script: read("script.json"), storyboard: read("storyboard.json"), timings: json(join(ROOT, "tests", "fixtures", "spacex-timings.json")), research: read("research.json") });
  writeFileSync(join(dir, "plan", "timeline.json"), JSON.stringify(timeline));
  writeFileSync(join(dir, "plan", "review.json"), JSON.stringify({ verdict: "pass", checks: [], frames: [] }));
  const denied = ov(dir, "publish");
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /review stage is awaiting-approval/);
  assert.equal(ov(dir, "approve", "review").status, 0);
  const ok = ov(dir, "publish");
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(readFileSync(join(dir, "out", "publish", "captions.srt"), "utf8").length > 0);
});

test("shared API keys only go to trusted hosts", () => {
  const saved = { ...process.env };
  try {
    process.env.MANGO_API_KEY = "sk-test-shared";
    process.env.HOME = mkdtempSync(join(tmpdir(), "ov-home-"));
    delete process.env.ONEVIDEO_KEY_HOSTS;
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://api.mangoqwq.com/v1").key, "sk-test-shared");
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://evil.example/v1"), null);
    assert.throws(() => requireApiKey("MANGO_API_KEY", "https://evil.example/v1"), /dedicated variable/);
    process.env.OTHER_KEY = "sk-other";
    assert.equal(resolveApiKey("OTHER_KEY", "https://evil.example/v1").key, "sk-other");
    process.env.ONEVIDEO_KEY_HOSTS = "relay.example";
    assert.equal(resolveApiKey("MANGO_API_KEY", "https://relay.example/v1").key, "sk-test-shared");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
