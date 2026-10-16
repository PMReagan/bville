/* ---------- bVille server adapter (Netlify) ----------
   Same shape the game already uses (db / user / assets), backed by /api/*.
   Live updates are polled every 20 seconds while the page is visible, and right after your own writes. */
(function(){
  const jwt = () => { const m = /(?:^|; )nf_jwt=([^;]*)/.exec(document.cookie); return m ? decodeURIComponent(m[1]) : ""; };
  async function api(path, opt = {}){
    const h = { ...(opt.headers || {}) }; const t = jwt(); if (t) h.Authorization = "Bearer " + t;
    try { const pl = JSON.parse(localStorage.getItem("bville-player") || "null"); if (pl) h["x-player"] = pl.id + "." + pl.token; } catch (e) {}
    if (opt.json !== undefined) { h["content-type"] = "application/json"; opt.body = JSON.stringify(opt.json); }
    let r = await fetch("/api/" + path, { method: opt.method || "GET", headers: h, body: opt.body, credentials: "same-origin" });
    if (r.status === 401 && t && window.NI) { try { await NI.refreshSession(); } catch (e) {} const t2 = jwt(); if (t2 && t2 !== t) { h.Authorization = "Bearer " + t2; r = await fetch("/api/" + path, { method: opt.method || "GET", headers: h, body: opt.body }); } }
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error(data?.error || "http_" + r.status); err.code = r.status === 401 || r.status === 403 ? "invalid_argument" : data?.error === "too_large" ? "too_large" : data?.error === "unsupported_type" ? "unsupported_type" : data?.error; throw err; }
    return data;
  }
  const subs = new Set();
  function snap(rows){ return { docs: rows.map(r => { const { id, ...rest } = r; return { id, exists: true, data: () => rest }; }) }; }
  class Query {
    constructor(col){ this.col = col; this.w = null; this.o = null; this.dir = "asc"; this.n = 1000; }
    where(f, op, v){ const q = this._c(); q.w = [f, v]; return q; }
    orderBy(f, dir = "asc"){ const q = this._c(); q.o = f; q.dir = dir; return q; }
    limit(n){ const q = this._c(); q.n = n; return q; }
    _c(){ const q = new Query(this.col); Object.assign(q, this); return q; }
    async _fetch(){
      const qs = this.w && this.w[0] === "stop" ? "?stop=" + encodeURIComponent(this.w[1]) : "";
      let rows = (await api("c/" + this.col + qs)).docs || [];
      if (this.w && this.w[0] !== "stop") rows = rows.filter(r => r[this.w[0]] === this.w[1]);
      if (this.o) { const k = this.o, s = this.dir === "desc" ? -1 : 1; rows.sort((a, b) => ((a[k] ?? 0) > (b[k] ?? 0) ? 1 : (a[k] ?? 0) < (b[k] ?? 0) ? -1 : 0) * s); }
      return rows.slice(0, this.n);
    }
    onSnapshot(cb, err){
      const sub = { col: this.col, run: async () => { try { cb(snap(await this._fetch())); } catch (e) { err && err(e); } } };
      subs.add(sub); sub.run(); return () => subs.delete(sub);
    }
    async get(){ return snap(await this._fetch()); }
    async add(doc){ const r = await api("c/" + this.col, { method: "POST", json: doc }); refresh(this.col); return { id: r.id }; }
  }
  function refresh(col){ subs.forEach(s => { if (!col || s.col === col) s.run(); }); }
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.bvDB = {
    collection: c => new Query(c),
    doc(path){ const [col, id] = path.split("/"); return {
      async get(){ const rows = (await api("c/" + col)).docs || []; const r = rows.find(x => x.id === id); return { exists: !!r, id, data: () => { if (!r) return undefined; const { id: _, ...rest } = r; return rest; } }; },
      async set(v){ await api("c/" + col + "/" + encodeURIComponent(id), { method: "PUT", json: v }); refresh(col); } }; },
    api, refresh };
  window.bvUser = {
    id: async () => window.bvMe?.id || null,
    profiles: async ids => { ids = [...new Set(ids.filter(Boolean))]; if (!ids.length) return {}; return api("profiles?ids=" + ids.map(encodeURIComponent).join(",")); } };
  window.bvAssets = {
    upload: async (blob, o = {}) => { const r = await api("img", { method: "POST", body: blob, headers: { "content-type": o.type || blob.type || "image/jpeg" } }); return { id: r.id, url: r.url }; } };
})();
