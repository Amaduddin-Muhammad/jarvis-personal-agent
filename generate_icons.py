import zlib
import struct
import os

def write_png(width, height, filename):
    # PNG signature
    png = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    # Width, Height, Bit depth (8), Color type (2=RGB), Compression (0), Filter (0), Interlace (0)
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr = b'IHDR' + ihdr_data
    ihdr_crc = zlib.crc32(ihdr)
    png += struct.pack('>I', len(ihdr_data)) + ihdr + struct.pack('>I', ihdr_crc)
    
    # IDAT chunk (pixel data)
    scanline_len = width * 3 + 1
    raw_data = bytearray(scanline_len * height)
    
    for y in range(height):
        # Filter type 0 (None)
        raw_data[y * scanline_len] = 0
        for x in range(width):
            cx, cy = width / 2.0, height / 2.0
            rx, ry = width / 2.0, height / 2.0
            # Normalized distance from center
            dist = ((x - cx + 0.5) / rx)**2 + ((y - cy + 0.5) / ry)**2
            
            # Draw a circular glow logo
            if dist < 0.7:
                # Inner phosphor green #33ff99
                r, g, b = 51, 255, 153
            elif dist < 0.95:
                # Outer ring cold cyan #3ad6ff
                r, g, b = 58, 214, 255
            else:
                # Dark background #05080a
                r, g, b = 5, 8, 10
                
            offset = y * scanline_len + 1 + x * 3
            raw_data[offset] = r
            raw_data[offset+1] = g
            raw_data[offset+2] = b
            
    compressed = zlib.compress(raw_data)
    idat = b'IDAT' + compressed
    idat_crc = zlib.crc32(idat)
    png += struct.pack('>I', len(compressed)) + idat + struct.pack('>I', idat_crc)
    
    # IEND chunk
    iend = b'IEND'
    iend_crc = zlib.crc32(iend)
    png += struct.pack('>I', 0) + iend + struct.pack('>I', iend_crc)
    
    # Ensure dir exists
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    with open(filename, 'wb') as f:
        f.write(png)
        print(f"Generated {filename}")

if __name__ == "__main__":
    src_dir = os.path.join(os.path.dirname(__file__), "src")
    write_png(16, 16, os.path.join(src_dir, "tray_icon.png"))
    write_png(256, 256, os.path.join(src_dir, "logo.png"))
