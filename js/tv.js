/*
 * Demo Retail Co. :: TV mode
 * Rotates full-screen views (overview, RFV, regions, CRM funnel, ABC) on a timer.
 * URL options: ?tela=rfv  ?segundos=20  ?seed=42
 */
(function () {
  'use strict';

  const D = window.DemoData, A = window.DemoAnalytics, M = window.DemoMap, F = A.fmt;
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const readLS = (key, fallback) => { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
  const writeLS = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } };

  /* ---------------- data ---------------- */
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed')) || Number(readLS('dr_seed', 42)) || 42;
  const base = D.generate(seed);
  const ctx = A.prepare(base, {});
  const ov = A.overview(ctx);
  const rfv = A.rfv(ctx);
  const abc = A.abc(ctx);
  const fun = A.funnel(ctx);
  const reg = A.regional(base, {});
  const refDate = F.date(base.date(base.lastDay));
  const regionName = id => (base.regions.find(r => r.id === id) || { name: id }).name;

  /* ---------------- screens ---------------- */
  const ICONS = {
    geral: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
    rfv: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="8" r="2"/><circle cx="9" cy="17" r="2.5"/><circle cx="17.5" cy="16.5" r="3.5"/>',
    regioes: '<rect x="3.5" y="3.5" width="5" height="5" rx="1"/><rect x="9.5" y="3.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><rect x="15.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="15.5" width="5" height="5" rx="1"/>',
    funil: '<path d="M3.5 5h17l-6.5 8v6l-4 1.5V13Z"/>',
    abc: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M6 17c3-9 7-11 14-12"/>'
  };
  const SCREENS = [
    { id: 'geral', name: 'Visão geral', color: '#9a8ff5', draw: drawOverview },
    { id: 'rfv', name: 'RFV', color: '#43c592', draw: drawRFV },
    { id: 'regioes', name: 'Regiões', color: '#4aa3f0', draw: drawRegions, minSeconds: 30 },
    { id: 'funil', name: 'Funil de CRM', color: '#f0b04a', draw: drawFunnel },
    { id: 'abc', name: 'Curva ABC', color: '#f0705c', draw: drawABC }
  ];

  const stored = readLS('dr_tv', {}) || {};
  const cfg = {
    seconds: [10, 15, 20, 30, 45, 60, 120].includes(stored.seconds) ? stored.seconds : 20,
    screens: Array.isArray(stored.screens) ? stored.screens.filter(id => SCREENS.some(s => s.id === id)) : SCREENS.map(s => s.id),
    paused: !!stored.paused
  };
  if (!cfg.screens.length) cfg.screens = SCREENS.map(s => s.id);
  const urlSeconds = Number(params.get('segundos'));
  const save = () => writeLS('dr_tv', cfg);

  let current = 0, elapsed = 0, last = performance.now(), tour = null;
  const charts = [];

  const rotation = () => SCREENS.filter(s => cfg.screens.includes(s.id));
  const duration = () => {
    const sec = urlSeconds > 0 ? urlSeconds : cfg.seconds;
    return Math.max(sec, SCREENS[current].minSeconds || 0) * 1000;
  };

  /* ---------------- shared bits ---------------- */
  const pill = (cur, prev, mode) => {
    if (mode !== 'pp' && !prev) return '<span class="pill">–</span>';
    const v = mode === 'pp' ? (cur - prev) * 100 : (cur / prev - 1) * 100;
    const cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : '';
    return '<span class="pill ' + cls + '">' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + (mode === 'pp' ? ' p.p.' : '%') + '</span>';
  };
  const block = (label, inner, cls) => '<div class="block ' + (cls || '') + '"><div class="label">' + label + '</div>' + inner + '</div>';
  const screen = (s, sub, body, layout) =>
    '<section class="screen"><div class="title"><span class="badge"><svg viewBox="0 0 24 24">' + ICONS[s.id] + '</svg></span><h1>' + s.name + '</h1><span>' + sub + '</span></div>' +
    '<div class="body ' + layout + '">' + body + '</div></section>';
  const barRows = (items, max) => '<div class="bars">' + items.map(it =>
    '<div class="bar-row ' + (it.cls || '') + '"' + (it.key ? ' data-key="' + it.key + '"' : '') + '><span class="nm">' + (it.color ? '<i style="background:' + it.color + '"></i>' : '') + it.name + '</span>' +
    '<span class="tr"><i style="width:' + (100 * it.value / (max || 1)).toFixed(1) + '%;background:' + (it.color || 'var(--tv-color)') + '"></i></span>' +
    '<span class="r">' + it.text + '</span><span class="r dim">' + (it.extra || '') + '</span></div>').join('') + '</div>';

  function chartTheme() {
    if (!window.Chart) return;
    const C = window.Chart.defaults;
    C.font.family = 'Geist, ui-sans-serif, system-ui, sans-serif';
    C.font.size = Math.max(11, Math.round(window.innerHeight * 0.0135));
    C.color = '#8a8983';
    C.borderColor = '#ffffff10';
    C.maintainAspectRatio = false;
    C.animation = { duration: 600 };
    C.plugins.legend.display = false;
    C.plugins.tooltip.enabled = false;
  }
  function chart(id, config) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.Chart) { el.parentNode.innerHTML = '<p class="sub">Gráfico indisponível sem internet.</p>'; return; }
    charts.push(new window.Chart(el, config));
  }

  /* ---------------- screen: overview ---------------- */
  function drawOverview(s) {
    const cur = ov.cur, prev = ov.prev;
    const months = []; for (let m = ov.lastMonth - 11; m <= ov.lastMonth; m++) months.push(m);
    const maxSeg = Math.max(...rfv.segments.map(x => x.n));
    const html = screen(s, 'últimos 12 meses · dados até ' + refDate,
      '<div class="stack rows-3">' +
        block('Compradores 12m', '<div class="big xl">' + F.int(cur.buyers) + '</div><div class="sub">' + pill(cur.buyers, prev.buyers) + ' vs <b>' + F.int(prev.buyers) + '</b></div>', 'hl') +
        block('Receita 12m', '<div class="big">' + F.moneyShort(cur.revenue) + '</div><div class="sub">' + pill(cur.revenue, prev.revenue) + ' ticket <b>' + F.money(cur.ticket) + '</b></div>') +
        block('Taxa de recompra', '<div class="big">' + F.pct(cur.repeatRate) + '</div><div class="sub">' + pill(cur.repeatRate, prev.repeatRate, 'pp') + ' vs <b>' + F.pct(prev.repeatRate) + '</b></div>') +
      '</div><div class="stack rows-2">' +
        block('Compradores por mês', '<div class="legend"><span><i style="background:var(--tv-color)"></i>Últimos 12 meses</span><span><i style="background:var(--tv-prev)"></i>Ano anterior</span></div><div class="chart"><canvas id="tv-ov"></canvas></div>') +
        block('Segmentos RFV', barRows(rfv.segments.map(x => ({ name: x.name, color: x.color, value: x.n, text: F.int(x.n), extra: F.pct(x.share, 0) })), maxSeg)) +
      '</div>', 'cols-3-5');
    return { html, after() {
      chart('tv-ov', { type: 'bar', data: { labels: months.map(F.month), datasets: [
        { data: months.map(m => ov.buyers[m - 12] || 0), backgroundColor: '#5a5a62', borderRadius: 4, maxBarThickness: 26 },
        { data: months.map(m => ov.buyers[m]), backgroundColor: s.color, borderRadius: 4, maxBarThickness: 26 }] },
        options: { scales: { x: { grid: { display: false }, border: { display: false } }, y: { beginAtZero: true, border: { display: false }, ticks: { maxTicksLimit: 5, callback: v => F.int(v) } } } } });
    } };
  }

  /* ---------------- screen: RFV ---------------- */
  function drawRFV(s) {
    let grid = '<div class="rfv">';
    for (let r = 5; r >= 1; r--) {
      grid += '<div class="ax row">R' + r + '</div>';
      for (let f = 1; f <= 5; f++) {
        const c = rfv.grid[r][f], sg = A.SEG_BY_ID[c.seg];
        grid += '<div class="cell" style="background:' + sg.color + '"><small>' + sg.name + '</small><b>' + F.int(c.n) + '</b><small>' + F.pct(c.n / rfv.total) + '</small></div>';
      }
    }
    grid += '<div class="ax"></div>' + ['F1 · 1 compra', 'F2 · 2', 'F3 · 3', 'F4 · 4–5', 'F5 · 6+'].map(t => '<div class="ax">' + t + '</div>').join('') + '</div>';
    const seg = id => rfv.segments.find(x => x.id === id);
    const champ = seg('campeoes'), loyal = seg('leais'), risk = seg('em_risco'), novos = seg('novos');
    const maxV = Math.max(...rfv.segments.map(x => x.valueShare));
    const html = screen(s, F.int(rfv.total) + ' clientes · recência × frequência',
      block('Mapa RFV', grid) +
      '<div class="stack rows-a1"><div class="row-3">' +
        block('Campeões + Leais', '<div class="big md">' + F.int(champ.n + loyal.n) + '</div><div class="sub"><b>' + F.pct(champ.valueShare + loyal.valueShare, 0) + '</b> do valor</div>', 'hl') +
        block('Em risco', '<div class="big md">' + F.int(risk.n) + '</div><div class="sub"><b>' + F.moneyShort(risk.value) + '</b> no histórico</div>') +
        block('Novos', '<div class="big md">' + F.int(novos.n) + '</div><div class="sub"><b>' + F.pct(novos.share, 0) + '</b> da base</div>') +
      '</div>' +
        block('Participação no valor', barRows(rfv.segments.map(x => ({ name: x.name, color: x.color, value: x.valueShare, text: F.pct(x.valueShare), extra: F.int(x.n) })), maxV)) +
      '</div>', 'cols-5-4');
    return { html };
  }

  /* ---------------- screen: regions (with a small auto tour) ---------------- */
  function drawRegions(s) {
    const values = {}, regionOf = {};
    Object.values(reg.ufs).forEach(u => { values[u.uf] = u.buyers; regionOf[u.uf] = u.region; });
    const mapFor = region => M.svg({ tiles: base.tiles, regionOf, values, color: s.color, region, label: uf => F.int(reg.ufs[uf].buyers) });
    const maxB = Math.max(...reg.regions.map(r => r.buyers));
    const t = reg.total;
    const html = screen(s, 'compradores dos últimos 12 meses pelo endereço do cliente',
      block('Mapa de clientes', '<div class="mapbox" id="tv-map">' + mapFor(null) + '</div>') +
      '<div class="stack rows-a1"><div class="row-3">' +
        block('Compradores', '<div class="big md">' + F.int(t.buyers) + '</div><div class="sub">' + pill(t.buyers, t.buyersPrev) + '</div>', 'hl') +
        block('Receita 12m', '<div class="big md">' + F.moneyShort(t.revenue) + '</div><div class="sub">' + pill(t.revenue, t.revenuePrev) + '</div>') +
        block('Recompra', '<div class="big md">' + F.pct(t.repeatRate) + '</div><div class="sub">2+ datas no ano</div>') +
      '</div>' +
        block('Regiões <span id="tv-tour-label"></span>', barRows(reg.regions.map(r => ({ key: r.id, name: r.name, value: r.buyers, text: F.int(r.buyers),
          extra: (r.growth >= 0 ? '+' : '') + F.pct(r.growth, 0) })), maxB) +
          '<table class="ttable" style="margin-top:1.6vh"><thead><tr><th>Maiores estados</th><th class="r">Compradores</th><th class="r">Recompra</th><th class="r">Receita</th></tr></thead><tbody id="tv-ufs"></tbody></table>') +
      '</div>', 'cols-5-4');
    const ufRows = region => Object.values(reg.ufs).filter(u => !region || u.region === region).sort((a, b) => b.buyers - a.buyers).slice(0, 5)
      .map(u => '<tr><td><b>' + u.uf + '</b> · ' + regionName(u.region) + '</td><td class="r">' + F.int(u.buyers) + '</td><td class="r">' + F.pct(u.repeatRate) + '</td><td class="r">' + F.moneyShort(u.revenue) + '</td></tr>').join('');
    return { html, after() {
      const steps = [null].concat(base.regions.map(r => r.id));
      let k = 0;
      const apply = () => {
        const region = steps[k];
        $('#tv-map').innerHTML = mapFor(region);
        document.querySelectorAll('.bar-row[data-key]').forEach(el => {
          el.classList.toggle('off', !!region && el.dataset.key !== region);
          el.classList.toggle('on', el.dataset.key === region);
        });
        $('#tv-ufs').innerHTML = ufRows(region);
        $('#tv-tour-label').textContent = region ? '· ' + regionName(region) : '· Brasil';
      };
      apply();
      tour = setInterval(() => { if (!cfg.paused) { k = (k + 1) % steps.length; apply(); } }, 5000);
    } };
  }

  /* ---------------- screen: CRM funnel ---------------- */
  const FUNNEL_COLORS = ['#5a4bd0', '#6f61e0', '#8d80ee', '#e2843a', '#f0b04a'];
  function drawFunnel(s) {
    const st = fun.stages, baseN = st[0].n || 1, t = fun.totals;
    const funnel = '<div class="funnel">' + st.map((x, i) =>
      '<div class="f-row"><div class="nm"><b>' + x.name + '</b><span>' + x.hint + '</span></div>' +
      '<div class="tr"><div class="bar" style="width:' + Math.max(3, 100 * x.n / baseN).toFixed(1) + '%;background:' + FUNNEL_COLORS[i] + '">' + F.int(x.n) + '</div></div>' +
      '<div class="pc"><b>' + F.pct(x.n / baseN) + '</b>' + (i ? F.pct(st[i - 1].n ? x.n / st[i - 1].n : 0, 0) + ' da etapa anterior' : 'da base') + '</div></div>').join('') + '</div>';
    const topCampaigns = fun.rows.slice().sort((a, b) => b.converted - a.converted).slice(0, 5);
    const html = screen(s, F.int(fun.rows.length) + ' campanhas nos últimos 12 meses',
      block('Funil de clientes', funnel) +
      '<div class="stack rows-a1"><div class="row-3">' +
        block('Conversão 30 dias', '<div class="big md">' + F.pct(t.contacts ? t.converted / t.contacts : 0) + '</div><div class="sub"><b>' + F.int(t.converted) + '</b> compras</div>', 'hl') +
        block('Receita atribuída', '<div class="big md">' + F.moneyShort(t.revenue) + '</div><div class="sub">ticket <b>' + F.money(t.converted ? t.revenue / t.converted : 0) + '</b></div>') +
        block('Engajamento', '<div class="big md">' + F.pct(t.contacts ? t.engaged / t.contacts : 0) + '</div><div class="sub"><b>' + F.int(t.contacts) + '</b> contatos</div>') +
      '</div>' +
        block('Canais e maiores campanhas',
          '<table class="ttable"><thead><tr><th>Canal</th><th class="r">Contatos</th><th class="r">Engaj.</th><th class="r">Conversão</th></tr></thead><tbody>' +
          fun.byChannel.map(c => '<tr><td><b>' + c.channel + '</b></td><td class="r">' + F.int(c.contacts) + '</td><td class="r">' + F.pct(c.engageRate) + '</td><td class="r">' + F.pct(c.convRate) + '</td></tr>').join('') +
          '</tbody></table><table class="ttable" style="margin-top:1.4vh"><thead><tr><th>Campanha</th><th class="r">Conversões</th><th class="r">Taxa</th><th class="r">Receita</th></tr></thead><tbody>' +
          topCampaigns.map(r => '<tr><td><b>' + esc(r.cmp.name) + '</b> · ' + r.cmp.channel + '</td><td class="r">' + F.int(r.converted) + '</td><td class="r">' + F.pct(r.convRate) + '</td><td class="r">' + F.moneyShort(r.revenue) + '</td></tr>').join('') +
          '</tbody></table>') +
      '</div>', 'cols-5-4');
    return { html };
  }

  /* ---------------- screen: ABC ---------------- */
  function drawABC(s) {
    const k = abc.classes;
    const cls = c => block('Classe ' + c, '<div class="big md">' + F.int(k[c].n) + ' <small>clientes</small></div><div class="sub"><b>' + F.pct(k[c].share, 0) +
      '</b> da base · <b>' + F.pct(k[c].valueShare, 0) + '</b> da receita</div>', c === 'A' ? 'hl' : '');
    const html = screen(s, 'concentração da receita por cliente',
      block('Curva de Pareto', '<div class="legend"><span><i style="background:' + A.ABC_COLORS.A + '"></i>A</span><span><i style="background:' + A.ABC_COLORS.B + '"></i>B</span><span><i style="background:' + A.ABC_COLORS.C + '"></i>C</span><span><i style="background:var(--tv-color)"></i>% acumulado</span></div><div class="chart"><canvas id="tv-abc"></canvas></div>') +
      '<div class="stack rows-3">' + cls('A') + cls('B') +
        block('Concentração', '<div class="big md">' + F.pct(abc.top1) + '</div><div class="sub">da receita vem do 1% que mais compra · top 20% = <b>' + F.pct(abc.top20) + '</b></div>') +
      '</div>', 'cols-5-4');
    return { html, after() {
      chart('tv-abc', { type: 'bar', data: { labels: abc.buckets.map(b => b.label), datasets: [
        { type: 'line', data: abc.buckets.map(b => b.cum * 100), borderColor: s.color, yAxisID: 'y2', pointRadius: 0, borderWidth: 3, tension: 0.25, order: 0 },
        { data: abc.buckets.map(b => b.share * 100), backgroundColor: abc.buckets.map(b => A.ABC_COLORS[b.cls]), borderRadius: 3, order: 1 }] },
        options: { scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { beginAtZero: true, border: { display: false }, ticks: { callback: v => v + '%', maxTicksLimit: 5 } },
          y2: { position: 'right', min: 0, max: 100, grid: { display: false }, border: { display: false }, ticks: { callback: v => v + '%' } } } } });
    } };
  }

  /* ---------------- rotation ---------------- */
  function show(i) {
    current = (i + SCREENS.length) % SCREENS.length;
    elapsed = 0;
    if (tour) { clearInterval(tour); tour = null; }
    while (charts.length) charts.pop().destroy();
    const s = SCREENS[current];
    document.documentElement.style.setProperty('--tv-color', s.color);
    renderTabs();
    chartTheme();
    const out = s.draw(s);
    $('#stage').innerHTML = out.html;
    if (out.after) out.after();
  }
  function step(dir) {
    const list = rotation();
    if (!list.length) return show(current + dir);
    let pos = list.findIndex(s => s.id === SCREENS[current].id);
    if (pos < 0) pos = dir > 0 ? -1 : 0;
    const nextId = list[(pos + dir + list.length) % list.length].id;
    show(SCREENS.findIndex(s => s.id === nextId));
  }
  function renderTabs() {
    $('#tabs').innerHTML = SCREENS.map((s, i) => '<button type="button" class="tab ' + (i === current ? 'on ' : '') + (cfg.screens.includes(s.id) ? '' : 'off') + '" data-i="' + i + '" style="--dot:' + s.color + '"><i></i>' + s.name + '</button>').join('');
  }
  function tick(now) {
    const dt = now - last;
    last = now;
    if (!cfg.paused && $('#settings').hidden) elapsed += dt;
    const dur = duration();
    $('#progress').style.width = Math.min(100, 100 * elapsed / dur).toFixed(2) + '%';
    if (elapsed >= dur) step(1);
    requestAnimationFrame(tick);
  }
  function setPaused(p) {
    cfg.paused = p;
    document.body.classList.toggle('paused', p);
    $('#btn-pause').setAttribute('aria-label', p ? 'Continuar o giro' : 'Pausar o giro');
    save();
  }

  /* ---------------- ticker, clock, settings ---------------- */
  function ticker() {
    const best = fun.rows.slice().sort((a, b) => b.convRate - a.convRate)[0];
    const top = reg.regions.slice().sort((a, b) => b.buyers - a.buyers)[0];
    const risk = rfv.segments.find(x => x.id === 'em_risco');
    const items = [
      'Compradores 12m <b>' + F.int(ov.cur.buyers) + '</b> (' + (ov.cur.buyers >= ov.prev.buyers ? '+' : '') + F.pct(ov.cur.buyers / ov.prev.buyers - 1) + ' vs ano anterior)',
      'Receita 12m <b>' + F.moneyShort(ov.cur.revenue) + '</b>',
      'Taxa de recompra <b>' + F.pct(ov.cur.repeatRate) + '</b>',
      'Clientes em risco <b>' + F.int(risk.n) + '</b>, com ' + F.moneyShort(risk.value) + ' no histórico',
      'Curva A: <b>' + F.pct(abc.classes.A.share, 0) + '</b> dos clientes fazem 80% da receita',
      'Melhor campanha: <b>' + esc(best.cmp.name) + '</b> (' + best.cmp.channel + '), conversão de ' + F.pct(best.convRate),
      'Maior região: <b>' + top.name + '</b>, ' + F.pct(top.share, 0) + ' dos compradores',
      'Dados sintéticos de demonstração · semente ' + seed
    ];
    $('#ticker').innerHTML = items.map(t => '<span>' + t + '</span>').join('');
  }
  function clock() {
    const now = new Date();
    $('#clock').textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }
  function openSettings() {
    $('#cfg-seconds').value = String(cfg.seconds);
    $('#cfg-screens').innerHTML = SCREENS.map(s => '<label><input type="checkbox" value="' + s.id + '"' + (cfg.screens.includes(s.id) ? ' checked' : '') + '> ' + s.name + '</label>').join('');
    $('#settings').hidden = false;
    $('#cfg-seconds').focus();
  }
  function closeSettings() { $('#settings').hidden = true; renderTabs(); }

  function toggleFull() {
    if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen(); }
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }

  /* ---------------- init ---------------- */
  $('#tv-info').textContent = base.brand + ' · dados até ' + refDate;
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) show(Number(b.dataset.i)); });
  $('#btn-pause').addEventListener('click', () => setPaused(!cfg.paused));
  $('#btn-full').addEventListener('click', toggleFull);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#cfg-close').addEventListener('click', closeSettings);
  $('#settings').addEventListener('click', e => { if (e.target.id === 'settings') closeSettings(); });
  $('#cfg-seconds').addEventListener('change', e => { cfg.seconds = Number(e.target.value); save(); });
  $('#cfg-screens').addEventListener('change', () => {
    const ids = Array.from(document.querySelectorAll('#cfg-screens input:checked')).map(i => i.value);
    cfg.screens = ids.length ? ids : SCREENS.map(s => s.id);
    save();
  });
  document.addEventListener('keydown', e => {
    if (!$('#settings').hidden) { if (e.key === 'Escape') closeSettings(); return; }
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === ' ') { e.preventDefault(); setPaused(!cfg.paused); }
    else if (e.key === 'f' || e.key === 'F') toggleFull();
  });
  let idle = null;
  document.addEventListener('mousemove', () => {
    document.body.classList.remove('no-cursor');
    clearTimeout(idle);
    idle = setTimeout(() => document.body.classList.add('no-cursor'), 3000);
  });
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { const e = elapsed; show(current); elapsed = e; }, 250); });

  setPaused(cfg.paused);
  ticker();
  clock();
  setInterval(clock, 1000);
  const startId = params.get('tela');
  const startIdx = SCREENS.findIndex(s => s.id === startId);
  show(startIdx >= 0 ? startIdx : SCREENS.findIndex(s => s.id === rotation()[0].id));
  requestAnimationFrame(tick);
})();
