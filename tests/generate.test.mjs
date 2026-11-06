import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateImage, generateVideo, fetchAsset } from "../cli/lib/assets.mjs";
import { ask, parseJsonReply } from "../cli/lib/llm.mjs";
import { sheetPlan, sceneAt } from "../cli/commands/director.mjs";
import { REMOTION_BIN, ffmpeg } from "../cli/lib/ffmpeg.mjs";

// A stand-in relay: `routes[path]` answers (req, body) → [status, json | Buffer]; calls are logged.
async function relay(routes) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : null;
      calls.push({ method: req.method, path: req.url, json, auth: req.headers.authorization });
      const route = Object.entries(routes).find(([p]) => new RegExp(`^${p}$`).test(req.url));
      const [status, out] = route ? route[1](req, json) : [404, { error: "no route" }];
      res.writeHead(status, { "Content-Type": Buffer.isBuffer(out) ? "application/octet-stream" : "application/json" });
      res.end(Buffer.isBuffer(out) ? out : JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.OV_TEST_KEY = "test-key";
  return { base: `http://127.0.0.1:${server.address().port}/v1`, calls, close: () => server.close() };
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const chat = (content) => [200, { choices: [{ message: { content } }] }];

test("image generation falls back to the next model and asks non-OpenAI models for base64", async () => {
  const r = await relay({
    "/v1/images/generations": (_, j) => (j.model === "broken" ? [500, { error: "down" }] : [200, { data: [{ b64_json: PNG.toString("base64") }] }]),
  });
  try {
    const dir = mkdtempSync(join(tmpdir(), "ov-gen-"));
    const item = await generateImage({ id: "dawn", generate: { prompt: "a rocket at dawn" } }, { dir, aspect: "9:16", defaults: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["broken", "grok-imagine-image"] } });
    assert.equal(item.file, "assets/dawn.png");
    assert.equal(item.author, "grok-imagine-image");
    assert.deepEqual(readFileSync(join(dir, "dawn.png")), PNG);
    const ok = r.calls.find((c) => c.json.model === "grok-imagine-image");
    assert.equal(ok.json.size, "1024x1536");
    assert.equal(ok.json.response_format, "b64_json");
    assert.equal(ok.auth, "Bearer test-key");
    assert.equal(r.calls.find((c) => c.json.model === "broken").json.response_format, "b64_json");
  } finally { r.close(); }
});

test("variants: a vision model picks the take; every take stays on disk", async () => {
  let n = 0;
  const r = await relay({
    "/v1/images/generations": () => [200, { data: [{ b64_json: (n++ === 1 ? PNG : JPG).toString("base64") }] }],
    "/v1/chat/completions": (_, j) => (j.model === "mute" ? chat("") : chat('Sure:\n```json\n{"best": 1, "reason": "clear subject"}\n```')),
  });
  try {
    const dir = mkdtempSync(join(tmpdir(), "ov-gen-"));
    const item = await generateImage({ id: "pad", generate: { prompt: "launch pad", variants: 3, brief: "establishing shot" } }, {
      dir, defaults: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["gpt-image-2.5"] }, llm: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["mute", "eyes"] },
    });
    assert.deepEqual(item.takes, ["assets/pad.take0.jpg", "assets/pad.take1.png", "assets/pad.take2.jpg"]);
    assert.equal(item.picked, 1);
    assert.equal(item.pickedBy, "eyes");
    assert.equal(item.file, "assets/pad.png");
    assert.deepEqual(readFileSync(join(dir, "pad.png")), PNG);
    assert.equal(r.calls.find((c) => c.json.model === "gpt-image-2.5").json.response_format, undefined);
    const look = r.calls.find((c) => c.json.model === "eyes");
    assert.equal(look.json.messages[0].content.filter((p) => p.type === "image_url").length, 3);
    assert.match(look.json.messages[0].content[0].text, /establishing shot/);
  } finally { r.close(); }
});

test("a failed generation falls back to the item's stock url", async () => {
  const r = await relay({ "/v1/images/generations": () => [400, { error: "bad prompt" }], "/photo.jpg": () => [200, JPG] });
  try {
    const publicDir = mkdtempSync(join(tmpdir(), "ov-gen-"));
    const warnings = [];
    const item = await fetchAsset({ id: "x", generate: "y", url: r.base.replace("/v1", "/photo.jpg"), license: "CC0" }, { publicDir, gen: { image: { baseUrl: r.base, keyEnv: "OV_TEST_KEY" }, onWarn: (m) => warnings.push(m) } });
    assert.equal(item.via, "url");
    assert.equal(item.file, "assets/x.jpg");
    assert.match(warnings[0], /falling back to url/);
  } finally { r.close(); }
});

