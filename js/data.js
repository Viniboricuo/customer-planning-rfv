/*
 * Demo Retail Co. :: synthetic data generator
 * -------------------------------------------
 * Everything here is invented. A seeded PRNG makes the output deterministic:
 * the same seed always yields the same customers, stores, purchases and CRM events.
 *
 * Exposes window.DemoData = { generate(seed, options), rng, REGIONS, UF_TILES }.
 */
(function (root) {
  'use strict';

  const MS_DAY = 86400000;
  const START = Date.UTC(2023, 10, 1);   // 2023-11-01 (day 0)
  const END = Date.UTC(2026, 9, 31);     // 2026-10-31 (reference date, last day with data)
  const LAST_DAY = Math.round((END - START) / MS_DAY);

  /* Small, fast 32-bit PRNG (mulberry32 algorithm). */
  function rng(seed) {
    let s = seed >>> 0;
    return function next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Macro regions with a rough share of the customer base. */
  const REGIONS = [
    { id: 'N',  name: 'Norte',        share: 0.08, ufs: ['AM', 'PA', 'RO', 'TO', 'AC', 'AP', 'RR'] },
    { id: 'NE', name: 'Nordeste',     share: 0.22, ufs: ['BA', 'PE', 'CE', 'MA', 'PB', 'RN', 'AL', 'PI', 'SE'] },
    { id: 'CO', name: 'Centro-Oeste', share: 0.09, ufs: ['DF', 'GO', 'MT', 'MS'] },
    { id: 'SE', name: 'Sudeste',      share: 0.46, ufs: ['SP', 'RJ', 'MG', 'ES'] },
    { id: 'S',  name: 'Sul',          share: 0.15, ufs: ['PR', 'RS', 'SC'] }
  ];

  /* Abstract tile grid (column, row): one square per state, no real geometry. */
  const UF_TILES = {
    RR: [2, 0], AP: [4, 0],
    AM: [2, 1], PA: [3, 1], MA: [4, 1], CE: [5, 1], RN: [6, 1],
    AC: [0, 2], RO: [1, 2], TO: [3, 2], PI: [4, 2], PE: [5, 2], PB: [6, 2],
    MT: [2, 3], GO: [3, 3], BA: [4, 3], AL: [5, 3],
    MS: [2, 4], DF: [3, 4], MG: [4, 4], SE: [5, 4],
    SP: [3, 5], RJ: [4, 5], ES: [5, 5],
    PR: [3, 6], SC: [3, 7], RS: [3, 8]
  };

  const FIRST_NAMES = [
    'Ana', 'Alice', 'Arthur', 'Beatriz', 'Bernardo', 'Bruna', 'Caio', 'Camila', 'Carla', 'Davi', 'Débora', 'Diego',
    'Eduarda', 'Elisa', 'Enzo', 'Fábio', 'Fernanda', 'Gabriela', 'Giovana', 'Gustavo', 'Heitor', 'Helena', 'Hugo',
    'Iara', 'Igor', 'Isabela', 'Joana', 'Júlia', 'Karina', 'Larissa', 'Laura', 'Leonardo', 'Lívia', 'Lucas', 'Luana',
    'Manuela', 'Marcos', 'Mariana', 'Mateus', 'Natália', 'Nicolas', 'Olívia', 'Otávio', 'Paula', 'Pedro', 'Rafael',
    'Renan', 'Renata', 'Samuel', 'Sara', 'Sofia', 'Tatiane', 'Thiago', 'Valentina', 'Vitória', 'Yasmin', 'Rita', 'Joel',
    'Cecília', 'Antônio', 'Clara', 'Miguel', 'Lorena', 'Benício', 'Melissa', 'Ícaro', 'Noemi', 'Tomás', 'Vera', 'Zélia'
  ];
  const INITIALS = 'ABCDEFGHIJKLMNOPRSTV';

  /* Seasonality: relative demand by calendar month (Jan..Dec). */
  const MONTH_FACTOR = [0.9, 0.8, 0.9, 0.95, 1.12, 1.05, 0.95, 1.06, 0.95, 1.0, 1.25, 1.45];

  /* CRM campaigns: [ISO date, name, channel, audience]. */
  const CAMPAIGNS = [
    ['2025-11-05', 'Esquenta de novembro', 'WhatsApp', 'ativos'],
    ['2025-11-26', 'Semana de ofertas', 'E-mail', 'todos'],
    ['2025-12-10', 'Presentes de fim de ano', 'WhatsApp', 'ativos'],
    ['2026-01-14', 'Liquida verão', 'SMS', 'todos'],
    ['2026-02-11', 'Volta às compras', 'E-mail', 'inativos'],
    ['2026-03-18', 'Lançamento outono', 'Push', 'ativos'],
    ['2026-04-29', 'Dia das Mães', 'WhatsApp', 'todos'],
    ['2026-05-20', 'Reativação 180 dias', 'WhatsApp', 'inativos'],
    ['2026-06-17', 'Liquida inverno', 'SMS', 'todos'],
    ['2026-07-29', 'Dia dos Pais', 'E-mail', 'ativos'],
    ['2026-08-19', 'Boas-vindas', 'WhatsApp', 'novos'],
    ['2026-09-09', 'Semana do cliente', 'E-mail', 'todos'],
    ['2026-09-30', 'Clube de vantagens', 'Push', 'ativos'],
    ['2026-10-14', 'Pós-venda 30 dias', 'WhatsApp', 'novos']
  ];
  const ENGAGE_RATE = { 'E-mail': 0.22, WhatsApp: 0.46, SMS: 0.13, Push: 0.09 };
  const CONVERT_RATE = { 'E-mail': 0.14, WhatsApp: 0.19, SMS: 0.1, Push: 0.08 };
  const AUDIENCE_REACH = { todos: 0.09, ativos: 0.2, inativos: 0.16, novos: 0.6 };

  const pad = (n, w) => String(n).padStart(w, '0');
  const dayOf = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - START) / MS_DAY);

  function generate(seed, options) {
    seed = seed == null ? 42 : seed;
    const opts = options || {};
    const N = opts.customers || 6000;
    const rand = rng(seed);

    const gauss = () => {
      let u = 0;
      while (u === 0) u = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    };
    const logNormal = (median, sigma) => median * Math.exp(sigma * gauss());
    const exponential = mean => -Math.log(1 - rand()) * mean;
    const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const choose = arr => arr[Math.floor(rand() * arr.length)];
    const weighted = (items, weights) => {
      let total = 0;
      for (const w of weights) total += w;
      let x = rand() * total;
      for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
      return items[items.length - 1];
    };

    /* calendar helpers: month index of every day (0 = Nov/2023) */
    const monthOfDay = new Int16Array(LAST_DAY + 1);
    const calMonth = new Int8Array(LAST_DAY + 1);
    for (let d = 0; d <= LAST_DAY; d++) {
      const dt = new Date(START + d * MS_DAY);
      calMonth[d] = dt.getUTCMonth();
      monthOfDay[d] = (dt.getUTCFullYear() - 2023) * 12 + dt.getUTCMonth() - 10;
    }
    const seasonal = d => MONTH_FACTOR[d >= 0 ? calMonth[Math.min(LAST_DAY, d)] : calMonth[((d % 365) + 365) % 365]];

    /* ---- states with weights ---- */
    const states = [];
    REGIONS.forEach(region => {
      const raw = region.ufs.map((_, i) => 1 / Math.pow(i + 1, 0.9));
      const sum = raw.reduce((a, b) => a + b, 0);
      region.ufs.forEach((uf, i) => states.push({ uf, region: region.id, weight: region.share * raw[i] / sum }));
    });

    /* ---- stores ---- */
    const stores = [];
    REGIONS.forEach(region => {
      let count = 0;
      states.filter(s => s.region === region.id).forEach(s => {
        let n = Math.round(s.weight * 46);
        if (n === 0 && rand() < 0.55) n = 1;
        for (let k = 1; k <= n; k++) {
          stores.push({ idx: stores.length, id: 'L' + pad(stores.length + 1, 3), name: 'Loja ' + s.uf + '-' + pad(k, 2),
            uf: s.uf, region: region.id, type: weighted(['Shopping', 'Rua', 'Quiosque'], [0.55, 0.3, 0.15]) });
          count++;
        }
      });
      if (!count) {
        const uf = region.ufs[0];
        stores.push({ idx: stores.length, id: 'L' + pad(stores.length + 1, 3), name: 'Loja ' + uf + '-01', uf, region: region.id, type: 'Shopping' });
      }
    });
    const ONLINE = stores.length;
    stores.push({ idx: ONLINE, id: 'L' + pad(ONLINE + 1, 3), name: 'Loja online', uf: '', region: '', type: 'Online' });
    const storesByUf = {}, storesByRegion = {};
    stores.forEach(s => {
      if (s.type === 'Online') return;
      (storesByUf[s.uf] = storesByUf[s.uf] || []).push(s.idx);
      (storesByRegion[s.region] = storesByRegion[s.region] || []).push(s.idx);
    });

    /* ---- customers and their purchase history ---- */
    const customers = [];
    const LEGACY = 900;                                      // simulate history before day 0 so the base is in steady state
    for (let guard = 0; customers.length < N && guard < N * 6; guard++) {
      const st = weighted(states, states.map(s => s.weight));
      const home = choose(storesByUf[st.uf] || storesByRegion[st.region]);

      // acquisition date: mild growth over time + seasonality
      let first = 0;
      for (let tries = 0; tries < 25; tries++) {
        first = Math.floor((LAST_DAY + LEGACY) * Math.pow(rand(), 0.9)) - LEGACY;
        if (rand() < seasonal(first) / 1.45) break;
      }

      const zRate = gauss();
      const ratePerYear = Math.min(16, Math.max(0.3, 1.2 * Math.exp(0.9 * zRate)));
      let spend = 120 * Math.exp(0.85 * gauss() + 0.35 * zRate);
      if (rand() < 0.06) spend *= 2 + rand() * 5;            // a few big spenders: long tail
      const churn = Math.min(0.65, Math.max(0.06, 0.4 - 0.035 * ratePerYear + (rand() - 0.5) * 0.15));
      const online = rand() < 0.25 ? 0.6 + rand() * 0.35 : rand() * 0.15;

      const c = {
        i: customers.length, id: '', name: choose(FIRST_NAMES) + ' ' + INITIALS[Math.floor(rand() * INITIALS.length)] + '.',
        uf: st.uf, region: st.region, store: home, since: first, purchases: [],
        _spend: spend, _online: online
      };

      let t = first;
      while (t <= LAST_DAY) {
        const p = makePurchase(c, t, -1);
        if (t >= 0) c.purchases.push(p);
        if (rand() < churn) break;
        t += Math.round(exponential(365 / ratePerYear)) + 3;
        if (t <= LAST_DAY && rand() > seasonal(t) / 1.45) t += between(5, 20);
      }
      if (!c.purchases.length) continue;                     // churned before the observed window
      c.id = 'CLI-' + pad(c.i + 1, 6);
      customers.push(c);
    }

    function makePurchase(c, day, campaign) {
      const channel = rand() < c._online ? 1 : 0;   // 0 = store, 1 = online
      let store = ONLINE;
      if (!channel) store = rand() < 0.85 ? c.store : choose(storesByRegion[c.region]);
      const value = Math.max(39.9, c._spend * Math.exp(0.32 * gauss()));
      return { d: day, v: Math.round(value * 100) / 100, s: store, k: channel, m: campaign };
    }

    /* ---- CRM campaigns and contact events ---- */
    const campaigns = CAMPAIGNS.map((row, idx) => ({
      idx, id: 'CMP-' + pad(idx + 1, 2), day: dayOf(row[0]), name: row[1], channel: row[2], audience: row[3],
      contacts: [], engaged: []
    }));

    campaigns.forEach(cmp => {
      const d = cmp.day;
      const reach = AUDIENCE_REACH[cmp.audience];
      customers.forEach(c => {
        let firstDay = -1, lastDay = -1;
        for (const p of c.purchases) { if (p.d >= d) break; if (firstDay < 0) firstDay = p.d; lastDay = p.d; }
        if (lastDay < 0) return;
        const gap = d - lastDay;
        if (cmp.audience === 'ativos' && gap > 180) return;
        if (cmp.audience === 'inativos' && gap <= 180) return;
        if (cmp.audience === 'novos' && d - firstDay > 60) return;
        if (rand() > reach) return;

        const warmth = gap <= 90 ? 1.25 : gap <= 180 ? 1 : 0.7;
        const engaged = rand() < ENGAGE_RATE[cmp.channel] * warmth ? 1 : 0;
        cmp.contacts.push(c.i);
        cmp.engaged.push(engaged);

        const pConvert = engaged ? CONVERT_RATE[cmp.channel] : 0.012;
        if (rand() < pConvert) {
          let wait = 1 + Math.round(exponential(6));
          if (wait > 30) wait = between(1, 30);
          const day = d + wait;
          if (day <= LAST_DAY) {
            c.purchases.push(makePurchase(c, day, cmp.idx));
            if (rand() < 0.4) {
              const again = day + between(15, 120);
              if (again <= LAST_DAY) c.purchases.push(makePurchase(c, again, -1));
            }
            c.purchases.sort((a, b) => a.d - b.d);
          }
        }
      });
    });

    customers.forEach(c => { delete c._spend; delete c._online; });

    return {
      seed, brand: 'Demo Retail Co.', start: START, lastDay: LAST_DAY,
      regions: REGIONS, tiles: UF_TILES, states, stores, customers, campaigns, monthOfDay,
      date: d => new Date(START + d * MS_DAY)
    };
  }

  root.DemoData = { generate, rng, REGIONS, UF_TILES };
})(typeof window !== 'undefined' ? window : globalThis);
