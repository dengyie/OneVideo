// Workers static assets answer Range requests with a full 200, which iOS Safari refuses to play
// and which makes every seek re-download the file. /v/* runs through here instead: the first hit
// loads the asset into the colo's edge cache, and the cache answers Range with proper 206s.
export default {
  async fetch(req, env, ctx) {
    if (req.method !== "GET") return env.ASSETS.fetch(req);
    const cache = caches.default;
    const hit = await cache.match(req);
    if (hit) return hit;

    const res = await env.ASSETS.fetch(new Request(req.url));
    if (res.status !== 200) return res;
    // The binding's response can be chunked with no Content-Length; buffer once to know the size.
    const buf = new Uint8Array(await res.arrayBuffer());
    const headers = new Headers(res.headers);
    headers.set("Content-Length", String(buf.byteLength));
    headers.set("Accept-Ranges", "bytes");
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=86400");
    const key = new Request(req.url);
    await cache.put(key, new Response(buf.slice(), { headers }));
    return (await cache.match(req)) ?? rangeResponse(req, buf, headers);
  },
};

// Fallback when the edge cache refused the entry: slice the buffer ourselves.
function rangeResponse(req, buf, headers) {
  const size = buf.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec((req.headers.get("Range") ?? "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return new Response(buf, { headers });
  let start, end;
  if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
  const h = new Headers(headers);
  h.set("Content-Range", `bytes ${start}-${end}/${size}`);
  h.set("Content-Length", String(end - start + 1));
  return new Response(buf.subarray(start, end + 1), { status: 206, headers: h });
}
