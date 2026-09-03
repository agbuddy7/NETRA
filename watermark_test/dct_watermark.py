import cv2
import numpy as np
import sys

# --- Must match WatermarkUtils.java and verify.js exactly ---
ALPHA = 30.0
COEFF_U = 3
COEFF_V = 1
REDUNDANCY = 7
MAGIC_BITS = [
    0,1,0,1,0,0,0,0,  # 0x50 = 'P'
    0,1,0,0,1,0,1,1   # 0x4B = 'K'
]

def text_to_bits(text):
    """Convert string to bits — byte-by-byte, MSB first (matches Java)."""
    bits = []
    for byte in text.encode('utf-8'):
        for i in range(7, -1, -1):
            bits.append((byte >> i) & 1)
    return bits

def bits_to_text(bits):
    """Convert bits back to string — byte-by-byte, MSB first (matches JS)."""
    chars = []
    for i in range(0, len(bits), 8):
        byte_bits = bits[i:i+8]
        if len(byte_bits) < 8:
            break
        val = 0
        for b in byte_bits:
            val = (val << 1) | b
        chars.append(chr(val))
    return ''.join(chars)

def build_bitstream(payload):
    """Build: [16-bit magic 'PK'] [16-bit length] [payload bits]"""
    payload_bits = text_to_bits(payload)
    length = len(payload_bits)
    
    stream = list(MAGIC_BITS)  # 16 bits magic
    
    # 16-bit length header (big-endian)
    for i in range(15, -1, -1):
        stream.append((length >> i) & 1)
    
    stream.extend(payload_bits)
    return stream

def rgb_to_y(r, g, b):
    """Same Y formula used across all codebases."""
    return 0.299 * r + 0.587 * g + 0.114 * b

