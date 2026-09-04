import cv2
import numpy as np
import sys
import os

# --- V3 Configuration ---
REDUNDANCY = 7
MIN_MARGIN = 20.0
MAX_MARGIN = 50.0
PRNG_SEED = 123456789
MAGIC_BITS = [
    0,1,0,1,0,0,0,0,  # 0x50 = 'P'
    0,1,0,0,1,0,1,1   # 0x4B = 'K'
]
PAIRS = [
    ((2,3), (3,2)),
    ((1,3), (3,1)),
    ((2,4), (4,2))
]

# --- LCG PRNG (Deterministic across Java/Python/JS) ---
class PRNG:
    def __init__(self, seed):
        self.state = seed & 0xFFFFFFFF
    
    def next(self):
        # POSIX standard LCG
        self.state = (self.state * 1103515245 + 12345) & 0x7FFFFFFF
        return self.state

# --- Hamming(7,4) ECC ---
def hamming_encode(data_bits):
    encoded = []
    for i in range(0, len(data_bits), 4):
        d = data_bits[i:i+4]
        if len(d) < 4: d += [0] * (4 - len(d)) # Pad with 0s
        p1 = d[0] ^ d[1] ^ d[3]
        p2 = d[0] ^ d[2] ^ d[3]
        p3 = d[1] ^ d[2] ^ d[3]
        encoded.extend([p1, p2, d[0], p3, d[1], d[2], d[3]])
    return encoded

def hamming_decode(encoded_bits):
    decoded = []
    for i in range(0, len(encoded_bits), 7):
        chunk = encoded_bits[i:i+7]
        if len(chunk) < 7: break
        
        p1, p2, d1, p3, d2, d3, d4 = chunk
        s1 = p1 ^ d1 ^ d2 ^ d4
        s2 = p2 ^ d1 ^ d3 ^ d4
        s3 = p3 ^ d2 ^ d3 ^ d4
        
        error_pos = s1 * 1 + s2 * 2 + s3 * 4
        if error_pos != 0:
            chunk[error_pos - 1] ^= 1 # Correct the error
            
        decoded.extend([chunk[2], chunk[4], chunk[5], chunk[6]])
    return decoded

# --- Interleaving ---
def interleave(bits, seed):
    prng = PRNG(seed)
    indices = list(range(len(bits)))
    # Fisher-Yates
    for i in range(len(indices) - 1, 0, -1):
        j = prng.next() % (i + 1)
        indices[i], indices[j] = indices[j], indices[i]
        
    shuffled = [0] * len(bits)
    for i, b in enumerate(bits):
        shuffled[indices[i]] = b
    return shuffled

def deinterleave(bits, seed):
    prng = PRNG(seed)
    indices = list(range(len(bits)))
    for i in range(len(indices) - 1, 0, -1):
        j = prng.next() % (i + 1)
        indices[i], indices[j] = indices[j], indices[i]
        
    unshuffled = [0] * len(bits)
    for i, idx in enumerate(indices):
        unshuffled[i] = bits[idx]
    return unshuffled

# --- 1D K-Means Thresholding ---
def find_kmeans_threshold(values):
    """Finds optimal decision boundary between two clusters (0-bits and 1-bits)."""
    vals = np.array(values, dtype=np.float32)
    min_v, max_v = float(np.min(vals)), float(np.max(vals))
    if min_v >= max_v:
        return 0.0
    
    c0 = np.percentile(vals, 25)
    c1 = np.percentile(vals, 75)
    if c0 == c1:
        c0, c1 = min_v, max_v
        
    for _ in range(20):
        thresh = (c0 + c1) / 2.0
        cluster0 = vals[vals < thresh]
        cluster1 = vals[vals >= thresh]
        
        new_c0 = float(np.mean(cluster0)) if len(cluster0) > 0 else c0
        new_c1 = float(np.mean(cluster1)) if len(cluster1) > 0 else c1
        
        if abs(new_c0 - c0) < 1e-4 and abs(new_c1 - c1) < 1e-4:
            break
        c0, c1 = new_c0, new_c1
        
    return (c0 + c1) / 2.0

# --- Watermark Math ---
def get_adaptive_margin(dct_block):
    ac_energy = np.sum(np.abs(dct_block)) - abs(dct_block[0, 0])
    normalized = (ac_energy - 500) / 2500.0
    normalized = max(0.0, min(1.0, normalized))
    return MIN_MARGIN + normalized * (MAX_MARGIN - MIN_MARGIN)

def text_to_bits(text):
    bits = []
    for c in text.encode('utf-8'):
        b = bin(c)[2:].zfill(8)
        bits.extend([int(x) for x in b])
    return bits

def bits_to_text(bits):
    chars = []
    for i in range(0, len(bits), 8):
        byte_bits = bits[i:i+8]
        if len(byte_bits) < 8: break
        val = int(''.join(map(str, byte_bits)), 2)
        chars.append(chr(val))
    return ''.join(chars)

