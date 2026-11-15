"""Layout model for Gridfinity Bin Designer.

Pure Python with no Fusion imports, so it can be unit-tested anywhere.
palette/layout.js implements the same rules, and tests/test_parity.py checks
that both give identical results.

Coordinates: millimetres. The origin is the front-left corner of the bin's
grid cells (not of the bin itself: the bin sits BinClearance inside the
cells). X is to the right, Y to the back, Z up, foot bottom at Z = 0.

Spec values (gridfinity.xyz design reference v5, cross-checked with
kennetek/gridfinity-rebuilt-openscad):
  grid 42 mm, height unit 7 mm, 0.25 mm clearance per side (41.5 mm bins),
  foot 0.8 / 1.8 / 2.15 mm (45 degree chamfers, 4.75 mm total),
  outer corner radius 3.75 mm, stacking lip 0.7 / 1.8 / 1.9 mm,
  magnet holes 6.5 x 2.4 mm, M3 screw holes 3 x 6 mm, 26 mm hole pattern.

Walls are stored on a sub-grid (1 to 4 cells per Gridfinity unit):
  walls['v'] = [[i, j], ...]  vertical segment on grid line x = i, spanning cell row j
  walls['h'] = [[i, j], ...]  horizontal segment on grid line y = j, spanning cell column i
"""

import math

SCHEMA_VERSION = 1

# Fixed by the Gridfinity profile (the clearance-dependent parts are derived).
FOOT_BOTTOM = 0.8        # 45 degree chamfer at the bottom of each foot
FOOT_MIDDLE = 1.8        # vertical band
FOOT_TOP = 2.15          # 45 degree chamfer up to the full bin size
FOOT_HEIGHT = FOOT_BOTTOM + FOOT_MIDDLE + FOOT_TOP   # 4.75
SOCKET_RADIUS = 4.0      # baseplate pocket corner radius; bin radius = 4 - clearance
LIP_BOTTOM = 0.7         # stacking lip: 45 degree chamfer from the inner tip
LIP_MIDDLE = 1.8         # vertical band
LIP_SUPPORT = 1.2        # vertical band under the lip tip before the 45 degree support
TAB_THICKNESS = 1.2      # front edge thickness of a label tab
OVERLAP = 0.4            # how far added features reach into walls and floors

DEFAULT_FIT = {
    'GridPitch': 42.0,
    'HeightUnit': 7.0,
    'BinClearance': 0.25,
    'WallThickness': 1.2,
    'FloorHeight': 7.0,       # top of the inside floor, measured from the foot bottom
    'MagnetDiameter': 6.5,
    'MagnetDepth': 2.4,
    'ScrewDiameter': 3.0,
    'ScrewDepth': 6.0,
    'HoleSpacing': 26.0,      # centre-to-centre within a cell
}
DEFAULT_DIVIDER = {'thickness': 1.2, 'topGap': 0.5}
DEFAULT_TABS = {'enabled': False, 'depth': 13.0, 'angle': 45.0, 'width': 0.0, 'align': 'center'}
DEFAULT_SCOOP = {'enabled': False, 'radius': 12.0}
DEFAULT_SIZE = {'nx': 3, 'ny': 2, 'sub': 1, 'heightUnits': 6}
HOLE_MODES = ('none', 'magnets', 'screws', 'both')
HOLE_CELLS = ('all', 'corners')
TAB_ALIGN = ('left', 'center', 'right')

LIMITS = {
    'units': (1, 20),
    'heightUnits': (2, 40),
    'sub': (1, 2, 3, 4),
    'wall': (0.8, 2.5),
    'dividerThickness': (0.4, 5.0),
    'clearance': (0.0, 0.6),
}


class LayoutError(ValueError):
    """Raised when a configuration cannot be built. .errors lists every problem."""

    def __init__(self, errors):
        super().__init__('; '.join(errors))
        self.errors = list(errors)


def _f(value, name, errors):
    try:
        v = float(value)
    except (TypeError, ValueError):
        errors.append('%s must be a number' % name)
        return None
    if not math.isfinite(v):
        errors.append('%s must be a finite number' % name)
        return None
    return v


