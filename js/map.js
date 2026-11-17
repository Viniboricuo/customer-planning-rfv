/*
 * Demo Retail Co. :: abstract tile map
 * One square per state on a coarse grid. No geographic shapes and no map tiles.
 * DemoMap.svg(options) returns an SVG string.
 */
(function (root) {
  'use strict';

  const STEP = 64, SIZE = 58;

  function esc(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

  /*
   * options: {
   *   tiles: { UF: [col, row] }, regionOf: { UF: regionId },
   *   values: { UF: number }, label: (uf, value) => string, title: (uf) => string,
   *   color: '#hex', diverging: false, good: '#hex', bad: '#hex',
   *   region: regionId | null (others dimmed), selected: UF | null
   * }
   */
  function svg(o) {
    const ufs = Object.keys(o.tiles);
    let cols = 0, rows = 0;
    ufs.forEach(uf => { cols = Math.max(cols, o.tiles[uf][0] + 1); rows = Math.max(rows, o.tiles[uf][1] + 1); });
    const vals = ufs.map(uf => o.values[uf] || 0);
    const maxAbs = Math.max(1e-9, ...vals.map(Math.abs));
    const w = cols * STEP - (STEP - SIZE), h = rows * STEP - (STEP - SIZE);
    let out = '<svg class="tile-map" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.ariaLabel || 'Mapa abstrato por estado') + '">';
    ufs.forEach(uf => {
      const [c, r] = o.tiles[uf];
      const x = c * STEP, y = r * STEP;
      const v = o.values[uf] || 0;
      const t = Math.min(1, Math.abs(v) / maxAbs);
      const fill = o.diverging ? (v >= 0 ? (o.good || '#2fa877') : (o.bad || '#e2553f')) : o.color;
      const opacity = v === 0 && o.diverging ? 0 : 0.12 + 0.88 * Math.sqrt(t);
      const light = opacity > 0.55;
      const cls = ['tile'];
      if (o.region && o.regionOf[uf] !== o.region) cls.push('dim');
      if (o.selected === uf) cls.push('sel');
      out += '<g class="' + cls.join(' ') + '" data-uf="' + uf + '" tabindex="0">' +
        '<title>' + esc(o.title ? o.title(uf) : uf) + '</title>' +
        '<rect class="bgtile" x="' + x + '" y="' + y + '" width="' + SIZE + '" height="' + SIZE + '" rx="9"/>' +
        '<rect x="' + x + '" y="' + y + '" width="' + SIZE + '" height="' + SIZE + '" rx="9" fill="' + fill + '" fill-opacity="' + opacity.toFixed(3) + '"/>' +
        '<text class="uf ' + (light ? 'lt' : 'dk') + '" x="' + (x + 8) + '" y="' + (y + 20) + '">' + uf + '</text>' +
        '<text class="val ' + (light ? 'lt' : 'dk') + '" x="' + (x + 8) + '" y="' + (y + SIZE - 9) + '">' + esc(o.label ? o.label(uf, v) : v) + '</text>' +
        '</g>';
    });
    return out + '</svg>';
  }

  root.DemoMap = { svg };
})(typeof window !== 'undefined' ? window : globalThis);