test("ask walks the model list and parses JSON replies", async () => {
  const r = await relay({
    "/v1/chat/completions": (_, j) => (j.model === "gone" ? [500, { error: "no channel" }] : j.model === "blank" ? chat("⚠️ Upstream Gemini returned an empty response.") : chat('{"ok": true, "s": "a } b"}')),
  });
  try {
    const res = await ask({ prompt: "hi", json: true, config: { llm: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["gone", "blank", "good"] } } });
    assert.deepEqual(res, { data: { ok: true, s: "a } b" }, model: "good" });
    await assert.rejects(ask({ prompt: "hi", config: { llm: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["gone"] } } }), /no model answered \(gone: HTTP 500/);
  } finally { r.close(); }
  assert.deepEqual(parseJsonReply("x [1, [2]] y"), [1, [2]]);
  assert.throws(() => parseJsonReply("nothing here"), /no JSON/);
});

test("contact sheet geometry and scene lookup", () => {
  assert.deepEqual(sheetPlan(35.4).map((s) => [s.t0, s.cells, s.cols, s.rows]), [[0, 24, 6, 4], [24, 12, 6, 2]]);
  assert.equal(sheetPlan(120)[0].step, 2);
  assert.deepEqual(sheetPlan(10, { fps: 2, from: 4, to: 6 }).map((s) => [s.t0, s.cells, s.cols]), [[4, 4, 4]]);
  const tl = { scenes: [{ id: "a", start: 0 }, { id: "b", start: 11.6 }] };
  assert.equal(sceneAt(tl, 11.6), "b");
  assert.equal(sceneAt(tl, 3), "a");
});

test("video generation: submit, poll, download, cut; image-to-video sends the still", { skip: !existsSync(REMOTION_BIN) && "needs template deps (ffmpeg)" }, async () => {
  const src = join(mkdtempSync(join(tmpdir(), "ov-vid-")), "src.mp4");
  await ffmpeg(["-y", "-f", "lavfi", "-i", "nullsrc=size=320x180:rate=30:duration=2", "-c:v", "libx264", "-preset", "ultrafast", src]);
  const mp4 = readFileSync(src);
  let polls = 0;
  const r = await relay({
    "/v1/videos": (_, j) => [200, { id: j.model === "busy" ? "t-busy" : "t-ok", status: "queued" }],
    "/v1/videos/t-busy": () => [200, { status: "failed", error: { message: "upstream 429: Too many requests" } }],
    "/v1/videos/t-ok": () => [200, { status: ++polls < 2 ? "processing" : "completed" }],
    "/v1/videos/t-ok/content": () => [200, mp4],
  });
  try {
    const publicDir = mkdtempSync(join(tmpdir(), "ov-vid-"));
    mkdirSync(join(publicDir, "assets"));
    writeFileSync(join(publicDir, "assets", "still.jpg"), JPG);
    const item = await generateVideo({ id: "move", kind: "video", generate: { prompt: "push in", from: "still", duration: 4.6 } }, {
      publicDir, aspect: "16:9", lookup: (id) => (id === "still" ? { id, file: "assets/still.jpg" } : null),
      defaults: { baseUrl: r.base, keyEnv: "OV_TEST_KEY", models: ["busy", "grok-imagine-video"], pollSec: 0.01 },
    });
    assert.equal(item.file, "assets/move.mp4");
    assert.equal(item.author, "grok-imagine-video");
    assert.equal(item.width, 320);
    assert.ok(existsSync(join(publicDir, "assets", "move.frames", "0001.jpg")));
    const sub = r.calls.find((c) => c.path === "/v1/videos" && c.json.model === "grok-imagine-video").json;
    assert.equal(sub.duration, 5);
    assert.equal(sub.aspect_ratio, "16:9");
    assert.match(sub.image.url, /^data:image\/jpeg;base64,/);
    await assert.rejects(generateVideo({ id: "m2", kind: "video", generate: { prompt: "p", from: "nope" } }, { publicDir, lookup: () => null, defaults: { baseUrl: r.base, keyEnv: "OV_TEST_KEY" } }), /"nope" is not fetched yet/);
  } finally { r.close(); }
});
