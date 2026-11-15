"""Generate the add-in toolbar icons (pure Python, no dependencies).

Run: python3 tools/make_icons.py
Draws a rounded bin seen from above with a stacking-lip rim, one divider and a label tab.
"""

import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'GridfinityBinDesigner', 'resources', 'icon')
SIZES = {'16x16.png': 16, '16x16@2x.png': 32, '32x32.png': 32, '32x32@2x.png': 64, '64x64.png': 64}

RIM = (47, 111, 222, 255)
FLOOR = (214, 225, 244, 255)
DIVIDER = (47, 111, 222, 255)
TAB = (138, 99, 210, 255)


def rounded(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def colour(u, v):
    """Colour at normalized coordinates (0..1, y down)."""
    if not rounded(u, v, 0.06, 0.06, 0.94, 0.94, 0.18):
        return None
    if not rounded(u, v, 0.16, 0.16, 0.84, 0.84, 0.10):
        return RIM
    if 0.47 <= u <= 0.55 and 0.16 <= v <= 0.84:
        return DIVIDER
    if 0.16 <= v <= 0.33 and (0.16 <= u <= 0.47 or 0.55 <= u <= 0.84):
        return TAB
    return FLOOR


def render(n, ss=4):
    rows = []
    for y in range(n):
        row = bytearray([0])
        for x in range(n):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = colour((x + (sx + 0.5) / ss) / n, (y + (sy + 0.5) / ss) / n)
                    if c:
                        for k in range(3):
                            acc[k] += c[k] * c[3]
                        acc[3] += c[3]
            a = acc[3] / (ss * ss)
            if acc[3]:
                row += bytes([round(acc[0] / acc[3]), round(acc[1] / acc[3]), round(acc[2] / acc[3]), round(a)])
            else:
                row += bytes(4)
        rows.append(bytes(row))
    return b''.join(rows)


def png(n, raw):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, n in SIZES.items():
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(png(n, render(n)))
        print('wrote', name)
