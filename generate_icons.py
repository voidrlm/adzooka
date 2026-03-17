#!/usr/bin/env python3
"""Generate simple shield PNG icons for the extension (no Pillow needed)."""
import struct, zlib, math

def make_png(size):
    """Render a red shield on dark background as a minimal PNG."""
    img = [[(26, 26, 46)] * size for _ in range(size)]  # dark background

    cx, cy = size / 2, size / 2
    s = size

    # Draw shield shape by testing each pixel
    for y in range(size):
        for x in range(size):
            nx = (x - cx) / (s * 0.42)
            ny = (y - cy) / (s * 0.46)

            # Shield outline: top = rounded rectangle, bottom = pointed V
            in_shield = False
            if -0.9 <= nx <= 0.9 and -0.9 <= ny <= 0.6:
                # Top rounded part
                if ny <= 0.0:
                    in_shield = (nx**2 + max(0, (ny + 0.3))**2 * 2) <= 1.1 if ny < -0.3 else abs(nx) <= 0.9
                    in_shield = abs(nx) <= 0.9
                else:
                    # Bottom triangle
                    in_shield = abs(nx) <= (0.9 - ny * 0.9 / 0.6)

            if in_shield:
                # Red shield
                img[y][x] = (233, 69, 96)

            # White checkmark / lock icon in center
            lx = (x - cx) / (s * 0.18)
            ly = (y - cy) / (s * 0.18)
            # Simple "S" safe symbol — just a white dot for tiny sizes
            if lx**2 + ly**2 <= 0.25 and in_shield:
                img[y][x] = (255, 255, 255)

    # Encode as PNG
    def pack_row(row):
        return b'\x00' + bytes([v for px in row for v in px])

    raw = b''.join(pack_row(row) for row in img)
    compressed = zlib.compress(raw)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    return png

for sz in [16, 48, 128]:
    with open(f'icons/icon{sz}.png', 'wb') as f:
        f.write(make_png(sz))
    print(f"Generated icons/icon{sz}.png")

print("Done.")
