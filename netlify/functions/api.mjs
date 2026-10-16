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

// ---- Explorer accounts: no passwords. A player holds a secret token on their phone;
// an explorer code moves them to another phone; Google sign-in can be linked as a backup.
const enc = new TextEncoder();
async function sha(t){ const d = await crypto.subtle.digest("SHA-256", enc.encode(t)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join(""); }
const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => { const a = rand(8); let c = ""; for (let i = 0; i < 8; i++) c += CODE_ABC[a[i] % CODE_ABC.length]; return "BVILLE-" + c.slice(0, 4) + "-" + c.slice(4); };
const newToken = () => [...rand(24)].map(b => b.toString(16).padStart(2, "0")).join("");
const cleanName = n => String(n || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
async function setProfile(id, name){ const p = store("profiles"); const cur = await p.get(id, { type: "json" }); if (!cur || cur.name !== name) await p.setJSON(id, { name }); }
async function issue(id, player){
  const token = newToken(); player.tokens = [await sha(token), ...(player.tokens || [])].slice(0, 6);
  await store("players").setJSON(id, player); return { id, token, code: player.code, name: player.name };
}
async function makePlayer(id, name){
  const codes = store("codes"); let code = newCode();
  for (let i = 0; i < 5; i++) { const r = await codes.set(code, id, { onlyIfNew: true }); if (r.modified !== false) break; code = newCode(); }
  const player = { name, code, created: Date.now(), tokens: [] }; await setProfile(id, name);
  return issue(id, player);
}
async function playerFromHeader(req){
  const h = req.headers.get("x-player") || ""; const [id, token] = h.split(".");
  if (!id || !token || !/^p_[a-z0-9]+$|^[0-9a-f-]{20,}$/.test(id)) return null;
  const pl = await store("players").get(id, { type: "json" }); if (!pl) return null;
  if (!(pl.tokens || []).includes(await sha(token))) return null;
  return { id, pl };
}
async function identityUser(){ try { return await getUser(); } catch (e) { return null; } }
let REQ = null;
async function me(){
  try {
    const p = await playerFromHeader(REQ);
    if (p) return { id: p.id, name: p.pl.name, code: p.pl.code, admin: !!p.pl.admin, google: !!p.pl.google };
    // older email/Google sessions with no player token yet
    const u = await identityUser(); if (!u) return null;
    const link = await store("links").get(u.id, { type: "json" }); const id = link?.player || u.id;
    const pl = await store("players").get(id, { type: "json" });
    return { id, name: pl?.name || cleanName(u.name) || "Explorer", code: pl?.code || null, admin: !!u.email && ADMIN.includes(u.email.toLowerCase()), google: true };
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
  const [a, b, c, d] = parts, M = req.method; REQ = req;
  try {
    // --- accounts
    if (a === "join" && M === "POST") {
      const v = await body(req), name = cleanName(v.name) || "Explorer " + (1000 + Math.floor(Math.random() * 9000));
      const id = "p_" + [...rand(9)].map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
      return json(await makePlayer(id, name));
    }
    if (a === "restore" && M === "POST") {
      const v = await body(req), code = String(v.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^BVILLE/, "");
      if (code.length !== 8) return bad("bad_code");
      const id = await store("codes").get("BVILLE-" + code.slice(0, 4) + "-" + code.slice(4)); if (!id) return bad("bad_code", 404);
      const pl = await store("players").get(id, { type: "json" }); if (!pl) return bad("bad_code", 404);
      return json(await issue(id, pl));
    }
    if (a === "me" && b === "name" && M === "PUT") {
      const p = await playerFromHeader(req); if (!p) return bad("sign_in", 401);
      const name = cleanName((await body(req)).name); if (name.length < 2) return bad("bad_name");
      p.pl.name = name; await store("players").setJSON(p.id, p.pl); await setProfile(p.id, name); return json({ ok: true, name });
    }
    // link the Google account that is signed in to this player (backup)
    if (a === "me" && b === "link" && M === "POST") {
      const p = await playerFromHeader(req), u = await identityUser(); if (!p || !u) return bad("sign_in", 401);
      await store("links").setJSON(u.id, { player: p.id, at: Date.now() }); p.pl.google = true; if (u.email && ADMIN.includes(u.email.toLowerCase())) p.pl.admin = true;
      await store("players").setJSON(p.id, p.pl); return json({ ok: true });
    }
    // signed in with Google on a new phone: hand back that player (or create one)
    if (a === "google" && M === "POST") {
      const u = await identityUser(); if (!u) return bad("sign_in", 401);
      const link = await store("links").get(u.id, { type: "json" });
      if (link?.player) { const pl = await store("players").get(link.player, { type: "json" }); if (pl) return json(await issue(link.player, pl)); }
      const id = u.id, old = await store("players").get(id, { type: "json" });
      const out = old ? await issue(id, old) : await makePlayer(id, cleanName(u.name) || (await store("profiles").get(id, { type: "json" }))?.name || "Explorer");
      const pl = await store("players").get(id, { type: "json" }); pl.google = true; if (u.email && ADMIN.includes(u.email.toLowerCase())) pl.admin = true; await store("players").setJSON(id, pl);
      await store("links").setJSON(u.id, { player: id, at: Date.now() }); return json(out);
    }
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
