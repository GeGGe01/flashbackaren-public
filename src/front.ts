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

  .modes { display:flex; gap:6px; margin-top:14px; }
  .mode { background:#fff; color:var(--muted); border:1px solid var(--frame); border-radius:3px; padding:5px 12px; font-size:13px; font-weight:600; cursor:pointer; }
  .mode.active { background:var(--primary); color:#fff; border-color:#2e6da4; }
  .tpl-name { color:var(--muted); font-size:12px; margin:12px 0 6px; }
  .crit { padding:8px 0; border-bottom:1px solid var(--row2); }
  .crit-head { display:flex; justify-content:space-between; font-size:14px; }
  .crit-label { font-weight:600; }
  .crit-val { color:var(--star); font-weight:700; font-variant-numeric:tabular-nums; }
  .crit-row { display:flex; align-items:center; gap:12px; margin-top:4px; }
  .crit-row input[type=range] { flex:1; accent-color:var(--primary); }
  .wlab { font-size:12px; color:var(--muted); white-space:nowrap; }
  .wlab select { margin-left:4px; }
  #rich-final { color:var(--star); }
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

let TEMPLATE = null;
async function getTemplate(){ if(!TEMPLATE) TEMPLATE = await (await fetch('/api/template')).json(); return TEMPLATE; }
function fmtAgg(stars, count){ return (stars == null ? '–' : '★ ' + stars) + '<span class="count"> (' + count + ' röster)</span>'; }
function afterRate(d){ $('#agg').innerHTML = fmtAgg(d.stars, d.count); $('#note').textContent = 'Ditt betyg sparat.'; search($('#q').value); }

async function openProfile(uid) {
  const p = await (await fetch('/api/profile?uid=' + encodeURIComponent(uid))).json();
  if (p.error) return;
  profile.hidden = false;
  profile.innerHTML =
    '<h2>' + esc(p.username) + '</h2>' +
    '<div class="agg" id="agg">' + fmtAgg(p.stars, p.count) + '</div>' +
    '<div class="modes"><button class="mode" data-m="direct">Direkt</button>' +
      '<button class="mode" data-m="rich">Kriterier</button></div>' +
    '<div id="rate-area"></div>' +
    '<div class="rate-row"><button class="ghost" id="close">Stäng</button>' +
      '<span class="muted" id="note">' + (p.yourHalfsteps==null ? 'Du har inte betygsatt än.' : 'Ditt betyg.') + '</span></div>';
  const state = { uid, p };
  const modeBtns = profile.querySelectorAll('.mode');
  function selectMode(m){
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset.m === m));
    if (m === 'rich') renderRich(state); else renderDirect(state);
  }
  modeBtns.forEach(b => b.onclick = () => selectMode(b.dataset.m));
  $('#close').onclick = () => { profile.hidden = true; };
  selectMode(p.yourMode === 'rich' ? 'rich' : 'direct');
}

function renderDirect(state){
  const hs = (state.p.yourMode !== 'rich' && state.p.yourHalfsteps != null) ? state.p.yourHalfsteps : 0;
  $('#rate-area').innerHTML =
    '<div class="rate-row"><input type="range" id="slider" min="0" max="10" step="1" value="' + hs + '">' +
      '<span class="yourval" id="yourval">' + (hs/2).toFixed(1) + ' ★</span>' +
      '<button id="submit">Betygsätt</button></div>';
  const slider = $('#slider'), yv = $('#yourval');
  slider.oninput = () => { yv.textContent = (slider.value/2).toFixed(1) + ' ★'; };
  $('#submit').onclick = async () => {
    const d = await (await fetch('/api/rate', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ uid: state.uid, mode:'direct', halfsteps: Number(slider.value) }) })).json();
    if (d.ok) afterRate(d);
  };
}

async function renderRich(state){
  const tpl = await getTemplate();
  const prev = {}; (state.p.yourCriteria||[]).forEach(c => prev[c.criterion_id] = c);
  const rowsHtml = tpl.criteria.map(c => {
    const pc = prev[c.id]; const hs = pc ? pc.halfsteps : 0; const w = pc ? pc.weight : 1;
    return '<div class="crit" data-cid="'+c.id+'">' +
      '<div class="crit-head"><span class="crit-label">'+esc(c.label)+'</span>' +
        '<span class="crit-val">'+(hs/2).toFixed(1)+' ★</span></div>' +
      '<div class="crit-row"><input type="range" class="c-score" min="0" max="10" step="1" value="'+hs+'">' +
        '<label class="wlab">vikt <select class="c-weight">' +
          [1,2,3,4,5].map(x=>'<option'+(x===w?' selected':'')+'>'+x+'</option>').join('') +
        '</select></label></div></div>';
  }).join('');
  $('#rate-area').innerHTML = '<p class="tpl-name">Mall: '+esc(tpl.name)+' · viktat snitt</p>' + rowsHtml +
    '<div class="rate-row"><strong>Blir <span id="rich-final">–</span></strong>' +
      '<button id="submit">Betygsätt</button></div>';
  const crits = () => [...profile.querySelectorAll('.crit')].map(el => ({
    criterion_id: el.dataset.cid,
    halfsteps: Number(el.querySelector('.c-score').value),
    weight: Number(el.querySelector('.c-weight').value),
  }));
  function recompute(){
    let w=0, a=0;
    profile.querySelectorAll('.crit').forEach(el => {
      const s = Number(el.querySelector('.c-score').value);
      const wt = Number(el.querySelector('.c-weight').value);
      w += wt; a += s * wt;
      el.querySelector('.crit-val').textContent = (s/2).toFixed(1) + ' ★';
    });
    $('#rich-final').textContent = (w ? Math.round(a/w)/2 : 0).toFixed(1) + ' ★';
  }
  profile.querySelectorAll('.c-score, .c-weight').forEach(i => { i.oninput = recompute; i.onchange = recompute; });
  recompute();
  $('#submit').onclick = async () => {
    const d = await (await fetch('/api/rate', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ uid: state.uid, mode:'rich', template_id: tpl.id, criteria: crits() }) })).json();
    if (d.ok) afterRate(d);
  };
}

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

let t; $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => search(e.target.value), 150); });
search('');
</script>
</body>
</html>`;
