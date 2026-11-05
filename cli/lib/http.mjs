// HTTP via curl: Cloudflare-fronted relays reject Node's fetch fingerprint.
// The curl config (URL, headers, body) goes through stdin so secrets never appear in argv.
import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { UserError } from "./project.mjs";

const UA = "OneVideo/0.1 (+https://github.com/dengyie/OneVideo)";

// Key lookup order: explicit env name → ONEVIDEO_API_KEY → MANGO_API_KEY → ~/.zcode provider config.
// The key is never printed; callers only learn where it came from.
export function resolveApiKey(envName) {
  for (const name of [envName, "ONEVIDEO_API_KEY", "MANGO_API_KEY"].filter(Boolean)) {
    if (process.env[name]) return { key: process.env[name], source: `env ${name}` };
  }
  const cfg = join(homedir(), ".zcode", "v2", "provider_config.json");
  if (existsSync(cfg)) {
    const m = readFileSync(cfg, "utf8").match(/sk-[A-Za-z0-9]{20,}/);
    if (m) return { key: m[0], source: "~/.zcode/v2/provider_config.json" };
  }
  return null;
}

export function requireApiKey(envName) {
  const k = resolveApiKey(envName);
  if (!k) throw new UserError(`no API key: set ${envName ?? "MANGO_API_KEY"} (or ONEVIDEO_API_KEY)`);
  return k.key;
}

const quote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function runCurl(config, timeoutSec = 180) {
  return new Promise((resolve, reject) => {
    const child = execFile("curl", ["-sS", "-K", "-", "-w", "\n%{http_code}", "-m", String(timeoutSec)], { encoding: "buffer", maxBuffer: 1 << 30 }, (err, stdout, stderr) => {
      if (err && !stdout?.length) return reject(new Error(`curl failed: ${stderr?.toString().trim() || err.message}`));
      const nl = stdout.lastIndexOf(10);
      resolve({ status: Number(stdout.subarray(nl + 1).toString()), body: stdout.subarray(0, nl) });
    });
    child.stdin.end(config);
  });
}

// JSON payloads travel inline in the config as a quoted data-binary value.
export async function request(url, { method = "GET", headers = {}, json, key, timeoutSec, retries = 3, accept } = {}) {
  const lines = [`url = ${quote(url)}`, `request = ${quote(method)}`, `user-agent = ${quote(UA)}`, "location"];
  if (key) lines.push(`header = ${quote(`Authorization: Bearer ${key}`)}`);
  if (accept) lines.push(`header = ${quote(`Accept: ${accept}`)}`);
  for (const [k, v] of Object.entries(headers)) lines.push(`header = ${quote(`${k}: ${v}`)}`);
  if (json !== undefined) {
    lines.push(`header = ${quote("Content-Type: application/json")}`);
    lines.push(`data-binary = ${quote(JSON.stringify(json))}`);
  }
  const config = lines.join("\n") + "\n";
  let last;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await runCurl(config, timeoutSec);
      if (res.status >= 200 && res.status < 300) return res;
      last = new Error(`HTTP ${res.status} from ${new URL(url).host}: ${res.body.subarray(0, 300).toString()}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      last = e;
    }
    if (attempt <= retries) await new Promise((r) => setTimeout(r, attempt * 2500));
  }
  throw last;
}

export async function getJson(url, opts) {
  const res = await request(url, { ...opts, accept: "application/json" });
  try {
    return JSON.parse(res.body.toString());
  } catch {
    throw new Error(`non-JSON response from ${url}: ${res.body.subarray(0, 200).toString()}`);
  }
}

export async function download(url, opts) {
  return (await request(url, { timeoutSec: 300, ...opts })).body;
}

// Run tasks with bounded concurrency, preserving result order.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
