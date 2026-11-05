// Collects every pre-compose issue for a project; used by `validate`, `timeline` and `render`.
import { existsSync } from "node:fs";
import { readJson } from "./project.mjs";
import { schemaGate, numbersGate, captionGate, storyboardGate, rateGate, assetsGate, budgetGate, summarize } from "./gates.mjs";
import { compileTimeline } from "./timeline.mjs";

export function loadPlan(project) {
  const { paths } = project;
  const opt = (p) => (existsSync(p) ? readJson(p) : null);
  return {
    research: opt(paths.research),
    script: opt(paths.script),
    storyboard: opt(paths.storyboard),
    assets: opt(paths.assets),
    timings: opt(paths.timings),
  };
}

export function checkProject(project, { needTimings = false } = {}) {
  const { config } = project;
  const plan = loadPlan(project);
  const issues = [...schemaGate("project", config)];
  if (plan.research) issues.push(...schemaGate("research", plan.research));
  if (!plan.script) issues.push({ level: "error", gate: "files", msg: "missing plan/script.json (stage: script)" });
  else issues.push(...schemaGate("script", plan.script));
  if (!plan.storyboard) issues.push({ level: "error", gate: "files", msg: "missing plan/storyboard.json (stage: storyboard)" });
  else issues.push(...schemaGate("storyboard", plan.storyboard));
  if (plan.assets) issues.push(...schemaGate("assets", plan.assets));
  const structural = summarize(issues).errors.length > 0;

  let timeline = null;
  if (!structural) {
    issues.push(...numbersGate(plan.script, plan.research, config));
    issues.push(...captionGate(plan.script, config));
    issues.push(...budgetGate(plan.script, config));
    issues.push(...storyboardGate(plan.storyboard, plan.script, config, plan.assets));
    if (plan.assets) issues.push(...assetsGate(plan.assets, config));
    if (plan.timings) {
      issues.push(...rateGate(plan.script, plan.timings, config));
      const res = compileTimeline({ config, script: plan.script, storyboard: plan.storyboard, timings: plan.timings, assets: plan.assets, research: plan.research, root: project.root });
      issues.push(...res.errors.map((msg) => ({ level: "error", gate: "timeline", msg })));
      issues.push(...res.warnings.map((msg) => ({ level: "warn", gate: "timeline", msg })));
      timeline = res.timeline;
    } else if (needTimings) issues.push({ level: "error", gate: "files", msg: "missing plan/timings.json; run: onevideo tts" });
  }
  return { plan, issues, timeline, ...summarize(issues) };
}

export function printIssues(issues, log = console.log) {
  for (const i of issues) log(`${i.level === "error" ? "✗" : "⚠"} [${i.gate}] ${i.msg}`);
}