def embed_dct(image_path, output_path, payload, alpha=ALPHA):
    print(f"--- Embedding DCT Watermark (v2 — redundancy + marker) ---")
    img = cv2.imread(image_path)
    if img is None:
        print("Could not read image")
        return 0
    
    bitstream = build_bitstream(payload)
    
    h, w, _ = img.shape
    h_pad = h - (h % 8)
    w_pad = w - (w % 8)
    
    max_blocks = (h_pad // 8) * (w_pad // 8)
    total_needed = len(bitstream) * REDUNDANCY
    
    if total_needed > max_blocks:
        print(f"Warning: Need {total_needed} blocks, have {max_blocks}")
    
    # Work on a float copy
    img_float = img.astype(np.float64)
    
    logical_bit_idx = 0
    redundancy_idx = 0
    
    for by in range(0, h_pad, 8):
        for bx in range(0, w_pad, 8):
            if logical_bit_idx >= len(bitstream):
                break
            
            # Extract 8x8 block
            block_bgr = img_float[by:by+8, bx:bx+8]
            b_ch = block_bgr[:,:,0]
            g_ch = block_bgr[:,:,1]
            r_ch = block_bgr[:,:,2]
            
            # RGB → Y using the shared formula
            y_block = 0.299 * r_ch + 0.587 * g_ch + 0.114 * b_ch
            
            # DCT
            dct_block = cv2.dct(y_block.astype(np.float32))
            
            # Embed bit via quantization
            bit = bitstream[logical_bit_idx]
            coeff = dct_block[COEFF_U, COEFF_V]
            
            q = round(float(coeff) / alpha)
            if bit == 1:
                if q % 2 == 0: q += 1
            else:
                if q % 2 != 0: q += 1
            
            dct_block[COEFF_U, COEFF_V] = q * alpha
            
            # IDCT
            new_y = cv2.idct(dct_block)
            
            # Reconstruct: apply Y-delta to RGB (preserves color)
            old_y = y_block
            diff_y = new_y.astype(np.float64) - old_y
            
            new_r = np.clip(r_ch + diff_y, 0, 255)
            new_g = np.clip(g_ch + diff_y, 0, 255)
            new_b = np.clip(b_ch + diff_y, 0, 255)
            
            img_float[by:by+8, bx:bx+8, 0] = new_b
            img_float[by:by+8, bx:bx+8, 1] = new_g
            img_float[by:by+8, bx:bx+8, 2] = new_r
            
            redundancy_idx += 1
            if redundancy_idx >= REDUNDANCY:
                redundancy_idx = 0
                logical_bit_idx += 1
        
        if logical_bit_idx >= len(bitstream):
            break
    
    final_img = np.clip(img_float, 0, 255).astype(np.uint8)
    cv2.imwrite(output_path, final_img)
    print(f"Embedded {len(bitstream)} logical bits × {REDUNDANCY} redundancy into {output_path}")
    return len(bitstream)

def extract_dct(image_path, alpha=ALPHA):
    """Extract watermark — auto-detects length via header. No need to pass bit count."""
    print(f"\n--- Extracting DCT Watermark (v2) from {image_path} ---")
    img = cv2.imread(image_path)
    if img is None:
        print("Could not read image")
        return
    
    img_float = img.astype(np.float64)
    h, w, _ = img.shape
    h_pad = h - (h % 8)
    w_pad = w - (w % 8)
    
    max_blocks = (h_pad // 8) * (w_pad // 8)
    
    # We don't know total length yet. Extract one raw bit per REDUNDANCY blocks.
    # First extract enough for magic (16 bits) + length header (16 bits) = 32 logical bits
    # That needs 32 * REDUNDANCY = 224 blocks. Then we read the length and continue.
    
    raw_bits_per_block = []
    
    for by in range(0, h_pad, 8):
        for bx in range(0, w_pad, 8):
            block_bgr = img_float[by:by+8, bx:bx+8]
            r_ch = block_bgr[:,:,2]
            g_ch = block_bgr[:,:,1]
            b_ch = block_bgr[:,:,0]
            
            y_block = 0.299 * r_ch + 0.587 * g_ch + 0.114 * b_ch
            dct_block = cv2.dct(y_block.astype(np.float32))
            
            coeff = dct_block[COEFF_U, COEFF_V]
            q = round(float(coeff) / alpha)
            
            raw_bits_per_block.append(0 if q % 2 == 0 else 1)
    
    # Apply majority voting to decode logical bits
    logical_bits = []
    for i in range(0, len(raw_bits_per_block), REDUNDANCY):
        chunk = raw_bits_per_block[i:i+REDUNDANCY]
        if len(chunk) < REDUNDANCY:
            break
        ones = sum(chunk)
        logical_bits.append(1 if ones > REDUNDANCY // 2 else 0)
    
    # Check magic marker
    if len(logical_bits) < 32:
        print("Image too small to contain watermark header.")
        return
    
    magic = logical_bits[:16]
    if magic != MAGIC_BITS:
        print("[X] No watermark detected (magic marker mismatch).")
        print(f"   Expected: {MAGIC_BITS}")
        print(f"   Got:      {magic}")
        return
    
    print("[OK] Magic marker 'PK' found!")
    
    # Read length header
    length_bits = logical_bits[16:32]
    payload_length = 0
    for b in length_bits:
        payload_length = (payload_length << 1) | b
    
    print(f"   Payload length: {payload_length} bits ({payload_length // 8} chars)")
    
    # Extract payload
    total_logical_bits_needed = 32 + payload_length  # magic + length + payload
    if len(logical_bits) < total_logical_bits_needed:
        print(f"Warning: Not enough blocks for full payload. Have {len(logical_bits)}, need {total_logical_bits_needed}")
        payload_bits = logical_bits[32:]
    else:
        payload_bits = logical_bits[32:total_logical_bits_needed]
    
    payload = bits_to_text(payload_bits)
    print(f"   Extracted Payload: '{payload}'")
    return payload

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  To embed:  python dct_watermark.py embed <input.jpg> <output.png> 'my secret'")
        print("  To extract: python dct_watermark.py extract <image.png>")
        print("  (v2: no need to pass bit length for extraction!)")
        sys.exit(1)
        
    mode = sys.argv[1]
    
    if mode == "embed":
        if len(sys.argv) != 5:
            print("Missing args for embed")
            sys.exit(1)
        embed_dct(sys.argv[2], sys.argv[3], sys.argv[4])
        
    elif mode == "extract":
        if len(sys.argv) != 3:
            print("Missing args for extract")
            sys.exit(1)
        extract_dct(sys.argv[2])

