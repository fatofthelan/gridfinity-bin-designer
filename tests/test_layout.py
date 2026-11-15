"""Unit tests for gbd_layout (pure Python, no Fusion needed).

Run: python3 -m unittest discover -s tests
"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'GridfinityBinDesigner'))

import gbd_layout as L  # noqa: E402


def cfg(**kw):
    return L.normalize(kw)


class SpecDimensions(unittest.TestCase):
    def test_standard_sizes(self):
        g = L.derived(cfg(nx=2, ny=1, heightUnits=6))
        self.assertAlmostEqual(g['width'], 83.5)
        self.assertAlmostEqual(g['depth'], 41.5)
        self.assertAlmostEqual(g['height'], 42.0)
        self.assertAlmostEqual(g['lipHeight'], 4.4)
        self.assertAlmostEqual(g['top'], 46.4)
        self.assertAlmostEqual(g['outerRadius'], 3.75)

    def test_foot_profile(self):
        g = L.derived(cfg())
        self.assertAlmostEqual(L.FOOT_HEIGHT, 4.75)
        self.assertAlmostEqual(g['footTopWidth'], 41.5)
        self.assertAlmostEqual(g['footMidWidth'], 37.2)
        self.assertAlmostEqual(g['footBottomWidth'], 35.6)
        self.assertAlmostEqual(g['footBottomRadius'], 0.8)

    def test_lip_profile_matches_foot(self):
        # the lip's inner profile must equal the foot profile so bins stack: 0.7 + 1.9 = 2.6 mm deep
        g = L.derived(cfg())
        self.assertAlmostEqual(g['lipDepth'], 2.6)
        self.assertAlmostEqual(g['lipTopChamfer'] + g['clearance'], L.FOOT_TOP)
        pts = L.cavity_profile(cfg())
        self.assertEqual(pts[-1], (g['top'], 0.0))
        for (z0, _), (z1, _) in zip(pts, pts[1:]):
            self.assertLessEqual(z0, z1)

    def test_no_lip(self):
        c = cfg(lip=False)
        g = L.derived(c)
        self.assertEqual(g['lipHeight'], 0)
        self.assertEqual(L.cavity_profile(c), [(7.0, 1.2), (g['height'], 1.2)])

    def test_volume_matches_fusion_reference(self):
        # measured in Fusion for a plain 2 x 1 x 6u bin built by gbd_builder
        self.assertAlmostEqual(L.base_volume(cfg(nx=2, ny=1, heightUnits=6)) / 1000, 33.805, places=3)


class Normalize(unittest.TestCase):
    def test_defaults(self):
        c = cfg()
        self.assertEqual((c['nx'], c['ny'], c['sub'], c['heightUnits']), (3, 2, 1, 6))
        self.assertTrue(c['lip'])
        self.assertEqual(c['holes'], 'none')
        self.assertEqual(c['fit'], L.DEFAULT_FIT)

    def test_strings_are_coerced(self):
        c = cfg(nx='4', ny=2.0, heightUnits='3', lip='false', fit={'BinClearance': '0.3'})
        self.assertEqual((c['nx'], c['ny'], c['heightUnits']), (4, 2, 3))
        self.assertFalse(c['lip'])
        self.assertAlmostEqual(c['fit']['BinClearance'], 0.3)

    def test_out_of_range_walls_dropped(self):
        c = cfg(nx=2, ny=1, walls={'v': [[0, 0], [1, 0], [2, 0], [1, 5], ['x', 0]], 'h': [[0, 0], [0, 1]]})
        self.assertEqual(c['walls'], {'v': [[1, 0]], 'h': []})

    def test_all_errors_reported(self):
        with self.assertRaises(L.LayoutError) as ctx:
            L.normalize({'nx': 0, 'ny': 99, 'heightUnits': 1, 'sub': 5, 'holes': 'glue'})
        self.assertEqual(len(ctx.exception.errors), 5)

    def test_unknown_keys_ignored(self):
        c = cfg(fit={'Bogus': 1}, divider={'thickness': 1.6, 'colour': 'red'})
        self.assertNotIn('Bogus', c['fit'])
        self.assertEqual(c['divider'], {'thickness': 1.6, 'topGap': 0.5})


class Validate(unittest.TestCase):
    def errs(self, **kw):
        return L.validate(L.normalize(kw, check=False))

    def test_valid_defaults(self):
        self.assertEqual(self.errs(), [])

    def test_too_low(self):
        self.assertTrue(any('too low' in e for e in self.errs(heightUnits=2, fit={'FloorHeight': 12})))
        self.assertEqual(self.errs(heightUnits=2), [])

    def test_floor_must_cover_feet(self):
        self.assertTrue(any('FloorHeight' in e for e in self.errs(fit={'FloorHeight': 5})))

    def test_magnet_depth(self):
        self.assertTrue(any('MagnetDepth' in e for e in self.errs(holes='magnets', fit={'MagnetDepth': 4.5})))
        self.assertEqual(self.errs(holes='magnets', fit={'MagnetDepth': 4.5 - 0.4}), [])

    def test_holes_must_fit_on_foot(self):
        self.assertTrue(any('do not fit' in e for e in self.errs(holes='magnets', fit={'HoleSpacing': 32})))

    def test_screw_smaller_than_magnet(self):
        self.assertTrue(any('ScrewDiameter' in e for e in self.errs(holes='both', fit={'ScrewDiameter': 7})))

    def test_tabs_too_tall(self):
        self.assertTrue(any('Label tabs' in e for e in self.errs(heightUnits=3, tabs={'enabled': True, 'depth': 20})))
        self.assertEqual(self.errs(heightUnits=3, tabs={'enabled': True, 'depth': 10}), [])

    def test_thick_dividers_on_fine_grid(self):
        self.assertTrue(any('too thick' in e for e in self.errs(sub=4, fit={'GridPitch': 30}, divider={'thickness': 4.9})))


class Layout(unittest.TestCase):
    def test_compartments_and_runs(self):
        c = cfg(nx=3, ny=2, sub=2, walls={'v': [[2, j] for j in range(4)], 'h': [[i, 2] for i in range(2, 6)]})
        comps = L.compartments(c)
        self.assertEqual(len(comps), 3)
        self.assertEqual(sorted(len(x['cells']) for x in comps), [8, 8, 8])
        self.assertEqual(L.divider_runs(c), [('v', 2, 0, 4), ('h', 2, 2, 6)])

    def test_divider_boxes_reach_wall_middle(self):
        c = cfg(nx=2, ny=1, walls={'v': [[1, 0]], 'h': []})
        (x0, y0, x1, y1), = L.divider_boxes(c)
        self.assertAlmostEqual((x0 + x1) / 2, 42.0)
        self.assertAlmostEqual(x1 - x0, 1.2)
        self.assertAlmostEqual(y0, 0.25 + 0.6)
        self.assertAlmostEqual(y1, 42 - 0.85)

    def test_compartment_size(self):
        c = cfg(nx=2, ny=1, walls={'v': [[1, 0]], 'h': []})
        sizes = [x['size'] for x in L.compartments(c)]
        w = 42 - 0.25 - 1.2 - 0.6
        self.assertEqual(sizes, [(round(w, 3), 39.1, 34.5)] * 2)

    def test_dangling_wall_keeps_one_compartment(self):
        c = cfg(nx=3, ny=3, walls={'v': [[1, 0]], 'h': []})
        self.assertEqual(len(L.compartments(c)), 1)

    def test_label_tabs_per_compartment(self):
        c = cfg(nx=2, ny=2, walls={'v': [[1, 0], [1, 1]], 'h': [[0, 1]]}, tabs={'enabled': True})
        tabs = L.label_tabs(c)
        self.assertEqual(len(tabs), 3)    # left column has two compartments, right column one
        back = [t for t in tabs if abs(t['yFace'] - (84 - 1.45)) < 1e-9]
        self.assertEqual(len(back), 2)
        middle = [t for t in tabs if abs(t['yFace'] - (42 - 0.6)) < 1e-9]
        self.assertEqual(len(middle), 1)

    def test_tab_width_and_alignment(self):
        t, = L.label_tabs(cfg(nx=2, ny=1, tabs={'enabled': True, 'width': 20, 'align': 'left'}))
        self.assertAlmostEqual(t['x0'], 1.45 - L.OVERLAP)
        self.assertAlmostEqual(t['x1'], 1.45 + 20)
        t, = L.label_tabs(cfg(nx=2, ny=1, tabs={'enabled': True, 'width': 20, 'align': 'center'}))
        self.assertAlmostEqual((t['x0'] + t['x1']) / 2, 42)

    def test_tab_height_from_angle(self):
        g = L.derived(cfg(tabs={'enabled': True, 'depth': 10, 'angle': 45}))
        self.assertAlmostEqual(g['tabHeight'], 10 + L.TAB_THICKNESS)

    def test_scoops_limited_by_compartment(self):
        c = cfg(nx=1, ny=1, sub=4, walls={'h': [[0, 1], [1, 1], [2, 1], [3, 1]]}, scoop={'enabled': True, 'radius': 30})
        sc = L.scoops(c)
        self.assertEqual(len(sc), 2)
        for s in sc:
            self.assertLessEqual(s['radius'], 30)
        self.assertLess(min(s['radius'] for s in sc), 10)

    def test_hole_centres(self):
        self.assertEqual(len(L.hole_centres(cfg(nx=3, ny=2, holes='magnets'))), 24)
        corners = L.hole_centres(cfg(nx=3, ny=2, holes='magnets', holeCells='corners'))
        self.assertEqual(sorted(corners), sorted([(8.0, 8.0), (118.0, 8.0), (8.0, 76.0), (118.0, 76.0)]))

    def test_hole_volume(self):
        c = cfg(nx=1, ny=1, holes='both')
        each = math.pi * 3.25 ** 2 * 2.4 + math.pi * 1.5 ** 2 * (6 - 2.4)
        self.assertAlmostEqual(L.hole_volume(c), 4 * each)

    def test_divider_volume_simple(self):
        # one straight divider in the straight-walled part of a no-lip bin: thickness x length x height
        c = cfg(nx=2, ny=1, lip=False, walls={'v': [[1, 0]]})
        g = L.derived(c)
        expected = 1.2 * (g['gridDepth'] - 2 * g['innerWall']) * (g['dividerTop'] - g['floor'])
        self.assertAlmostEqual(L.divider_volume_added(c, 200), expected, places=6)

    def test_file_stem(self):
        self.assertEqual(L.file_stem(cfg(nx=2, ny=3, heightUnits=6, name='M3 / M4 screws!')),
                         'gridfinity-bin-2x3x6u-m3-m4-screws')


if __name__ == '__main__':
    unittest.main()
