"""Fusion integration test for Gridfinity Bin Designer.

Run inside Fusion: UTILITIES > Scripts and Add-Ins > "+" (add this script),
or with any tool that executes a Fusion Python script. It builds bins in new
documents, checks them against the Gridfinity spec, prints a report and
closes only the documents it created (without saving).
"""

import importlib
import os
import sys
import traceback

import adsk.core
import adsk.fusion

HERE = os.path.dirname(os.path.realpath(__file__))
ADDIN = os.path.join(HERE, '..', 'GridfinityBinDesigner')
if os.path.isdir(ADDIN) and ADDIN not in sys.path:
    sys.path.insert(0, ADDIN)

TOL = 1e-3


def _check(results, name, ok, detail=''):
    results.append((name, bool(ok), detail))


def _stack_overlap(body, dz, dx=0.0):
    """Volume (mm3) shared by the bin and a copy of itself moved up by dz and sideways by dx (mm)."""
    tbm = adsk.fusion.TemporaryBRepManager.get()
    top, base = tbm.copy(body), tbm.copy(body)
    m = adsk.core.Matrix3D.create()
    m.translation = adsk.core.Vector3D.create(dx / 10, 0, dz / 10)
    tbm.transform(top, m)
    tbm.booleanOperation(base, top, adsk.fusion.BooleanTypes.IntersectionBooleanType)
    return base.volume * 1000


def run_tests(app):
    import gbd_layout as L
    import gbd_builder as B
    importlib.reload(L)
    importlib.reload(B)
    results, created = [], []
    try:
        # 1. plain bin vs the analytic spec volume
        cfg = L.normalize({'nx': 2, 'ny': 1, 'heightUnits': 6})
        doc, rep = B.create_bin(app, cfg)
        created.append(doc)
        design = adsk.fusion.Design.cast(app.activeProduct)
        body = design.rootComponent.bRepBodies.item(0)
        _check(results, 'plain: no verification problems', not rep['problems'], rep['problems'])
        _check(results, 'plain: size %s' % rep.get('size_mm'), rep.get('size_mm') == [83.5, 41.5, 46.4])
        exp = L.base_volume(cfg) / 1000
        _check(results, 'plain: volume %.4f cm3 (spec %.4f)' % (body.volume, exp), abs(body.volume - exp) < TOL)

        # 2. stacking: seats exactly one bin height up, and the lip holds it in place
        h = L.derived(cfg)['height']
        _check(results, 'stack: seats at %.0f mm without collision' % h, _stack_overlap(body, h) < 1e-6)
        _check(results, 'stack: 0.25 mm sideways still free', _stack_overlap(body, h, 0.25) < 1e-6)
        _check(results, 'stack: 0.6 mm sideways collides (lip locks)', _stack_overlap(body, h, 0.6) > 1.0)

        # 3. in-place update: half grid, dividers, label tabs, scoops, magnets + screws
        walls = {'v': [[2, j] for j in range(4)] + [[4, j] for j in range(2)],
                 'h': [[i, 2] for i in range(6)] + [[0, 3], [1, 3]]}
        full = {'nx': 3, 'ny': 2, 'sub': 2, 'heightUnits': 6, 'walls': walls, 'holes': 'both',
                'tabs': {'enabled': True}, 'scoop': {'enabled': True}}
        rep = B.update_bin(design, full)
        _check(results, 'features: no verification problems', not rep['problems'], rep['problems'])
        _check(results, 'features: 6 compartments', rep['compartments'] == 6)
        _check(results, 'features: size %s' % rep.get('size_mm'), rep.get('size_mm') == [125.5, 83.5, 46.4])

        # 4. dividers only: the added volume is checked against numeric integration inside verify()
        rep = B.update_bin(design, dict(full, tabs={'enabled': False}, scoop={'enabled': False}, holes='magnets',
                                        holeCells='corners'))
        _check(results, 'dividers: volume and holes match', not rep['problems'], rep['problems'])

        # 5. no lip, third grid, narrow left-aligned tabs
        rep = B.update_bin(design, {'nx': 2, 'ny': 2, 'sub': 3, 'heightUnits': 6, 'lip': False,
                                    'walls': {'v': [[2, j] for j in range(6)], 'h': [[i, 3] for i in range(6)]},
                                    'tabs': {'enabled': True, 'width': 15, 'align': 'left'}})
        _check(results, 'no lip: no verification problems', not rep['problems'], rep['problems'])
        _check(results, 'no lip: size %s' % rep.get('size_mm'), rep.get('size_mm') == [83.5, 83.5, 42.0])

        # 6. smallest bin
        doc2, rep = B.create_bin(app, {'nx': 1, 'ny': 1, 'heightUnits': 2})
        created.append(doc2)
        _check(results, '1x1x2u: no verification problems', not rep['problems'], rep['problems'])
        _check(results, '1x1x2u: size %s' % rep.get('size_mm'), rep.get('size_mm') == [41.5, 41.5, 18.4])

        # 7. invalid input is rejected before anything is built
        try:
            B.create_bin(app, {'heightUnits': 3, 'tabs': {'enabled': True, 'depth': 25}})
            _check(results, 'invalid config rejected', False, 'no error raised')
        except L.LayoutError as e:
            _check(results, 'invalid config rejected', True, e.errors[0])
    except Exception:
        _check(results, 'unexpected exception', False, traceback.format_exc())
    finally:
        for d in created:
            try:
                d.close(False)
            except Exception:
                pass
    return results


def run(context):
    app = adsk.core.Application.get()
    results = run_tests(app)
    lines = ['%s  %s%s' % ('PASS' if ok else 'FAIL', name, ('  ' + str(detail)) if (detail and not ok) else '')
             for name, ok, detail in results]
    failed = sum(1 for _, ok, _ in results if not ok)
    report = '\n'.join(lines + ['', '%d checks, %d failed' % (len(results), failed)])
    print(report)
    if not os.environ.get('GBD_NO_DIALOG'):
        app.userInterface.messageBox(report, 'Gridfinity Bin Designer tests')