def _i(value, name, errors):
    try:
        v = float(value)
    except (TypeError, ValueError):
        errors.append('%s must be a whole number' % name)
        return None
    if not math.isfinite(v) or v != int(v):
        errors.append('%s must be a whole number' % name)
        return None
    return int(v)


def _bool(value):
    if isinstance(value, str):
        return value.strip().lower() in ('1', 'true', 'yes', 'on')
    return bool(value)


# ------------------------------------------------------------- derived
def derived(cfg):
    """Frequently used dimensions (mm) of a normalized configuration."""
    f = cfg['fit']
    p, c, w = f['GridPitch'], f['BinClearance'], f['WallThickness']
    h = cfg['heightUnits'] * f['HeightUnit']
    lip_top_chamfer = FOOT_TOP - c                  # 1.9 at the standard clearance
    lip_depth = LIP_BOTTOM + lip_top_chamfer        # 2.6: inner tip inset from the outer face
    lip_height = LIP_BOTTOM + LIP_MIDDLE + lip_top_chamfer if cfg['lip'] else 0.0
    outer_r = SOCKET_RADIUS - c
    tab_h = cfg['tabs']['depth'] * math.tan(math.radians(cfg['tabs']['angle'])) + TAB_THICKNESS
    return {
        'pitch': p,
        'step': p / cfg['sub'],
        'gridWidth': cfg['nx'] * p,
        'gridDepth': cfg['ny'] * p,
        'width': cfg['nx'] * p - 2 * c,
        'depth': cfg['ny'] * p - 2 * c,
        'clearance': c,
        'height': h,                                 # nominal height (stacking pitch)
        'top': h + lip_height,                       # highest point of the bin
        'lipHeight': lip_height,
        'lipDepth': lip_depth,
        'lipTopChamfer': lip_top_chamfer,
        'outerRadius': outer_r,
        'innerWall': c + w,                          # inner wall face, from the grid edge
        'floor': f['FloorHeight'],
        'dividerTop': h - cfg['divider']['topGap'],
        'tabHeight': tab_h,
        'footTopWidth': p - 2 * c,
        'footMidWidth': p - 2 * c - 2 * FOOT_TOP,
        'footBottomWidth': p - 2 * c - 2 * FOOT_TOP - 2 * FOOT_BOTTOM,
        'footTopRadius': outer_r,
        'footMidRadius': outer_r - FOOT_TOP,
        'footBottomRadius': outer_r - FOOT_TOP - FOOT_BOTTOM,
        # where the 45 degree support under the lip meets the inner wall face
        'supportStart': h - LIP_SUPPORT - (lip_depth - w),
    }


def cavity_profile(cfg):
    """Inside of the bin as (z, inset-from-outer-face) breakpoints, bottom to top.
    Straight segments between breakpoints; corner radius at inset i is outerRadius - i."""
    g, w = derived(cfg), cfg['fit']['WallThickness']
    z0, h = g['floor'], g['height']
    if not cfg['lip']:
        return [(z0, w), (h, w)]
    pts = [(z0, w)]
    if g['lipDepth'] > w:
        pts += [(g['supportStart'], w), (h - LIP_SUPPORT, g['lipDepth'])]
    else:
        pts += [(h - LIP_SUPPORT, w)]
    pts += [(h, g['lipDepth']), (h + LIP_BOTTOM, g['lipTopChamfer']),
            (h + LIP_BOTTOM + LIP_MIDDLE, g['lipTopChamfer']), (g['top'], 0.0)]
    return pts


