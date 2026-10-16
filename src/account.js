
/* ---------- Accounts (Netlify Identity) and saved progress ---------- */
let authMode = "signup", progT = null, progReady = false;
function setAuthMode(m){
  authMode = m; const up = m === "signup";
  document.querySelectorAll(".autabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.m === m));
  $("#au-h").textContent = up ? "Join the expedition" : "Welcome back, explorer";
  $("#au-sub").textContent = up ? "Save your finds and Marthas on any phone, post photos and compete on the Martha Board." : "Sign in to pick up where you left off.";
  $("#au-namef").hidden = !up; $("#au-go").textContent = up ? "Join the expedition" : "Sign in"; $("#au-forgot").hidden = up;
  $("#au-pw").autocomplete = up ? "new-password" : "current-password"; $("#au-msg").textContent = "";
}
function openAuth(m){
  $("#auin").hidden = !!myId; $("#auout").hidden = !myId; $("#aureset").hidden = true;
  if (!myId) setAuthMode(m || "signup"); else { $("#au-who").textContent = window.bvMe?.email || window.bvMe?.name || ""; $("#au-rename").value = window.bvMe?.name || ""; $("#au-msg2").textContent = ""; }
  $("#authsheet").hidden = false; document.body.style.overflow = "hidden";
  setTimeout(() => (myId ? $("#au-rename") : (authMode === "signup" ? $("#au-name") : $("#au-email"))).focus(), 50);
}
function closeAuth(){ $("#authsheet").hidden = true; document.body.style.overflow = $("#sheet").hidden ? "" : "hidden"; }
function authErr(e){
  const m = String(e?.message || e || "").toLowerCase(), st = e?.status;
  if (m.includes("already") || m.includes("registered")) return "That email already has an account. Choose “I have an account” to sign in.";
  if (m.includes("invalid") && (m.includes("password") || m.includes("grant") || m.includes("credentials")) || st === 400) return "That email and password don’t match. Try again, or reset your password.";
  if (m.includes("confirm")) return "Check your inbox and click the confirmation link first.";
  if (m.includes("password") && m.includes("6")) return "Use a password with at least 8 characters.";
  if (st === 404 || m.includes("identity")) return "Sign-in isn’t switched on for this site yet.";
  return "Something went wrong. Check your connection and try again.";
}
document.addEventListener("click", e => { const t = e.target.closest?.("[data-auth]"); if (t) { e.preventDefault(); openAuth(t.dataset.auth); } });
function paintAcct(){ const b = $("#acct"); if (!b) return; b.textContent = myId ? (window.bvMe?.name || "Explorer") : "Sign in"; b.classList.toggle("in", !!myId); const s = $("#introsign"); if (s) s.hidden = !!myId; }
async function signedIn(u){
  let me = null; try { me = (await bvDB.api("me")).user; } catch (e) {}
  if (!me) { myId = null; paintAcct(); return; }
  window.bvMe = { ...me, email: u?.email || "" }; myId = me.id; paintAcct();
  await pullProgress(); progReady = true; queueProgress(true);
  lastSent = null; paintTop(); render(); bvDB.refresh();
  if (!$("#sheet").hidden && cur) { renderReportUI(); const top = $("#card").scrollTop; paintCard(); $("#card").scrollTop = top; }
  if (tab === "board") drawBoard();
}
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
addEventListener("pagehide", () => { if (myId && progReady && progT) { clearTimeout(progT); try { const m = /(?:^|; )nf_jwt=([^;]*)/.exec(document.cookie); fetch("/api/me/progress", { method: "PUT", keepalive: true, headers: { "content-type": "application/json", ...(m ? { Authorization: "Bearer " + decodeURIComponent(m[1]) } : {}) }, body: JSON.stringify({ found, answers, hints, relics, uploads, firsts }) }); } catch (e) {} } });
(async function bootAuth(){
  $("#acct").onclick = () => openAuth("login"); $("#aux").onclick = closeAuth;
  $("#authsheet").onclick = e => { if (e.target.id === "authsheet") closeAuth(); };
  document.querySelectorAll(".autabs button").forEach(b => b.onclick = () => setAuthMode(b.dataset.m));
  paintAcct();
  if (!window.NI) return;
  try { const st = await NI.getSettings(); if (st?.providers?.google) { const g = $("#au-google"); g.hidden = false; g.onclick = () => NI.oauthLogin("google"); } } catch (e) {}
  $("#au-form").onsubmit = async e => {
    e.preventDefault(); const em = $("#au-email").value.trim(), pw = $("#au-pw").value, nm = $("#au-name").value.trim(), msg = $("#au-msg"); msg.className = "verdict";
    if (!/^\S+@\S+\.\S+$/.test(em)) { msg.textContent = "Enter your email address."; return; }
    if (pw.length < 8) { msg.textContent = "Use a password with at least 8 characters."; return; }
    if (authMode === "signup" && nm.length < 2) { msg.textContent = "Pick an explorer name."; return; }
    $("#au-go").disabled = true; msg.textContent = authMode === "signup" ? "Creating your account…" : "Signing in…";
    try {
      if (authMode === "signup") {
        const u = await NI.signup(em, pw, { full_name: nm });
        let cur = null; try { cur = await NI.getUser(); } catch (x) {}
        if (!cur) { try { cur = await NI.login(em, pw); } catch (x) {} }
        if (cur) { closeAuth(); await signedIn(cur); celebrate("Welcome, " + nm + "!", "Your expedition is saved"); }
        else { msg.className = "verdict ok"; msg.textContent = "Almost there! We sent a confirmation link to " + em + ". Open it on this phone to finish."; }
      } else { const u = await NI.login(em, pw); closeAuth(); await signedIn(u); toast("Welcome back, " + (window.bvMe?.name || "explorer") + "!"); }
    } catch (x) { msg.className = "verdict err"; msg.textContent = authErr(x); }
    $("#au-go").disabled = false;
  };
  $("#au-forgot").onclick = async () => { const em = $("#au-email").value.trim(), msg = $("#au-msg"); if (!/^\S+@\S+\.\S+$/.test(em)) { msg.textContent = "Type your email above first."; return; } try { await NI.requestPasswordRecovery(em); msg.className = "verdict ok"; msg.textContent = "Check your email for a link to reset your password."; } catch (x) { msg.className = "verdict err"; msg.textContent = authErr(x); } };
  $("#au-out").onclick = async () => { clearTimeout(progT); if (progReady) { try { await bvDB.api("me/progress", { method: "PUT", json: { found, answers, hints, relics, uploads, firsts } }); } catch (e) {} } try { await NI.logout(); } catch (e) {} PROG_KEYS.forEach(k => { try { localStorage.removeItem(KEY + k); } catch (e) {} }); location.reload(); };
  $("#au-savename").onclick = async () => { const nm = $("#au-rename").value.trim(), msg = $("#au-msg2"); if (nm.length < 2) { msg.textContent = "Pick a name with at least 2 letters."; return; } try { await NI.updateUser({ data: { full_name: nm } }); await NI.refreshSession?.(); const me = (await bvDB.api("me")).user; if (me) window.bvMe = { ...window.bvMe, ...me }; paintAcct(); msg.className = "verdict ok"; msg.textContent = "Saved. The board updates within a minute."; } catch (x) { msg.className = "verdict err"; msg.textContent = authErr(x); } };
  $("#au-setpw").onclick = async () => { const pw = $("#au-newpw").value, msg = $("#au-msg3"); if (pw.length < 8) { msg.textContent = "Use at least 8 characters."; return; } try { await NI.updateUser({ password: pw }); msg.className = "verdict ok"; msg.textContent = "Password saved."; setTimeout(closeAuth, 900); } catch (x) { msg.className = "verdict err"; msg.textContent = authErr(x); } };
  let cb = null; try { cb = await NI.handleAuthCallback(); } catch (e) { toast("That link has expired. Try again."); }
  let u = cb?.user || null; if (!u) { try { u = await NI.getUser(); } catch (e) {} }
  if (u) await signedIn(u);
  if (cb?.type === "confirmation") celebrate("Welcome aboard!", "Your expedition is saved");
  if (cb?.type === "oauth" && u) toast("Signed in as " + (window.bvMe?.name || "explorer"));
  if (cb?.type === "recovery") { $("#auin").hidden = true; $("#auout").hidden = true; $("#aureset").hidden = false; $("#authsheet").hidden = false; }
})();
