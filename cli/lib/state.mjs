// Stage state: a stage is "done" when its products exist, "approved" when a human signed off
// on the exact product contents (hash recorded), and "stale" when products changed after approval.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "./project.mjs";

function hashPath(path, h) {
  if (!existsSync(path)) return false;
  if (statSync(path).isDirectory()) {
    // An empty directory (e.g. a fresh out/) is not a product yet.
    const files = readdirSync(path).filter((f) => !f.startsWith(".")).sort();
    if (!files.length) return false;
    for (const f of files) hashPath(join(path, f), h);
  } else h.update(path).update(readFileSync(path));
  return true;
}

export function productsHash(root, products) {
  const h = createHash("sha1");
  for (const p of products) if (!hashPath(join(root, p), h)) return null;
  return h.digest("hex").slice(0, 16);
}

export function loadState(project) {
  return readJson(project.paths.state, { stages: {} });
}

export function stageStatus(project, pipeline, state = loadState(project)) {
  const out = [];
  let blocked = false;
  for (const stage of pipeline.stages) {
    const products = stage.produces ?? [];
    const hash = products.length ? productsHash(project.root, products) : null;
    const rec = state.stages[stage.id];
    let status;
    if (hash === null) status = stage.optional ? "optional" : "pending";
    else if (!stage.approval) status = "done";
    else if (rec?.hash === hash) status = "approved";
    else if (rec?.hash) status = "stale";
    else status = "awaiting-approval";
    const row = { ...stage, status, blocked, approvedAt: rec?.at ?? null };
    out.push(row);
    if (!["done", "approved", "optional"].includes(status)) blocked = true;
  }
  return out;
}

export function approveStage(project, pipeline, stageId, note) {
  const stage = pipeline.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`pipeline "${pipeline.name}" has no stage "${stageId}" (${pipeline.stages.map((s) => s.id).join(", ")})`);
  const hash = productsHash(project.root, stage.produces ?? []);
  if (hash === null) throw new Error(`stage "${stageId}" has no products yet (${(stage.produces ?? []).join(", ")})`);
  const state = loadState(project);
  state.stages[stageId] = { hash, at: new Date().toISOString(), ...(note ? { note } : {}) };
  writeJson(project.paths.state, state);
  return state.stages[stageId];
}
