// Public page for one People's Register nomination: /n/<id>
// Server-rendered so link previews (Messages, Facebook, Nextdoor) show the house photo and the question.
import { getStore } from "@netlify/blobs";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export default async (req) => {
  const url = new URL(req.url), id = url.pathname.split("/").filter(Boolean)[1] || "", origin = url.origin;
  const n = id ? await getStore({ name: "bville-noms", consistency: "strong" }).get(id, { type: "json" }) : null;
  if (!n || n.status === "hidden") return new Response(page("Not found", `<main class="wrap"><h1>This nomination isn’t available</h1><p class="lede">It may have been removed by the owner.</p><a class="cta" href="/">Play bVille</a></main>`, ""), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  const where = n.exact ? n.addr : n.street, q = `Should ${n.title} join Birmingham’s People’s Register?`, img = `${origin}/api/img/${encodeURIComponent(n.asset)}`;
  const head = `<meta property="og:type" content="website"><meta property="og:url" content="${origin}/n/${esc(id)}"><meta property="og:title" content="${esc(q)}">
<meta property="og:description" content="${esc((n.year ? "Built " + n.year + " · " : "") + where + ", Birmingham, MI. Cast your vote: Historic! or Not yet.")}"><meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(img)}">`;
  const body = `<main class="wrap">
  <a class="brand" href="/"><span class="fl">🔥</span>bVille <small>People’s Register</small></a>
  <figure class="photo"><img src="/api/img/${esc(n.asset)}" alt="${esc(n.title)}"><figcaption id="badge"></figcaption></figure>
  <h1>${esc(n.title)}</h1>
  <p class="meta">${n.year ? `Built ${esc(n.year)} · ` : ""}${esc(where)}, Birmingham · nominated by ${esc(n.byName || "an explorer")}</p>
  ${n.story ? `<p class="story">${esc(n.story)}</p>` : ""}
  <section class="vote"><h2>Should it join the People’s Register?</h2>
    <div class="btns"><button id="yes" type="button">🏛️ Historic!</button><button id="no" type="button">Not yet</button></div>
    <div class="meter"><i id="bar"></i></div><p class="hint" id="count">Counting votes…</p></section>
  <section class="comments"><h2>What do neighbours say?</h2><ul id="list"></ul>
    <form id="cf"><input id="cn" maxlength="30" placeholder="Your first name" autocomplete="given-name"><textarea id="ct" maxlength="400" placeholder="A memory, a detail you love, a bit of history…"></textarea><button type="submit">Add comment</button><p class="hint" id="cm"></p></form></section>
  <section class="play"><h2>78 more historic sites are hiding in Birmingham</h2><p>Follow the leads, photograph what you find, and keep the bulldozers away.</p><a class="cta" href="/">Start the hunt →</a>
    <p class="hint">Got a house with a story? <a href="/#nominate">Nominate it</a>.</p></section>
  <p class="fine">The People’s Register is a community honour from the bVille game, not an official designation. For the City’s real process, see <a href="https://www.bhamgov.org/about_birmingham/city_departments/planning_department/historic_preservation/designated_historic_districts.php" rel="noopener">Birmingham Historic Preservation</a>.
  <br><button id="rm" type="button" class="link">Is this your home? Remove it</button></p>
</main>
<script>
const ID = ${JSON.stringify(id)}, NEED = 25, $ = s => document.querySelector(s);
let voter = localStorage.getItem("bville-voter"); if (!voter) { voter = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join(""); localStorage.setItem("bville-voter", voter); }
const H = () => { const h = { "content-type": "application/json", "x-voter": voter }; try { const p = JSON.parse(localStorage.getItem("bville-player") || "null"); if (p) h["x-player"] = p.id + "." + p.token; } catch (e) {} return h; };
const api = (p, o = {}) => fetch("/api/noms/" + ID + p, { method: o.method || "GET", headers: H(), body: o.json ? JSON.stringify(o.json) : undefined }).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || r.status), { status: r.status }); return j; });
function paint(d){
  $("#bar").style.width = Math.min(100, d.yes / NEED * 100) + "%";
  $("#count").textContent = d.status === "admitted" ? "Admitted to the People’s Register with " + d.yes + " votes." : d.yes + " of " + NEED + " Historic votes needed" + (d.no ? " · " + d.no + " say not yet" : "");
  $("#badge").textContent = d.status === "admitted" ? "On the People’s Register" : "Nominee";
  $("#badge").className = d.status === "admitted" ? "gold" : "";
  $("#yes").classList.toggle("on", d.myVote === "yes"); $("#no").classList.toggle("on", d.myVote === "no");
}
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function comments(cs){ $("#list").innerHTML = cs.length ? cs.map(c => '<li><b>' + esc(c.name) + '</b><span>' + esc(c.text) + '</span><button class="link rep" data-id="' + c.id + '" type="button">Report</button></li>').join("") : '<li class="hint">No comments yet. Be the first.</li>';
  document.querySelectorAll(".rep").forEach(b => b.onclick = async () => { await api("/comments/" + b.dataset.id + "/report", { method: "POST" }); b.textContent = "Reported"; b.disabled = true; }); }
async function load(){ try { const d = await api(""); paint(d); comments(d.comments || []); } catch (e) { $("#count").textContent = "Couldn’t load votes."; } }
async function vote(v){ try { const cur = $("#" + v).classList.contains("on"); const d = await api("/vote", { method: "POST", json: { v: cur ? "clear" : v } }); paint(d); if (!cur && v === "yes" && navigator.vibrate) navigator.vibrate(30); }
  catch (e) { $("#count").textContent = e.status === 429 ? "Too many votes from this connection." : "Couldn’t save your vote. Try again."; } }
$("#yes").onclick = () => vote("yes"); $("#no").onclick = () => vote("no");
$("#cn").value = localStorage.getItem("bville-cname") || "";
$("#cf").onsubmit = async e => { e.preventDefault(); const name = $("#cn").value.trim(), text = $("#ct").value.trim(); if (name.length < 2 || text.length < 2) { $("#cm").textContent = "Add your name and a comment."; return; }
  try { localStorage.setItem("bville-cname", name); await api("/comments", { method: "POST", json: { name, text } }); $("#ct").value = ""; $("#cm").textContent = "Thanks!"; load(); } catch (e) { $("#cm").textContent = "Couldn’t post. Try again."; } };
$("#rm").onclick = async () => { if (!confirm("Remove this nomination from bVille? It disappears right away.")) return; try { await api("/remove", { method: "POST", json: {} }); location.replace("/n/" + ID); } catch (e) {} };
load(); setInterval(() => { if (!document.hidden) load(); }, 20000);
</script>`;
  return new Response(page(q, body, head), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" } });
};
function page(title, body, head){ return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · bVille</title>
<meta name="theme-color" content="#08111F">${head}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Barlow+Condensed:wght@600;700&family=Figtree:wght@400;600;700&display=swap">
<style>
:root{--night:#08111F;--cave:#0F1D33;--rock:#18304D;--line:#28466B;--bone:#F4EEDF;--dust:#9FB3C8;--torch:#FFB43C;--ember:#FF5E3A;--jade:#2EE6A6;--orchid:#C77DFF}
*{box-sizing:border-box}html,body{margin:0;background:var(--night);color:var(--bone);font-family:Figtree,system-ui,sans-serif;line-height:1.5}
body{background-image:radial-gradient(900px 420px at 50% -10%,rgba(255,180,60,.14),transparent 70%),radial-gradient(900px 600px at -10% 70%,rgba(199,125,255,.10),transparent 60%);background-attachment:fixed}
.wrap{max-width:640px;margin:0 auto;padding:16px 16px 60px}
.brand{display:inline-flex;gap:6px;align-items:baseline;color:var(--torch);text-decoration:none;font-family:"Alfa Slab One",serif;font-size:28px}.brand small{font-family:"Barlow Condensed";font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--dust)}
.photo{margin:14px 0;position:relative;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.5)}.photo img{display:block;width:100%;max-height:70vh;object-fit:cover}
.photo figcaption{position:absolute;top:12px;left:12px;font-family:"Barlow Condensed";font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:14px;padding:4px 10px;border-radius:8px;background:rgba(8,17,31,.8);color:var(--orchid)}
.photo figcaption.gold{background:linear-gradient(135deg,#FFE3A6,var(--torch));color:#2A1604}
h1{font-family:"Alfa Slab One",serif;font-weight:400;font-size:clamp(30px,8vw,44px);line-height:1.05;margin:6px 0;color:var(--torch)}
h2{font-family:"Barlow Condensed";font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:17px;color:var(--dust);margin:0 0 10px}
.meta{color:var(--dust);margin:0}.story{font-size:18px}
section{background:var(--cave);border:1px solid var(--line);border-radius:16px;padding:16px;margin-top:16px}
.btns{display:grid;grid-template-columns:1.4fr 1fr;gap:10px}
.btns button,.cta,form button{font:inherit;border:0;cursor:pointer;border-radius:14px;padding:14px;font-family:"Alfa Slab One",serif;font-size:20px}
#yes{background:linear-gradient(135deg,#FFE3A6,var(--torch) 40%,#FF6A3D);color:#1A0E03;box-shadow:0 10px 30px rgba(255,120,40,.35)}
#no{background:var(--rock);color:var(--bone);border:1.5px solid var(--line)}
.btns button.on{outline:3px solid var(--jade);outline-offset:2px}
.meter{height:12px;background:#0A1628;border-radius:99px;margin-top:14px;overflow:hidden}.meter i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--orchid),var(--torch));transition:width .6s}
.hint{color:var(--dust);font-size:14px}
ul{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:8px}li{background:var(--night);border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:grid;gap:2px}li b{font-size:14px;color:var(--torch)}
input,textarea{width:100%;font:inherit;font-size:16px;color:var(--bone);background:var(--night);border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px}textarea{min-height:80px}
form button{background:var(--rock);color:var(--bone);font-size:17px;padding:10px 18px}
.play{text-align:center;background:linear-gradient(160deg,#152a4d,var(--cave))}.cta{display:inline-block;text-decoration:none;background:linear-gradient(135deg,#FFE3A6,var(--torch) 40%,#FF6A3D);color:#1A0E03;padding:14px 30px;border-radius:99px;margin:6px 0 4px}
a{color:var(--torch)}.fine{font-size:13px;color:var(--dust);margin-top:24px}.link{background:none;border:0;color:var(--dust);text-decoration:underline;cursor:pointer;font:inherit;font-size:13px;padding:0;justify-self:start}
</style></head><body>${body}</body></html>`; }
export const config = { path: "/n/*" };
