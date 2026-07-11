import zlib
import struct
import os

def create_png_bytes(width, height):
    # PNG signature
    png = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    # Width, Height, Bit depth (8), Color type (6=RGBA), Compression (0), Filter (0), Interlace (0)
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = b'IHDR' + ihdr_data
    ihdr_crc = zlib.crc32(ihdr)
    png += struct.pack('>I', len(ihdr_data)) + ihdr + struct.pack('>I', ihdr_crc)
    
    # IDAT chunk (pixel data: scanline length is width * 4 + 1 for filter type byte)
    scanline_len = width * 4 + 1
    raw_data = bytearray(scanline_len * height)
    
    for y in range(height):
        # Filter type 0 (None)
        raw_data[y * scanline_len] = 0
        for x in range(width):
            cx, cy = width / 2.0, height / 2.0
            rx, ry = width / 2.0, height / 2.0
            # Normalized distance from center
            dist = ((x - cx + 0.5) / rx)**2 + ((y - cy + 0.5) / ry)**2
            
            # Draw a beautiful transparent circular glowing core logo
            if dist < 0.65:
                # Inner phosphor green #33ff99
                r, g, b, a = 51, 255, 153, 255
            elif dist < 0.9:
                # Outer ring cold cyan #3ad6ff
                r, g, b, a = 58, 214, 255, 255
            else:
                # Fully transparent corners
                r, g, b, a = 0, 0, 0, 0
                
            offset = y * scanline_len + 1 + x * 4
            raw_data[offset] = r
            raw_data[offset+1] = g
            raw_data[offset+2] = b
            raw_data[offset+3] = a
            
    compressed = zlib.compress(raw_data)
    idat = b'IDAT' + compressed
    idat_crc = zlib.crc32(idat)
    png += struct.pack('>I', len(compressed)) + idat + struct.pack('>I', idat_crc)
    
    # IEND chunk
    iend = b'IEND'
    iend_crc = zlib.crc32(iend)
    png += struct.pack('>I', 0) + iend + struct.pack('>I', iend_crc)
    
    return png

def write_ico(png_data, filename):
    # ICO header: Reserved (0), Type (1=Icon), Count (1)
    header = struct.pack('<HHH', 0, 1, 1)
    
    # Directory entry: Width (0 for 256), Height (0 for 256), Colors (0), Reserved (0), Planes (1), BPP (32), Size, Offset (22)
    entry = struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(png_data), 22)
    
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    with open(filename, 'wb') as f:
        f.write(header)
        f.write(entry)
        f.write(png_data)
    print(f"Generated {filename}")

if __name__ == "__main__":
    src_dir = os.path.join(os.path.dirname(__file__), "src")
    os.makedirs(src_dir, exist_ok=True)
    
    # 1. Write 16x16 Tray Icon (PNG with alpha channel)
    tray_bytes = create_png_bytes(16, 16)
    with open(os.path.join(src_dir, "tray_icon.png"), "wb") as f:
        f.write(tray_bytes)
    print("Generated src/tray_icon.png")
        
    # 2. Write 256x256 App Logo (PNG with alpha channel)
    logo_bytes = create_png_bytes(256, 256)
    with open(os.path.join(src_dir, "logo.png"), "wb") as f:
        f.write(logo_bytes)
    print("Generated src/logo.png")
    
    # 3. Write 256x256 Windows App Icon (ICO wrapper for transparent PNG)
    write_ico(logo_bytes, os.path.join(src_dir, "logo.ico"))
