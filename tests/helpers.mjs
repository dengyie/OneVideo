import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const EXAMPLE = join(ROOT, "examples", "spacex-ipo");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

// The SpaceX example plus the timings measured in a real TTS run.
// `media` lists files to create (empty) under a temporary public/, standing in for rendered audio.
export function example({ media = ["sfx/whoosh.wav", "sfx/pop.wav", "music/bgm.wav"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ov-example-"));
  for (const f of media) {
    mkdirSync(dirname(join(root, "public", f)), { recursive: true });
    writeFileSync(join(root, "public", f), "");
  }
  // The manifest as `assets fetch` leaves it, with empty stand-in files.
  const items = json(join(EXAMPLE, "plan", "assets.json")).items.map((a) => ({ ...a, file: `assets/${a.id}.jpg` }));
  mkdirSync(join(root, "public", "assets"), { recursive: true });
  for (const a of items) writeFileSync(join(root, "public", a.file), "");
  return {
    root,
    config: json(join(EXAMPLE, "onevideo.json")),
    script: json(join(EXAMPLE, "plan", "script.json")),
    storyboard: json(join(EXAMPLE, "plan", "storyboard.json")),
    research: json(join(EXAMPLE, "plan", "research.json")),
    timings: json(join(ROOT, "tests", "fixtures", "spacex-timings.json")),
    fetchedAssets: { items },
  };
}
