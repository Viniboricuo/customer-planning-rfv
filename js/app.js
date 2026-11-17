/*
 * Demo Retail Co. :: Planejamento de Clientes (dashboard)
 * Hash router, quick filters, theme, and one renderer per page.
 */
(function () {
  'use strict';

  const D = window.DemoData, A = window.DemoAnalytics, M = window.DemoMap, F = A.fmt;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* localStorage can be missing or blocked: always guarded */
  const saved = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } }
  };

  const state = {
    page: 'geral',
    seed: Number(saved.get('dr_seed', 42)) || 42,
    region: null,
    channel: null,
    rfvMode: 'notas',
    rfvSeg: null,
    mapMetric: 'buyers',
    storeSort: { key: 'revenue', dir: -1 },
    list: { q: '', seg: null, sort: 'value', page: 0 }
  };
  const PAGE_SIZE = 50;
  let base = null, cache = null;
  const charts = [];

  /* ---------------- data ---------------- */
  function data() {
    const key = state.seed + '|' + (state.region || '') + '|' + (state.channel || '');
    if (cache && cache.key === key) return cache;
    const ctx = A.prepare(base, { region: state.region, channel: state.channel });
    const rfv = A.rfv(ctx);
    let km = null;
    cache = {
      key, ctx, rfv,
      abc: A.abc(ctx),
      ov: A.overview(ctx),
      rec: A.recurrence(ctx),
      fun: A.funnel(ctx),
      reg: A.regional(base, { channel: state.channel }),
      km: () => km || (km = A.kmeans(ctx, 5, 7))
    };
    return cache;
  }
  const regionName = id => (base.regions.find(r => r.id === id) || { name: id || 'Online' }).name;

  /* ---------------- helpers: html ---------------- */
  function delta(cur, prev, mode) {
    if (mode !== 'pp' && !prev) return '<span class="delta">–</span>';
    const v = mode === 'pp' ? (cur - prev) * 100 : (cur / prev - 1) * 100;
    const cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : '';
    const txt = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + (mode === 'pp' ? ' p.p.' : '%');
    return '<span class="delta ' + cls + '">' + txt + '</span>';
  }
  const kpi = (title, value, meta, extra) =>
    '<div class="kpi"><h3>' + title + '</h3><div class="value">' + value + '</div>' + (extra || '') + '<div class="meta">' + (meta || '') + '</div></div>';
  function card(o) {
    return '<section class="card ' + (o.cls || '') + '"' + (o.id ? ' id="' + o.id + '"' : '') + '>' +
      (o.title ? '<div class="card-head"><div class="card-title"><h2>' + o.title + '</h2>' + (o.sub ? '<p>' + o.sub + '</p>' : '') + '</div>' +
        (o.tools ? '<div class="card-tools">' + o.tools + '</div>' : '') + '</div>' : '') +
      o.body + '</section>';
  }
  const canvas = (id, size) => '<div class="chart ' + (size || '') + '"><canvas id="' + id + '"></canvas></div>';
  const how = items => '<details class="how"><summary><span>+</span>Como calculamos</summary><ul>' + items.map(i => '<li>' + i + '</li>').join('') + '</ul></details>';
  const segTag = id => { const s = A.SEG_BY_ID[id]; return s ? '<span class="tag"><i style="background:' + s.color + '"></i>' + s.name + '</span>' : ''; };
  const abcTag = c => '<span class="abc-tag" style="background:' + A.ABC_COLORS[c] + ';' + (c === 'C' ? 'color:#2a2840' : '') + '">' + c + '</span>';
  const segmented = (name, options, current) => '<div class="seg" role="group" data-seg-control="' + name + '">' +
    options.map(o => '<button type="button" data-value="' + o[0] + '" class="' + (o[0] === current ? 'on' : '') + '">' + o[1] + '</button>').join('') + '</div>';
  const legend = items => '<div class="legend">' + items.map(i => '<span><i style="background:' + i[1] + '"></i>' + i[0] + '</span>').join('') + '</div>';
  const dateOf = d => F.date(base.date(d));
  const monthsBack = (last, n) => { const out = []; for (let m = last - n + 1; m <= last; m++) out.push(m); return out; };

  /* ---------------- helpers: charts ---------------- */
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function chartTheme() {
    if (!window.Chart) return;
    const C = window.Chart.defaults;
    C.font.family = 'Geist, ui-sans-serif, system-ui, sans-serif';
    C.font.size = 12;
    C.color = cssVar('--text-3');
    C.borderColor = cssVar('--grid-line');
    C.maintainAspectRatio = false;
    C.plugins.legend.display = false;
    C.plugins.tooltip.backgroundColor = cssVar('--ink');
    C.plugins.tooltip.titleColor = cssVar('--ink-text');
    C.plugins.tooltip.bodyColor = cssVar('--ink-text');
    C.plugins.tooltip.padding = 10;
    C.plugins.tooltip.cornerRadius = 8;
    C.plugins.tooltip.boxPadding = 4;
  }
  function chart(id, config) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (!window.Chart) {
      el.parentNode.innerHTML = '<div class="empty">Gráfico indisponível: a biblioteca de gráficos não carregou (sem internet?).</div>';
      return null;
    }
    const c = new window.Chart(el, config);
    charts.push(c);
    return c;
  }
  function destroyCharts() { while (charts.length) charts.pop().destroy(); }
  const axes = (yFmt, extra) => Object.assign({
    x: { grid: { display: false }, border: { display: false } },
    y: { beginAtZero: true, border: { display: false }, ticks: { callback: yFmt || (v => F.int(v)), maxTicksLimit: 6 } }
  }, extra || {});

  /* ---------------- pages ---------------- */
  const PAGES = {
    geral: { title: 'Visão geral', sub: 'Os principais números da base de clientes nos últimos 12 meses.', render: renderOverview },
    rfv: { title: 'RFV e clusters', sub: 'Recência, frequência e valor de cada cliente, com segmentos por notas e por k-means.', render: renderRFV },
    abc: { title: 'Curva ABC', sub: 'Concentração da receita: poucos clientes respondem pela maior parte do faturamento.', render: renderABC },
    recorrencia: { title: 'Recorrência', sub: 'Quem volta a comprar, em quanto tempo e como cada safra de clientes se comporta.', render: renderRecurrence },
    funil: { title: 'Funil de CRM', sub: 'Da base ao cliente que volta: contato, engajamento, conversão em 30 dias e recompra.', render: renderFunnel },
    regioes: { title: 'Regiões', sub: 'Compradores, evolução e recompra pelo endereço do cliente, com o ranking de lojas.', render: renderRegions },
    lista: { title: 'Lista de clientes', sub: 'Busca por ID ou nome, filtro por segmento e exportação em CSV.', render: renderList }
  };

  function render() {
    destroyCharts();
    chartTheme();
    const page = PAGES[state.page];
    $('#page-title').textContent = page.title;
    $('#page-sub').textContent = page.sub;
    document.title = page.title + ' · Planejamento de Clientes';
    $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === state.page));
    renderChips();
    renderHeadRight();
    const el = $('#content');
    el.innerHTML = '';
    page.render(data(), el);
  }

  function renderChips() {
    const regions = [[null, 'Todas']].concat(base.regions.map(r => [r.id, r.name]));
    const channels = [[null, 'Todos'], ['store', 'Loja física'], ['online', 'Online']];
    $('#chips').innerHTML =
      '<span class="chip-label">Região</span>' +
      regions.map(r => '<button type="button" class="chip ' + (state.region === r[0] ? 'on' : '') + '" data-region="' + (r[0] || '') + '">' + r[1] + '</button>').join('') +
      '<i class="chip-sep" aria-hidden="true"></i><span class="chip-label">Canal</span>' +
      channels.map(c => '<button type="button" class="chip ' + (state.channel === c[0] ? 'on' : '') + '" data-channel="' + (c[0] || '') + '">' + c[1] + '</button>').join('');
  }

  function renderHeadRight() {
    const filters = [];
    if (state.region) filters.push(regionName(state.region));
    if (state.channel) filters.push(state.channel === 'online' ? 'Online' : 'Loja física');
    $('#head-right').innerHTML =
      (filters.length ? '<button type="button" class="btn sm" id="btn-clear" title="Limpar filtros">' + esc(filters.join(' · ')) + ' ✕</button>' : '') +
      '<span class="ref-pill"><svg class="ic" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>Dados até <b>' + dateOf(base.lastDay) + '</b></span>';
  }

  /* ======================= Visão geral ======================= */
  function renderOverview(d, el) {
    const ov = d.ov, cur = ov.cur, prev = ov.prev, r = d.rfv, fun = d.fun;
    const risk = r.segments.find(s => s.id === 'em_risco');
    const clsA = d.abc.classes.A;
    const conv = fun.totals.contacts ? fun.totals.converted / fun.totals.contacts : 0;
    const top = d.reg.regions.slice().sort((a, b) => b.buyers - a.buyers)[0];
    const months = monthsBack(ov.lastMonth, 12);

    el.innerHTML =
      '<section class="kpi-strip k5">' +
        kpi('Clientes na base', F.int(ov.base), '<span>com compra desde ' + F.monthLong(0) + '</span>') +
        kpi('Compradores 12m', F.int(cur.buyers), delta(cur.buyers, prev.buyers) + '<span>vs <b>' + F.int(prev.buyers) + '</b></span>') +
        kpi('Receita 12m', F.moneyShort(cur.revenue), delta(cur.revenue, prev.revenue) + '<span>vs <b>' + F.moneyShort(prev.revenue) + '</b></span>') +
        kpi('Ticket médio', F.money(cur.ticket), delta(cur.ticket, prev.ticket) + '<span>' + F.int(cur.orders) + ' compras</span>') +
        kpi('Taxa de recompra', F.pct(cur.repeatRate), delta(cur.repeatRate, prev.repeatRate, 'pp') + '<span>vs <b>' + F.pct(prev.repeatRate) + '</b></span>') +
      '</section>' +
      '<div class="callouts">' +
        '<a class="callout" href="#rfv" data-goto-seg="em_risco"><b>' + F.int(risk.n) + ' clientes em risco</b><span>' + F.moneyShort(risk.value) + ' em compras no histórico · ' + F.pct(risk.share) + ' da base</span></a>' +
        '<a class="callout" href="#abc"><b>' + F.pct(clsA.share, 0) + ' dos clientes fazem 80% da receita</b><span>Curva A com ' + F.int(clsA.n) + ' clientes</span></a>' +
        '<a class="callout" href="#funil"><b>Conversão de CRM em ' + F.pct(conv) + '</b><span>' + F.int(fun.totals.converted) + ' compras em até 30 dias, de ' + F.int(fun.totals.contacts) + ' contatos</span></a>' +
        (top ? '<a class="callout" href="#regioes"><b>' + top.name + ': ' + F.pct(top.share, 0) + ' dos compradores</b><span>Maior região nos últimos 12 meses</span></a>' : '') +
      '</div>' +
      '<div class="grid g-wide">' +
        card({ title: 'Compradores por mês', sub: 'Clientes distintos que compraram no mês, contra o mesmo mês do ano anterior',
          body: legend([['Últimos 12 meses', cssVar('--chart-1')], ['Ano anterior', cssVar('--chart-2')]]) + canvas('ov-buyers') }) +
        card({ title: 'Segmentos RFV', sub: 'Participação na base, por notas de recência e frequência',
          body: canvas('ov-seg', 'short') + '<div class="seg-list" style="margin-top:12px">' + r.segments.map(s =>
            '<a class="seg-row" href="#rfv" data-goto-seg="' + s.id + '" style="grid-template-columns:minmax(110px,1fr) 70px 56px;text-decoration:none;color:inherit">' +
            '<span class="name"><i style="background:' + s.color + '"></i>' + s.name + '</span><span class="r">' + F.int(s.n) + '</span><span class="r">' + F.pct(s.share, 0) + '</span></a>').join('') + '</div>' }) +
      '</div>' +
      '<div class="grid g2">' +
        card({ title: 'Receita por mês', sub: 'Últimos 24 meses', body: canvas('ov-rev', 'short') }) +
        card({ title: 'Clientes novos por mês', sub: 'Primeira compra na rede, últimos 12 meses', body: canvas('ov-new', 'short') }) +
      '</div>' +
      card({ title: 'Compradores por região', sub: 'Últimos 12 meses, pelo endereço do cliente. Clique para filtrar o painel.',
        body: '<div class="region-cards">' + d.reg.regions.map(g =>
          '<button type="button" class="region-card ' + (state.region === g.id ? 'on' : '') + '" data-set-region="' + g.id + '"><span>' + g.name + '</span><b>' + F.int(g.buyers) + '</b>' +
          '<small>' + delta(g.buyers, g.buyersPrev) + ' · recompra ' + F.pct(g.repeatRate, 0) + '</small></button>').join('') + '</div>' }) +
      how([
        'Janela de 12 meses: do dia seguinte a um ano antes da data de referência até a data de referência; o ano anterior é a janela de 12 meses imediatamente antes.',
        'Comprador: cliente com ao menos uma compra na janela. Ticket médio = receita ÷ número de compras.',
        'Taxa de recompra: compradores da janela com compras em 2 ou mais datas diferentes ÷ compradores da janela; a variação é em pontos percentuais (p.p.).',
        'Cliente novo: primeira compra na rede (data de aquisição) dentro do mês.',
        'Os filtros de região e canal do topo valem para todas as páginas. Todos os dados são sintéticos.'
      ]);

    chart('ov-buyers', {
      type: 'bar',
      data: { labels: months.map(F.month), datasets: [
        { label: 'Ano anterior', data: months.map(m => ov.buyers[m - 12] || 0), backgroundColor: cssVar('--chart-2'), borderRadius: 4, maxBarThickness: 18 },
        { label: 'Últimos 12 meses', data: months.map(m => ov.buyers[m]), backgroundColor: cssVar('--chart-1'), borderRadius: 4, maxBarThickness: 18 }
      ] },
      options: { scales: axes(), interaction: { mode: 'index', intersect: false } }
    });
    chart('ov-seg', {
      type: 'doughnut',
      data: { labels: r.segments.map(s => s.name), datasets: [{ data: r.segments.map(s => s.n), backgroundColor: r.segments.map(s => s.color), borderColor: cssVar('--surface'), borderWidth: 2 }] },
      options: { cutout: '66%', plugins: { tooltip: { callbacks: { label: c => ' ' + F.int(c.raw) + ' clientes (' + F.pct(c.raw / r.total) + ')' } } } }
    });
    const m24 = monthsBack(ov.lastMonth, 24);
    chart('ov-rev', {
      type: 'line',
      data: { labels: m24.map(F.month), datasets: [{ data: m24.map(m => ov.revenue[m]), borderColor: cssVar('--chart-1'), backgroundColor: cssVar('--accent-soft'),
        fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 }] },
      options: { scales: axes(v => F.moneyShort(v)), plugins: { tooltip: { callbacks: { label: c => ' ' + F.money(c.raw) } } }, interaction: { mode: 'index', intersect: false } }
    });
    chart('ov-new', {
      type: 'bar',
      data: { labels: months.map(F.month), datasets: [{ data: months.map(m => ov.newcomers[m]), backgroundColor: cssVar('--chart-3'), borderRadius: 4, maxBarThickness: 22 }] },
      options: { scales: axes(), plugins: { tooltip: { callbacks: { label: c => ' ' + F.int(c.raw) + ' clientes novos' } } } }
    });
  }

  /* ======================= RFV ======================= */
  function renderRFV(d, el) {
    const r = d.rfv;
    const champ = r.segments.find(s => s.id === 'campeoes'), loyal = r.segments.find(s => s.id === 'leais'), risk = r.segments.find(s => s.id === 'em_risco');
    const cl = champ.n + loyal.n;
    let html =
      '<section class="kpi-strip k5">' +
        kpi('Base RFV', F.int(r.total), '<span>clientes com ao menos 1 compra</span>') +
        kpi('Compraram em 12 meses', F.pct(r.total ? r.active12 / r.total : 0), '<b>' + F.int(r.active12) + '</b><span>clientes</span>',
          '<div class="bar"><i style="width:' + (r.total ? 100 * r.active12 / r.total : 0).toFixed(1) + '%"></i></div>') +
        kpi('Campeões + Leais', F.int(cl), '<b>' + F.pct(r.total ? cl / r.total : 0) + '</b><span>da base ·</span><b>' + F.pct(champ.valueShare + loyal.valueShare) + '</b><span>do valor</span>') +
        kpi('Em risco', F.int(risk.n), '<b>' + F.moneyShort(risk.value) + '</b><span>comprados no histórico</span>') +
        kpi('Valor por cliente', F.money(r.total ? r.totalValue / r.total : 0), '<span>nota V5 acima de</span><b>' + F.moneyShort(r.qV[3]) + '</b>') +
      '</section>';

    const tools = segmented('rfvMode', [['notas', 'Notas (quintis)'], ['kmeans', 'k-means (k = 5)']], state.rfvMode);
    if (state.rfvMode === 'notas') {
      html += card({ title: 'Mapa recência × frequência', sub: 'Cada célula é uma combinação de notas R e F, pintada pelo segmento. Clique numa célula ou segmento para ver o detalhe.',
        tools, body: rfvGridHtml(r) });
      html += card({ title: 'Composição por valor (nota V)', sub: 'Quintis do valor total comprado por cliente',
        body: '<div class="vmix">' + r.vmix.map(v => '<div class="vmix-item"><span>V' + v.v + '</span><b>' + F.int(v.n) + '</b>' +
          '<small>' + F.pct(r.totalValue ? v.value / r.totalValue : 0) + ' do valor</small><small>' + F.moneyShort(v.min === Infinity ? 0 : v.min) + ' a ' + F.moneyShort(v.max) + '</small></div>').join('') + '</div>' });
      html += card({ title: 'Detalhe do segmento', id: 'seg-detail', body: segDetailHtml(d) });
    } else {
      const km = d.km();
      html += card({ title: 'Clusters k-means', sub: 'Agrupamento automático em 5 grupos sobre log(recência), log(frequência) e log(valor), padronizados.',
        tools, body: '<div class="rfv-layout"><div>' + legend(km.clusters.map(c => [c.name, c.color])) + canvas('km-scatter', 'tall') +
          '<p class="note">Cada ponto é um cliente (amostra de até 1.500). Eixo do valor em escala logarítmica.</p></div>' +
          '<div><div class="table-wrap"><table class="table"><thead><tr><th>Cluster</th><th class="r">Clientes</th><th class="r">Recência (mediana)</th><th class="r">Compras</th><th class="r">Valor/cliente</th><th class="r">% valor</th></tr></thead><tbody>' +
          km.clusters.map(c => '<tr><td>' + segTag(c.id) + '</td><td class="r">' + F.int(c.n) + ' <span class="muted">' + F.pct(c.share, 0) + '</span></td><td class="r">' + F.int(c.recMedian) + ' dias</td>' +
            '<td class="r">' + F.dec(c.ordersAvg) + '</td><td class="r">' + F.money(c.perCustomer) + '</td><td class="r">' + F.pct(c.valueShare) + '</td></tr>').join('') +
          '</tbody></table></div><p class="note">Convergiu em ' + km.iterations + ' iterações (inicialização k-means++ com semente fixa). ' +
          F.pct(km.agreement, 0) + ' dos clientes caem no segmento de mesmo nome nas notas por quintis; cada cluster recebe o nome do segmento por notas mais comum entre os seus clientes (sem repetir nomes).</p></div></div>' });
      html += card({ title: 'Perfil dos centróides', sub: 'Desvios-padrão em relação à média da base (recência alta = mais tempo sem comprar)', body: canvas('km-profile') });
    }
    html += how([
      '<b>R (recência)</b>: dias desde a última compra até a data de referência, em quintis: nota 5 para os 20% mais recentes, 1 para os 20% mais antigos.',
      '<b>F (frequência)</b>: número de compras no histórico em faixas fixas: 1, 2, 3, 4–5 e 6 ou mais (quintis não funcionam bem com tantos empates em 1 compra).',
      '<b>V (valor)</b>: valor total comprado, em quintis (nota 5 = 20% que mais gastaram).',
      'Segmentos pela grade R × F: Campeões (R≥4, F≥4), Novos (R≥4, F=1), Leais (R≥3, F≥3), Promissores (R≥3, demais), Em risco (R≤2, F≥3), Hibernando (R=2, F≤2) e Perdidos (R=1, F≤2).',
      '<b>k-means</b>: k = 5, inicialização k-means++ com semente fixa (resultado reprodutível), até 40 iterações, distância euclidiana sobre as três variáveis em log e padronizadas (z-score). O nome de cada cluster é o segmento por notas mais frequente entre os seus clientes.'
    ]);
    el.innerHTML = html;

    if (state.rfvMode === 'kmeans') drawKmeans(d);
  }

  function recencyLabel(r, q) {
    const t = q.map(v => Math.round(v));
    return r === 5 ? 'até ' + t[0] + ' d' : r === 4 ? t[0] + 1 + '–' + t[1] + ' d' : r === 3 ? t[1] + 1 + '–' + t[2] + ' d' : r === 2 ? t[2] + 1 + '–' + t[3] + ' d' : 'mais de ' + t[3] + ' d';
  }

  function rfvGridHtml(r) {
    let g = '<div class="rfv-layout"><div><div class="rfv-grid">';
    for (let rs = 5; rs >= 1; rs--) {
      g += '<div class="rfv-axis row"><span><b>R' + rs + '</b><br>' + recencyLabel(rs, r.qR) + '</span></div>';
      for (let fs = 1; fs <= 5; fs++) {
        const c = r.grid[rs][fs], s = A.SEG_BY_ID[c.seg];
        const cls = ['rfv-cell'];
        if (state.rfvSeg && state.rfvSeg !== c.seg) cls.push('dim');
        g += '<button type="button" class="' + cls.join(' ') + '" style="background:' + s.color + '" data-pick-seg="' + c.seg + '" title="' + s.name + ' · R' + rs + ' F' + fs + ': ' +
          F.int(c.n) + ' clientes, ' + F.money(c.value) + '"><small>' + s.name + '</small><b>' + F.int(c.n) + '</b><small>' + F.pct(r.total ? c.n / r.total : 0) + '</small></button>';
      }
    }
    g += '<div></div>' + ['1 compra', '2', '3', '4–5', '6+'].map((t, i) => '<div class="rfv-axis"><span><b>F' + (i + 1) + '</b><br>' + t + '</span></div>').join('');
    g += '</div><div class="rfv-caption"><span>← menos compras</span><span>mais compras →</span></div></div>';
    const maxShare = Math.max(...r.segments.map(s => s.share), 0.0001);
    g += '<div><div class="seg-head"><span>Segmento</span><span></span><span>Clientes</span><span>% valor</span></div><div class="seg-list">' +
      r.segments.map(s => '<button type="button" class="seg-row ' + (state.rfvSeg === s.id ? 'on' : '') + '" data-pick-seg="' + s.id + '">' +
        '<span class="name"><i style="background:' + s.color + '"></i>' + s.name + '</span>' +
        '<span class="mini-bar"><i style="width:' + (100 * s.share / maxShare).toFixed(1) + '%;background:' + s.color + '"></i></span>' +
        '<span class="r">' + F.int(s.n) + '<small>' + F.pct(s.share) + '</small></span><span class="r">' + F.pct(s.valueShare) + '</span></button>').join('') +
      '</div></div></div>';
    return g;
  }

  function segDetailHtml(d) {
    const r = d.rfv;
    if (!state.rfvSeg) {
      return '<div class="empty"><b>Escolha um segmento</b>Clique numa célula do mapa, numa linha da lista ou num atalho abaixo.' +
        '<div class="shortcut-list">' + r.segments.map(s => '<button type="button" class="pill" data-pick-seg="' + s.id + '"><i style="background:' + s.color + '"></i>' + s.name + ' <small>' + F.int(s.n) + '</small></button>').join('') + '</div></div>';
    }
    const s = r.segments.find(x => x.id === state.rfvSeg);
    const members = d.ctx.list.filter(x => x.seg === s.id).sort((a, b) => b.total - a.total);
    const top = members.slice(0, 10);
    return '<div class="seg-detail"><div class="seg-about"><h3><i style="background:' + s.color + '"></i>' + s.name + '</h3><p>' + s.about + '</p>' +
      '<div class="action"><b>Ação sugerida</b>' + s.action + '</div>' +
      '<div class="stat-row"><div><span>Clientes</span><b>' + F.int(s.n) + '</b></div><div><span>Dias sem comprar (média)</span><b>' + F.int(s.recAvg) + '</b></div>' +
      '<div><span>Compras (média)</span><b>' + F.dec(s.ordersAvg) + '</b></div></div>' +
      '<div class="stat-row"><div><span>Valor total</span><b>' + F.moneyShort(s.value) + '</b></div><div><span>Valor por cliente</span><b>' + F.money(s.perCustomer) + '</b></div>' +
      '<div><span>% do valor</span><b>' + F.pct(s.valueShare) + '</b></div></div>' +
      '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button type="button" class="btn dark sm" data-open-list="' + s.id + '">Abrir na lista de clientes</button>' +
      '<button type="button" class="btn sm" data-pick-seg="' + s.id + '">Fechar</button></div></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>UF</th><th class="r">R F V</th><th class="r">Compras</th><th class="r">Valor</th><th class="r">Última compra</th></tr></thead><tbody>' +
      top.map(x => '<tr><td><b>' + x.c.id + '</b> <span class="muted">' + esc(x.c.name) + '</span></td><td>' + x.c.uf + '</td><td class="r">' + x.r + ' ' + x.f + ' ' + x.v + '</td>' +
        '<td class="r">' + x.n + '</td><td class="r">' + F.money(x.total) + '</td><td class="r">' + dateOf(x.last) + '</td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  function drawKmeans(d) {
    const km = d.km(), L = d.ctx.list;
    const step = Math.max(1, Math.ceil(L.length / 1500));
    const byCluster = {};
    km.clusters.forEach(c => { byCluster[c.id] = []; });
    for (let i = 0; i < L.length; i += step) byCluster[L[i].km].push({ x: L[i].rec, y: L[i].total });
    chart('km-scatter', {
      type: 'scatter',
      data: { datasets: km.clusters.map(c => ({ label: c.name, data: byCluster[c.id], backgroundColor: c.color + 'aa', pointRadius: 2.6, pointHoverRadius: 5 })) },
      options: {
        scales: {
          x: { title: { display: true, text: 'Dias desde a última compra' }, border: { display: false }, grid: { color: cssVar('--grid-line') } },
          y: { type: 'logarithmic', title: { display: true, text: 'Valor total (R$)' }, border: { display: false }, ticks: { callback: v => [100, 300, 1000, 3000, 10000, 30000].includes(v) ? F.moneyShort(v) : '' } }
        },
        plugins: { tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + F.int(c.raw.x) + ' dias, ' + F.money(c.raw.y) } } }
      }
    });
    const dims = [['Recência (z)', 0, cssVar('--chart-2')], ['Frequência (z)', 1, cssVar('--chart-3')], ['Valor (z)', 2, cssVar('--chart-1')]];
    chart('km-profile', {
      type: 'bar',
      data: { labels: km.clusters.map(c => c.name), datasets: dims.map(dm => ({ label: dm[0], data: km.clusters.map(c => +c.z[dm[1]].toFixed(2)), backgroundColor: dm[2], borderRadius: 4, maxBarThickness: 22 })) },
      options: { plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10 } } },
        scales: { x: { grid: { display: false }, border: { display: false } }, y: { border: { display: false } } } }
    });
  }

  /* ======================= Curva ABC ======================= */
  function renderABC(d, el) {
    const ab = d.abc, k = ab.classes;
    const clsKpi = c => kpi('Classe ' + c, F.int(k[c].n) + ' <small>clientes</small>',
      '<b>' + F.pct(k[c].share) + '</b><span>da base ·</span><b>' + F.pct(k[c].valueShare) + '</b><span>da receita</span>',
      '<div class="bar"><i style="width:' + (100 * k[c].share).toFixed(1) + '%"></i></div>');
    // ABC by segment and by region
    const bySeg = {}, byRegion = {};
    A.SEGMENTS.forEach(s => { bySeg[s.id] = { A: 0, B: 0, C: 0, n: 0 }; });
    d.ctx.list.forEach(x => {
      const s = bySeg[x.seg]; s[x.abc]++; s.n++;
      const g = byRegion[x.c.region] = byRegion[x.c.region] || { n: 0, A: 0, value: 0, valueA: 0 };
      g.n++; g.value += x.total; if (x.abc === 'A') { g.A++; g.valueA += x.total; }
    });
    el.innerHTML =
      '<section class="kpi-strip k4">' + clsKpi('A') + clsKpi('B') + clsKpi('C') +
        kpi('Concentração', F.pct(ab.top1), '<span>da receita vem do 1% que mais compra · top 20% =</span><b>' + F.pct(ab.top20) + '</b>') + '</section>' +
      card({ title: 'Curva de Pareto dos clientes', sub: 'Clientes ordenados do maior para o menor valor, em faixas de 2% da base. Barras: % da receita da faixa. Linha: % acumulado.',
        body: legend([['Classe A', A.ABC_COLORS.A], ['Classe B', A.ABC_COLORS.B], ['Classe C', A.ABC_COLORS.C], ['% acumulado', cssVar('--chart-1')]]) + canvas('abc-pareto', 'tall') }) +
      '<div class="grid g2">' +
        card({ title: 'Classe ABC por segmento RFV', sub: 'Distribuição dos clientes de cada segmento entre as classes', body: canvas('abc-seg') }) +
        card({ title: 'Classe A por região', sub: 'Quantos clientes de cada região estão na curva A',
          body: '<div class="table-wrap"><table class="table"><thead><tr><th>Região</th><th class="r">Clientes</th><th class="r">Na classe A</th><th class="r">% A</th><th class="r">Receita</th><th class="r">% da receita</th></tr></thead><tbody>' +
            base.regions.filter(g => byRegion[g.id]).map(g => { const v = byRegion[g.id]; return '<tr><td>' + g.name + '</td><td class="r">' + F.int(v.n) + '</td><td class="r">' + F.int(v.A) + '</td><td class="r">' + F.pct(v.A / v.n) + '</td>' +
              '<td class="r">' + F.moneyShort(v.value) + '</td><td class="r">' + F.pct(v.value / ab.total) + '</td></tr>'; }).join('') + '</tbody></table></div>' }) +
      '</div>' +
      card({ title: '20 maiores clientes', sub: 'Por valor total comprado no histórico',
        body: '<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Cliente</th><th>UF</th><th>Segmento</th><th class="r">Compras</th><th class="r">Valor</th><th class="r">% acumulado</th><th>Classe</th></tr></thead><tbody>' +
          ab.sorted.slice(0, 20).map(x => '<tr><td class="muted">' + x.rank + '</td><td><b>' + x.c.id + '</b> <span class="muted">' + esc(x.c.name) + '</span></td><td>' + x.c.uf + '</td><td>' + segTag(x.seg) + '</td>' +
            '<td class="r">' + x.n + '</td><td class="r">' + F.money(x.total) + '</td><td class="r">' + F.pct(x.cum) + '</td><td>' + abcTag(x.abc) + '</td></tr>').join('') + '</tbody></table></div>' }) +
      how([
        'Clientes ordenados pelo valor total comprado no histórico (com os filtros do topo).',
        '<b>Classe A</b>: clientes que, somados do maior para o menor, chegam a 80% da receita; <b>B</b>: os próximos até 95%; <b>C</b>: os 5% finais da receita.',
        'Concentração: participação na receita do 1% e dos 20% de clientes que mais compram.'
      ]);

    chart('abc-pareto', {
      type: 'bar',
      data: { labels: ab.buckets.map(b => b.label), datasets: [
        { type: 'line', label: '% acumulado', data: ab.buckets.map(b => +(b.cum * 100).toFixed(2)), borderColor: cssVar('--chart-1'), backgroundColor: cssVar('--chart-1'),
          yAxisID: 'y2', pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, tension: 0.25, order: 0 },
        { type: 'line', label: '80%', data: ab.buckets.map(() => 80), yAxisID: 'y2', borderColor: cssVar('--text-3'), borderDash: [4, 4], borderWidth: 1, pointRadius: 0, order: 0 },
        { type: 'line', label: '95%', data: ab.buckets.map(() => 95), yAxisID: 'y2', borderColor: cssVar('--text-3'), borderDash: [2, 4], borderWidth: 1, pointRadius: 0, order: 0 },
        { label: '% da receita', data: ab.buckets.map(b => +(b.share * 100).toFixed(2)), backgroundColor: ab.buckets.map(b => A.ABC_COLORS[b.cls]), borderRadius: 3, order: 1 }
      ] },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: { display: false }, title: { display: true, text: '% acumulado de clientes' }, ticks: { autoSkip: true, maxTicksLimit: 10 } },
          y: { beginAtZero: true, border: { display: false }, ticks: { callback: v => v + '%' }, title: { display: true, text: '% da receita na faixa' } },
          y2: { position: 'right', min: 0, max: 100, grid: { display: false }, border: { display: false }, ticks: { callback: v => v + '%' } }
        },
        plugins: { tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + c.raw.toLocaleString('pt-BR') + '%' } } }
      }
    });
    const segs = A.SEGMENTS.filter(s => bySeg[s.id].n);
    chart('abc-seg', {
      type: 'bar',
      data: { labels: segs.map(s => s.name), datasets: ['A', 'B', 'C'].map(c => ({ label: 'Classe ' + c, data: segs.map(s => +(100 * bySeg[s.id][c] / bySeg[s.id].n).toFixed(1)),
        backgroundColor: A.ABC_COLORS[c], borderRadius: 3, maxBarThickness: 20 })) },
      options: { indexAxis: 'y', scales: { x: { stacked: true, max: 100, ticks: { callback: v => v + '%' }, border: { display: false } }, y: { stacked: true, grid: { display: false }, border: { display: false } } },
        plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + c.raw.toLocaleString('pt-BR') + '%' } } } }
    });
  }

  /* ======================= Recorrência ======================= */
  function renderRecurrence(d, el) {
    const rc = d.rec;
    const maxRate = Math.max(0.0001, ...rc.cohorts.flatMap(c => c.rates.slice(1).filter(v => v != null)));
    const cohortRows = rc.cohorts.map(co => '<tr><td><b>' + F.monthLong(co.month) + '</b></td><td class="r">' + F.int(co.size) + '</td>' +
      co.rates.slice(1).map(v => {
        if (v == null) return '<td class="cell na">–</td>';
        const a = Math.min(1, v / maxRate);
        return '<td class="cell" style="background:rgba(var(--heat),' + (0.08 + 0.8 * a).toFixed(2) + ');' + (a > 0.6 ? 'color:#fff' : '') + '">' + F.pct(v, 0) + '</td>';
      }).join('') + '</tr>').join('');

    el.innerHTML =
      '<section class="kpi-strip k5">' +
        kpi('Taxa de recompra 12m', F.pct(rc.cur.repeatRate), delta(rc.cur.repeatRate, rc.prev.repeatRate, 'pp') + '<span>vs <b>' + F.pct(rc.prev.repeatRate) + '</b></span>') +
        kpi('Clientes com 2+ compras', F.int(rc.multi), '<b>' + F.pct(rc.multiShare) + '</b><span>da base, no histórico</span>') +
        kpi('Intervalo entre compras', F.int(rc.gapMedian) + ' <small>dias</small>', '<span>mediana entre compras seguidas</span>') +
        kpi('Até a 2ª compra', F.int(rc.toSecondMedian) + ' <small>dias</small>', '<span>mediana, da 1ª para a 2ª compra</span>') +
        kpi('Compras por cliente', F.dec(rc.ordersPerCustomer), '<span>média no histórico</span>') +
      '</section>' +
      '<div class="grid g2">' +
        card({ title: 'Intervalo entre compras', sub: 'Dias entre duas compras seguidas do mesmo cliente (% dos intervalos)', body: canvas('rc-gap') }) +
        card({ title: 'Compras por cliente', sub: 'Quantos clientes têm 1, 2, 3… compras no histórico', body: canvas('rc-count') }) +
      '</div>' +
      card({ title: 'Safras de clientes (coortes)', sub: 'Clientes por mês da primeira compra e % que voltou a comprar em cada mês seguinte (M1 = mês seguinte)',
        body: '<div class="table-wrap"><table class="table cohort"><thead><tr><th>Safra</th><th class="r">Clientes</th>' +
          Array.from({ length: 11 }, (_, i) => '<th class="r">M' + (i + 1) + '</th>').join('') + '</tr></thead><tbody>' + cohortRows + '</tbody></table></div>' +
          '<p class="note">Quanto mais forte a cor, maior a recompra no mês. Meses que ainda não aconteceram ficam vazios.</p>' }) +
      how([
        'Taxa de recompra 12m: compradores da janela com compras em 2 ou mais datas diferentes ÷ compradores da janela.',
        'Intervalo entre compras: diferença em dias entre compras consecutivas do mesmo cliente, em todo o histórico.',
        'Safras: clientes adquiridos em cada um dos últimos 12 meses; a célula M<i>n</i> é a % da safra que comprou <i>n</i> meses depois do mês de aquisição.'
      ]);

    const total = rc.gapHist.reduce((a, b) => a + b.n, 0) || 1;
    chart('rc-gap', {
      type: 'bar',
      data: { labels: rc.gapHist.map(b => b.label), datasets: [{ data: rc.gapHist.map(b => +(100 * b.n / total).toFixed(1)), backgroundColor: cssVar('--chart-3'), borderRadius: 4, maxBarThickness: 40 }] },
      options: { scales: axes(v => v + '%', { x: { grid: { display: false }, border: { display: false }, title: { display: true, text: 'dias' } } }),
        plugins: { tooltip: { callbacks: { label: c => ' ' + c.raw.toLocaleString('pt-BR') + '% dos intervalos' } } } }
    });
    chart('rc-count', {
      type: 'bar',
      data: { labels: rc.countHist.map(b => b.label), datasets: [{ data: rc.countHist.map(b => b.n), backgroundColor: rc.countHist.map((b, i) => i === 0 ? cssVar('--chart-2') : cssVar('--chart-1')), borderRadius: 4, maxBarThickness: 40 }] },
      options: { scales: axes(null, { x: { grid: { display: false }, border: { display: false }, title: { display: true, text: 'compras no histórico' } } }),
        plugins: { tooltip: { callbacks: { label: c => ' ' + F.int(c.raw) + ' clientes · ' + F.moneyShort(rc.countHist[c.dataIndex].value) } } } }
    });
  }

  /* ======================= Funil de CRM ======================= */
  const FUNNEL_COLORS = ['#4a3cc0', '#6152d6', '#7d6ee6', '#cc5a33', '#c4322a'];
  function renderFunnel(d, el) {
    const fu = d.fun, t = fu.totals, st = fu.stages;
    const baseN = st[0].n || 1;
    const funnelHtml = '<div class="funnel">' + st.map((s, i) => {
      const w = Math.max(3, 100 * s.n / baseN);
      const prevN = i ? st[i - 1].n : 0;
      return '<div class="funnel-row"><div class="funnel-name"><b>' + s.name + '</b><span>' + s.hint + '</span></div>' +
        '<div class="funnel-track"><div class="funnel-bar" style="width:' + w.toFixed(1) + '%;background:' + FUNNEL_COLORS[i] + '">' + F.int(s.n) + '</div></div>' +
        '<div class="funnel-rate"><b>' + F.pct(s.n / baseN) + '</b>' + (i ? F.pct(prevN ? s.n / prevN : 0) + ' da etapa anterior' : 'da base') + '</div></div>';
    }).join('') + '</div>';
    const rows = fu.rows.slice().sort((a, b) => b.cmp.day - a.cmp.day);

    el.innerHTML =
      '<section class="kpi-strip k5">' +
        kpi('Clientes contatados', F.int(st[1].n), '<b>' + F.pct(st[1].n / baseN) + '</b><span>da base · ' + F.int(t.contacts) + ' contatos</span>') +
        kpi('Engajamento', F.pct(t.contacts ? t.engaged / t.contacts : 0), '<span>abriram, clicaram ou responderam</span>') +
        kpi('Conversão 30 dias', F.pct(t.contacts ? t.converted / t.contacts : 0), '<b>' + F.int(t.converted) + '</b><span>compras após contato</span>') +
        kpi('Receita atribuída', F.moneyShort(t.revenue), '<span>ticket</span><b>' + F.money(t.converted ? t.revenue / t.converted : 0) + '</b>') +
        kpi('Recompra pós-conversão', F.pct(st[3].n ? st[4].n / st[3].n : 0), '<b>' + F.int(st[4].n) + '</b><span>clientes voltaram</span>') +
      '</section>' +
      card({ title: 'Funil do CRM', sub: 'Clientes únicos em cada etapa, considerando todas as campanhas dos últimos 12 meses', body: funnelHtml }) +
      '<div class="grid g2">' +
        card({ title: 'Por canal', sub: 'Engajamento e conversão em 30 dias por contato', body: legend([['Engajamento', cssVar('--chart-3')], ['Conversão', cssVar('--chart-1')]]) + canvas('fu-channel', 'short') }) +
        card({ title: 'Dias até a conversão', sub: 'Tempo entre o contato e a compra (conversões em até 30 dias)', body: canvas('fu-wait', 'short') }) +
      '</div>' +
      card({ title: 'Campanhas', sub: 'Da mais recente para a mais antiga',
        body: '<div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Campanha</th><th>Canal</th><th>Público</th><th class="r">Contatos</th><th class="r">Engajamento</th><th class="r">Conversão</th><th class="r">Receita</th><th class="r">Ticket</th></tr></thead><tbody>' +
          rows.map(r => '<tr><td>' + dateOf(r.cmp.day) + '</td><td><b>' + esc(r.cmp.name) + '</b> <span class="muted">' + r.cmp.id + '</span></td><td>' + r.cmp.channel + '</td><td>' + r.cmp.audience + '</td>' +
            '<td class="r">' + F.int(r.contacts) + '</td><td class="r">' + F.pct(r.engageRate) + '</td><td class="r">' + F.pct(r.convRate) + '</td><td class="r">' + F.moneyShort(r.revenue) + '</td><td class="r">' + F.money(r.ticket) + '</td></tr>').join('') +
          '</tbody></table></div>' }) +
      how([
        '<b>Base</b>: clientes com ao menos uma compra (com os filtros do topo). <b>Contatados</b>: receberam ao menos uma campanha.',
        '<b>Engajados</b>: abriram, clicaram ou responderam a ao menos um contato.',
        '<b>Convertidos</b>: compraram em até 30 dias depois de um contato (atribuição por janela; inclui quem compraria de qualquer forma).',
        '<b>Recompra</b>: convertidos que compraram de novo depois da primeira compra convertida.',
        'Nas taxas por contato, o mesmo cliente conta uma vez por campanha recebida.'
      ]);

    chart('fu-channel', {
      type: 'bar',
      data: { labels: fu.byChannel.map(c => c.channel), datasets: [
        { label: 'Engajamento', data: fu.byChannel.map(c => +(100 * c.engageRate).toFixed(1)), backgroundColor: cssVar('--chart-3'), borderRadius: 4, maxBarThickness: 26 },
        { label: 'Conversão', data: fu.byChannel.map(c => +(100 * c.convRate).toFixed(1)), backgroundColor: cssVar('--chart-1'), borderRadius: 4, maxBarThickness: 26 }
      ] },
      options: { scales: axes(v => v + '%'), plugins: { tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + c.raw.toLocaleString('pt-BR') + '%' } } } }
    });
    chart('fu-wait', {
      type: 'bar',
      data: { labels: fu.waitHist.map(b => b.label), datasets: [{ data: fu.waitHist.map(b => b.n), backgroundColor: cssVar('--chart-1'), borderRadius: 4, maxBarThickness: 40 }] },
      options: { scales: axes(), plugins: { tooltip: { callbacks: { label: c => ' ' + F.int(c.raw) + ' conversões' } } } }
    });
  }

  /* ======================= Regiões ======================= */
  function renderRegions(d, el) {
    const rg = d.reg;
    const focus = state.region ? rg.regions.find(g => g.id === state.region) : rg.total;
    const top = rg.regions.slice().sort((a, b) => b.buyers - a.buyers)[0];
    const physical = rg.stores.filter(s => s.store.type !== 'Online' && s.buyers > 0 && (!state.region || s.store.region === state.region));
    const metric = state.mapMetric;
    const metricDef = {
      buyers: { get: o => o.buyers, label: (o) => F.int(o.buyers), color: '#6b5ce0' },
      growth: { get: o => o.growth, label: (o) => (o.growth >= 0 ? '+' : '') + F.pct(o.growth, 0), diverging: true },
      repeat: { get: o => o.repeatRate, label: (o) => F.pct(o.repeatRate, 0), color: '#1f9d6b' }
    }[metric];
    const values = {}, regionOf = {};
    Object.values(rg.ufs).forEach(u => { values[u.uf] = metricDef.get(u); regionOf[u.uf] = u.region; });
    const mapSvg = M.svg({
      tiles: base.tiles, regionOf, values, color: metricDef.color, diverging: metricDef.diverging, region: state.region,
      label: uf => metricDef.label(rg.ufs[uf]),
      title: uf => { const u = rg.ufs[uf]; return uf + ' · ' + regionName(u.region) + ': ' + F.int(u.buyers) + ' compradores (' + (u.growth >= 0 ? '+' : '') + F.pct(u.growth) + ' vs ano anterior), recompra ' + F.pct(u.repeatRate); }
    });
    const maxBuyers = Math.max(1, ...rg.regions.map(g => g.buyers));
    const regionList = '<div class="region-list">' + rg.regions.map(g => '<button type="button" class="region-row ' + (state.region === g.id ? 'on' : '') + '" data-set-region="' + g.id + '">' +
      '<span><b>' + g.name + '</b></span><span class="mini-bar"><i style="width:' + (100 * g.buyers / maxBuyers).toFixed(1) + '%;background:#6b5ce0"></i></span>' +
      '<span class="r">' + metricDef.label(g) + '</span><span class="r">' + delta(g.buyers, g.buyersPrev) + '</span></button>').join('') + '</div>';
    const ufRows = Object.values(rg.ufs).filter(u => !state.region || u.region === state.region).sort((a, b) => b.buyers - a.buyers).slice(0, state.region ? 99 : 10);
    const ufTable = '<div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>UF</th><th class="r">Compradores</th><th class="r">vs ano ant.</th><th class="r">Recompra</th><th class="r">Receita</th></tr></thead><tbody>' +
      ufRows.map(u => '<tr><td><b>' + u.uf + '</b> <span class="muted">' + regionName(u.region) + '</span></td><td class="r">' + F.int(u.buyers) + '</td><td class="r">' + delta(u.buyers, u.buyersPrev) + '</td>' +
        '<td class="r">' + F.pct(u.repeatRate) + '</td><td class="r">' + F.moneyShort(u.revenue) + '</td></tr>').join('') + '</tbody></table></div>';

    el.innerHTML =
      '<section class="kpi-strip k5">' +
        kpi(state.region ? 'Compradores · ' + focus.name : 'Compradores 12m', F.int(focus.buyers), delta(focus.buyers, focus.buyersPrev) + '<span>vs <b>' + F.int(focus.buyersPrev) + '</b></span>') +
        kpi('Maior região', top ? top.name : '–', top ? '<b>' + F.pct(top.share) + '</b><span>dos compradores</span>' : '') +
        kpi('Receita 12m', F.moneyShort(focus.revenue), delta(focus.revenue, focus.revenuePrev)) +
        kpi('Recompra 12m', F.pct(focus.repeatRate), '<span>compraram em 2+ datas</span>') +
        kpi('Lojas físicas com venda', F.int(physical.length), '<span>ticket médio</span><b>' + F.money(physical.reduce((a, s) => a + s.revenue, 0) / Math.max(1, physical.reduce((a, s) => a + s.orders, 0))) + '</b>') +
      '</section>' +
      card({ title: 'Mapa de clientes', sub: 'Pelo endereço do cliente, últimos 12 meses. Clique num estado ou numa região para filtrar o painel.',
        tools: segmented('mapMetric', [['buyers', 'Compradores'], ['growth', 'Evolução'], ['repeat', 'Recompra']], metric),
        body: '<div class="map-layout"><div>' + mapSvg +
          (metricDef.diverging ? '<div class="map-scale"><span>queda</span><i style="background:linear-gradient(90deg,#e2553f,var(--surface-2),#2fa877)"></i><span>alta</span></div>'
            : '<div class="map-scale"><span>menos</span><i style="background:linear-gradient(90deg,var(--surface-2),' + metricDef.color + ')"></i><span>mais</span></div>') +
          '</div><div>' + regionList + ufTable + '</div></div>' }) +
      card({ title: 'Lojas', sub: (state.region ? regionName(state.region) + ' · ' : '') + 'Compradores e receita nos últimos 12 meses. Clique no cabeçalho para ordenar.', id: 'stores-card', body: storesTable(rg) }) +
      how([
        'Região e estado vêm do <b>endereço do cliente</b>, não da loja onde comprou; a tabela de lojas usa a loja da compra.',
        'Evolução: compradores dos últimos 12 meses ÷ compradores dos 12 meses anteriores − 1.',
        'O mapa é um desenho abstrato: um quadrado por estado numa grade, sem geometria real.',
        'A loja online aparece na tabela quando não há filtro de região.'
      ]);
  }

  function storesTable(rg) {
    const s = state.storeSort;
    const cols = [['name', 'Loja', 'l'], ['uf', 'UF', 'l'], ['type', 'Tipo', 'l'], ['buyers', 'Compradores', 'r'], ['growthB', 'vs ano ant.', 'r'],
      ['revenue', 'Receita', 'r'], ['ticket', 'Ticket', 'r'], ['orders', 'Compras', 'r']];
    const val = (x, k) => k === 'name' ? x.store.name : k === 'uf' ? x.store.uf : k === 'type' ? x.store.type : k === 'growthB' ? (x.buyersPrev ? x.buyers / x.buyersPrev - 1 : 0) : x[k];
    const rows = rg.stores.filter(x => (state.region ? x.store.region === state.region : true) && (x.buyers || x.buyersPrev))
      .sort((a, b) => { const va = val(a, s.key), vb = val(b, s.key); return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * s.dir; });
    return '<div class="table-wrap"><table class="table"><thead><tr>' + cols.map(c => '<th class="sortable ' + (c[2] === 'r' ? 'r ' : '') + (s.key === c[0] ? 'sorted' : '') + '" data-sort="' + c[0] + '">' +
      c[1] + (s.key === c[0] ? (s.dir < 0 ? ' ↓' : ' ↑') : '') + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(x => '<tr><td><b>' + x.store.name + '</b> <span class="muted">' + x.store.id + '</span></td><td>' + (x.store.uf || '–') + '</td><td>' + x.store.type + '</td>' +
        '<td class="r">' + F.int(x.buyers) + '</td><td class="r">' + delta(x.buyers, x.buyersPrev) + '</td><td class="r">' + F.moneyShort(x.revenue) + '</td>' +
        '<td class="r">' + F.money(x.ticket) + '</td><td class="r">' + F.int(x.orders) + '</td></tr>').join('') +
      (rows.length ? '' : '<tr><td colspan="8" class="muted">Nenhuma loja com venda nesta combinação de filtros.</td></tr>') + '</tbody></table></div>';
  }

  /* ======================= Lista de clientes ======================= */
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function listRows(d) {
    const L = state.list, q = norm(L.q.trim());
    let rows = d.ctx.list;
    if (L.seg) rows = rows.filter(x => x.seg === L.seg);
    if (q) rows = rows.filter(x => norm(x.c.id).includes(q) || norm(x.c.name).includes(q));
    const by = {
      value: (a, b) => b.total - a.total,
      recent: (a, b) => a.rec - b.rec,
      orders: (a, b) => b.n - a.n || b.total - a.total,
      idle: (a, b) => b.rec - a.rec,
      id: (a, b) => a.c.i - b.c.i
    }[L.sort];
    return rows.slice().sort(by);
  }

  function renderList(d, el) {
    el.innerHTML =
      '<section class="kpi-strip k4" id="ls-kpis"></section>' +
      card({ body:
        '<div class="toolbar">' +
          '<label class="search"><svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>' +
          '<input type="search" id="ls-q" placeholder="Buscar por ID (CLI-000123) ou nome" value="' + esc(state.list.q) + '" aria-label="Buscar cliente"></label>' +
          '<select class="select" id="ls-sort" aria-label="Ordenar">' +
            [['value', 'Maior valor'], ['recent', 'Compra mais recente'], ['orders', 'Mais compras'], ['idle', 'Mais tempo sem comprar'], ['id', 'ID']].map(o =>
              '<option value="' + o[0] + '"' + (state.list.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
          '<button type="button" class="btn dark" id="ls-csv"><svg class="ic" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>Exportar CSV</button>' +
        '</div><div class="pills" id="ls-pills"></div><div id="ls-table"></div>' }) +
      how([
        'A lista usa a base RFV inteira com os filtros de região e canal do topo; a busca procura no ID e no nome.',
        'O CSV traz todas as linhas da seleção (não só a página visível), separado por ponto e vírgula, com vírgula decimal.',
        'Os nomes são fictícios (primeiro nome e inicial) e os IDs são sequenciais e sintéticos.'
      ]);
    updateList(d);
    const input = $('#ls-q');
    input.addEventListener('input', () => { state.list.q = input.value; state.list.page = 0; updateList(data()); });
    $('#ls-sort').addEventListener('change', e => { state.list.sort = e.target.value; state.list.page = 0; updateList(data()); });
    $('#ls-csv').addEventListener('click', () => exportCsv(listRows(data())));
  }

  function updateList(d) {
    const rows = listRows(d), L = state.list;
    const total = rows.reduce((a, x) => a + x.total, 0);
    $('#ls-kpis').innerHTML =
      kpi('Clientes na seleção', F.int(rows.length), '<span>de ' + F.int(d.ctx.list.length) + ' na base</span>') +
      kpi('Valor comprado', F.moneyShort(total), '<span>no histórico</span>') +
      kpi('Valor por cliente', F.money(rows.length ? total / rows.length : 0), '') +
      kpi('Dias sem comprar', F.int(A.median(rows.map(x => x.rec))), '<span>mediana da seleção</span>');
    const counts = {};
    d.ctx.list.forEach(x => { counts[x.seg] = (counts[x.seg] || 0) + 1; });
    $('#ls-pills').innerHTML = '<button type="button" class="pill ' + (!L.seg ? 'on' : '') + '" data-list-seg="">Todos <small>' + F.int(d.ctx.list.length) + '</small></button>' +
      A.SEGMENTS.map(s => '<button type="button" class="pill ' + (L.seg === s.id ? 'on' : '') + '" data-list-seg="' + s.id + '"><i style="background:' + s.color + '"></i>' + s.name + ' <small>' + F.int(counts[s.id] || 0) + '</small></button>').join('');
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    L.page = Math.min(L.page, pages - 1);
    const slice = rows.slice(L.page * PAGE_SIZE, (L.page + 1) * PAGE_SIZE);
    $('#ls-table').innerHTML = rows.length ?
      '<div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Cliente</th><th>UF</th><th>Segmento</th><th class="r">R F V</th><th>ABC</th><th class="r">Compras</th><th class="r">Valor total</th><th class="r">Ticket</th><th class="r">Última compra</th><th class="r">Dias sem comprar</th></tr></thead><tbody>' +
        slice.map(x => '<tr><td><b>' + x.c.id + '</b></td><td>' + esc(x.c.name) + '</td><td>' + x.c.uf + '</td><td>' + segTag(x.seg) + '</td><td class="r">' + x.r + ' ' + x.f + ' ' + x.v + '</td>' +
          '<td>' + abcTag(x.abc) + '</td><td class="r">' + x.n + '</td><td class="r">' + F.money(x.total) + '</td><td class="r">' + F.money(x.total / x.n) + '</td>' +
          '<td class="r">' + dateOf(x.last) + '</td><td class="r">' + F.int(x.rec) + '</td></tr>').join('') + '</tbody></table></div>' +
        '<div class="pager"><span>' + F.int(L.page * PAGE_SIZE + 1) + '–' + F.int(L.page * PAGE_SIZE + slice.length) + ' de ' + F.int(rows.length) + '</span><div>' +
          '<button type="button" class="btn sm" data-list-page="-1"' + (L.page ? '' : ' disabled') + '>‹ Anterior</button>' +
          '<button type="button" class="btn sm" data-list-page="1"' + (L.page < pages - 1 ? '' : ' disabled') + '>Próxima ›</button></div></div>'
      : '<div class="empty"><b>Nenhum cliente encontrado</b>Tente outro termo ou limpe o filtro de segmento.</div>';
  }

  function exportCsv(rows) {
    const num = v => v.toFixed(2).replace('.', ',');
    const head = ['id_cliente', 'nome', 'uf', 'regiao', 'loja_principal', 'segmento', 'nota_r', 'nota_f', 'nota_v', 'classe_abc', 'compras', 'valor_total', 'ticket_medio', 'primeira_compra', 'ultima_compra', 'dias_sem_comprar'];
    const lines = [head.join(';')];
    rows.forEach(x => {
      lines.push([x.c.id, x.c.name, x.c.uf, regionName(x.c.region), base.stores[x.c.store].name, A.SEG_BY_ID[x.seg].name, x.r, x.f, x.v, x.abc, x.n,
        num(x.total), num(x.total / x.n), dateOf(x.first), dateOf(x.last), x.rec].map(v => /[;"\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(';'));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'clientes_demo_' + (state.list.seg || 'todos') + (state.region ? '_' + state.region : '') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------- events ---------------- */
  function onClick(e) {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.matches('.chip[data-region]')) { state.region = t.dataset.region || null; return render(); }
    if (t.matches('.chip[data-channel]')) { state.channel = t.dataset.channel || null; return render(); }
    if (t.id === 'btn-clear') { state.region = null; state.channel = null; return render(); }
    if (t.dataset.setRegion) { state.region = state.region === t.dataset.setRegion ? null : t.dataset.setRegion; return render(); }
    if (t.dataset.gotoSeg) { state.rfvSeg = t.dataset.gotoSeg; state.rfvMode = 'notas'; return; } // the link changes the hash
    if (t.dataset.pickSeg) { state.rfvSeg = state.rfvSeg === t.dataset.pickSeg ? null : t.dataset.pickSeg; return render(); }
    if (t.dataset.openList) { state.list.seg = t.dataset.openList; state.list.page = 0; location.hash = '#lista'; return; }
    if (t.dataset.listSeg !== undefined) { state.list.seg = t.dataset.listSeg || null; state.list.page = 0; return updateList(data()); }
    if (t.dataset.listPage) { state.list.page += Number(t.dataset.listPage); updateList(data()); return $('#ls-table').scrollIntoView({ block: 'nearest' }); }
    const segCtl = t.closest('[data-seg-control]');
    if (segCtl && t.dataset.value) {
      const name = segCtl.dataset.segControl;
      if (name === 'rfvMode') state.rfvMode = t.dataset.value;
      if (name === 'mapMetric') state.mapMetric = t.dataset.value;
      return render();
    }
  }
  function onMapClick(e) {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort, s = state.storeSort;
      if (s.key === k) s.dir = -s.dir; else { s.key = k; s.dir = ['name', 'uf', 'type'].includes(k) ? 1 : -1; }
      $('#stores-card .table-wrap').outerHTML = storesTable(data().reg);
      return;
    }
    const tile = e.target.closest('.tile-map .tile');
    if (tile) {
      const reg = base.states.find(s => s.uf === tile.dataset.uf).region;
      state.region = state.region === reg ? null : reg;
      render();
    }
  }

  function currentTheme() {
    const t = document.documentElement.dataset.theme;
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }

  function setDataInfo() {
    const orders = base.customers.reduce((a, c) => a + c.purchases.length, 0);
    $('#data-info').innerHTML = '<b><i aria-hidden="true"></i>Dados sintéticos</b><span>Semente ' + state.seed + ' · até ' + dateOf(base.lastDay) + '</span>' +
      '<span>' + F.int(base.customers.length) + ' clientes · ' + F.int(orders) + ' compras</span>';
  }

  function generate() {
    base = D.generate(state.seed);
    cache = null;
    setDataInfo();
  }

  function route() {
    const p = (location.hash || '').replace('#', '');
    state.page = PAGES[p] ? p : 'geral';
    render();
    window.scrollTo(0, 0);
    $('#shell').classList.remove('menu-open');
  }

  function init() {
    applyTheme(saved.get('dr_theme', null));
    if (saved.get('dr_collapsed', false)) $('#shell').classList.add('collapsed');
    generate();

    document.addEventListener('click', onClick);
    $('#content').addEventListener('click', onMapClick);
    $('#content').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.tile')) { e.preventDefault(); onMapClick(e); } });
    window.addEventListener('hashchange', route);
    $('#btn-theme').addEventListener('click', () => { const next = currentTheme() === 'dark' ? 'light' : 'dark'; applyTheme(next); saved.set('dr_theme', next); render(); });
    $('#btn-collapse').addEventListener('click', () => {
      const on = $('#shell').classList.toggle('collapsed');
      $('#btn-collapse').setAttribute('aria-expanded', String(!on));
      saved.set('dr_collapsed', on);
      setTimeout(() => charts.forEach(c => c.resize()), 220);
    });
    $('#btn-menu').addEventListener('click', () => {
      const open = $('#shell').classList.toggle('menu-open');
      $('#btn-menu').setAttribute('aria-expanded', String(open));
    });
    $('#btn-sample').addEventListener('click', () => {
      state.seed = state.seed >= 9999 ? 1 : state.seed + 1;
      saved.set('dr_seed', state.seed);
      generate();
      render();
    });
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (!document.documentElement.dataset.theme) render(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
    }
    route();
  }

  init();
})();
