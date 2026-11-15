/* Gridfinity Bin Designer: layout rules (browser + Node).
 * Mirrors gbd_layout.py; tests/test_parity.py runs both and compares.
 * Units: mm. Origin: front-left corner of the bin's grid cells, X right, Y back, Z up.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GBDLayout = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FOOT_BOTTOM = 0.8, FOOT_MIDDLE = 1.8, FOOT_TOP = 2.15, FOOT_HEIGHT = FOOT_BOTTOM + FOOT_MIDDLE + FOOT_TOP;
  const SOCKET_RADIUS = 4.0, LIP_BOTTOM = 0.7, LIP_MIDDLE = 1.8, LIP_SUPPORT = 1.2, TAB_THICKNESS = 1.2, OVERLAP = 0.4;
  const DEFAULT_FIT = {
    GridPitch: 42.0, HeightUnit: 7.0, BinClearance: 0.25, WallThickness: 1.2, FloorHeight: 7.0,
    MagnetDiameter: 6.5, MagnetDepth: 2.4, ScrewDiameter: 3.0, ScrewDepth: 6.0, HoleSpacing: 26.0
  };
  const DEFAULT_DIVIDER = { thickness: 1.2, topGap: 0.5 };
  const DEFAULT_TABS = { enabled: false, depth: 13.0, angle: 45.0, width: 0.0, align: 'center' };
  const DEFAULT_SCOOP = { enabled: false, radius: 12.0 };
  const DEFAULT_SIZE = { nx: 3, ny: 2, sub: 1, heightUnits: 6 };
  const LIMITS = { units: [1, 20], heightUnits: [2, 40], sub: [1, 2, 3, 4], wall: [0.8, 2.5], dividerThickness: [0.4, 5.0], clearance: [0.0, 0.6] };

  const key = (a, b) => a + ',' + b;
  const g3 = v => String(Number(v.toPrecision(6)));
  const r6 = x => Math.round(x * 1e6) / 1e6;
  const r3 = x => Math.round(x * 1e3) / 1e3;
  const rad = d => d * Math.PI / 180;

  function derived(cfg) {
    const f = cfg.fit, p = f.GridPitch, c = f.BinClearance, w = f.WallThickness;
    const h = cfg.heightUnits * f.HeightUnit, lipTop = FOOT_TOP - c, lipDepth = LIP_BOTTOM + lipTop;
    const lipHeight = cfg.lip ? LIP_BOTTOM + LIP_MIDDLE + lipTop : 0.0, outerR = SOCKET_RADIUS - c;
    return {
      pitch: p, step: p / cfg.sub, gridWidth: cfg.nx * p, gridDepth: cfg.ny * p,
      width: cfg.nx * p - 2 * c, depth: cfg.ny * p - 2 * c, clearance: c,
      height: h, top: h + lipHeight, lipHeight, lipDepth, lipTopChamfer: lipTop, outerRadius: outerR,
      innerWall: c + w, floor: f.FloorHeight, dividerTop: h - cfg.divider.topGap,
      tabHeight: cfg.tabs.depth * Math.tan(rad(cfg.tabs.angle)) + TAB_THICKNESS,
      footTopWidth: p - 2 * c, footMidWidth: p - 2 * c - 2 * FOOT_TOP, footBottomWidth: p - 2 * c - 2 * FOOT_TOP - 2 * FOOT_BOTTOM,
      footTopRadius: outerR, footMidRadius: outerR - FOOT_TOP, footBottomRadius: outerR - FOOT_TOP - FOOT_BOTTOM,
      supportStart: h - LIP_SUPPORT - (lipDepth - w)
    };
  }

  function cavityProfile(cfg) {
    const g = derived(cfg), w = cfg.fit.WallThickness, z0 = g.floor, h = g.height;
    if (!cfg.lip) return [[z0, w], [h, w]];
    const pts = [[z0, w]];
    if (g.lipDepth > w) pts.push([g.supportStart, w], [h - LIP_SUPPORT, g.lipDepth]);
    else pts.push([h - LIP_SUPPORT, w]);
    pts.push([h, g.lipDepth], [h + LIP_BOTTOM, g.lipTopChamfer], [h + LIP_BOTTOM + LIP_MIDDLE, g.lipTopChamfer], [g.top, 0.0]);
    return pts;
  }

  function validate(cfg) {
    const errors = [], f = cfg.fit, d = cfg.divider, t = cfg.tabs, s = cfg.scoop;
    for (const k of ['GridPitch', 'HeightUnit', 'MagnetDiameter', 'MagnetDepth', 'ScrewDiameter', 'ScrewDepth', 'HoleSpacing'])
      if (!(f[k] > 0)) errors.push(`${k} must be greater than 0`);
    const [clo, chi] = LIMITS.clearance;
    if (!(f.BinClearance >= clo && f.BinClearance <= chi)) errors.push(`BinClearance must be between ${g3(clo)} and ${g3(chi)} mm`);
    const [wlo, whi] = LIMITS.wall;
    if (!(f.WallThickness >= wlo && f.WallThickness <= whi)) errors.push(`Wall thickness must be between ${g3(wlo)} and ${g3(whi)} mm`);
    if (errors.length) return errors;
    const g = derived(cfg);
    if (f.GridPitch < 30) errors.push('GridPitch must be at least 30 mm for the Gridfinity foot profile');
    if (f.FloorHeight < FOOT_HEIGHT + 0.6) errors.push(`FloorHeight must be at least ${(FOOT_HEIGHT + 0.6).toFixed(2)} mm so the floor covers the gaps between the feet`);
    const topOfCavity = cfg.lip && g.lipDepth > f.WallThickness ? g.supportStart : g.height - (cfg.lip ? LIP_SUPPORT : 0);
    if (topOfCavity - f.FloorHeight < 1.0) errors.push('The bin is too low for this floor height: add height units or lower FloorHeight');
    const holes = cfg.holes;
    if ((holes === 'magnets' || holes === 'both') && f.MagnetDepth > FOOT_HEIGHT - 0.6)
      errors.push(`MagnetDepth must stay at least 0.6 mm inside the foot (max ${(FOOT_HEIGHT - 0.6).toFixed(2)} mm)`);
    if ((holes === 'screws' || holes === 'both') && f.ScrewDepth > f.FloorHeight - 0.6) errors.push('ScrewDepth must be at least 0.6 mm less than FloorHeight');
    if (holes !== 'none') {
      const r = Math.max(holes === 'magnets' || holes === 'both' ? f.MagnetDiameter : 0, holes === 'screws' || holes === 'both' ? f.ScrewDiameter : 0) / 2;
      if (f.HoleSpacing / 2 + r > g.footBottomWidth / 2 - 0.4) errors.push('The holes do not fit on the foot: reduce HoleSpacing or the hole diameter');
      if (holes === 'both' && f.ScrewDiameter >= f.MagnetDiameter) errors.push('ScrewDiameter must be smaller than MagnetDiameter');
    }
    const [tlo, thi] = LIMITS.dividerThickness;
    if (!(d.thickness >= tlo && d.thickness <= thi)) errors.push(`Divider thickness must be between ${g3(tlo)} and ${g3(thi)} mm`);
    if (d.topGap < 0) errors.push('Divider top gap cannot be negative');
    if (g.dividerTop - f.FloorHeight < 1.0) errors.push('Dividers would not reach above the floor: reduce the divider top gap');
    if (d.thickness >= g.step - 3.0) errors.push('Dividers are too thick for the selected grid');
    if (t.enabled) {
      if (!(t.depth >= 3 && t.depth <= 30)) errors.push('Label tab depth must be between 3 and 30 mm');
      if (!(t.angle >= 30 && t.angle <= 60)) errors.push('Label tab support angle must be between 30 and 60 degrees');
      if (t.width < 0) errors.push('Label tab width cannot be negative (0 means full width)');
      if (!errors.length && g.dividerTop - g.tabHeight < f.FloorHeight)
        errors.push('Label tabs are taller than the inside of the bin: use a smaller tab depth or angle, or a taller bin');
    }
    if (s.enabled && !(s.radius >= 1 && s.radius <= 60)) errors.push('Scoop radius must be between 1 and 60 mm');
    return errors;
  }

  function cleanWalls(cfg) {
    const gx = cfg.nx * cfg.sub, gy = cfg.ny * cfg.sub, v = new Map(), h = new Map();
    for (const [i, j] of cfg.walls.v || []) if (Number.isInteger(i) && Number.isInteger(j) && i > 0 && i < gx && j >= 0 && j < gy) v.set(key(i, j), [i, j]);
    for (const [i, j] of cfg.walls.h || []) if (Number.isInteger(i) && Number.isInteger(j) && j > 0 && j < gy && i >= 0 && i < gx) h.set(key(i, j), [i, j]);
    return { v: [...v.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]), h: [...h.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]) };
  }

  function dividerRuns(cfg) {
    const out = [];
    for (const axis of ['v', 'h']) {
      const lines = new Map();
      for (const [i, j] of cfg.walls[axis]) {
        const line = axis === 'v' ? i : j, pos = axis === 'v' ? j : i;
        if (!lines.has(line)) lines.set(line, new Set());
        lines.get(line).add(pos);
      }
      for (const line of [...lines.keys()].sort((a, b) => a - b)) {
        const cells = [...lines.get(line)].sort((a, b) => a - b);
        let start = cells[0], prev = cells[0];
        for (let n = 1; n <= cells.length; n++) {
          const c = cells[n];
          if (c !== undefined && c === prev + 1) { prev = c; continue; }
          out.push([axis, line, start, prev + 1]);
          if (c !== undefined) { start = prev = c; }
        }
      }
    }
    return out;
  }

  function dividerBoxes(cfg) {
    const g = derived(cfg), t = cfg.divider.thickness, edge = g.clearance + cfg.fit.WallThickness / 2, step = g.step;
    const nmax = { v: cfg.ny * cfg.sub, h: cfg.nx * cfg.sub }, full = { v: g.gridDepth, h: g.gridWidth };
    return dividerRuns(cfg).map(([axis, line, a, b]) => {
      const c = line * step, lo = a === 0 ? edge : a * step - t / 2, hi = b === nmax[axis] ? full[axis] - edge : b * step + t / 2;
      return axis === 'v' ? [c - t / 2, lo, c + t / 2, hi] : [lo, c - t / 2, hi, c + t / 2];
    });
  }

  function wallSets(cfg) { return [new Set(cfg.walls.v.map(a => key(a[0], a[1]))), new Set(cfg.walls.h.map(a => key(a[0], a[1])))]; }

  function compartments(cfg) {
    const sub = cfg.sub, gx = cfg.nx * sub, gy = cfg.ny * sub, g = derived(cfg), step = g.step, t = cfg.divider.thickness;
    const [v, h] = wallSets(cfg), seen = new Set(), out = [];
    for (let i0 = 0; i0 < gx; i0++) for (let j0 = 0; j0 < gy; j0++) {
      if (seen.has(key(i0, j0))) continue;
      const stack = [[i0, j0]], cells = []; seen.add(key(i0, j0));
      while (stack.length) {
        const [i, j] = stack.pop(); cells.push([i, j]);
        const nb = [[[i - 1, j], i === 0 || v.has(key(i, j))], [[i + 1, j], i === gx - 1 || v.has(key(i + 1, j))],
                    [[i, j - 1], j === 0 || h.has(key(i, j))], [[i, j + 1], j === gy - 1 || h.has(key(i, j + 1))]];
        for (const [n, blocked] of nb) if (!blocked && !seen.has(key(n[0], n[1]))) { seen.add(key(n[0], n[1])); stack.push(n); }
      }
      cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
      const b = [Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1];
      const [ci, cj] = cells[0];
      const x0 = b[0] === 0 ? g.innerWall : b[0] * step + t / 2, x1 = b[2] === gx ? g.gridWidth - g.innerWall : b[2] * step - t / 2;
      const y0 = b[1] === 0 ? g.innerWall : b[1] * step + t / 2, y1 = b[3] === gy ? g.gridDepth - g.innerWall : b[3] * step - t / 2;
      out.push({ cells, bounds: b, isRect: (b[2] - b[0]) * (b[3] - b[1]) === cells.length,
                 probe: [(ci + 0.5) * step + 0.37, (cj + 0.5) * step + 0.29],
                 size: [r3(x1 - x0), r3(y1 - y0), r3(g.dividerTop - g.floor)] });
    }
    return out;
  }

  function edgeRuns(cfg, side) {
    const sub = cfg.sub, gx = cfg.nx * sub, gy = cfg.ny * sub, [v, h] = wallSets(cfg), compOf = new Map();
    compartments(cfg).forEach((comp, n) => comp.cells.forEach(c => compOf.set(key(c[0], c[1]), n)));
    const runs = [];
    for (let j = 0; j < gy; j++) {
      const line = side === 'back' ? j + 1 : j;
      const closed = ii => line === 0 || line === gy || h.has(key(ii, line));
      let i = 0;
      while (i < gx) {
        if (!closed(i)) { i++; continue; }
        const n = compOf.get(key(i, j)), start = i;
        while (i + 1 < gx && closed(i + 1) && compOf.get(key(i + 1, j)) === n && !v.has(key(i + 1, j))) i++;
        runs.push([n, line, start, i + 1]);
        i++;
      }
    }
    return runs;
  }

  function xSpan(cfg, i0, i1) {
    const g = derived(cfg), gx = cfg.nx * cfg.sub;
    return [i0 === 0 ? g.innerWall : i0 * g.step, i1 === gx ? g.gridWidth - g.innerWall : i1 * g.step];
  }
  function intoWalls(cfg, x0, x1) {
    const g = derived(cfg);
    if (Math.abs(x0 - g.innerWall) < 1e-9) x0 -= OVERLAP;
    if (Math.abs(x1 - (g.gridWidth - g.innerWall)) < 1e-9) x1 += OVERLAP;
    return [x0, x1];
  }

  function labelTabs(cfg) {
    if (!cfg.tabs.enabled) return [];
    const g = derived(cfg), tb = cfg.tabs, gy = cfg.ny * cfg.sub, t = cfg.divider.thickness, out = [];
    for (const [n, line, i0, i1] of edgeRuns(cfg, 'back')) {
      let [x0, x1] = xSpan(cfg, i0, i1);
      const width = x1 - x0;
      if (tb.width > 0 && tb.width < width) {
        const w = tb.width;
        if (tb.align === 'left') x1 = x0 + w;
        else if (tb.align === 'right') x0 = x1 - w;
        else { const mid = (x0 + x1) / 2; x0 = mid - w / 2; x1 = mid + w / 2; }
      }
      [x0, x1] = intoWalls(cfg, x0, x1);
      const yFace = line === gy ? g.gridDepth - g.innerWall : line * g.step - t / 2;
      out.push({ compartment: n, x0: r6(x0), x1: r6(x1), yFace: r6(yFace), zTop: g.dividerTop, depth: tb.depth, height: g.tabHeight });
    }
    return out;
  }

  function scoops(cfg) {
    if (!cfg.scoop.enabled) return [];
    const g = derived(cfg), t = cfg.divider.thickness, comps = compartments(cfg), out = [];
    for (const [n, line, i0, i1] of edgeRuns(cfg, 'front')) {
      const [x0, x1] = intoWalls(cfg, ...xSpan(cfg, i0, i1));
      const yFace = line === 0 ? g.innerWall : line * g.step + t / 2;
      const depth = comps[n].size[1];
      const room = depth - (cfg.tabs.enabled ? cfg.tabs.depth : 0) - 2.0;
      const r = Math.min(cfg.scoop.radius, g.dividerTop - g.floor - 0.5, Math.max(room, 0.0), depth * 0.75);
      if (r < 1.0) continue;
      out.push({ compartment: n, x0: r6(x0), x1: r6(x1), yFace: r6(yFace), zFloor: g.floor, radius: r6(r) });
    }
    return out;
  }

  function holeCentres(cfg) {
    if (cfg.holes === 'none') return [];
    const p = cfg.fit.GridPitch, half = cfg.fit.HoleSpacing / 2, pts = [];
    for (let i = 0; i < cfg.nx; i++) for (let j = 0; j < cfg.ny; j++) {
      const cx = (i + 0.5) * p, cy = (j + 0.5) * p;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        if (cfg.holeCells === 'corners' &&
            !((sx < 0 && i === 0 || sx > 0 && i === cfg.nx - 1) && (sy < 0 && j === 0 || sy > 0 && j === cfg.ny - 1))) continue;
        pts.push([r6(cx + sx * half), r6(cy + sy * half)]);
      }
    }
    return pts;
  }

  function rrArea(w, d, r) { return w * d - (4 - Math.PI) * r * r; }
  function frustum(w0, d0, r0, w1, d1, r1, h) {
    if (h <= 0) return 0;
    return h / 6 * (rrArea(w0, d0, r0) + 4 * rrArea((w0 + w1) / 2, (d0 + d1) / 2, (r0 + r1) / 2) + rrArea(w1, d1, r1));
  }
  function footVolume(cfg) {
    const g = derived(cfg), b = g.footBottomWidth, m = g.footMidWidth, t = g.footTopWidth;
    return frustum(b, b, g.footBottomRadius, m, m, g.footMidRadius, FOOT_BOTTOM) + frustum(m, m, g.footMidRadius, m, m, g.footMidRadius, FOOT_MIDDLE) +
           frustum(m, m, g.footMidRadius, t, t, g.footTopRadius, FOOT_TOP);
  }
  function cavityVolume(cfg) {
    const g = derived(cfg), pts = cavityProfile(cfg);
    let vol = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [z0, i0] = pts[k], [z1, i1] = pts[k + 1];
      vol += frustum(g.width - 2 * i0, g.depth - 2 * i0, g.outerRadius - i0, g.width - 2 * i1, g.depth - 2 * i1, g.outerRadius - i1, z1 - z0);
    }
    return vol;
  }
  function baseVolume(cfg) {
    const g = derived(cfg);
    return cfg.nx * cfg.ny * footVolume(cfg) + rrArea(g.width, g.depth, g.outerRadius) * (g.top - FOOT_HEIGHT) - cavityVolume(cfg);
  }

  function quickSplit(cfg, cols, rows) {
    const gx = cfg.nx * cfg.sub, gy = cfg.ny * cfg.sub;
    cols = Math.max(1, Math.min(gx, cols | 0)); rows = Math.max(1, Math.min(gy, rows | 0));
    const xs = new Set(), ys = new Set(), v = [], h = [];
    for (let k = 1; k < cols; k++) xs.add(Math.round(k * gx / cols));
    for (let k = 1; k < rows; k++) ys.add(Math.round(k * gy / rows));
    xs.forEach(i => { for (let j = 0; j < gy; j++) v.push([i, j]); });
    ys.forEach(j => { for (let i = 0; i < gx; i++) h.push([i, j]); });
    return cleanWalls({ ...cfg, walls: { v, h } });
  }

  return { FOOT_BOTTOM, FOOT_MIDDLE, FOOT_TOP, FOOT_HEIGHT, TAB_THICKNESS, OVERLAP, DEFAULT_FIT, DEFAULT_DIVIDER, DEFAULT_TABS,
           DEFAULT_SCOOP, DEFAULT_SIZE, LIMITS, derived, cavityProfile, validate, cleanWalls, dividerRuns, dividerBoxes,
           compartments, labelTabs, scoops, holeCentres, footVolume, cavityVolume, baseVolume, quickSplit };
});
