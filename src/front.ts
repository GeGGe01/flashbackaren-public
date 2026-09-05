// The v1-core see-and-feel front end, served inline by the worker. Deliberately rough — a skeleton
// to click, not a finished UI. React/Vite (the preferred stack) is deferred until the surface grows.
export const FRONT_HTML = /* html */ `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flashbackaren — prototyp (v1-core)</title>
<style>
  :root { --bg:#0b0c10; --card:#14161d; --fg:#f4f4f5; --muted:#9aa0aa; --accent:#ffd23f; --line:#262a33; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, sans-serif; }
  main { max-width:44rem; margin:0 auto; padding:2rem 1.25rem 4rem; }
  h1 { font-size:1.5rem; letter-spacing:-.02em; margin:0 0 .25rem; }
  .sub { color:var(--muted); font-size:.85rem; margin:0 0 1.5rem; }
  .warn { background:#2e1a16; color:#e08578; border:1px solid #5a2a22; border-radius:.5rem; padding:.6rem .8rem; font-size:.8rem; margin-bottom:1.5rem; }
  input[type=search] { width:100%; padding:.7rem .9rem; border-radius:.6rem; border:1px solid var(--line); background:var(--card); color:var(--fg); font-size:1rem; }
  ul { list-style:none; padding:0; margin:1rem 0 0; }
  li { display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:.8rem .2rem; border-bottom:1px solid var(--line); cursor:pointer; }
  li:hover { color:var(--accent); }
  .stars { font-variant-numeric:tabular-nums; color:var(--accent); font-size:.9rem; white-space:nowrap; }
  .count { color:var(--muted); font-size:.75rem; margin-left:.4rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:.75rem; padding:1.25rem; margin-top:1.5rem; }
  .card h2 { margin:0 0 .3rem; font-size:1.2rem; }
  .agg { font-size:2rem; color:var(--accent); font-variant-numeric:tabular-nums; }
  .rate-row { display:flex; align-items:center; gap:1rem; margin-top:1.2rem; }
  input[type=range] { flex:1; accent-color:var(--accent); }
  .yourval { min-width:3.5rem; text-align:right; font-variant-numeric:tabular-nums; }
  button { background:var(--accent); color:#0b0c10; border:0; border-radius:.5rem; padding:.6rem 1rem; font-weight:600; cursor:pointer; }
  button.ghost { background:transparent; color:var(--muted); border:1px solid var(--line); }
  .muted { color:var(--muted); font-size:.8rem; }
</style>
</head>
<body>
<main>
  <h1>Flashbackaren <span class="muted">· prototyp v1-core</span></h1>
  <p class="sub">Betygsätt användaren, inte inlägget. Sök en (demo-)användare, ge 0–5 stjärnor, se snittet.</p>
  <div class="warn">Skiss: inget anti-fusk. En webbläsare = en röst per användare, men röster är trivialt manipulerbara — det är meningen i första ytan. Demo-användare, inga riktiga personer.</div>

  <input id="q" type="search" placeholder="Sök användarnamn (t.ex. demo)…" autocomplete="off" />
  <ul id="results"></ul>

  <section id="profile" class="card" hidden></section>
</main>

<script>
const $ = (s) => document.querySelector(s);
const results = $('#results');
const profile = $('#profile');

async function search(q) {
  const r = await fetch('/api/members?q=' + encodeURIComponent(q));
  const list = await r.json();
  results.innerHTML = '';
  for (const m of list) {
    const li = document.createElement('li');
    li.innerHTML = '<span>' + esc(m.username) + '</span><span class="stars">' +
      (m.stars == null ? '– ' : '★ ' + m.stars) + '<span class="count">(' + m.count + ')</span></span>';
    li.onclick = () => openProfile(m.uid);
    results.appendChild(li);
  }
}

async function openProfile(uid) {
  const r = await fetch('/api/profile?uid=' + encodeURIComponent(uid));
  const p = await r.json();
  if (p.error) return;
  const hs = p.yourHalfsteps == null ? 0 : p.yourHalfsteps;
  profile.hidden = false;
  profile.innerHTML =
    '<h2>' + esc(p.username) + '</h2>' +
    '<div class="agg" id="agg">' + (p.stars == null ? '–' : '★ ' + p.stars) +
      '<span class="count" id="cnt">(' + p.count + ' röster)</span></div>' +
    '<div class="rate-row"><input type="range" id="slider" min="0" max="10" step="1" value="' + hs + '">' +
      '<span class="yourval" id="yourval">' + (hs/2).toFixed(1) + ' ★</span></div>' +
    '<div class="rate-row"><button id="submit">Betygsätt</button>' +
      '<button class="ghost" id="close">Stäng</button>' +
      '<span class="muted" id="note">' + (p.yourHalfsteps==null ? 'Du har inte betygsatt än.' : 'Ditt betyg.') + '</span></div>';
  const slider = $('#slider'), yourval = $('#yourval');
  slider.oninput = () => { yourval.textContent = (slider.value/2).toFixed(1) + ' ★'; };
  $('#submit').onclick = async () => {
    const res = await fetch('/api/rate', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ uid, halfsteps: Number(slider.value) }) });
    const d = await res.json();
    if (d.ok) {
      $('#agg').innerHTML = '★ ' + d.stars + '<span class="count">(' + d.count + ' röster)</span>';
      $('#note').textContent = 'Ditt betyg sparat.';
      search($('#q').value);
    }
  };
  $('#close').onclick = () => { profile.hidden = true; };
}

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

let t; $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => search(e.target.value), 150); });
search('');
</script>
</body>
</html>`;
