import re, json
s = open('/home/claude/dex/template.html').read()
def R(a, b, cnt=1):
    global s
    assert a in s, "MISSING: " + a[:90]
    s = s.replace(a, b, cnt)

# --- document head
R('<title>bVille Expedition</title>\n<meta name="claude:viewport-fit-sides" content="cover">',
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>bVille Expedition · Birmingham, Michigan</title>\n<meta name="description" content="78 historic sites are hiding in plain sight in Birmingham, Michigan. Crack the riddles, dig through time and stop the Syndicate.">\n<meta name="theme-color" content="#08111F">\n<meta property="og:title" content="bVille Expedition">\n<meta property="og:description" content="78 historic sites are hiding in plain sight. Find them before the bulldozers do.">\n<meta property="og:image" content="/img/walk/img/hunter-a1.jpg">\n<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 28%22%3E%3Cpath d=%22M12 1c1 5 7 8 7 15a7 7 0 0 1-14 0c0-4 2-6 3-9 1 3 2 4 3 4-1-4 0-7 1-10z%22 fill=%22%23FF7A3D%22/%3E%3C/svg%3E">')
R('</style>\n', '</style>\n</head>\n<body>\n', 1)

# --- images: explorer photos come from /api/img
R('const IMG = f => f.startsWith("/_blob/") ? f : "img/" + f + ".jpg";', 'const IMG = f => f.startsWith("/") ? f : "img/" + f + ".jpg";')
R('["/_blob/" + d.asset,', '["/api/img/" + d.asset,')
R("textContent:'This explorer photo can’t be shown to you. Uploaded photos are visible to members of the owner’s organization.'", "textContent:'This photo couldn’t load. Try again in a moment.'")

# --- save hook: progress goes to the server when signed in
R('const save = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} };',
  'const PROG_KEYS = ["found", "answers", "hints", "relics", "uploads", "firsts"];\nconst save = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} if (PROG_KEYS.includes(k)) queueProgress(); };')

# --- write gates: need a signed-in explorer
R('  if (!db || !myId || !canWrite) { toast("Sign in with contributor access to defend sites."); return false; }',
  '  if (!myId) { toast("Sign in to defend sites."); openAuth("signup"); return false; }')
R('  if (!db) return `<div class="box"><h3>Excavate Layer 3</h3><p class="hint">Sign in to claude.ai to add today’s photo of this site.</p></div>`;\n  if (!assets || !canWrite) return `<div class="box"><h3>Excavate Layer 3</h3><p class="hint">Ask the expedition’s owner for contributor access to add photos.</p></div>`;',
  '  if (!myId) return `<div class="box"><h3>Excavate Layer 3</h3><p class="hint">Sign in to add today’s photo of this site and earn Marthas.</p><div class="row2"><button class="btn go" type="button" data-auth>Sign in or join</button></div></div>`;')
R('    (!db ? `<p class="hint" style="margin-top:6px">Sign in to claude.ai to post your score and see other explorers.</p>` : !canWrite ?',
  '    (!myId ? `<p class="hint" style="margin-top:6px">Sign in to put your score on the board and keep it safe on any phone.</p><div class="row2"><button class="btn go" type="button" data-auth>Sign in or join</button></div>` : !canWrite ?')
R('  if (!db) { b.innerHTML = `<p class="hint">Sign in to claude.ai to read and add field reports.</p>`; return; }',
  '  if (!myId) { b.innerHTML = `<p class="hint">Sign in to add a field report.</p><div class="row2"><button class="btn" type="button" data-auth>Sign in or join</button></div>`; return; }')

# --- startup: server adapter + Netlify Identity
old = re.search(r'\(async \(\) => \{ try \{ if \(!window\.claude\?\.use\) return;.*?\}\)\(\);\n', s).group(0)
s = s.replace(old, '''db = window.bvDB; user = window.bvUser; assets = window.bvAssets;
subscribeActs(); subscribeBoard();
''')
s = s.replace('let db = null, user = null, myId = null, rdocs = [], unsub = null, canWrite = true;', 'let db = null, user = null, myId = null, rdocs = [], unsub = null, canWrite = true;\nlet assets = null;')
R("let assets = null, todayDocs = []", "let todayDocs = []")

acct = open('/home/claude/bville/src/account.js').read()
k = s.rindex('</script>'); s = s[:k] + acct + s[k:]
R('<script>', '<script src="identity.js"></script>\n<script src="net.js"></script>\n<script>', 1)
s += '\n</body>\n</html>\n'

# --- header: account chip
R('<button class="howbtn" id="how" type="button" aria-label="How to play">How to play</button>',
  '<span class="hbtns"><button class="howbtn" id="acct" type="button">Sign in</button><button class="howbtn" id="how" type="button" aria-label="How to play">How?</button></span>')
R('<button class="cta" id="start" type="button">Start the hunt</button>',
  '<button class="cta" id="start" type="button">Start the hunt</button>\n    <button class="introlink" id="introsign" type="button" data-auth>Already exploring? Sign in</button>')

css = open('/home/claude/bville/src/account.css').read()
R('/* ===== Landing ===== */', css + '\n/* ===== Landing ===== */')
R('<div class="sheet" id="howsheet" hidden>', open('/home/claude/bville/src/account.html').read() + '<div class="sheet" id="howsheet" hidden>')

data = open('/home/claude/dex/game.json').read()
s = s.replace('__DATA__', data)
open('/home/claude/bville/public/index.html', 'w').write(s)
print("built", len(s))
