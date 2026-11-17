/*
 * Demo Retail Co. :: customer analytics (runs entirely in the browser)
 * RFV scoring + segments, k-means clustering, ABC curve, recurrence, CRM funnel and regional rollups.
 * Exposes window.DemoAnalytics.
 */
(function (root) {
  'use strict';

  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  /* Segment catalogue. Colours are mid-tones that read on light and dark backgrounds. */
  const SEGMENTS = [
    { id: 'campeoes', name: 'Campeões', color: '#1f9d6b',
      about: 'Compraram há pouco, compram com frequência e gastam mais.',
      action: 'Acesso antecipado a lançamentos, atendimento VIP e programa de indicação.' },
    { id: 'leais', name: 'Leais', color: '#3b82c4',
      about: 'Compram com regularidade e continuam ativos.',
      action: 'Benefícios de fidelidade e venda cruzada de categorias.' },
    { id: 'promissores', name: 'Promissores', color: '#7c6fd6',
      about: 'Compra recente, mas ainda poucas compras no histórico.',
      action: 'Guiar a próxima compra: recomendação personalizada e cupom com prazo.' },
    { id: 'novos', name: 'Novos', color: '#20a4b0',
      about: 'Primeira compra muito recente.',
      action: 'Régua de boas-vindas e contato de pós-venda.' },
    { id: 'em_risco', name: 'Em risco', color: '#e07a2c',
      about: 'Já compraram bastante, mas estão há tempo sem voltar.',
      action: 'Contato pessoal, oferta de retorno e pesquisa de motivo.' },
    { id: 'hibernando', name: 'Hibernando', color: '#c09a22',
      about: 'Poucas compras e um bom tempo sem comprar.',
      action: 'Campanhas de reativação de baixo custo (e-mail, push).' },
    { id: 'perdidos', name: 'Perdidos', color: '#8d8d88',
      about: 'Uma ou duas compras, há muito tempo.',
      action: 'Só nas grandes datas; evitar canais caros.' }
  ];
  const SEG_BY_ID = {};
  SEGMENTS.forEach(s => { SEG_BY_ID[s.id] = s; });

  const ABC_COLORS = { A: '#5b4bd6', B: '#9a8ff0', C: '#c9c6dc' };

  /* ------------ formatting (pt-BR) ------------ */
  const nfInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nfMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmt = {
    int: n => nfInt.format(Math.round(n || 0)),
    dec: n => nf1.format(n || 0),
    money: n => nfMoney.format(n || 0),
    moneyShort(n) {
      const a = Math.abs(n || 0);
      if (a >= 1e6) return 'R$ ' + nf1.format(n / 1e6) + ' mi';
      if (a >= 1e4) return 'R$ ' + nfInt.format(n / 1e3) + ' mil';
      if (a >= 1e3) return 'R$ ' + nf1.format(n / 1e3) + ' mil';
      return 'R$ ' + nfInt.format(n || 0);
    },
    pct: (x, digits) => (isFinite(x) ? (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits == null ? 1 : digits, maximumFractionDigits: digits == null ? 1 : digits }) : '–') + '%',
    date: dt => dt.toLocaleDateString('pt-BR', { timeZone: 'UTC' }),
    month: mi => { const m = (mi + 10) % 12; const y = 2023 + Math.floor((mi + 10) / 12); return MONTHS[m] + '/' + String(y).slice(2); },
    monthLong: mi => { const m = (mi + 10) % 12; const y = 2023 + Math.floor((mi + 10) / 12); return MONTHS[m] + ' ' + y; }
  };

  const median = arr => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };
  const quantile = (sorted, p) => {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };

  /* ------------ base context ------------ */
  /* filter: { region: 'SE' | null, channel: 'store' | 'online' | null } */
  function prepare(base, filter) {
    const f = filter || {};
    const REF = base.lastDay;
    const list = [];
    const byIndex = new Map();
    const wantChannel = f.channel === 'online' ? 1 : f.channel === 'store' ? 0 : -1;
    for (const c of base.customers) {
      if (f.region && c.region !== f.region) continue;
      const ps = wantChannel < 0 ? c.purchases : c.purchases.filter(p => p.k === wantChannel);
      if (!ps.length) continue;
      let total = 0;
      for (const p of ps) total += p.v;
      const last = ps[ps.length - 1].d;
      const item = { c, ps, n: ps.length, total, first: ps[0].d, last, rec: REF - last };
      list.push(item);
      byIndex.set(c.i, item);
    }
    return { base, filter: f, REF, list, byIndex };
  }

  /* purchases in (from, to] */
  function windowStats(ctx, from, to) {
    let buyers = 0, revenue = 0, orders = 0, repeaters = 0;
    for (const x of ctx.list) {
      let distinct = 0, prevDay = -1, any = false;
      for (const p of x.ps) {
        if (p.d <= from || p.d > to) continue;
        any = true; revenue += p.v; orders++;
        if (p.d !== prevDay) { distinct++; prevDay = p.d; }
      }
      if (any) { buyers++; if (distinct >= 2) repeaters++; }
    }
    return { buyers, revenue, orders, repeaters, ticket: orders ? revenue / orders : 0, repeatRate: buyers ? repeaters / buyers : 0 };
  }

  /* ------------ overview ------------ */
  function overview(ctx) {
    const REF = ctx.REF, mod = ctx.base.monthOfDay;
    const cur = windowStats(ctx, REF - 365, REF);
    const prev = windowStats(ctx, REF - 730, REF - 365);
    const lastMonth = mod[REF];
    const nMonths = lastMonth + 1;
    const buyers = new Array(nMonths).fill(0), revenue = new Array(nMonths).fill(0), newcomers = new Array(nMonths).fill(0);
    for (const x of ctx.list) {
      let lastM = -1;
      if (x.c.since === x.first) newcomers[mod[x.first]]++;   // acquired inside the observed window
      for (const p of x.ps) {
        const m = mod[p.d];
        revenue[m] += p.v;
        if (m !== lastM) { buyers[m]++; lastM = m; }
      }
    }
    return { cur, prev, lastMonth, buyers, revenue, newcomers, base: ctx.list.length };
  }

  /* ------------ RFV ------------ */
  function fScore(n) { return n >= 6 ? 5 : n >= 4 ? 4 : n; }
  function segmentOf(r, f) {
    if (r >= 4 && f >= 4) return 'campeoes';
    if (r >= 4 && f === 1) return 'novos';
    if (r >= 3 && f >= 3) return 'leais';
    if (r >= 3) return 'promissores';
    if (f >= 3) return 'em_risco';
    if (r === 2) return 'hibernando';
    return 'perdidos';
  }

  function rfv(ctx) {
    const L = ctx.list;
    const recs = L.map(x => x.rec).sort((a, b) => a - b);
    const vals = L.map(x => x.total).sort((a, b) => a - b);
    const qR = [0.2, 0.4, 0.6, 0.8].map(p => quantile(recs, p));
    const qV = [0.2, 0.4, 0.6, 0.8].map(p => quantile(vals, p));
    const grid = [];
    for (let r = 0; r <= 5; r++) { grid.push([]); for (let f = 0; f <= 5; f++) grid[r].push({ n: 0, value: 0 }); }
    const segAgg = {};
    SEGMENTS.forEach(s => { segAgg[s.id] = { n: 0, value: 0, rec: 0, orders: 0 }; });
    const vmix = [0, 1, 2, 3, 4, 5].map(v => ({ v, n: 0, value: 0, min: Infinity, max: 0 }));
    let totalValue = 0;

    for (const x of L) {
      x.r = x.rec <= qR[0] ? 5 : x.rec <= qR[1] ? 4 : x.rec <= qR[2] ? 3 : x.rec <= qR[3] ? 2 : 1;
      x.f = fScore(x.n);
      x.v = x.total > qV[3] ? 5 : x.total > qV[2] ? 4 : x.total > qV[1] ? 3 : x.total > qV[0] ? 2 : 1;
      x.seg = segmentOf(x.r, x.f);
      const g = grid[x.r][x.f]; g.n++; g.value += x.total;
      const s = segAgg[x.seg]; s.n++; s.value += x.total; s.rec += x.rec; s.orders += x.n;
      const vm = vmix[x.v]; vm.n++; vm.value += x.total; vm.min = Math.min(vm.min, x.total); vm.max = Math.max(vm.max, x.total);
      totalValue += x.total;
    }
    for (let r = 1; r <= 5; r++) for (let f = 1; f <= 5; f++) grid[r][f].seg = segmentOf(r, f);
    const total = L.length;
    const segments = SEGMENTS.map(meta => {
      const a = segAgg[meta.id];
      return Object.assign({}, meta, {
        n: a.n, value: a.value, share: total ? a.n / total : 0, valueShare: totalValue ? a.value / totalValue : 0,
        recAvg: a.n ? a.rec / a.n : 0, ordersAvg: a.n ? a.orders / a.n : 0, perCustomer: a.n ? a.value / a.n : 0
      });
    });
    return { grid, segments, vmix: vmix.slice(1), total, totalValue, qR, qV, active12: L.filter(x => x.rec <= 365).length };
  }

  /* ------------ k-means on standardised log(R), log(F), log(V) ------------ */
  function kmeans(ctx, k, seed) {
    k = k || 5;
    const L = ctx.list, n = L.length;
    if (n < k) return { k, clusters: [], agreement: 0 };
    const raw = L.map(x => [Math.log1p(x.rec), Math.log(x.n), Math.log(x.total)]);
    const mean = [0, 0, 0], sd = [0, 0, 0];
    raw.forEach(p => p.forEach((v, j) => { mean[j] += v / n; }));
    raw.forEach(p => p.forEach((v, j) => { sd[j] += (v - mean[j]) * (v - mean[j]) / n; }));
    for (let j = 0; j < 3; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    const X = raw.map(p => p.map((v, j) => (v - mean[j]) / sd[j]));
    const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

    // k-means++ seeding with a deterministic PRNG
    const rand = root.DemoData.rng(seed || 7);
    const centers = [X[Math.floor(rand() * n)].slice()];
    const d2 = new Float64Array(n);
    while (centers.length < k) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        let best = Infinity;
        for (const c of centers) best = Math.min(best, dist2(X[i], c));
        d2[i] = best; sum += best;
      }
      let t = rand() * sum, pick = n - 1;
      for (let i = 0; i < n; i++) { t -= d2[i]; if (t <= 0) { pick = i; break; } }
      centers.push(X[pick].slice());
    }

    const label = new Int8Array(n).fill(-1);
    let iterations = 0;
    for (; iterations < 40; iterations++) {
      let changed = 0;
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < k; c++) { const dd = dist2(X[i], centers[c]); if (dd < bd) { bd = dd; best = c; } }
        if (label[i] !== best) { label[i] = best; changed++; }
      }
      const sums = centers.map(() => [0, 0, 0]), counts = new Array(k).fill(0);
      for (let i = 0; i < n; i++) { const c = label[i]; counts[c]++; for (let j = 0; j < 3; j++) sums[c][j] += X[i][j]; }
      for (let c = 0; c < k; c++) if (counts[c]) for (let j = 0; j < 3; j++) centers[c][j] = sums[c][j] / counts[c];
      if (!changed) break;
    }

    // name clusters: one-to-one greedy match on the share of each cluster that falls in each quintile segment
    // (needs rfv() to have run first; otherwise fall back to the catalogue order)
    const sizes = new Array(k).fill(0);
    const overlap = centers.map(() => {
      const o = {};
      SEGMENTS.forEach(s => { o[s.id] = 0; });
      return o;
    });
    for (let i = 0; i < n; i++) { sizes[label[i]]++; if (L[i].seg) overlap[label[i]][L[i].seg]++; }
    const nameOf = new Array(k), usedSeg = new Set(), usedCluster = new Set();
    for (let round = 0; round < k; round++) {
      let best = null;
      for (let c = 0; c < k; c++) {
        if (usedCluster.has(c)) continue;
        for (const s of SEGMENTS) {
          if (usedSeg.has(s.id)) continue;
          const score = sizes[c] ? overlap[c][s.id] / sizes[c] : 0;
          if (!best || score > best.score) best = { c, id: s.id, score };
        }
      }
      nameOf[best.c] = best.id;
      usedCluster.add(best.c);
      usedSeg.add(best.id);
    }

    const clusters = centers.map((z, c) => {
      const members = [];
      for (let i = 0; i < n; i++) if (label[i] === c) members.push(L[i]);
      const value = members.reduce((a, x) => a + x.total, 0);
      return Object.assign({}, SEG_BY_ID[nameOf[c]], {
        index: c, z, n: members.length, share: members.length / n, value,
        recMedian: median(members.map(x => x.rec)), ordersAvg: members.reduce((a, x) => a + x.n, 0) / (members.length || 1),
        perCustomer: value / (members.length || 1)
      });
    });
    const totalValue = clusters.reduce((a, c) => a + c.value, 0);
    clusters.forEach(c => { c.valueShare = totalValue ? c.value / totalValue : 0; });
    let agree = 0;
    for (let i = 0; i < n; i++) { L[i].km = nameOf[label[i]]; if (L[i].seg && L[i].seg === L[i].km) agree++; }
    clusters.sort((a, b) => SEGMENTS.findIndex(s => s.id === a.id) - SEGMENTS.findIndex(s => s.id === b.id));
    return { k, clusters, iterations: iterations + 1, agreement: agree / n };
  }

  /* ------------ ABC (Pareto) ------------ */
  function abc(ctx) {
    const sorted = ctx.list.slice().sort((a, b) => b.total - a.total);
    const total = sorted.reduce((a, x) => a + x.total, 0) || 1;
    const classes = { A: { n: 0, value: 0 }, B: { n: 0, value: 0 }, C: { n: 0, value: 0 } };
    let cum = 0;
    sorted.forEach((x, i) => {
      const before = cum / total;
      cum += x.total;
      x.cum = cum / total;
      x.rank = i + 1;
      x.abc = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C';
      classes[x.abc].n++; classes[x.abc].value += x.total;
    });
    const n = sorted.length || 1;
    Object.keys(classes).forEach(k => { classes[k].share = classes[k].n / n; classes[k].valueShare = classes[k].value / total; });
    const buckets = [];
    const B = 50;
    let acc = 0;
    for (let b = 0; b < B; b++) {
      const i0 = Math.floor(b * n / B), i1 = Math.floor((b + 1) * n / B);
      let v = 0;
      for (let i = i0; i < i1 && i < sorted.length; i++) v += sorted[i].total;
      acc += v;
      buckets.push({ label: ((b + 1) * 100 / B) + '%', share: v / total, cum: acc / total, cls: sorted[Math.min(i0, sorted.length - 1)] ? sorted[Math.min(i0, sorted.length - 1)].abc : 'C' });
    }
    const top1 = sorted.slice(0, Math.max(1, Math.round(n * 0.01))).reduce((a, x) => a + x.total, 0) / total;
    const top20 = sorted.slice(0, Math.max(1, Math.round(n * 0.2))).reduce((a, x) => a + x.total, 0) / total;
    return { sorted, total, classes, buckets, top1, top20 };
  }

  /* ------------ recurrence ------------ */
  const GAP_BINS = [[0, 30, 'até 30'], [31, 60, '31–60'], [61, 90, '61–90'], [91, 120, '91–120'], [121, 180, '121–180'],
    [181, 270, '181–270'], [271, 365, '271–365'], [366, 1e9, '366+']];
  const COUNT_BINS = [[1, 1, '1'], [2, 2, '2'], [3, 3, '3'], [4, 4, '4'], [5, 5, '5'], [6, 9, '6–9'], [10, 1e9, '10+']];

  function recurrence(ctx) {
    const REF = ctx.REF, mod = ctx.base.monthOfDay;
    const cur = windowStats(ctx, REF - 365, REF), prev = windowStats(ctx, REF - 730, REF - 365);
    const gaps = [], toSecond = [];
    const gapHist = GAP_BINS.map(b => ({ label: b[2], n: 0 }));
    const countHist = COUNT_BINS.map(b => ({ label: b[2], n: 0, value: 0 }));
    let multi = 0;
    for (const x of ctx.list) {
      const ci = COUNT_BINS.findIndex(b => x.n >= b[0] && x.n <= b[1]);
      countHist[ci].n++; countHist[ci].value += x.total;
      if (x.n >= 2) { multi++; toSecond.push(x.ps[1].d - x.ps[0].d); }
      for (let i = 1; i < x.ps.length; i++) {
        const g = x.ps[i].d - x.ps[i - 1].d;
        gaps.push(g);
        gapHist[GAP_BINS.findIndex(b => g >= b[0] && g <= b[1])].n++;
      }
    }
    // cohorts: customers by month of first purchase (last 12 months) x months since
    const lastM = mod[REF];
    const cohorts = [];
    for (let m = lastM - 11; m <= lastM; m++) cohorts.push({ month: m, size: 0, active: new Array(12).fill(0) });
    for (const x of ctx.list) {
      if (x.c.since !== x.first) continue;                     // cohort = month of acquisition
      const m0 = mod[x.first];
      const co = cohorts[m0 - (lastM - 11)];
      if (!co) continue;
      co.size++;
      let lastOff = -1;
      for (const p of x.ps) {
        const off = mod[p.d] - m0;
        if (off > 11) break;
        if (off !== lastOff) { co.active[off]++; lastOff = off; }
      }
    }
    cohorts.forEach(co => { co.rates = co.active.map((a, off) => (co.month + off <= lastM && co.size ? a / co.size : null)); });
    const totalOrders = ctx.list.reduce((a, x) => a + x.n, 0);
    return {
      cur, prev, gapHist, countHist, cohorts, multi, multiShare: ctx.list.length ? multi / ctx.list.length : 0,
      gapMedian: median(gaps), toSecondMedian: median(toSecond), ordersPerCustomer: ctx.list.length ? totalOrders / ctx.list.length : 0
    };
  }

  /* ------------ CRM funnel ------------ */
  const WAIT_BINS = [[1, 3, '1–3 dias'], [4, 7, '4–7'], [8, 14, '8–14'], [15, 21, '15–21'], [22, 30, '22–30']];

  function funnel(ctx) {
    const campaigns = ctx.base.campaigns;
    const contacted = new Set(), engaged = new Set(), converted = new Map();
    const waitHist = WAIT_BINS.map(b => ({ label: b[2], n: 0 }));
    const rows = campaigns.map(cmp => {
      let nC = 0, nE = 0, nV = 0, rev = 0;
      for (let j = 0; j < cmp.contacts.length; j++) {
        const ci = cmp.contacts[j];
        const item = ctx.byIndex.get(ci);
        if (!item) continue;
        nC++; contacted.add(ci);
        if (cmp.engaged[j]) { nE++; engaged.add(ci); }
        const conv = item.ps.find(p => p.d > cmp.day && p.d <= cmp.day + 30);
        if (conv) {
          nV++; rev += conv.v;
          const w = conv.d - cmp.day;
          waitHist[WAIT_BINS.findIndex(b => w >= b[0] && w <= b[1])].n++;
          if (!converted.has(ci) || converted.get(ci) > conv.d) converted.set(ci, conv.d);
        }
      }
      return { cmp, contacts: nC, engaged: nE, converted: nV, revenue: rev,
        engageRate: nC ? nE / nC : 0, convRate: nC ? nV / nC : 0, ticket: nV ? rev / nV : 0 };
    });
    let repeat = 0;
    converted.forEach((day, ci) => { if (ctx.byIndex.get(ci).ps.some(p => p.d > day)) repeat++; });
    const channels = {};
    rows.forEach(r => {
      const ch = channels[r.cmp.channel] = channels[r.cmp.channel] || { channel: r.cmp.channel, contacts: 0, engaged: 0, converted: 0, revenue: 0 };
      ch.contacts += r.contacts; ch.engaged += r.engaged; ch.converted += r.converted; ch.revenue += r.revenue;
    });
    const byChannel = Object.values(channels).map(c => Object.assign(c, {
      engageRate: c.contacts ? c.engaged / c.contacts : 0, convRate: c.contacts ? c.converted / c.contacts : 0 }));
    const totals = rows.reduce((a, r) => { a.contacts += r.contacts; a.engaged += r.engaged; a.converted += r.converted; a.revenue += r.revenue; return a; },
      { contacts: 0, engaged: 0, converted: 0, revenue: 0 });
    const stages = [
      { id: 'base', name: 'Base de clientes', n: ctx.list.length, hint: 'clientes com ao menos uma compra' },
      { id: 'contatados', name: 'Contatados', n: contacted.size, hint: 'receberam ao menos uma campanha' },
      { id: 'engajados', name: 'Engajados', n: engaged.size, hint: 'abriram, clicaram ou responderam' },
      { id: 'convertidos', name: 'Convertidos', n: converted.size, hint: 'compraram até 30 dias após um contato' },
      { id: 'recompra', name: 'Recompra', n: repeat, hint: 'voltaram a comprar depois da conversão' }
    ];
    return { rows, byChannel, totals, stages, waitHist };
  }

  /* ------------ regional rollups ------------ */
  function regional(base, filter) {
    const ctx = prepare(base, { channel: filter && filter.channel });
    const REF = ctx.REF, lo = REF - 365, lo2 = REF - 730;
    const ufs = {};
    base.states.forEach(s => { ufs[s.uf] = { uf: s.uf, region: s.region, buyers: 0, buyersPrev: 0, revenue: 0, revenuePrev: 0, repeaters: 0 }; });
    const st = base.stores.map(s => ({ store: s, buyers: new Set(), buyersPrev: new Set(), revenue: 0, revenuePrev: 0, orders: 0 }));
    for (const x of ctx.list) {
      const u = ufs[x.c.uf];
      let distinct = 0, prevDay = -1, any = false, anyPrev = false;
      for (const p of x.ps) {
        if (p.d > lo) {
          any = true; u.revenue += p.v;
          if (p.d !== prevDay) { distinct++; prevDay = p.d; }
          const s = st[p.s]; s.buyers.add(x.c.i); s.revenue += p.v; s.orders++;
        } else if (p.d > lo2) {
          anyPrev = true; u.revenuePrev += p.v;
          const s = st[p.s]; s.buyersPrev.add(x.c.i); s.revenuePrev += p.v;
        }
      }
      if (any) { u.buyers++; if (distinct >= 2) u.repeaters++; }
      if (anyPrev) u.buyersPrev++;
    }
    const finish = o => Object.assign(o, {
      growth: o.buyersPrev ? o.buyers / o.buyersPrev - 1 : 0, repeatRate: o.buyers ? o.repeaters / o.buyers : 0 });
    Object.values(ufs).forEach(finish);
    const total = finish({ buyers: 0, buyersPrev: 0, revenue: 0, revenuePrev: 0, repeaters: 0 });
    const regions = base.regions.map(r => {
      const o = { id: r.id, name: r.name, buyers: 0, buyersPrev: 0, revenue: 0, revenuePrev: 0, repeaters: 0 };
      r.ufs.forEach(uf => { const u = ufs[uf]; ['buyers', 'buyersPrev', 'revenue', 'revenuePrev', 'repeaters'].forEach(k => { o[k] += u[k]; total[k] += u[k]; }); });
      return finish(o);
    });
    finish(total);
    regions.forEach(r => { r.share = total.buyers ? r.buyers / total.buyers : 0; });
    const stores = st.map(s => ({
      store: s.store, buyers: s.buyers.size, buyersPrev: s.buyersPrev.size, revenue: s.revenue, revenuePrev: s.revenuePrev, orders: s.orders,
      ticket: s.orders ? s.revenue / s.orders : 0, growth: s.revenuePrev ? s.revenue / s.revenuePrev - 1 : 0
    }));
    return { ufs, regions, stores, total };
  }

  root.DemoAnalytics = {
    SEGMENTS, SEG_BY_ID, ABC_COLORS, fmt, median,
    prepare, windowStats, overview, rfv, kmeans, abc, recurrence, funnel, regional, segmentOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
