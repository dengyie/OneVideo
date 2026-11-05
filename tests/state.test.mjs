import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productsHash } from "../cli/lib/state.mjs";

test("productsHash: missing or empty (dotfiles only) products are not done", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-state-"));
  assert.equal(productsHash(root, ["out"]), null);
  mkdirSync(join(root, "out"));
  writeFileSync(join(root, "out", ".DS_Store"), "x");
  assert.equal(productsHash(root, ["out"]), null);
});

test("productsHash changes with content and ignores dotfiles", () => {
  const root = mkdtempSync(join(tmpdir(), "ov-state-"));
  mkdirSync(join(root, "out"));
  writeFileSync(join(root, "out", "a.mp4"), "1");
  const h1 = productsHash(root, ["out"]);
  writeFileSync(join(root, "out", ".DS_Store"), "junk");
  assert.equal(productsHash(root, ["out"]), h1);
  writeFileSync(join(root, "out", "a.mp4"), "2");
  assert.notEqual(productsHash(root, ["out"]), h1);
});