# ------------------------------------------------------------ validate
def validate(cfg):
    """Return a list of human-readable problems for a normalized config (empty = OK)."""
    errors = []
    f, d, t, s = cfg['fit'], cfg['divider'], cfg['tabs'], cfg['scoop']
    for k in ('GridPitch', 'HeightUnit', 'MagnetDiameter', 'MagnetDepth', 'ScrewDiameter', 'ScrewDepth', 'HoleSpacing'):
        if f[k] <= 0:
            errors.append('%s must be greater than 0' % k)
    lo, hi = LIMITS['clearance']
    if not lo <= f['BinClearance'] <= hi:
        errors.append('BinClearance must be between %g and %g mm' % (lo, hi))
    lo, hi = LIMITS['wall']
    if not lo <= f['WallThickness'] <= hi:
        errors.append('Wall thickness must be between %g and %g mm' % (lo, hi))
    if errors:
        return errors
    g = derived(cfg)
    if f['GridPitch'] < 30:
        errors.append('GridPitch must be at least 30 mm for the Gridfinity foot profile')
    if f['FloorHeight'] < FOOT_HEIGHT + 0.6:
        errors.append('FloorHeight must be at least %.2f mm so the floor covers the gaps between the feet' % (FOOT_HEIGHT + 0.6))
    top_of_cavity = g['supportStart'] if cfg['lip'] and g['lipDepth'] > f['WallThickness'] else g['height'] - (LIP_SUPPORT if cfg['lip'] else 0)
    if top_of_cavity - f['FloorHeight'] < 1.0:
        errors.append('The bin is too low for this floor height: add height units or lower FloorHeight')
    holes = cfg['holes']
    if holes in ('magnets', 'both') and f['MagnetDepth'] > FOOT_HEIGHT - 0.6:
        errors.append('MagnetDepth must stay at least 0.6 mm inside the foot (max %.2f mm)' % (FOOT_HEIGHT - 0.6))
    if holes in ('screws', 'both') and f['ScrewDepth'] > f['FloorHeight'] - 0.6:
        errors.append('ScrewDepth must be at least 0.6 mm less than FloorHeight')
    if holes != 'none':
        r = max(f['MagnetDiameter'] if holes in ('magnets', 'both') else 0,
                f['ScrewDiameter'] if holes in ('screws', 'both') else 0) / 2
        if f['HoleSpacing'] / 2 + r > g['footBottomWidth'] / 2 - 0.4:
            errors.append('The holes do not fit on the foot: reduce HoleSpacing or the hole diameter')
        if holes == 'both' and f['ScrewDiameter'] >= f['MagnetDiameter']:
            errors.append('ScrewDiameter must be smaller than MagnetDiameter')
    lo, hi = LIMITS['dividerThickness']
    if not lo <= d['thickness'] <= hi:
        errors.append('Divider thickness must be between %g and %g mm' % (lo, hi))
    if d['topGap'] < 0:
        errors.append('Divider top gap cannot be negative')
    if g['dividerTop'] - f['FloorHeight'] < 1.0:
        errors.append('Dividers would not reach above the floor: reduce the divider top gap')
    if d['thickness'] >= g['step'] - 3.0:
        errors.append('Dividers are too thick for the selected grid')
    if t['enabled']:
        if not 3 <= t['depth'] <= 30:
            errors.append('Label tab depth must be between 3 and 30 mm')
        if not 30 <= t['angle'] <= 60:
            errors.append('Label tab support angle must be between 30 and 60 degrees')
        if t['width'] < 0:
            errors.append('Label tab width cannot be negative (0 means full width)')
        if not errors and g['dividerTop'] - g['tabHeight'] < f['FloorHeight']:
            errors.append('Label tabs are taller than the inside of the bin: use a smaller tab depth or angle, or a taller bin')
    if s['enabled'] and not 1 <= s['radius'] <= 60:
        errors.append('Scoop radius must be between 1 and 60 mm')
    return errors


