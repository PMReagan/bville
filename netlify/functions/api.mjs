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
    // --- People's Register: nominations, votes, comments
    if (a === "noms") return await register(req, context, parts.slice(1));
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

/* ================= People's Register ================= */
const ADMIT_AT = 25;
const voteKey = (nom, v, who) => `${nom}/${v}/${who}`;
async function tally(nom){
  const { blobs } = await store("votes").list({ prefix: nom + "/" }); let yes = 0, no = 0;
  for (const b of blobs) { const v = b.key.split("/")[1]; if (v === "yes") yes++; else if (v === "no") no++; }
  const c = await store("ncomments").list({ prefix: nom + "/" });
  return { yes, no, comments: c.blobs.length };
}
async function voterId(req){
  const p = await playerFromHeader(req); if (p) return "pl:" + p.id;
  const v = (req.headers.get("x-voter") || "").replace(/[^a-z0-9]/gi, ""); return v.length >= 16 ? "v:" + v.slice(0, 40) : null;
}
async function geocode(addr){
  try { const u = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" + encodeURIComponent(addr + ", Birmingham, MI");
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 6000);
    const j = await (await fetch(u, { signal: ctl.signal })).json(); const m = j?.result?.addressMatches?.[0]?.coordinates;
    return m ? { lat: m.y, lon: m.x } : null; } catch (e) { return null; }
}
function publicNom(n, t, mine){
  const out = { id: n.id, title: n.title, year: n.year || "", story: n.story || "", street: n.street, addr: n.exact ? n.addr : "", lat: n.exact ? n.lat : null, lon: n.exact ? n.lon : null,
    asset: n.asset, at: n.at, by: n.by, byName: n.byName || "", status: n.status, admittedAt: n.admittedAt || null, ...t };
  if (mine !== undefined) out.myVote = mine; return out;
}
async function myVoteFor(nom, who){ if (!who) return null; const s = store("votes");
  if (await s.getMetadata(voteKey(nom, "yes", who))) return "yes"; if (await s.getMetadata(voteKey(nom, "no", who))) return "no"; return null; }
async function maybeAdmit(n, t){
  if (n.status === "open" && t.yes >= ADMIT_AT && t.yes > t.no) { n.status = "admitted"; n.admittedAt = Date.now(); await store("noms").setJSON(n.id, n); }
  return n;
}
async function register(req, context, parts){
  const [id, sub, cid, act] = parts, M = req.method, S = store("noms");
  // list
  if (!id && M === "GET") {
    const { blobs } = await S.list(); const who = await voterId(req);
    const rows = await Promise.all(blobs.map(async b => { const n = await S.get(b.key, { type: "json" }); if (!n || n.status === "hidden") return null;
      const t = await tally(n.id); await maybeAdmit(n, t); return publicNom(n, t, await myVoteFor(n.id, who)); }));
    return json({ noms: rows.filter(Boolean).sort((x, y) => y.at - x.at) });
  }
  // create (any explorer)
  if (!id && M === "POST") {
    const u = await me(); if (!u) return bad("sign_in", 401);
    const v = await body(req), title = clean(v.title, 60).trim(), street = clean(v.street, 40).trim(), num = clean(v.number, 8).replace(/[^0-9A-Za-z-]/g, "");
    if (title.length < 3 || street.length < 3 || !v.asset) return bad("bad_body");
    const nid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const n = { id: nid, title, year: clean(v.year, 12).trim(), story: clean(v.story, 600).trim(), street, addr: num ? num + " " + street : street, exact: !!v.exact && !!num,
      asset: clean(v.asset, 64), at: Date.now(), by: u.id, byName: u.name, status: "open" };
    if (n.exact) { const g = await geocode(n.addr); if (g) { n.lat = g.lat; n.lon = g.lon; } }
    await S.setJSON(nid, n); return json(publicNom(n, { yes: 0, no: 0, comments: 0 }, null));
  }
  const n = id ? await S.get(id, { type: "json" }) : null; if (!n) return bad("not_found", 404);
  if (!sub && M === "GET") {
    if (n.status === "hidden") return json({ hidden: true }, 410);
    const t = await tally(id); await maybeAdmit(n, t);
    const { blobs } = await store("ncomments").list({ prefix: id + "/" });
    const comments = (await Promise.all(blobs.map(async b => { const c = await store("ncomments").get(b.key, { type: "json" }); return c && !c.hidden ? { id: b.key.split("/")[1], name: c.name, text: c.text, at: c.at } : null; })))
      .filter(Boolean).sort((x, y) => x.at - y.at);
    return json({ ...publicNom(n, t, await myVoteFor(id, await voterId(req))), comments });
  }
  if (n.status === "hidden") return bad("not_found", 404);
  if (sub === "vote" && M === "POST") {
    const who = await voterId(req); if (!who) return bad("no_voter", 400);
    const v = (await body(req)).v; if (!["yes", "no", "clear"].includes(v)) return bad("bad_body");
    const ip = await sha((context?.ip || req.headers.get("x-nf-client-connection-ip") || "") + "|" + id), lim = store("votelimits");
    const prev = await myVoteFor(id, who);
    if (!prev && v !== "clear") { const c = (await lim.get(ip, { type: "json" })) || { n: 0 }; if (c.n >= 6) return bad("too_many", 429); c.n++; await lim.setJSON(ip, c); }
    const vs = store("votes"); await vs.delete(voteKey(id, "yes", who)); await vs.delete(voteKey(id, "no", who));
    if (v !== "clear") await vs.set(voteKey(id, v, who), String(Date.now()));
    const t = await tally(id); await maybeAdmit(n, t); return json({ ...t, myVote: v === "clear" ? null : v, status: n.status });
  }
  if (sub === "comments" && !cid && M === "POST") {
    const u = await me(), v = await body(req), text = clean(v.text, 400).trim(), name = (u?.name || cleanName(v.name)).slice(0, 30);
    if (text.length < 2 || name.length < 2) return bad("bad_body");
    const k = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await store("ncomments").setJSON(id + "/" + k, { name, text, at: Date.now(), by: u?.id || null, reports: 0 });
    return json({ id: k, name, text, at: Date.now() });
  }
  if (sub === "comments" && cid && act === "report" && M === "POST") {
    const cs = store("ncomments"), key = id + "/" + cid, c = await cs.get(key, { type: "json" }); if (!c) return bad("not_found", 404);
    c.reports = (c.reports || 0) + 1; if (c.reports >= 3) c.hidden = true; await cs.setJSON(key, c); return json({ ok: true });
  }
  if (sub === "comments" && cid && M === "DELETE") {
    const u = await me(); if (!u?.admin) return bad("not_yours", 403); await store("ncomments").delete(id + "/" + cid); return json({ ok: true });
  }
  // owner opt-out: hides immediately
  if (sub === "remove" && M === "POST") { n.status = "hidden"; n.removedAt = Date.now(); n.removeNote = clean((await body(req)).note, 200); await S.setJSON(id, n); return json({ ok: true }); }
  if (!sub && M === "DELETE") { const u = await me(); if (!u || (u.id !== n.by && !u.admin)) return bad("not_yours", 403); n.status = "hidden"; await S.setJSON(id, n); return json({ ok: true }); }
  return bad("not_found", 404);
}