# --- Embedding & Extraction ---
def embed_v3(img_path, output_path, payload):
    img = cv2.imread(img_path)
    if img is None: raise Exception("Image not found")
    
    height, width = img.shape[:2]
    pad_h = height - (height % 8)
    pad_w = width - (width % 8)
    img = img[:pad_h, :pad_w]
    
    # Payload prep
    payload_bits = text_to_bits(payload)
    length = len(payload_bits)
    
    # 1. Uninterleaved Header (matches WatermarkUtils.java & verify.js)
    header_raw = list(MAGIC_BITS) + [int(x) for x in bin(length)[2:].zfill(16)]
    ecc_header = hamming_encode(header_raw)
    redundant_header = []
    for _ in range(REDUNDANCY):
        redundant_header.extend(ecc_header)
        
    # 2. Interleaved Payload
    ecc_payload = hamming_encode(payload_bits)
    redundant_payload = []
    for _ in range(REDUNDANCY):
        redundant_payload.extend(ecc_payload)
    interleaved_payload = interleave(redundant_payload, PRNG_SEED)
    
    final_bits = redundant_header + interleaved_payload
    
    num_blocks = (pad_h // 8) * (pad_w // 8)
    if len(final_bits) > num_blocks:
        raise Exception(f"Image too small. Need {len(final_bits)} blocks, have {num_blocks}")
    
    # Spreading (Block selection)
    prng = PRNG(PRNG_SEED)
    block_indices = list(range(num_blocks))
    for i in range(len(block_indices) - 1, 0, -1):
        j = prng.next() % (i + 1)
        block_indices[i], block_indices[j] = block_indices[j], block_indices[i]
        
    embed_sequence = block_indices[:len(final_bits)]
    
    # Multi-Channel Color Conversion (Y, Cb, Cr)
    b, g, r = cv2.split(img.astype(np.float32))
    ycc = np.zeros_like(img, dtype=np.float32)
    ycc[:,:,0] = 0.299 * r + 0.587 * g + 0.114 * b
    ycc[:,:,1] = -0.1687 * r - 0.3313 * g + 0.5 * b + 128
    ycc[:,:,2] = 0.5 * r - 0.4187 * g - 0.0813 * b + 128
    
    blocks_w = pad_w // 8
    
    for i, bit in enumerate(final_bits):
        b_idx = embed_sequence[i]
        by = (b_idx // blocks_w) * 8
        bx = (b_idx % blocks_w) * 8
        
        pair = PAIRS[i % len(PAIRS)]
        c1_idx, c2_idx = pair[0], pair[1]
        
        # Multi-channel embedding: Y (ch 0, 1.0x margin), Cb (ch 1, 0.8x margin), Cr (ch 2, 0.8x margin)
        for ch, ch_scale in [(0, 1.0), (1, 0.8), (2, 0.8)]:
            block = ycc[by:by+8, bx:bx+8, ch]
            dct_block = cv2.dct(block)
            
            margin = get_adaptive_margin(dct_block) * ch_scale
            A = dct_block[c1_idx]
            B = dct_block[c2_idx]
            diff = A - B
            
            if bit == 1:
                if diff < margin:
                    adjust = (margin - diff) / 2.0
                    dct_block[c1_idx] += adjust
                    dct_block[c2_idx] -= adjust
            else:
                if diff > -margin:
                    adjust = (diff - (-margin)) / 2.0
                    dct_block[c1_idx] -= adjust
                    dct_block[c2_idx] += adjust
                    
            ycc[by:by+8, bx:bx+8, ch] = cv2.idct(dct_block)
        
    # Reconstruct RGB
    Y = ycc[:,:,0]
    cb = ycc[:,:,1] - 128
    cr = ycc[:,:,2] - 128
    
    r_new = Y + 1.402 * cr
    g_new = Y - 0.34414 * cb - 0.71414 * cr
    b_new = Y + 1.772 * cb
    
    merged = cv2.merge([b_new, g_new, r_new])
    merged = np.clip(merged, 0, 255).astype(np.uint8)
    
    cv2.imwrite(output_path, merged)
    return final_bits

def extract_v3(img_path, num_bits_expected=None):
    img = cv2.imread(img_path)
    if img is None: raise Exception("Image not found")
    
    height, width = img.shape[:2]
    pad_h = height - (height % 8)
    pad_w = width - (width % 8)
    img = img[:pad_h, :pad_w]
    
    num_blocks = (pad_h // 8) * (pad_w // 8)
    prng = PRNG(PRNG_SEED)
    block_indices = list(range(num_blocks))
    for i in range(len(block_indices) - 1, 0, -1):
        j = prng.next() % (i + 1)
        block_indices[i], block_indices[j] = block_indices[j], block_indices[i]
        
    b, g, r = cv2.split(img.astype(np.float32))
    ycc = np.zeros_like(img, dtype=np.float32)
    ycc[:,:,0] = 0.299 * r + 0.587 * g + 0.114 * b
    ycc[:,:,1] = -0.1687 * r - 0.3313 * g + 0.5 * b + 128
    ycc[:,:,2] = 0.5 * r - 0.4187 * g - 0.0813 * b + 128
    
    blocks_w = pad_w // 8
    
    def get_soft_diff(i):
        b_idx = block_indices[i]
        by = (b_idx // blocks_w) * 8
        bx = (b_idx % blocks_w) * 8
        pair = PAIRS[i % len(PAIRS)]
        c1_idx, c2_idx = pair[0], pair[1]
        
        diff_Y = float(cv2.dct(ycc[by:by+8, bx:bx+8, 0])[c1_idx] - cv2.dct(ycc[by:by+8, bx:bx+8, 0])[c2_idx])
        diff_Cb = float(cv2.dct(ycc[by:by+8, bx:bx+8, 1])[c1_idx] - cv2.dct(ycc[by:by+8, bx:bx+8, 1])[c2_idx])
        diff_Cr = float(cv2.dct(ycc[by:by+8, bx:bx+8, 2])[c1_idx] - cv2.dct(ycc[by:by+8, bx:bx+8, 2])[c2_idx])
        
        return 1.0 * diff_Y + 0.8 * diff_Cb + 0.8 * diff_Cr

    if num_blocks < 392:
        return None, []
        
    header_soft = [get_soft_diff(i) for i in range(392)]
    header_chunk_size = 392 // REDUNDANCY
    header_voted = [sum(header_soft[i + r * header_chunk_size] for r in range(REDUNDANCY)) / REDUNDANCY for i in range(header_chunk_size)]
    
    thresh = find_kmeans_threshold(header_voted)
    header_bits = [1 if v >= thresh else 0 for v in header_voted]
    header_raw = hamming_decode(header_bits)
    
    if header_raw[:16] != MAGIC_BITS:
        header_bits = [1 if v >= 0.0 else 0 for v in header_voted]
        header_raw = hamming_decode(header_bits)
        if header_raw[:16] != MAGIC_BITS:
            raw_hard = [1 if d >= 0 else 0 for d in header_soft]
            return None, raw_hard
            
    length_bits = header_raw[16:32]
    payload_len = int(''.join(map(str, length_bits)), 2)
    
    payload_ecc_len = ((payload_len + 3) // 4) * 7
    payload_redundant_len = payload_ecc_len * REDUNDANCY
    
    if 392 + payload_redundant_len > num_blocks:
        return None, []
        
    payload_soft = [get_soft_diff(392 + i) for i in range(payload_redundant_len)]
    deinterleaved_soft = deinterleave(payload_soft, PRNG_SEED)
    
    payload_voted = [sum(deinterleaved_soft[i + r * payload_ecc_len] for r in range(REDUNDANCY)) / REDUNDANCY for i in range(payload_ecc_len)]
    p_thresh = find_kmeans_threshold(payload_voted)
    payload_ecc_bits = [1 if v >= p_thresh else 0 for v in payload_voted]
    payload_raw = hamming_decode(payload_ecc_bits)
    
    all_raw_hard = [1 if d >= 0 else 0 for d in (header_soft + payload_soft)]
    return bits_to_text(payload_raw[:payload_len]), all_raw_hard

# --- Benchmarking ---
def benchmark():
    original = "original.jpg"
    if not os.path.exists(original):
        print(f"Creating dummy {original}")
        dummy = np.random.randint(0, 256, (1080, 1920, 3), dtype=np.uint8)
        cv2.imwrite(original, dummy)
        
    watermarked = "v3_watermarked.png"
    payload = "proofKrypt-9876543210"
    
    print(f"Embedding v3 Watermark (Multi-Channel + Soft Averaging): {payload}")
    ground_truth_bits = embed_v3(original, watermarked, payload)
    
    qualities = [100, 95, 90, 80, 70, 60, 50, 40]
    
    print("\n--- BENCHMARK RESULTS ---")
    print(f"{'Quality':<10} | {'BER (Raw)':<15} | {'Extracted Text':<20}")
    print("-" * 50)
    
    for q in qualities:
        test_img = f"test_q{q}.jpg"
        img = cv2.imread(watermarked)
        cv2.imwrite(test_img, img, [int(cv2.IMWRITE_JPEG_QUALITY), q])
        
        try:
            extracted_text, raw_extracted = extract_v3(test_img, len(ground_truth_bits))
            errors = sum(1 for a, b in zip(ground_truth_bits, raw_extracted) if a != b)
            ber = errors / len(ground_truth_bits)
            
            text_disp = extracted_text if extracted_text else "[FAILED TO DECODE]"
            print(f"JPEG {q:<5} | {ber:.4f} ({errors:4d} err) | {text_disp}")
        except Exception as e:
            print(f"JPEG {q:<5} | ERROR           | {str(e)}")
            
if __name__ == "__main__":
    benchmark()