# ----------------------------------------------------------- normalize
def normalize(cfg, check=True):
    """Fill defaults, coerce types, drop out-of-range wall segments.

    Raises LayoutError with all problems when check is True and the result is not buildable.
    """
    cfg = dict(cfg or {})
    errors = []

    def group(name, defaults):
        out = dict(defaults)
        for k, v in (cfg.get(name) or {}).items():
            if k not in defaults:
                continue
            if isinstance(defaults[k], bool):
                out[k] = _bool(v)
            elif isinstance(defaults[k], str):
                out[k] = str(v)
            else:
                val = _f(v, '%s %s' % (name, k), errors)
                if val is not None:
                    out[k] = val
        return out

    fit = group('fit', DEFAULT_FIT)
    div = group('divider', DEFAULT_DIVIDER)
    tabs = group('tabs', DEFAULT_TABS)
    scoop = group('scoop', DEFAULT_SCOOP)
    if tabs['align'] not in TAB_ALIGN:
        errors.append('Label tab alignment must be one of %s' % ', '.join(TAB_ALIGN))
    lo, hi = LIMITS['units']
    nx = _i(cfg.get('nx', DEFAULT_SIZE['nx']), 'Width (units)', errors)
    ny = _i(cfg.get('ny', DEFAULT_SIZE['ny']), 'Depth (units)', errors)
    for name, v in (('Width (units)', nx), ('Depth (units)', ny)):
        if v is not None and not lo <= v <= hi:
            errors.append('%s must be between %d and %d' % (name, lo, hi))
    hu = _i(cfg.get('heightUnits', DEFAULT_SIZE['heightUnits']), 'Height (units)', errors)
    lo, hi = LIMITS['heightUnits']
    if hu is not None and not lo <= hu <= hi:
        errors.append('Height must be between %d and %d units' % (lo, hi))
    sub = _i(cfg.get('sub', 1), 'Grid subdivision', errors)
    if sub is not None and sub not in LIMITS['sub']:
        errors.append('Grid subdivision must be 1, 2, 3 or 4')
    holes = str(cfg.get('holes', 'none'))
    if holes not in HOLE_MODES:
        errors.append('Holes must be one of %s' % ', '.join(HOLE_MODES))
    hole_cells = str(cfg.get('holeCells', 'all'))
    if hole_cells not in HOLE_CELLS:
        errors.append('Hole placement must be one of %s' % ', '.join(HOLE_CELLS))
    if errors:
        raise LayoutError(errors)
    assert nx is not None and ny is not None and hu is not None and sub is not None

    walls = cfg.get('walls') or {}
    gx, gy = nx * sub, ny * sub

    def segs(items, ok):
        out = set()
        for item in items or []:
            try:
                i, j = int(item[0]), int(item[1])
            except (TypeError, ValueError, IndexError):
                continue
            if ok(i, j):
                out.add((i, j))
        return out

    v = segs(walls.get('v'), lambda i, j: 0 < i < gx and 0 <= j < gy)
    h = segs(walls.get('h'), lambda i, j: 0 < j < gy and 0 <= i < gx)
    out = {
        'schema': SCHEMA_VERSION,
        'nx': nx, 'ny': ny, 'sub': sub, 'heightUnits': hu,
        'lip': _bool(cfg.get('lip', True)),
        'holes': holes, 'holeCells': hole_cells,
        'walls': {'v': [list(a) for a in sorted(v)], 'h': [list(a) for a in sorted(h, key=lambda a: (a[1], a[0]))]},
        'fit': fit, 'divider': div, 'tabs': tabs, 'scoop': scoop,
        'name': str(cfg.get('name', '') or '')[:120],
    }
    if check:
        problems = validate(out)
        if problems:
            raise LayoutError(problems)
    return out


# ------------------------------------------------------------ dividers
def divider_runs(cfg):
    """Merge wall segments into straight runs: (axis, line, start_cell, end_cell) in sub-grid steps."""
    runs = []
    for axis in ('v', 'h'):
        lines = {}
        for i, j in cfg['walls'][axis]:
            line, pos = (i, j) if axis == 'v' else (j, i)
            lines.setdefault(line, []).append(pos)
        for line in sorted(lines):
            cells = sorted(set(lines[line]))
            start = prev = cells[0]
            for c in cells[1:] + [None]:
                if c is not None and c == prev + 1:
                    prev = c
                    continue
                runs.append((axis, line, start, prev + 1))
                if c is not None:
                    start = prev = c
    return runs


def divider_boxes(cfg):
    """Divider footprints (x0, y0, x1, y1) in mm.

    Runs that reach the bin edge stop in the middle of the outer wall; interior
    ends are extended by half a thickness so T and L junctions are solid.
    """
    g = derived(cfg)
    t = cfg['divider']['thickness']
    edge = g['clearance'] + cfg['fit']['WallThickness'] / 2
    step = g['step']
    nmax = {'v': cfg['ny'] * cfg['sub'], 'h': cfg['nx'] * cfg['sub']}
    full = {'v': g['gridDepth'], 'h': g['gridWidth']}
    out = []
    for axis, line, a, b in divider_runs(cfg):
        c = line * step
        lo = edge if a == 0 else a * step - t / 2
        hi = full[axis] - edge if b == nmax[axis] else b * step + t / 2
        out.append((c - t / 2, lo, c + t / 2, hi) if axis == 'v' else (lo, c - t / 2, hi, c + t / 2))
    return out


