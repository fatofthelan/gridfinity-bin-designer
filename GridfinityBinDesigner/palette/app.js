/* Gridfinity Bin Designer: palette UI (2D layout editor, 3D preview, Fusion bridge). */
(function () {
  'use strict';
  const LY = window.GBDLayout;
  const $ = id => document.getElementById(id);
  const key = (a, b) => a + ',' + b;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));

  const FIT_META = [
    ['GridPitch', 'Grid pitch', 'mm'], ['HeightUnit', 'Height unit', 'mm'], ['BinClearance', 'Clearance per side', 'mm'],
    ['WallThickness', 'Outer wall', 'mm'], ['FloorHeight', 'Floor top above foot bottom', 'mm']
  ];
  const HOLE_META = [
    ['MagnetDiameter', 'Magnet hole diameter', 'mm'], ['MagnetDepth', 'Magnet hole depth', 'mm'],
    ['ScrewDiameter', 'Screw hole diameter', 'mm'], ['ScrewDepth', 'Screw hole depth', 'mm'], ['HoleSpacing', 'Hole spacing', 'mm']
  ];
  const HEIGHT_PRESETS = [3, 6, 9, 12];

  // ---------------------------------------------------------------- state
  const S = {
    nx: LY.DEFAULT_SIZE.nx, ny: LY.DEFAULT_SIZE.ny, sub: LY.DEFAULT_SIZE.sub, heightUnits: LY.DEFAULT_SIZE.heightUnits,
    lip: true, holes: 'none', holeCells: 'all', walls: { v: [], h: [] },
    fit: { ...LY.DEFAULT_FIT }, divider: { ...LY.DEFAULT_DIVIDER }, tabs: { ...LY.DEFAULT_TABS }, scoop: { ...LY.DEFAULT_SCOOP }, name: ''
  };
  S.walls = LY.quickSplit(S, 3, 1);
  const settings = { bedSize: 256, autoUpdate: false };
  const undoStack = [], redoStack = [];
  let errors = [];

  const cfg = () => ({
    nx: S.nx, ny: S.ny, sub: S.sub, heightUnits: S.heightUnits, lip: S.lip, holes: S.holes, holeCells: S.holeCells,
    walls: S.walls, fit: S.fit, divider: S.divider, tabs: S.tabs, scoop: S.scoop, name: S.name
  });
  function snapshot() { return JSON.stringify(cfg()); }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; }
  function restore(json) { Object.assign(S, JSON.parse(json)); syncInputs(); changed(false); }

  // --------------------------------------------------------------- inputs
  const fmt = v => String(Number(Number(v).toFixed(4)));
  function syncInputs() {
    $('nx').value = S.nx; $('ny').value = S.ny; $('hu').value = S.heightUnits; $('lip').checked = S.lip;
    $('dThick').value = S.divider.thickness; $('dGap').value = S.divider.topGap;
    $('tabOn').checked = S.tabs.enabled; $('tabDepth').value = S.tabs.depth; $('tabAngle').value = S.tabs.angle;
    $('tabWidth').value = S.tabs.width; $('tabAlign').value = S.tabs.align; $('tabRows').classList.toggle('off', !S.tabs.enabled);
    $('scoopOn').checked = S.scoop.enabled; $('scoopR').value = S.scoop.radius; $('scoopRows').classList.toggle('off', !S.scoop.enabled);
    $('holes').value = S.holes; $('holeCells').value = S.holeCells; $('holeCells').disabled = S.holes === 'none';
    document.querySelectorAll('[data-sub]').forEach(b => b.classList.toggle('on', Number(b.dataset.sub) === S.sub));
    $('heightChips').innerHTML = HEIGHT_PRESETS.map(u =>
      `<button class="chip${S.heightUnits === u ? ' on' : ''}" data-hu="${u}">${u}u (${fmt(u * S.fit.HeightUnit)} mm)</button>`).join('');
    const rows = (meta, cls) => meta.map(([k, label, u]) =>
      `<div class="row"><label for="fit_${k}">${label} (${u}) <span class="note">[${fmt(LY.DEFAULT_FIT[k])}]</span></label>` +
      `<input id="fit_${k}" class="${Math.abs(S.fit[k] - LY.DEFAULT_FIT[k]) > 1e-9 ? cls : ''}" type="number" step="0.05" data-fit="${k}" value="${fmt(S.fit[k])}"></div>`).join('');
    $('fitRows').innerHTML = rows(FIT_META, 'changed');
    $('holeRows').innerHTML = rows(HOLE_META, 'changed');
    $('layoutName').value = S.name || '';
    $('bedSize').value = settings.bedSize; $('autoSync').checked = !!settings.autoUpdate;
  }

  function changed(record = true) {
    S.walls = LY.cleanWalls(S);
    errors = LY.validate(S);
    drawEditor(); updateInfo(); rebuildMesh(); updateButtons();
    if (record) scheduleAutoSync();
  }

  function num(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

  // Re-map dividers when the grid subdivision changes; segments that are not on a line of the new grid are dropped.
  function convertWalls(walls, a, b) {
    const v = new Map(), h = new Map(); let dropped = 0;
    const cellsFor = j => { const out = []; for (let k = Math.floor(j * b / a); k < Math.ceil((j + 1) * b / a); k++) out.push(k); return out; };
    walls.v.forEach(([i, j]) => { if ((i * b) % a) { dropped++; return; } cellsFor(j).forEach(k => v.set(key(i * b / a, k), [i * b / a, k])); });
    walls.h.forEach(([i, j]) => { if ((j * b) % a) { dropped++; return; } cellsFor(i).forEach(k => h.set(key(k, j * b / a), [k, j * b / a])); });
    return { walls: { v: [...v.values()], h: [...h.values()] }, dropped };
  }
  function setSub(sub) {
    if (sub === S.sub) return;
    pushUndo();
    const r = convertWalls(S.walls, S.sub, sub);
    S.walls = r.walls; S.sub = sub;
    if (r.dropped) status(`Removed ${r.dropped} divider segment(s) that are not on the new grid.`);
    syncInputs(); changed();
  }

  function resize(nx, ny, hu) {
    nx = Math.max(1, Math.min(20, Math.round(num(nx, S.nx)))); ny = Math.max(1, Math.min(20, Math.round(num(ny, S.ny))));
    hu = Math.max(LY.LIMITS.heightUnits[0], Math.min(LY.LIMITS.heightUnits[1], Math.round(num(hu, S.heightUnits))));
    if (nx === S.nx && ny === S.ny && hu === S.heightUnits) { syncInputs(); return; }
    pushUndo(); S.nx = nx; S.ny = ny; S.heightUnits = hu; syncInputs(); changed();
  }

  function everyUnit() {
    pushUndo();
    const gx = S.nx * S.sub, gy = S.ny * S.sub, v = [], h = [];
    for (let i = S.sub; i < gx; i += S.sub) for (let j = 0; j < gy; j++) v.push([i, j]);
    for (let j = S.sub; j < gy; j += S.sub) for (let i = 0; i < gx; i++) h.push([i, j]);
    S.walls = { v, h }; changed();
  }

  function updateInfo() {
    const ok = !errors.length;
    $('errors').className = ok ? '' : 'show';
    $('errors').innerHTML = ok ? '' : `<b>Can't build this bin yet:</b><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
    const g = LY.derived(S), w = S.fit.WallThickness;
    const inW = g.width - 2 * w, inD = g.depth - 2 * w, deep = g.height - g.floor;
    const bed = num(settings.bedSize, 256);
    const bedWarn = (g.width > bed || g.depth > bed) ? `<br><span class="warn">Larger than your ${bed} mm print bed.</span>` : '';
    $('sizeInfo').innerHTML = `Outside ${g.width.toFixed(2)} × ${g.depth.toFixed(2)} × ${g.top.toFixed(2)} mm` +
      (S.lip ? ` (${fmt(g.height)} mm + ${g.lipHeight.toFixed(2)} mm lip)` : '') + '<br>' +
      `Inside ${inW.toFixed(1)} × ${inD.toFixed(1)} mm, ${deep.toFixed(1)} mm deep above the floor${bedWarn}`;
    const t = S.divider.thickness;
    $('dividerInfo').innerHTML = `Dividers stand ${(g.dividerTop - g.floor).toFixed(1)} mm above the floor` +
      (S.lip ? ', below the next bin\u2019s feet when stacked' : '') + `. ${t.toFixed(2)} mm is about ${(t / 0.42).toFixed(1)} extrusion lines at 0.42 mm.` +
      (t < 0.8 ? ' <span class="warn">That is below the usual 0.8 mm minimum for a 0.4 mm nozzle.</span>' : '');
    $('tabInfo').innerHTML = `Each tab is ${g.tabHeight.toFixed(1)} mm tall under its label surface.` +
      (S.tabs.angle < 45 ? ' <span class="warn">Support angles below 45° usually need supports or print with a rough underside.</span>' : '');
    const comps = LY.compartments(S), nRuns = LY.dividerRuns(S).length;
    $('compList').innerHTML = comps.map((c, n) =>
      `<div><span>#${n + 1}</span><span>${c.isRect ? `${c.size[0].toFixed(1)} × ${c.size[1].toFixed(1)}` : `Irregular, ${c.cells.length} cells`} × ${c.size[2].toFixed(1)} mm</span></div>`).join('');
    const nHoles = LY.holeCentres(S).length;
    $('editorStats').textContent = `${comps.length} compartment${comps.length === 1 ? '' : 's'} · ${nRuns} divider run${nRuns === 1 ? '' : 's'}` +
      (nHoles ? ` · ${nHoles} holes` : '');
    $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length;
  }

  // ------------------------------------------------------------ 2D editor
  const ed = $('editor'), ectx = ed.getContext('2d');
  let v2 = { s: 1, ox: 0, oy: 0, dpr: 1 }, hover = null, drag = null;
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function fitEditor() {
    const r = ed.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    ed.width = Math.max(10, Math.round(r.width * dpr)); ed.height = Math.max(10, Math.round(r.height * dpr));
    const g = LY.derived(S), m = 36;
    const s = Math.max(0.1, Math.min((r.width - 2 * m) / g.gridWidth, (r.height - 2 * m) / g.gridDepth));
    v2 = { s, ox: (r.width - g.gridWidth * s) / 2, oy: (r.height - g.gridDepth * s) / 2, dpr };
  }
  const sx = x => v2.ox + x * v2.s;
  const sy = y => v2.oy + (LY.derived(S).gridDepth - y) * v2.s;

  function roundRect(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function rectMM(c, x0, y0, x1, y1) { c.fillRect(sx(x0), sy(y1), (x1 - x0) * v2.s, (y1 - y0) * v2.s); }

  function drawEditor() {
    fitEditor();
    const c = ectx, g = LY.derived(S), gx = S.nx * S.sub, gy = S.ny * S.sub, iw = g.innerWall;
    c.setTransform(v2.dpr, 0, 0, v2.dpr, 0, 0);
    c.clearRect(0, 0, ed.width, ed.height);
    // grid cells of the baseplate, faint
    c.strokeStyle = 'rgba(120,130,150,.25)'; c.lineWidth = 1;
    for (let i = 0; i < S.nx; i++) for (let j = 0; j < S.ny; j++) c.strokeRect(sx(i * g.pitch), sy((j + 1) * g.pitch), g.pitch * v2.s, g.pitch * v2.s);
    c.fillStyle = css('--bin');
    roundRect(c, sx(g.clearance), sy(g.gridDepth - g.clearance), g.width * v2.s, g.depth * v2.s, g.outerRadius * v2.s); c.fill();
    c.fillStyle = css('--cell');
    roundRect(c, sx(iw), sy(g.gridDepth - iw), (g.gridWidth - 2 * iw) * v2.s, (g.gridDepth - 2 * iw) * v2.s,
      Math.max(0, g.outerRadius - S.fit.WallThickness) * v2.s); c.fill();
    const comps = LY.compartments(S);
    comps.forEach((cp, n) => {
      c.fillStyle = n % 2 ? css('--cell-alt') : css('--cell');
      cp.cells.forEach(([i, j]) => rectMM(c, Math.max(i * g.step, iw), Math.max(j * g.step, iw),
        Math.min((i + 1) * g.step, g.gridWidth - iw), Math.min((j + 1) * g.step, g.gridDepth - iw)));
    });
    c.globalAlpha = 0.45; c.fillStyle = css('--tab');
    LY.labelTabs(S).forEach(t => rectMM(c, t.x0, t.yFace - t.depth, t.x1, t.yFace));
    c.fillStyle = css('--scoop');
    LY.scoops(S).forEach(s => rectMM(c, s.x0, s.yFace, s.x1, s.yFace + s.radius));
    c.globalAlpha = 1;
    const gridLine = (major, x0, y0, x1, y1) => {
      c.strokeStyle = major ? 'rgba(120,130,150,.5)' : 'rgba(120,130,150,.22)'; c.lineWidth = 1; c.setLineDash(major ? [] : [3, 3]);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    };
    for (let i = 1; i < gx; i++) gridLine(i % S.sub === 0, sx(i * g.step), sy(iw), sx(i * g.step), sy(g.gridDepth - iw));
    for (let j = 1; j < gy; j++) gridLine(j % S.sub === 0, sx(iw), sy(j * g.step), sx(g.gridWidth - iw), sy(j * g.step));
    c.setLineDash([]);
    if (S.holes !== 'none') {
      const r = (S.holes === 'screws' ? S.fit.ScrewDiameter : S.fit.MagnetDiameter) / 2;
      c.strokeStyle = 'rgba(120,130,150,.55)'; c.setLineDash([2, 2]);
      LY.holeCentres(S).forEach(([x, y]) => { c.beginPath(); c.arc(sx(x), sy(y), r * v2.s, 0, 2 * Math.PI); c.stroke(); });
      c.setLineDash([]);
    }
    c.fillStyle = css('--wall');
    LY.dividerBoxes(S).forEach(([x0, y0, x1, y1]) => {
      const bw = Math.max((x1 - x0) * v2.s, 3), bh = Math.max((y1 - y0) * v2.s, 3);
      c.fillRect(sx((x0 + x1) / 2) - bw / 2, sy((y0 + y1) / 2) - bh / 2, bw, bh);
    });
    if (hover) {
      const [axis, i, j] = hover;
      c.strokeStyle = css('--wall-hover'); c.lineWidth = 5; c.lineCap = 'round'; c.beginPath();
      if (axis === 'v') { c.moveTo(sx(i * g.step), sy(j * g.step)); c.lineTo(sx(i * g.step), sy((j + 1) * g.step)); }
      else { c.moveTo(sx(i * g.step), sy(j * g.step)); c.lineTo(sx((i + 1) * g.step), sy(j * g.step)); }
      c.stroke(); c.lineCap = 'butt';
    }
    c.fillStyle = css('--ink'); c.textAlign = 'center'; c.textBaseline = 'middle';
    comps.forEach(cp => {
      const b = cp.bounds;
      const [ci, cj] = cp.isRect ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [cp.cells[0][0] + 0.5, cp.cells[0][1] + 0.5];
      const minDim = (cp.isRect ? Math.min(b[2] - b[0], b[3] - b[1]) : 1) * g.step * v2.s;
      if (minDim < 26) return;
      c.font = `${minDim > 60 ? 12 : 10}px -apple-system, sans-serif`;
      c.fillText(cp.isRect ? `${cp.size[0].toFixed(1)} × ${cp.size[1].toFixed(1)}` : `${cp.cells.length} cells`, sx(ci * g.step), sy(cj * g.step));
    });
    c.fillStyle = css('--muted'); c.font = '11px -apple-system, sans-serif';
    c.fillText(`${g.width.toFixed(2)} mm (${S.nx} unit${S.nx === 1 ? '' : 's'})`, sx(g.gridWidth / 2), sy(0) + 16);
    c.save(); c.translate(sx(0) - 16, sy(g.gridDepth / 2)); c.rotate(-Math.PI / 2);
    c.fillText(`${g.depth.toFixed(2)} mm (${S.ny} unit${S.ny === 1 ? '' : 's'})`, 0, 0); c.restore();
  }

  function pickSegment(px, py) {
    const g = LY.derived(S), gx = S.nx * S.sub, gy = S.ny * S.sub;
    const x = (px - v2.ox) / v2.s, y = g.gridDepth - (py - v2.oy) / v2.s;
    const tol = Math.max(10 / v2.s, g.step * 0.18);
    let best = null, bd = Infinity;
    const i = Math.round(x / g.step), j = Math.floor(y / g.step);
    if (i > 0 && i < gx && j >= 0 && j < gy) { const d = Math.abs(x - i * g.step); if (d < tol && d < bd) { bd = d; best = ['v', i, j]; } }
    const j2 = Math.round(y / g.step), i2 = Math.floor(x / g.step);
    if (j2 > 0 && j2 < gy && i2 >= 0 && i2 < gx) { const d = Math.abs(y - j2 * g.step); if (d < tol && d < bd) { bd = d; best = ['h', i2, j2]; } }
    return best;
  }
  const hasWall = seg => S.walls[seg[0]].some(a => a[0] === seg[1] && a[1] === seg[2]);
  function setWall(seg, on) {
    const list = S.walls[seg[0]], idx = list.findIndex(a => a[0] === seg[1] && a[1] === seg[2]);
    if (on && idx < 0) list.push([seg[1], seg[2]]);
    if (!on && idx >= 0) list.splice(idx, 1);
  }
  const evPos = e => { const r = ed.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  ed.addEventListener('pointerdown', e => {
    const seg = pickSegment(...evPos(e)); if (!seg) return;
    pushUndo(); drag = { on: !hasWall(seg) }; setWall(seg, drag.on); ed.setPointerCapture(e.pointerId); changed();
  });
  ed.addEventListener('pointermove', e => {
    const seg = pickSegment(...evPos(e)), same = hover && seg && hover.join() === seg.join();
    hover = seg;
    if (drag && seg && hasWall(seg) !== drag.on) { setWall(seg, drag.on); changed(); }
    else if (!same) drawEditor();
    const g = LY.derived(S);
    $('hoverInfo').textContent = seg ? (seg[0] === 'v' ? `Line at x = ${(seg[1] * g.step - g.clearance).toFixed(2)} mm from the left side`
      : `Line at y = ${(seg[2] * g.step - g.clearance).toFixed(2)} mm from the front`) : '';
  });
  const endDrag = () => { drag = null; };
  ed.addEventListener('pointerup', endDrag); ed.addEventListener('pointercancel', endDrag);
  ed.addEventListener('pointerleave', () => { if (!drag) { hover = null; drawEditor(); $('hoverInfo').textContent = ''; } });

  // ----------------------------------------------------------- 3D preview
  const cv = $('view'), gl = cv.getContext('webgl', { antialias: true });
  const cam = { yaw: -0.65, pitch: 0.62, dist: 1, tx: 0, ty: 0, tz: 0, userZoom: false };
  let mesh = null, prog = null;
  if (gl) {
    const VS = 'attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 mvp; varying vec3 vn; varying vec3 vc;' +
      'void main(){ gl_Position = mvp * vec4(p,1.0); vn = n; vc = c; }';
    const FS = 'precision mediump float; varying vec3 vn; varying vec3 vc;' +
      'void main(){ vec3 l = normalize(vec3(0.45,-0.6,0.9)); vec3 l2 = normalize(vec3(-0.6,0.5,0.3));' +
      'vec3 nn = normalize(vn); float d = 0.38 + 0.55*abs(dot(nn,l)) + 0.18*abs(dot(nn,l2)); gl_FragColor = vec4(vc*d,1.0); }';
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  } else {
    $('viewHint').textContent = 'WebGL is not available, so the 3D preview is off. The Fusion viewport still shows the real model.';
  }

  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function tri(arr, a, b, c, col) {
    const n = norm(cross(sub3(b, a), sub3(c, a)));
    for (const p of [a, b, c]) arr.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
  }
  function quad(arr, a, b, c, d, col) { tri(arr, a, b, c, col); tri(arr, a, c, d, col); }
  function box(arr, x0, y0, z0, x1, y1, z1, col) {
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    for (const [a, b, c, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]]) quad(arr, P[a], P[b], P[c], P[d], col);
  }
  function rrect(x0, y0, x1, y1, r, seg) {   // rounded-rectangle outline, counter-clockwise, always 4 * (seg + 1) points
    r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    const corners = [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]], pts = [];
    for (const [cx, cy, a0] of corners) for (let k = 0; k <= seg; k++) { const a = a0 + (Math.PI / 2) * k / seg; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  }
  function loft(arr, A, za, B, zb, col) {     // band between two outlines with the same point count
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      quad(arr, [...A[i], za], [...A[j], za], [...B[j], zb], [...B[i], zb], col);
    }
  }
  function capFill(arr, pts, z, col) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    for (let i = 0; i < pts.length; i++) tri(arr, [cx, cy, z], [...pts[i], z], [...pts[(i + 1) % pts.length], z], col);
  }
  function prismX(arr, x0, x1, poly, col) {   // extrude a YZ polygon (star-shaped from poly[0]) along X
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      quad(arr, [x0, a[0], a[1]], [x1, a[0], a[1]], [x1, b[0], b[1]], [x0, b[0], b[1]], col);
    }
    for (let i = 1; i + 1 < poly.length; i++) for (const x of [x0, x1]) tri(arr, [x, ...poly[0]], [x, ...poly[i]], [x, ...poly[i + 1]], col);
  }

  function rebuildMesh() {
    if (!gl) return;
    const g = LY.derived(S), arr = [], SEG = 6, c = g.clearance;
    const body = [0.80, 0.84, 0.90], divc = [0.30, 0.52, 0.92], footc = [0.66, 0.71, 0.79], tabc = [0.58, 0.45, 0.85], scoopc = [0.25, 0.68, 0.62], holec = [0.25, 0.27, 0.32];
    const outline = inset => rrect(c + inset, c + inset, g.gridWidth - c - inset, g.gridDepth - c - inset, g.outerRadius - inset, SEG);
    if (!errors.length) {
      // feet
      const FP = [[0, LY.FOOT_TOP + LY.FOOT_BOTTOM], [LY.FOOT_BOTTOM, LY.FOOT_TOP], [LY.FOOT_BOTTOM + LY.FOOT_MIDDLE, LY.FOOT_TOP], [LY.FOOT_HEIGHT, 0]];
      for (let i = 0; i < S.nx; i++) for (let j = 0; j < S.ny; j++) {
        const x = i * g.pitch, y = j * g.pitch;
        const ol = k => rrect(x + c + k, y + c + k, x + g.pitch - c - k, y + g.pitch - c - k, g.outerRadius - k, SEG);
        for (let k = 0; k + 1 < FP.length; k++) loft(arr, ol(FP[k][1]), FP[k][0], ol(FP[k + 1][1]), FP[k + 1][0], footc);
        capFill(arr, ol(FP[0][1]), 0, footc);
      }
      // outer block and cavity
      const outer = outline(0);
      loft(arr, outer, LY.FOOT_HEIGHT, outer, g.top, body);
      capFill(arr, outer, LY.FOOT_HEIGHT, body);
      const prof = LY.cavityProfile(S);
      for (let k = 0; k + 1 < prof.length; k++) loft(arr, outline(prof[k][1]), prof[k][0], outline(prof[k + 1][1]), prof[k + 1][0], body);
      capFill(arr, outline(prof[0][1]), g.floor, body);
      const last = prof[prof.length - 1];
      if (last[1] > 0) loft(arr, outer, g.top, outline(last[1]), g.top, body);
      // interior
      LY.dividerBoxes(S).forEach(([x0, y0, x1, y1]) => box(arr, x0, y0, g.floor, x1, y1, g.dividerTop, divc));
      LY.labelTabs(S).forEach(t => prismX(arr, t.x0, t.x1,
        [[t.yFace, t.zTop - t.height], [t.yFace, t.zTop], [t.yFace - t.depth, t.zTop], [t.yFace - t.depth, t.zTop - LY.TAB_THICKNESS]], tabc));
      LY.scoops(S).forEach(s => {
        const poly = [[s.yFace, s.zFloor]];
        for (let k = 0; k <= 10; k++) { const a = -Math.PI / 2 - (Math.PI / 2) * k / 10; poly.push([s.yFace + s.radius + s.radius * Math.cos(a), s.zFloor + s.radius + s.radius * Math.sin(a)]); }
        prismX(arr, s.x0, s.x1, poly, scoopc);
      });
      // base holes as dark discs on the foot bottoms
      const hr = (S.holes === 'screws' ? S.fit.ScrewDiameter : S.fit.MagnetDiameter) / 2;
      LY.holeCentres(S).forEach(([x, y]) => {
        const pts = []; for (let k = 0; k < 20; k++) { const a = 2 * Math.PI * k / 20; pts.push([x + hr * Math.cos(a), y + hr * Math.sin(a)]); }
        capFill(arr, pts, -0.05, holec);
      });
    }
    if (!mesh) mesh = { buf: gl.createBuffer(), count: 0 };
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    mesh.count = arr.length / 9;
    cam.tx = g.gridWidth / 2; cam.ty = g.gridDepth / 2; cam.tz = g.top / 2;
    if (!cam.userZoom) cam.dist = 1.35 * Math.hypot(g.width, g.depth, g.top);
    render3d();
  }
  function mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
  function perspective(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]); }
  function lookAt(e, c, u) {
    const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  }
  function render3d() {
    if (!gl || !mesh) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.max(10, Math.round(r.height * dpr));
    gl.viewport(0, 0, cv.width, cv.height);
    const bg = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [240, 240, 240]).map(Number);
    gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!mesh.count) return;
    gl.enable(gl.DEPTH_TEST); gl.useProgram(prog);
    const e = [cam.tx + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), cam.ty - cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw), cam.tz + cam.dist * Math.sin(cam.pitch)];
    const mvp = mul(perspective(0.6, cv.width / cv.height, cam.dist * 0.05, cam.dist * 4), lookAt(e, [cam.tx, cam.ty, cam.tz], [0, 0, 1]));
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'mvp'), false, mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
    [['p', 0], ['n', 12], ['c', 24]].forEach(([nm, off]) => { const l = gl.getAttribLocation(prog, nm); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 36, off); });
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
  let orbit = null;
  cv.addEventListener('pointerdown', e => { orbit = [e.clientX, e.clientY, cam.yaw, cam.pitch]; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
  cv.addEventListener('pointermove', e => {
    if (!orbit) return;
    cam.yaw = orbit[2] + (e.clientX - orbit[0]) * 0.01;
    cam.pitch = Math.max(-1.45, Math.min(1.5, orbit[3] + (e.clientY - orbit[1]) * 0.01)); render3d();
  });
  const endOrbit = () => { orbit = null; cv.style.cursor = 'grab'; };
  cv.addEventListener('pointerup', endOrbit); cv.addEventListener('pointercancel', endOrbit);
  cv.addEventListener('wheel', e => { e.preventDefault(); cam.userZoom = true; cam.dist *= Math.exp(e.deltaY * 0.0012); render3d(); }, { passive: false });
  cv.addEventListener('dblclick', () => { cam.yaw = -0.65; cam.pitch = 0.62; cam.userZoom = false; rebuildMesh(); });

  // -------------------------------------------------------- Fusion bridge
  const bridgeReady = () => typeof adsk !== 'undefined' && adsk && typeof adsk.fusionSendData === 'function';
  let connected = false, activeInfo = null, busyFlag = false;
  function send(action, payload) {
    if (!bridgeReady()) return Promise.resolve({ ok: false, error: 'Not connected to Fusion (preview mode).' });
    return Promise.resolve(adsk.fusionSendData(action, JSON.stringify(payload || {})))
      .then(r => { try { return r ? JSON.parse(r) : { ok: false, error: 'Fusion sent an empty reply.' }; } catch (e) { return { ok: false, error: String(r) }; } });
  }
  window.fusionJavaScriptHandler = {
    handle(action, data) {
      try {
        const d = data ? JSON.parse(data) : {};
        if (action === 'result') showResult(d);
        else if (action === 'activeChanged') applyActiveInfo(d);
      } catch (e) { status('Unexpected message from Fusion: ' + e, 'err'); }
      return 'OK';
    }
  };
  function status(msg, cls) { const s = $('status'); s.textContent = msg; s.className = cls || ''; }
  function updateButtons() {
    const isBin = !!(activeInfo && activeInfo.isBin), valid = !errors.length;
    $('btnCreate').disabled = busyFlag || !valid || !connected;
    $('btnUpdate').disabled = busyFlag || !valid || !isBin;
    ['btnStl', 'btn3mf', 'btnStep'].forEach(id => { $(id).disabled = busyFlag || !isBin; });
    $('btnCreate').title = connected ? '' : 'Open this window from Fusion to build bins';
    $('btnUpdate').title = isBin ? `Rebuild ${activeInfo.name}` : 'The active document is not a bin made by this tool';
    $('loadActive').disabled = !isBin;
  }
  function busy(on) { busyFlag = on; updateButtons(); }
  function showResult(r) {
    busy(false);
    if (r.active) applyActiveInfo(r.active);
    if (!r.ok) { status('Error: ' + r.error, 'err'); return; }
    if (r.summary) {
      const s = r.summary, probs = s.problems || [];
      status(`${r.message || 'Done.'}\n${s.size_mm ? s.size_mm.join(' × ') + ' mm, ' : ''}${s.volume_cm3} cm³ (about ${s.mass_g_pla} g of PLA), ` +
        `${s.compartments} compartment${s.compartments === 1 ? '' : 's'}.` +
        (probs.length ? '\nCheck failed: ' + probs.join('; ') : '\nAll checks passed.'), probs.length ? 'err' : 'ok');
    } else status(r.message || 'Done.', 'ok');
  }
  function run(action, extra) {
    if (errors.length && action !== 'export') { status('Fix the problems listed at the top first.', 'err'); return Promise.resolve(); }
    busy(true); status('Working in Fusion…');
    return send(action, Object.assign({ cfg: cfg() }, extra || {}))
      .then(r => { if (!r.queued) showResult(r); return r; })
      .catch(e => { busy(false); status('Error: ' + e, 'err'); });
  }
  function applyActiveInfo(a) { activeInfo = a || null; updateButtons(); }
  function loadConfig(c, msg) {
    if (!c) return;
    pushUndo();
    S.nx = c.nx; S.ny = c.ny; S.sub = c.sub || 1; S.heightUnits = c.heightUnits || LY.DEFAULT_SIZE.heightUnits;
    S.lip = c.lip !== false; S.holes = c.holes || 'none'; S.holeCells = c.holeCells || 'all';
    S.walls = c.walls ? clone(c.walls) : { v: [], h: [] };
    S.fit = { ...LY.DEFAULT_FIT, ...(c.fit || {}) }; S.divider = { ...LY.DEFAULT_DIVIDER, ...(c.divider || {}) };
    S.tabs = { ...LY.DEFAULT_TABS, ...(c.tabs || {}) }; S.scoop = { ...LY.DEFAULT_SCOOP, ...(c.scoop || {}) }; S.name = c.name || '';
    syncInputs(); changed(false); if (msg) status(msg, 'ok');
  }
  let syncTimer = null;
  function scheduleAutoSync() {
    clearTimeout(syncTimer);
    if (!settings.autoUpdate || !(activeInfo && activeInfo.isBin) || errors.length) return;
    syncTimer = setTimeout(() => { if (!busyFlag) run('update'); }, 1200);
  }

  // ------------------------------------------------- layouts & settings
  let layouts = [];
  function drawLayouts() {
    $('layoutList').innerHTML = layouts.length ? layouts.map((l, n) =>
      `<div><span title="${esc(l.name)}">${esc(l.name)} <span class="note">${l.cfg.nx}×${l.cfg.ny}×${l.cfg.heightUnits}u</span></span>` +
      `<button class="link" data-load="${n}">load</button><button class="link del" data-del="${n}">delete</button></div>`).join('')
      : '<p class="note">No saved layouts yet.</p>';
  }
  function persist(kind) {
    const payload = kind === 'layouts' ? { layouts } : { settings };
    const local = () => { try { localStorage.setItem('gbd.' + kind, JSON.stringify(kind === 'layouts' ? layouts : settings)); } catch (e) { /* storage unavailable */ } };
    if (!connected) return local();
    send(kind === 'layouts' ? 'saveLayouts' : 'saveSettings', payload).then(r => { if (!r.ok) { local(); status('Could not save ' + kind + ': ' + r.error, 'err'); } });
  }

  // --------------------------------------------------------------- wiring
  document.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.step) {
      const [k, d] = t.dataset.step.split(':'), n = Number(d);
      resize(S.nx + (k === 'nx' ? n : 0), S.ny + (k === 'ny' ? n : 0), S.heightUnits + (k === 'hu' ? n : 0));
    } else if (t.dataset.sub) setSub(Number(t.dataset.sub));
    else if (t.dataset.hu) resize(S.nx, S.ny, Number(t.dataset.hu));
    else if (t.dataset.load) { const l = layouts[Number(t.dataset.load)]; loadConfig(l.cfg, `Loaded "${l.name}".`); }
    else if (t.dataset.del) { const l = layouts.splice(Number(t.dataset.del), 1)[0]; drawLayouts(); persist('layouts'); status(`Deleted "${l.name}".`); }
  });
  const onChange = (id, fn) => $(id).addEventListener('change', e => { pushUndo(); fn(e.target); syncInputs(); changed(); });
  $('nx').addEventListener('change', e => resize(e.target.value, S.ny, S.heightUnits));
  $('ny').addEventListener('change', e => resize(S.nx, e.target.value, S.heightUnits));
  $('hu').addEventListener('change', e => resize(S.nx, S.ny, e.target.value));
  onChange('lip', el => { S.lip = el.checked; });
  onChange('dThick', el => { S.divider.thickness = num(el.value, S.divider.thickness); });
  onChange('dGap', el => { S.divider.topGap = num(el.value, S.divider.topGap); });
  onChange('tabOn', el => { S.tabs.enabled = el.checked; });
  onChange('tabDepth', el => { S.tabs.depth = num(el.value, S.tabs.depth); });
  onChange('tabAngle', el => { S.tabs.angle = num(el.value, S.tabs.angle); });
  onChange('tabWidth', el => { S.tabs.width = num(el.value, S.tabs.width); });
  onChange('tabAlign', el => { S.tabs.align = el.value; });
  onChange('scoopOn', el => { S.scoop.enabled = el.checked; });
  onChange('scoopR', el => { S.scoop.radius = num(el.value, S.scoop.radius); });
  onChange('holes', el => { S.holes = el.value; });
  onChange('holeCells', el => { S.holeCells = el.value; });
  ['fitRows', 'holeRows'].forEach(id => $(id).addEventListener('change', e => {
    const k = e.target.dataset.fit; if (!k) return;
    pushUndo(); S.fit[k] = num(e.target.value, S.fit[k]); syncInputs(); changed();
  }));
  $('fitReset').addEventListener('click', () => { pushUndo(); S.fit = { ...LY.DEFAULT_FIT }; syncInputs(); changed(); status('Fit and hole values reset to the Gridfinity spec.'); });
  $('qApply').addEventListener('click', () => { pushUndo(); S.walls = LY.quickSplit(S, num($('qCols').value, 1), num($('qRows').value, 1)); changed(); });
  $('clearWalls').addEventListener('click', () => { pushUndo(); S.walls = { v: [], h: [] }; changed(); });
  $('everyUnit').addEventListener('click', everyUnit);
  $('undo').addEventListener('click', () => { if (undoStack.length) { redoStack.push(snapshot()); restore(undoStack.pop()); } });
  $('redo').addEventListener('click', () => { if (redoStack.length) { undoStack.push(snapshot()); restore(redoStack.pop()); } });
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $(e.shiftKey ? 'redo' : 'undo').click(); }
  });
  $('layoutName').addEventListener('change', e => { S.name = e.target.value.trim(); });
  $('layoutSave').addEventListener('click', () => {
    const name = ($('layoutName').value || '').trim() || `${S.nx}×${S.ny}×${S.heightUnits}u layout`;
    S.name = name;
    const entry = { name, cfg: clone(cfg()) }, i = layouts.findIndex(l => l.name === name);
    if (i >= 0) layouts[i] = entry; else layouts.push(entry);
    drawLayouts(); persist('layouts'); status(`Saved layout "${name}".`, 'ok');
  });
  $('loadActive').addEventListener('click', () => send('readActive').then(r => {
    if (!r.ok) return status('Error: ' + r.error, 'err');
    applyActiveInfo(r.active);
    if (!r.active.config) return status(`${r.active.name || 'The active document'} has no saved layout.`, 'err');
    loadConfig(r.active.config, `Loaded the layout from ${r.active.name}.`);
  }));
  $('bedSize').addEventListener('change', e => { settings.bedSize = Math.max(50, num(e.target.value, 256)); syncInputs(); updateInfo(); persist('settings'); });
  $('autoSync').addEventListener('change', e => { settings.autoUpdate = e.target.checked; persist('settings'); scheduleAutoSync(); });
  $('btnCreate').addEventListener('click', () => run('create'));
  $('btnUpdate').addEventListener('click', () => run('update'));
  $('btnStl').addEventListener('click', () => run('export', { fmt: 'stl' }));
  $('btn3mf').addEventListener('click', () => run('export', { fmt: '3mf' }));
  $('btnStep').addEventListener('click', () => run('export', { fmt: 'step' }));
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { drawEditor(); render3d(); }, 50); });

  // ----------------------------------------------------------------- init
  function init() {
    syncInputs(); changed(false); drawLayouts();
    let tries = 0;
    (function connect() {
      if (bridgeReady()) {
        connected = true;
        send('init').then(r => {
          if (!r.ok) return status('Error: ' + r.error, 'err');
          $('ver').textContent = r.version ? 'v' + r.version : '';
          layouts = Array.isArray(r.layouts) ? r.layouts : []; drawLayouts();
          Object.assign(settings, r.settings || {}); syncInputs(); updateInfo();
          applyActiveInfo(r.active);
          status(r.active && r.active.isBin
            ? `Connected. "${r.active.name}" is a designer bin: use "Load from active bin" to edit its layout.`
            : 'Connected to Fusion.', 'ok');
        });
      } else if (tries++ < 50) setTimeout(connect, 100);
      else {
        try { layouts = JSON.parse(localStorage.getItem('gbd.layouts') || '[]'); } catch (e) { layouts = []; }
        try { Object.assign(settings, JSON.parse(localStorage.getItem('gbd.settings') || '{}')); } catch (e) { /* ignore */ }
        syncInputs(); drawLayouts(); updateInfo(); updateButtons();
        status('Preview mode: not running inside Fusion. You can still edit layouts and use the 3D preview.');
      }
    })();
  }
  init();
})();
