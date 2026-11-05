// lib list | search | import | merge | verify — the shared asset library (cli/lib/library.mjs).
import { readFileSync } from "node:fs";
import { UserError, log, warn } from "../lib/project.mjs";
import { CATALOG, extRoot, importCandidates, loadCatalog, mergeCatalogs, saveCatalog, searchCatalog, verifyCatalog, entryAvailable } from "../lib/library.mjs";

const row = (e) => `${e.id.padEnd(24)} ${(e.store === "ext" ? "ext " : "repo")} ${entryAvailable(e) ? "✓" : "·"} ${String(e.audio?.duration ?? "").padStart(6)}s  ${e.provenance?.source ?? ""}${e.note ? ` — ${e.note}` : ""}`;

export async function lib(args) {
  const [sub, ...rest] = args._;
  const catalog = loadCatalog();
  if (!sub || sub === "list") {
    const entries = catalog.entries.filter((e) => (!args.category || e.category === args.category) && (!args.kind || e.kind === args.kind));
    if (args.json) return console.log(JSON.stringify(entries, null, 2));
    const byCat = new Map();
    for (const e of entries) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]);
    for (const [cat, es] of [...byCat].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`${cat}  (default ${catalog.defaults[cat] ?? "—"})`);
      for (const e of es) console.log(`  ${row(e)}`);
    }
    return log(`${entries.length} entries, ${byCat.size} categories · ✓ = file on this host (ext store: ${extRoot()})`);
  }
  if (sub === "search") {
    const hits = searchCatalog(rest.join(" "), catalog);
    if (args.json) return console.log(JSON.stringify(hits, null, 2));
    for (const e of hits) console.log(row(e));
    return log(`${hits.length} matches`);
  }
  if (sub === "import") {
    if (!rest[0]) throw new UserError("usage: onevideo lib import <candidates.json> [--force]");
    const candidates = JSON.parse(readFileSync(rest[0], "utf8"));
    if (!Array.isArray(candidates)) throw new UserError("candidates file must be a JSON array");
    const res = await importCandidates(candidates, {
      catalog, force: Boolean(args.force),
      onEntry: ({ id, status, error }) => { if (status === "added") log(`+ ${id}`); else if (status === "failed") warn(`${id}: ${error}`); },
    });
    saveCatalog(res.catalog);
    return log(`import: ${res.added} added, ${res.skipped} kept/absent, ${res.failed} failed → ${CATALOG}`);
  }
  if (sub === "merge") {
    if (!rest[0]) throw new UserError("usage: onevideo lib merge <other-catalog.json>");
    const merged = mergeCatalogs(catalog, JSON.parse(readFileSync(rest[0], "utf8")));
    saveCatalog(merged);
    return log(`merged: ${merged.entries.length} entries`);
  }
  if (sub === "verify") {
    const res = verifyCatalog(catalog);
    const bad = res.filter((r) => r.status === "missing" || r.status === "mismatch");
    for (const r of bad) warn(`${r.id}: ${r.status}`);
    const n = (s) => res.filter((r) => r.status === s).length;
    log(`verify: ${n("ok")} ok, ${n("unavailable")} ext not on this host, ${n("missing")} missing, ${n("mismatch")} mismatch`);
    if (bad.length) process.exitCode = 1;
    return;
  }
  throw new UserError(`unknown lib subcommand "${sub}" (list, search, import, merge, verify)`);
}
