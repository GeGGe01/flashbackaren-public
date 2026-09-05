// The v1-core see-and-feel front end, served inline by the worker. Styled to Flashback's own
// visual language (from static.flashback.org's bundle CSS): light #eff0f1 ground, a dark section
// bar with a category-coloured accent + dot, alternating tborder rows, Open Sans, gold stars.
// Deliberately rough — a skeleton to click. React/Vite is deferred until the surface grows.
export const FRONT_HTML = /* html */ `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flashbackaren — prototyp (v1-core)</title>
<style>
  :root {
    --bg:#eff0f1; --row1:#eff0f1; --row2:#e3e3e3; --frame:#b8c0c7;
    --fg:#000; --muted:#444; --bar:#333; --bar-fg:#f0f0f0;
    --accent:#7b98af; --star:#f1a400; --primary:#337ab7; --red:#cc1f1f;
    --sans:'Open Sans','Helvetica Neue',Helvetica,Arial,sans-serif;
    --mono:ui-monospace,'DejaVu Sans Mono',Menlo,Consolas,monospace;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 var(--sans); }
  main { max-width:44rem; margin:0 auto; padding:1rem 1rem 4rem; }

  /* Flashback section bar: dark, thin light title, 3px category-colour underline + a colour dot. */
  .fb-bar { display:flex; align-items:center; gap:9px; background:var(--bar); color:var(--bar-fg);
    padding:8px 12px; border-bottom:3px solid var(--accent); margin:0 0 2px; }
  .fb-bar .dot { width:12px; height:12px; border-radius:50%; background:var(--accent); flex:none; }
  .fb-bar h1 { font-size:16px; font-weight:200; letter-spacing:.01em; margin:0; }
  .fb-bar .tag { margin-left:auto; font-size:11px; color:#bdbdbd; }

  .sub { color:var(--muted); font-size:13px; margin:12px 2px; }
  .warn { background:#fbeceb; color:#a11; border:1px solid #e0b4ae; padding:8px 10px; font-size:12px; margin:0 0 14px; }

  input[type=search] { width:100%; padding:9px 11px; border:1px solid var(--frame); background:#fff; color:var(--fg); font-size:15px; }

  /* tborder table look: blue-grey frame, alternating row shading. */
  .tborder { border:1px solid var(--frame); background:var(--frame); margin-top:12px; }
  .row { display:flex; justify-content:space-between; align-items:center; gap:1rem;
    padding:8px 12px; border-bottom:1px solid var(--frame); cursor:pointer; }
  .row:last-child { border-bottom:0; }
  .row:nth-child(odd) { background:var(--row1); }
  .row:nth-child(even) { background:var(--row2); }
  .uname { font-weight:700; color:var(--fg); }
  .row:hover .uname { text-decoration:underline; }
  .summary { color:var(--muted); font-size:13px; white-space:nowrap; }
  .stars { color:var(--star); font-weight:700; }
  .count { color:var(--muted); margin-left:.35rem; }

  .card { background:#fff; border:1px solid var(--frame); padding:14px 16px; margin-top:14px; }
  .card h2 { margin:0 0 2px; font-size:18px; font-weight:700; color:var(--fg); }
  .agg { font-size:30px; color:var(--star); font-weight:700; font-variant-numeric:tabular-nums; }
  .agg .count { font-size:13px; font-weight:400; }
  .rate-row { display:flex; align-items:center; gap:1rem; margin-top:14px; }
  input[type=range] { flex:1; accent-color:var(--primary); }
  .yourval { min-width:3.5rem; text-align:right; font-variant-numeric:tabular-nums; }
  button { background:var(--primary); color:#fff; border:1px solid #2e6da4; border-radius:3px; padding:7px 14px; font-weight:600; font-size:14px; cursor:pointer; }
  button.ghost { background:#fff; color:var(--muted); border:1px solid var(--frame); }
  .muted { color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<main>
  <div class="fb-bar">
    <span class="dot"></span>
    <h1>Flashbackaren</h1>
    <span class="tag">prototyp v1-core</span>
  </div>
  <p class="sub">Betygsätt användaren, inte inlägget. Sök en (demo-)användare, ge 0–5 stjärnor, se snittet.</p>
  <div class="warn">Skiss: inget anti-fusk. En webbläsare = en röst per användare, men röster är trivialt manipulerbara — det är meningen i första ytan. Demo-användare, inga riktiga personer.</div>

  <input id="q" type="search" placeholder="Sök användarnamn (t.ex. demo)…" autocomplete="off" />
  <div id="results" class="tborder" style="display:none"></div>

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
  results.style.display = list.length ? 'block' : 'none';
  for (const m of list) {
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = '<span class="uname">' + esc(m.username) + '</span>' +
      '<span class="summary"><span class="stars">' + (m.stars == null ? '– ' : '★ ' + m.stars) +
      '</span><span class="count">(' + m.count + ' röster)</span></span>';
    div.onclick = () => openProfile(m.uid);
    results.appendChild(div);
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
      '<span class="count" id="cnt"> (' + p.count + ' röster)</span></div>' +
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
      $('#agg').innerHTML = '★ ' + d.stars + '<span class="count"> (' + d.count + ' röster)</span>';
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
