#!/usr/bin/env node
// OneVideo CLI — a staged, gated pipeline for narrated data/documentary videos on Remotion.
import { parseArgs } from "./lib/args.mjs";
import { UserError } from "./lib/project.mjs";
import * as plan from "./commands/plan.mjs";
import * as media from "./commands/media.mjs";
import * as render from "./commands/render.mjs";

const COMMANDS = {
  init: [plan.init, "init <dir> [--pipeline data-explainer] [--style midnight-data] [--aspect 16:9] [--title …] [--example spacex-ipo]"],
  status: [plan.status, "status                       stage table + next director doc"],
  validate: [plan.validate, "validate [--strict]          schemas + pre-compose gates"],
  approve: [plan.approve, "approve <stage> [--note …]   human sign-off (hash-locked)"],
  tts: [media.tts, "tts [--sample] [--dry] [--force] [--only s1,s2]   sentence-level narration → plan/timings.json"],
  music: [media.music, "music [--preset ambient|pulse|documentary|bright] [--force]   procedural BGM + SFX"],
  timeline: [media.timeline, "timeline [--force]           compile plan/timeline.json"],
  assets: [media.assets, "assets search <query> [--provider …] [--kind video] | assets fetch [--only id] [--force]"],
  decide: [media.decide, "decide <category> <subject> --selected X [--options a,b] [--reason …]"],
  render: [render.render, "render [--draft] [--frames 0-90] [--concurrency 4] [--force]"],
  stills: [render.stills, "stills [--scene id,id] [--at 0.7]   one JPEG per scene → out/stills/"],
  studio: [render.studio, "studio [--port 3000]         Remotion Studio on this project"],
  qc: [render.qc, "qc [--video file]            post-render review → plan/review.json"],
  publish: [render.publish, "publish                      SRT/VTT, chapters, description → out/publish/"],
  build: [render.build, "build [--draft]              tts → music → timeline → render → qc → publish"],
  doctor: [render.doctor, "doctor                       environment check"],
};

function help() {
  console.log("onevideo <command> [options]\n");
  for (const [, usage] of Object.values(COMMANDS)) console.log(`  ${usage}`);
  console.log("\nDocs: SKILL.md · stages/*.md · references/*.md");
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") help();
else if (!COMMANDS[cmd]) {
  console.error(`unknown command "${cmd}"\n`);
  help();
  process.exitCode = 2;
} else {
  try {
    await COMMANDS[cmd][0](parseArgs(rest, { booleans: ["force", "dry", "sample", "draft", "strict", "json"] }));
  } catch (e) {
    console.error(`✗ ${e instanceof UserError ? e.message : e.stack ?? e.message}`);
    process.exitCode = 1;
  }
}
