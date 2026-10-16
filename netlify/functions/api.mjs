// bVille Expedition API — one function, routed under /api/*
// Storage: Netlify Blobs. Auth: Netlify Identity (writes need a signed-in explorer).
import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";

const PUBLIC = new Set(["scores", "acts", "photos", "reports"]);   // anyone can read
const OWN_DOC = new Set(["scores", "acts"]);                       // one doc per explorer, keyed by their id
const POSTS = new Set(["photos", "reports"]);                      // many per explorer, grouped by site
const MAX_JSON = 64 * 1024, MAX_IMG = 6 * 1024 * 1024;
const store = name => getStore({ name: "bville-" + name, consistency: "strong" });
const json = (b, s = 200, h = {}) => Response.json(b, { status: s, headers: { "cache-control": "no-store", ...h } });
const bad = (msg, s = 400) => json({ error: msg }, s);
const ADMIN = (process.env.BVILLE_ADMINS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);

async function me(){
  try { const u = await getUser(); if (!u) return null;
    const name = (u.name || (u.email || "").split("@")[0] || "Explorer").slice(0, 40);
    // keep a public display name for the board (never the email address)
    const p = store("profiles"); const cur = await p.get(u.id, { type: "json" });
    if (!cur || cur.name !== name) await p.setJSON(u.id, { name });
    return { id: u.id, name, admin: !!u.email && ADMIN.includes(u.email.toLowerCase()) };
  } catch (e) { return null; }
}
async function body(req, max = MAX_JSON){
  const t = await req.text(); if (t.length > max) throw new Error("too_large");
  const v = JSON.parse(t || "{}"); if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("bad_body"); return v;
}
async function listAll(s, prefix){
  const { blobs } = await s.list(prefix ? { prefix } : {});
  const out = await Promise.all(blobs.map(async b => { const d = await s.get(b.key, { type: "json" }); return d ? { id: b.key.split("/").pop(), ...d } : null; }));
  return out.filter(Boolean);
}
const clean = (v, n) => String(v ?? "").slice(0, n);

export default async (req, context) => {
  const url = new URL(req.url), parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d] = parts, M = req.method;
  try {
    // --- who am I
    if (a === "me" && !b && M === "GET") { const u = await me(); return json({ user: u }); }
    // --- private progress: one doc per explorer
    if (a === "me" && b === "progress") {
      const u = await me(); if (!u) return bad("sign_in", 401);
      const s = store("progress");
      if (M === "GET") return json({ data: await s.get(u.id, { type: "json" }) });
      if (M === "PUT") { const v = await body(req, 256 * 1024); v.savedAt = Date.now(); await s.setJSON(u.id, v); return json({ ok: true }); }
    }
    // --- display names
    if (a === "profiles" && M === "GET") {
      const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 200), p = store("profiles"), out = {};
      await Promise.all(ids.map(async id => { const v = await p.get(id, { type: "json" }); out[id] = { name: v?.name || "" }; }));
      return json(out, 200, { "cache-control": "public, max-age=60" });
    }
    // --- images
    if (a === "img" && b && M === "GET") {
      const r = await store("images").getWithMetadata(b, { type: "arrayBuffer" }); if (!r) return new Response("Not found", { status: 404 });
      return new Response(r.data, { headers: { "content-type": r.metadata?.type || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
    }
    if (a === "img" && !b && M === "POST") {
      const u = await me(); if (!u) return bad("sign_in", 401);
      const type = req.headers.get("content-type") || ""; if (!/^image\/(jpeg|png|webp)$/.test(type)) return bad("unsupported_type", 415);
      const buf = await req.arrayBuffer(); if (buf.byteLength > MAX_IMG) return bad("too_large", 413);
      const id = crypto.randomUUID().replace(/-/g, "");
      await store("images").set(id, buf, { metadata: { type, by: u.id, at: Date.now() } });
      return json({ id, url: "/api/img/" + id });
    }
    // --- collections
    if (a === "c" && b) {
      const col = b, s = store(col);
      if (M === "GET" && PUBLIC.has(col)) {
        const stop = url.searchParams.get("stop");
        if (POSTS.has(col) && !stop) return bad("stop_required");
        let rows = await listAll(s, POSTS.has(col) ? clean(stop, 80) + "/" : "");
        return json({ docs: rows });
      }
      const u = await me(); if (!u) return bad("sign_in", 401);
      if (OWN_DOC.has(col) && c && M === "PUT") {
        if (c !== u.id) return bad("not_yours", 403);
        const v = await body(req);
        if (col === "acts") { if (!Array.isArray(v.list) || v.list.length > 2000) return bad("bad_body"); }
        if (col === "scores") { for (const k of ["m", "found", "relics", "dug"]) v[k] = Math.max(0, Math.min(1e6, Number(v[k]) || 0)); v.rank = clean(v.rank, 40); }
        v.at = Date.now(); await s.setJSON(u.id, v); return json({ ok: true });
      }
      if (POSTS.has(col) && !c && M === "POST") {
        const v = await body(req), stop = clean(v.stop, 80), text = clean(v.text, col === "photos" ? 280 : 600).trim();
        if (!stop || !text) return bad("bad_body");
        const doc = { stop, text, at: Date.now(), author: u.id }; if (col === "photos") { doc.asset = clean(v.asset, 64); if (!doc.asset) return bad("bad_body"); }
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        await s.setJSON(stop + "/" + id, doc); return json({ id, ...doc });
      }
      if (POSTS.has(col) && c && d && M === "DELETE") {
        const key = c + "/" + d, cur = await s.get(key, { type: "json" }); if (!cur) return bad("not_found", 404);
        if (cur.author !== u.id && !u.admin) return bad("not_yours", 403);
        await s.delete(key); return json({ ok: true });
      }
    }
    return bad("not_found", 404);
  } catch (e) {
    const m = String(e?.message || e); return bad(m === "too_large" ? "too_large" : m === "bad_body" || e instanceof SyntaxError ? "bad_body" : "server_error", m === "too_large" ? 413 : e instanceof SyntaxError || m === "bad_body" ? 400 : 500);
  }
};
export const config = { path: "/api/*" };