# --------------------------------------------------------- compartments
def _walls_sets(cfg):
    return {tuple(a) for a in cfg['walls']['v']}, {tuple(a) for a in cfg['walls']['h']}


def compartments(cfg):
    """Connected groups of sub-grid cells separated by walls.

    Returns dicts: cells, bounds (i0, j0, i1, j1), isRect, probe (an interior point in mm),
    and size (w, d, h) in mm of the bounding box at floor level.
    """
    sub = cfg['sub']
    gx, gy = cfg['nx'] * sub, cfg['ny'] * sub
    g = derived(cfg)
    step, t = g['step'], cfg['divider']['thickness']
    v, h = _walls_sets(cfg)
    seen, out = set(), []
    for i0 in range(gx):
        for j0 in range(gy):
            if (i0, j0) in seen:
                continue
            stack, cells = [(i0, j0)], []
            seen.add((i0, j0))
            while stack:
                i, j = stack.pop()
                cells.append((i, j))
                for n, blocked in (((i - 1, j), i == 0 or (i, j) in v),
                                   ((i + 1, j), i == gx - 1 or (i + 1, j) in v),
                                   ((i, j - 1), j == 0 or (i, j) in h),
                                   ((i, j + 1), j == gy - 1 or (i, j + 1) in h)):
                    if not blocked and n not in seen:
                        seen.add(n)
                        stack.append(n)
            cells.sort()
            xs, ys = [c[0] for c in cells], [c[1] for c in cells]
            b = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
            is_rect = (b[2] - b[0]) * (b[3] - b[1]) == len(cells)
            ci, cj = cells[0]
            x0 = g['innerWall'] if b[0] == 0 else b[0] * step + t / 2
            x1 = g['gridWidth'] - g['innerWall'] if b[2] == gx else b[2] * step - t / 2
            y0 = g['innerWall'] if b[1] == 0 else b[1] * step + t / 2
            y1 = g['gridDepth'] - g['innerWall'] if b[3] == gy else b[3] * step - t / 2
            out.append({
                'cells': cells, 'bounds': b, 'isRect': is_rect,
                'probe': ((ci + 0.5) * step + 0.37, (cj + 0.5) * step + 0.29),
                'size': (round(x1 - x0, 3), round(y1 - y0, 3), round(g['dividerTop'] - g['floor'], 3)),
            })
    return out


def _edge_runs(cfg, side):
    """Runs of cell edges on the back ('back') or front ('front') of each compartment.

    Returns (compartment index, y line, i0, i1): cells i0..i1-1 of one compartment whose
    edge at that grid line is a wall or the bin boundary.
    """
    sub = cfg['sub']
    gx, gy = cfg['nx'] * sub, cfg['ny'] * sub
    v, h = _walls_sets(cfg)
    comp_of = {}
    for n, comp in enumerate(compartments(cfg)):
        for c in comp['cells']:
            comp_of[c] = n
    runs = []
    for j in range(gy):
        line = j + 1 if side == 'back' else j
        i = 0
        while i < gx:
            def closed(ii):
                return line in (0, gy) or (ii, line) in h
            if not closed(i):
                i += 1
                continue
            n, start = comp_of[(i, j)], i
            while i + 1 < gx and closed(i + 1) and comp_of[(i + 1, j)] == n and (i + 1, j) not in v:
                i += 1
            runs.append((n, line, start, i + 1))
            i += 1
    return runs


def _x_span(cfg, i0, i1):
    """X extent of a run of cells: inner wall faces at the bin edge, grid lines inside
    (a run ending at a divider then reaches into the divider's middle)."""
    g = derived(cfg)
    gx = cfg['nx'] * cfg['sub']
    x0 = g['innerWall'] if i0 == 0 else i0 * g['step']
    x1 = g['gridWidth'] - g['innerWall'] if i1 == gx else i1 * g['step']
    return x0, x1


def _into_walls(cfg, x0, x1):
    """Extend ends that sit on an inner wall face into the wall so the parts fuse."""
    g = derived(cfg)
    if abs(x0 - g['innerWall']) < 1e-9:
        x0 -= OVERLAP
    if abs(x1 - (g['gridWidth'] - g['innerWall'])) < 1e-9:
        x1 += OVERLAP
    return x0, x1


