
/* ---------- Explorer accounts: no passwords ----------
   The phone keeps a secret token for its player. An explorer code moves a player to another phone,
   and Google sign-in can be linked as a backup. Progress lives on the server. */
let progT = null, progReady = false, googleOn = false;
const PKEY = "bville-player";
function getPlayer(){ try { return JSON.parse(localStorage.getItem(PKEY) || "null"); } catch (e) { return null; } }
function setPlayer(p){ try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) {} }
function showPane(id){ ["aujoin", "aucode", "auprof"].forEach(p => $("#" + p).hidden = p !== id); }
function openAuth(pane){
  if (myId) { showPane("auprof"); paintProfile(); } else showPane(pane === "code" ? "aucode" : "aujoin");
  ["#au-msg", "#au-msg2", "#au-msg3"].forEach(m => { const e = $(m); if (e) { e.textContent = ""; e.className = "verdict"; } });
  $("#authsheet").hidden = false; document.body.style.overflow = "hidden";
  setTimeout(() => (myId ? null : pane === "code" ? $("#au-code") : $("#au-name"))?.focus(), 60);
}
function closeAuth(){ $("#authsheet").hidden = true; document.body.style.overflow = $("#sheet").hidden ? "" : "hidden"; }
function paintProfile(){
  $("#au-rename").value = window.bvMe?.name || ""; $("#au-mycode").textContent = window.bvMe?.code || "";
  $("#au-backup").innerHTML = window.bvMe?.google ? `<p class="cracked">Backed up with Google. Sign in with Google on any phone to pick up where you left off.</p>`
    : googleOn ? `<div class="codebox"><div class="hint">Extra safety</div><p class="hint">Link your Google account so you can get back in even without your code.</p><button class="btn google" type="button" id="au-link"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.1 14.6 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z"/></svg>Back up with Google</button></div>` : "";
  const l = $("#au-link"); if (l) l.onclick = () => { try { sessionStorage.setItem("bv-google", "link"); } catch (e) {} NI.oauthLogin("google"); };
}
document.addEventListener("click", e => { const t = e.target.closest?.("[data-auth]"); if (t) { e.preventDefault(); openAuth(t.dataset.auth); } });
function paintAcct(){ const b = $("#acct"); if (!b) return; b.textContent = myId ? (window.bvMe?.name || "Explorer") : "Join"; b.classList.toggle("in", !!myId); const s = $("#introsign"); if (s) s.hidden = !!myId; }
async function signedIn(){
  let me = null; try { me = (await bvDB.api("me")).user; } catch (e) {}
  if (!me) { myId = null; paintAcct(); return false; }
  window.bvMe = me; myId = me.id; paintAcct();
  await pullProgress(); progReady = true; queueProgress(true);
  lastSent = null; paintTop(); render(); bvDB.refresh();
  if (!$("#sheet").hidden && cur) { renderReportUI(); const top = $("#card").scrollTop; paintCard(); $("#card").scrollTop = top; }
  if (tab === "board") drawBoard();
  return true;
}
async function joinAs(name){ const p = await bvDB.api("join", { method: "POST", json: { name } }); setPlayer(p); return signedIn(); }
// Merge what's on this phone with what's saved on the server: nothing a player earned is ever dropped.
function mergeObj(a = {}, b = {}, k){
  const out = { ...a };
  for (const [id, v] of Object.entries(b)) {
    if (!(id in out)) { out[id] = v; continue; }
    const x = out[id];
    if (k === "hints") out[id] = Math.max(+x || 0, +v || 0);
    else if (k === "answers") out[id] = x && x.ok ? x : v;
    else if (typeof x === "object" && x && typeof v === "object" && v) out[id] = (v.at || Infinity) < (x.at || Infinity) ? v : x;
    else out[id] = Math.min(+x || Infinity, +v || Infinity) || x;
  }
  return out;
}
async function pullProgress(){
  try {
    const r = await bvDB.api("me/progress"), sv = r?.data || {};
    found = mergeObj(found, sv.found, "found"); answers = mergeObj(answers, sv.answers, "answers"); hints = mergeObj(hints, sv.hints, "hints");
    relics = mergeObj(relics, sv.relics, "relics"); uploads = mergeObj(uploads, sv.uploads, "uploads"); firsts = mergeObj(firsts, sv.firsts, "firsts");
    const cur = { found, answers, hints, relics, uploads, firsts }; PROG_KEYS.forEach(k => { try { localStorage.setItem(KEY + k, JSON.stringify(cur[k])); } catch (e) {} });
  } catch (e) {}
}
function queueProgress(now){
  if (!myId || !progReady) return; clearTimeout(progT);
  progT = setTimeout(async () => { try { await bvDB.api("me/progress", { method: "PUT", json: { found, answers, hints, relics, uploads, firsts } }); } catch (e) {} }, now ? 0 : 2000);
}
addEventListener("pagehide", () => { if (myId && progReady && progT) { clearTimeout(progT); const p = getPlayer(); try { fetch("/api/me/progress", { method: "PUT", keepalive: true, headers: { "content-type": "application/json", ...(p ? { "x-player": p.id + "." + p.token } : {}) }, body: JSON.stringify({ found, answers, hints, relics, uploads, firsts }) }); } catch (e) {} } });
(async function bootAuth(){
  $("#acct").onclick = () => openAuth(); $("#aux").onclick = closeAuth;
  $("#authsheet").onclick = e => { if (e.target.id === "authsheet") closeAuth(); };
  document.querySelectorAll("[data-pane]").forEach(b => b.onclick = () => { showPane(b.dataset.pane); setTimeout(() => (b.dataset.pane === "aucode" ? $("#au-code") : $("#au-name")).focus(), 50); });
  $("#au-join").onclick = async () => { const msg = $("#au-msg"), b = $("#au-join"); b.disabled = true; msg.textContent = "Setting up your expedition…";
    try { await joinAs($("#au-name").value.trim()); closeAuth(); celebrate("Welcome, " + (window.bvMe?.name || "explorer") + "!", "Your expedition is saved"); } catch (e) { msg.className = "verdict err"; msg.textContent = "Couldn’t reach the server. Try again."; } b.disabled = false; };
  $("#au-name").onkeydown = e => { if (e.key === "Enter") $("#au-join").click(); };
  $("#au-restore").onclick = async () => { const msg = $("#au-msg2"), b = $("#au-restore"); b.disabled = true; msg.className = "verdict"; msg.textContent = "Looking you up…";
    try { const p = await bvDB.api("restore", { method: "POST", json: { code: $("#au-code").value } }); setPlayer(p); await signedIn(); closeAuth(); toast("Welcome back, " + (window.bvMe?.name || "explorer") + "!"); SFX.play("coins", 4); }
    catch (e) { msg.className = "verdict err"; msg.textContent = /bad_code/.test(e.message) ? "That code doesn’t match an explorer. Check it and try again." : "Couldn’t reach the server. Try again."; } b.disabled = false; };
  $("#au-code").onkeydown = e => { if (e.key === "Enter") $("#au-restore").click(); };
  $("#au-savename").onclick = async () => { const nm = $("#au-rename").value.trim(), msg = $("#au-msg3"); if (nm.length < 2) { msg.textContent = "At least 2 letters."; return; }
    try { const r = await bvDB.api("me/name", { method: "PUT", json: { name: nm } }); window.bvMe.name = r.name; const p = getPlayer(); if (p) { p.name = r.name; setPlayer(p); } paintAcct(); msg.className = "verdict ok"; msg.textContent = "Saved."; } catch (e) { msg.className = "verdict err"; msg.textContent = "Couldn’t save. Try again."; } };
  $("#au-copy").onclick = async () => { try { await navigator.clipboard.writeText(window.bvMe?.code || ""); toast("Code copied"); } catch (e) { toast("Long-press the code to copy it"); } };
  paintAcct();
  if (getPlayer()) await signedIn();
  if (!window.NI) return;
  try { const st = await NI.getSettings(); googleOn = !!st?.providers?.google; } catch (e) {}
  document.querySelectorAll("[data-google]").forEach(g => { g.hidden = !googleOn; g.onclick = () => { try { sessionStorage.setItem("bv-google", "login"); } catch (e) {} NI.oauthLogin("google"); }; });
  // Back from Google
  let cb = null; try { cb = await NI.handleAuthCallback(); } catch (e) {}
  if (cb?.type === "oauth" || cb?.user) {
    let intent = ""; try { intent = sessionStorage.getItem("bv-google") || ""; sessionStorage.removeItem("bv-google"); } catch (e) {}
    try {
      if (intent === "link" && getPlayer()) { await bvDB.api("me/link", { method: "POST" }); window.bvMe.google = true; toast("Backed up with Google"); SFX.play("stamp"); }
      else { const p = await bvDB.api("google", { method: "POST" }); setPlayer(p); await signedIn(); toast("Welcome back, " + (window.bvMe?.name || "explorer") + "!"); }
    } catch (e) { toast("Google sign-in didn’t finish. Try again."); }
  } else if (!getPlayer()) {
    // an older email or Google session on this phone: turn it into an explorer account
    try { const u = await NI.getUser(); if (u) { const p = await bvDB.api("google", { method: "POST" }); setPlayer(p); await signedIn(); } } catch (e) {}
  }
})();
