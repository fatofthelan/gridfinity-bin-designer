"""Check that palette/layout.js and gbd_layout.py agree on every rule.

Needs Node.js; the test is skipped when `node` is not on PATH.
"""

import json
import os
import random
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, os.path.join(ROOT, 'GridfinityBinDesigner'))

import gbd_layout as L  # noqa: E402

NODE_SCRIPT = r"""
const LY = require(process.argv[process.argv.length - 1]);
const cases = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = cases.map(c => {
  const valid = LY.validate(c);
  const r = { derived: LY.derived(c), validate: valid, runs: LY.dividerRuns(c), boxes: LY.dividerBoxes(c),
              compartments: LY.compartments(c), clean: LY.cleanWalls(c), profile: LY.cavityProfile(c) };
  if (!valid.length) Object.assign(r, { tabs: LY.labelTabs(c), scoops: LY.scoops(c), holes: LY.holeCentres(c), baseVolume: LY.baseVolume(c) });
  return r;
});
process.stdout.write(JSON.stringify(out));
"""


def random_cases(n, seed=4242):
    rng = random.Random(seed)
    cases = []
    for k in range(n):
        nx, ny, sub = rng.randint(1, 7), rng.randint(1, 6), rng.choice((1, 2, 3, 4))
        gx, gy = nx * sub, ny * sub
        density = rng.random()
        v = [[i, j] for i in range(1, gx) for j in range(gy) if rng.random() < density * 0.6]
        h = [[i, j] for j in range(1, gy) for i in range(gx) if rng.random() < density * 0.6]
        fit = dict(L.DEFAULT_FIT)
        if k % 4 == 0:
            fit['BinClearance'] = rng.choice((0.0, 0.15, 0.25, 0.35, 0.7))
            fit['WallThickness'] = rng.choice((0.6, 0.95, 1.2, 2.0, 2.6))
            fit['FloorHeight'] = rng.choice((5.0, 6.0, 7.0, 9.5))
            fit['MagnetDepth'] = rng.choice((2.0, 2.4, 4.4))
            fit['HoleSpacing'] = rng.choice((26.0, 30.0))
        cases.append(L.normalize({
            'nx': nx, 'ny': ny, 'sub': sub, 'heightUnits': rng.choice((2, 3, 4, 6, 9, 15)),
            'lip': rng.random() < 0.7, 'holes': rng.choice(L.HOLE_MODES), 'holeCells': rng.choice(L.HOLE_CELLS),
            'walls': {'v': v, 'h': h}, 'fit': fit,
            'divider': {'thickness': rng.choice((0.3, 0.8, 1.2, 2.0, 4.9)), 'topGap': rng.choice((0.0, 0.5, 3.0, 40.0))},
            'tabs': {'enabled': rng.random() < 0.5, 'depth': rng.choice((8.0, 13.0, 25.0)), 'angle': rng.choice((30.0, 45.0, 60.0)),
                     'width': rng.choice((0.0, 0.0, 15.0, 60.0)), 'align': rng.choice(L.TAB_ALIGN)},
            'scoop': {'enabled': rng.random() < 0.5, 'radius': rng.choice((5.0, 12.0, 25.0))},
        }, check=False))
    return cases


def close(a, b, path=''):
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        if len(a) != len(b):
            raise AssertionError('%s: length %d != %d' % (path, len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            close(x, y, '%s[%d]' % (path, i))
    elif isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            raise AssertionError('%s: keys %s != %s' % (path, sorted(a), sorted(b)))
        for k in a:
            close(a[k], b[k], '%s.%s' % (path, k))
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        if abs(a - b) > 1e-6 * max(1.0, abs(a)):
            raise AssertionError('%s: %r != %r' % (path, a, b))
    elif a != b:
        raise AssertionError('%s: %r != %r' % (path, a, b))


@unittest.skipIf(shutil.which('node') is None, 'node is not installed')
class ParityTests(unittest.TestCase):
    def test_python_and_javascript_agree(self):
        cases = random_cases(400)
        js_path = os.path.join(ROOT, 'GridfinityBinDesigner', 'palette', 'layout.js')
        res = subprocess.run(['node', '-e', NODE_SCRIPT, js_path], input=json.dumps(cases),
                             capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        js = json.loads(res.stdout)
        self.assertEqual(len(js), len(cases))
        n_invalid = n_tabs = n_scoops = 0
        for idx, (c, j) in enumerate(zip(cases, js)):
            py = {
                'derived': L.derived(c), 'validate': L.validate(c), 'runs': [list(r) for r in L.divider_runs(c)],
                'boxes': [list(b) for b in L.divider_boxes(c)],
                'compartments': [{'cells': [list(x) for x in comp['cells']], 'bounds': list(comp['bounds']),
                                  'isRect': comp['isRect'], 'probe': list(comp['probe']), 'size': list(comp['size'])}
                                 for comp in L.compartments(c)],
                'clean': c['walls'], 'profile': [list(p) for p in L.cavity_profile(c)],
            }
            if not py['validate']:
                py.update(tabs=L.label_tabs(c), scoops=L.scoops(c), holes=[list(p) for p in L.hole_centres(c)],
                          baseVolume=L.base_volume(c))
                n_tabs += bool(py['tabs'])
                n_scoops += bool(py['scoops'])
            n_invalid += bool(py['validate'])
            try:
                close(py, j)
            except AssertionError as e:
                self.fail('case %d differs: %s\nconfig: %s' % (idx, e, json.dumps(c)))
        self.assertGreater(n_invalid, 20, 'the random cases should include invalid configurations')
        self.assertGreater(n_tabs, 30)
        self.assertGreater(n_scoops, 30)


if __name__ == '__main__':
    unittest.main()