def label_tabs(cfg):
    """Label tabs, one per back-edge run: dicts with x0, x1, yFace (the face it hangs from),
    zTop, depth, height. Tabs grow toward -Y (into the compartment)."""
    if not cfg['tabs']['enabled']:
        return []
    g, tb = derived(cfg), cfg['tabs']
    gy = cfg['ny'] * cfg['sub']
    t = cfg['divider']['thickness']
    out = []
    for n, line, i0, i1 in _edge_runs(cfg, 'back'):
        x0, x1 = _x_span(cfg, i0, i1)
        width = x1 - x0
        if tb['width'] > 0 and tb['width'] < width:
            w = tb['width']
            if tb['align'] == 'left':
                x1 = x0 + w
            elif tb['align'] == 'right':
                x0 = x1 - w
            else:
                mid = (x0 + x1) / 2
                x0, x1 = mid - w / 2, mid + w / 2
        x0, x1 = _into_walls(cfg, x0, x1)
        y_face = g['gridDepth'] - g['innerWall'] if line == gy else line * g['step'] - t / 2
        out.append({'compartment': n, 'x0': round(x0, 6), 'x1': round(x1, 6), 'yFace': round(y_face, 6),
                    'zTop': g['dividerTop'], 'depth': tb['depth'], 'height': g['tabHeight']})
    return out


def scoops(cfg):
    """Finger scoops, one per front-edge run: dicts with x0, x1, yFace, zFloor, radius.
    Scoops grow toward +Y. The radius is limited by the compartment's depth and height."""
    if not cfg['scoop']['enabled']:
        return []
    g = derived(cfg)
    t = cfg['divider']['thickness']
    comps = compartments(cfg)
    out = []
    for n, line, i0, i1 in _edge_runs(cfg, 'front'):
        x0, x1 = _into_walls(cfg, *_x_span(cfg, i0, i1))
        y_face = g['innerWall'] if line == 0 else line * g['step'] + t / 2
        depth = comps[n]['size'][1]
        room = depth - (cfg['tabs']['depth'] if cfg['tabs']['enabled'] else 0) - 2.0
        r = min(cfg['scoop']['radius'], g['dividerTop'] - g['floor'] - 0.5, max(room, 0.0), depth * 0.75)
        if r < 1.0:
            continue
        out.append({'compartment': n, 'x0': round(x0, 6), 'x1': round(x1, 6), 'yFace': round(y_face, 6),
                    'zFloor': g['floor'], 'radius': round(r, 6)})
    return out


# ---------------------------------------------------------------- holes
def hole_centres(cfg):
    """(x, y) centres of the base holes in mm."""
    if cfg['holes'] == 'none':
        return []
    p, half = cfg['fit']['GridPitch'], cfg['fit']['HoleSpacing'] / 2
    pts = []
    for i in range(cfg['nx']):
        for j in range(cfg['ny']):
            cx, cy = (i + 0.5) * p, (j + 0.5) * p
            for sx in (-1, 1):
                for sy in (-1, 1):
                    if cfg['holeCells'] == 'corners':
                        if not ((sx < 0 and i == 0 or sx > 0 and i == cfg['nx'] - 1) and
                                (sy < 0 and j == 0 or sy > 0 and j == cfg['ny'] - 1)):
                            continue
                    pts.append((round(cx + sx * half, 6), round(cy + sy * half, 6)))
    return pts


# ------------------------------------------------------- volume checks
def rr_area(width, depth, radius):
    return width * depth - (4 - math.pi) * radius * radius


def _frustum(w0, d0, r0, w1, d1, r1, h):
    """Volume between two rounded rectangles whose sizes and radii vary linearly (Simpson is exact)."""
    if h <= 0:
        return 0.0
    a0, a1 = rr_area(w0, d0, r0), rr_area(w1, d1, r1)
    am = rr_area((w0 + w1) / 2, (d0 + d1) / 2, (r0 + r1) / 2)
    return h / 6 * (a0 + 4 * am + a1)


def foot_volume(cfg):
    g = derived(cfg)
    b, m, t = g['footBottomWidth'], g['footMidWidth'], g['footTopWidth']
    rb, rm, rt = g['footBottomRadius'], g['footMidRadius'], g['footTopRadius']
    return (_frustum(b, b, rb, m, m, rm, FOOT_BOTTOM) + _frustum(m, m, rm, m, m, rm, FOOT_MIDDLE) +
            _frustum(m, m, rm, t, t, rt, FOOT_TOP))


def cavity_volume(cfg):
    g = derived(cfg)
    vol, pts = 0.0, cavity_profile(cfg)
    for (z0, i0), (z1, i1) in zip(pts, pts[1:]):
        vol += _frustum(g['width'] - 2 * i0, g['depth'] - 2 * i0, g['outerRadius'] - i0,
                        g['width'] - 2 * i1, g['depth'] - 2 * i1, g['outerRadius'] - i1, z1 - z0)
    return vol


def base_volume(cfg):
    """Expected solid volume (mm3) of the bin without dividers, tabs, scoops or holes."""
    g = derived(cfg)
    block = rr_area(g['width'], g['depth'], g['outerRadius']) * (g['top'] - FOOT_HEIGHT)
    return cfg['nx'] * cfg['ny'] * foot_volume(cfg) + block - cavity_volume(cfg)


def hole_volume(cfg):
    """Volume (mm3) removed by the base holes."""
    f = cfg['fit']
    each = 0.0
    if cfg['holes'] in ('magnets', 'both'):
        each += math.pi * (f['MagnetDiameter'] / 2) ** 2 * f['MagnetDepth']
    if cfg['holes'] in ('screws', 'both'):
        depth = f['ScrewDepth'] - (f['MagnetDepth'] if cfg['holes'] == 'both' else 0)
        each += math.pi * (f['ScrewDiameter'] / 2) ** 2 * depth
    return each * len(hole_centres(cfg))


def _union_area(rects):
    xs = sorted({r[0] for r in rects} | {r[2] for r in rects})
    ys = sorted({r[1] for r in rects} | {r[3] for r in rects})
    area = 0.0
    for x0, x1 in zip(xs, xs[1:]):
        for y0, y1 in zip(ys, ys[1:]):
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            if any(r[0] <= cx <= r[2] and r[1] <= cy <= r[3] for r in rects):
                area += (x1 - x0) * (y1 - y0)
    return area


def divider_volume_added(cfg, steps=4000):
    """Volume (mm3) the dividers add inside the cavity (numeric integration over Z).
    Exact enough for checks; ignores corner rounding (dividers never reach the corners)."""
    boxes = divider_boxes(cfg)
    if not boxes:
        return 0.0
    g = derived(cfg)
    pts = cavity_profile(cfg)

    def inset(z):
        for (z0, i0), (z1, i1) in zip(pts, pts[1:]):
            if z0 <= z <= z1:
                return i0 + (i1 - i0) * (z - z0) / (z1 - z0) if z1 > z0 else i1
        return pts[-1][1]
    z0, z1 = g['floor'], g['dividerTop']
    dz = (z1 - z0) / steps
    vol = 0.0
    for k in range(steps):
        z = z0 + (k + 0.5) * dz
        e = g['clearance'] + inset(z)
        clip = (e, e, g['gridWidth'] - e, g['gridDepth'] - e)
        rects = []
        for r in boxes:
            q = (max(r[0], clip[0]), max(r[1], clip[1]), min(r[2], clip[2]), min(r[3], clip[3]))
            if q[0] < q[2] and q[1] < q[3]:
                rects.append(q)
        vol += _union_area(rects) * dz
    return vol


# ---------------------------------------------------------------- naming
def label(cfg):
    return 'Gridfinity bin %dx%dx%du' % (cfg['nx'], cfg['ny'], cfg['heightUnits'])


def file_stem(cfg):
    stem = 'gridfinity-bin-%dx%dx%du' % (cfg['nx'], cfg['ny'], cfg['heightUnits'])
    name = ''.join(ch if ch.isalnum() else '-' for ch in (cfg.get('name') or '').lower())
    while '--' in name:
        name = name.replace('--', '-')
    name = name.strip('-')[:40]
    return stem + ('-' + name if name else '')
