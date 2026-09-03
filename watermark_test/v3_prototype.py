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

# --- Watermark Math ---
def get_adaptive_margin(dct_block):
    # AC Energy (sum of absolute AC coefficients)
    # Exclude DC component (0,0)
    ac_energy = np.sum(np.abs(dct_block)) - abs(dct_block[0, 0])
    
    # Map energy to margin. 
    # Let's say energy < 500 is flat, energy > 3000 is highly textured
    # We map [500, 3000] -> [MIN_MARGIN, MAX_MARGIN]
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
    length_bits = [int(x) for x in bin(len(payload_bits))[2:].zfill(16)]
    raw_payload = MAGIC_BITS + length_bits + payload_bits
    
    # ECC & Redundancy
    ecc_bits = hamming_encode(raw_payload)
    
    # Interleaving & Spreading (with redundancy interleaved)
    # Instead of doing chunk * REDUNDANCY then interleaving, we can
    # duplicate bits and then interleave the whole stream.
    redundant_bits = ecc_bits * REDUNDANCY
    interleaved_bits = interleave(redundant_bits, PRNG_SEED)
    
    num_blocks = (pad_h // 8) * (pad_w // 8)
    if len(interleaved_bits) > num_blocks:
        raise Exception(f"Image too small. Need {len(interleaved_bits)} blocks, have {num_blocks}")
    
    # Spreading (Block selection)
    prng = PRNG(PRNG_SEED)
    block_indices = list(range(num_blocks))
    for i in range(len(block_indices) - 1, 0, -1):
        j = prng.next() % (i + 1)
        block_indices[i], block_indices[j] = block_indices[j], block_indices[i]
        
    embed_sequence = block_indices[:len(interleaved_bits)]
    
    # Color conversion
    ycc = np.zeros_like(img, dtype=np.float32)
    b, g, r = cv2.split(img.astype(np.float32))
    ycc[:,:,0] = 0.299 * r + 0.587 * g + 0.114 * b
    ycc[:,:,1] = -0.1687 * r - 0.3313 * g + 0.5 * b + 128
    ycc[:,:,2] = 0.5 * r - 0.4187 * g - 0.0813 * b + 128
    
    Y = ycc[:,:,0]
    
    # Embed
    blocks_w = pad_w // 8
    
    for i, bit in enumerate(interleaved_bits):
        b_idx = embed_sequence[i]
        by = (b_idx // blocks_w) * 8
        bx = (b_idx % blocks_w) * 8
        
        block = Y[by:by+8, bx:bx+8]
        dct_block = cv2.dct(block)
        
        margin = get_adaptive_margin(dct_block)
        pair = PAIRS[i % len(PAIRS)]
        c1_idx, c2_idx = pair[0], pair[1]
        
        A = dct_block[c1_idx]
        B = dct_block[c2_idx]
        
        diff = A - B
        if bit == 1:
            if diff < margin:
                adjust = (margin - diff) / 2.0
                dct_block[c1_idx] += adjust
                dct_block[c2_idx] -= adjust
        else:
            # bit 0: B - A >= margin -> A - B <= -margin
            if diff > -margin:
                adjust = (diff - (-margin)) / 2.0
                dct_block[c1_idx] -= adjust
                dct_block[c2_idx] += adjust
                
        Y[by:by+8, bx:bx+8] = cv2.idct(dct_block)
        
    # Reconstruct RGB
    r_new = Y + 1.402 * (ycc[:,:,2] - 128)
    g_new = Y - 0.34414 * (ycc[:,:,1] - 128) - 0.71414 * (ycc[:,:,2] - 128)
    b_new = Y + 1.772 * (ycc[:,:,1] - 128)
    
    merged = cv2.merge([b_new, g_new, r_new])
    merged = np.clip(merged, 0, 255).astype(np.uint8)
    
    cv2.imwrite(output_path, merged)
    return interleaved_bits # Return for ground-truth comparison

def extract_v3(img_path, num_bits_expected):
    img = cv2.imread(img_path)
    if img is None: raise Exception("Image not found")
    
    height, width = img.shape[:2]
    pad_h = height - (height % 8)
    pad_w = width - (width % 8)
    img = img[:pad_h, :pad_w]
    
    # Spreading (Block selection)
    num_blocks = (pad_h // 8) * (pad_w // 8)
    prng = PRNG(PRNG_SEED)
    block_indices = list(range(num_blocks))
    for i in range(len(block_indices) - 1, 0, -1):
        j = prng.next() % (i + 1)
        block_indices[i], block_indices[j] = block_indices[j], block_indices[i]
        
    embed_sequence = block_indices[:num_bits_expected]
    
    b, g, r = cv2.split(img.astype(np.float32))
    Y = 0.299 * r + 0.587 * g + 0.114 * b
    
    blocks_w = pad_w // 8
    
    extracted_bits = []
    
    for i in range(num_bits_expected):
        b_idx = embed_sequence[i]
        by = (b_idx // blocks_w) * 8
        bx = (b_idx % blocks_w) * 8
        
        block = Y[by:by+8, bx:bx+8]
        dct_block = cv2.dct(block)
        
        pair = PAIRS[i % len(PAIRS)]
        A = dct_block[pair[0]]
        B = dct_block[pair[1]]
        
        extracted_bits.append(1 if A > B else 0)
        
    # Recovery
    deinterleaved = deinterleave(extracted_bits, PRNG_SEED)
    
    # Majority voting across REDUNDANCY copies
    voted = []
    chunk_size = len(deinterleaved) // REDUNDANCY
    for i in range(chunk_size):
        votes = sum([deinterleaved[i + r * chunk_size] for r in range(REDUNDANCY)])
        voted.append(1 if votes > (REDUNDANCY // 2) else 0)
        
    # ECC Decode
    payload_raw = hamming_decode(voted)
    
    # Parsing
    magic = payload_raw[:16]
    if magic != MAGIC_BITS:
        return None, extracted_bits
        
    length_bits = payload_raw[16:32]
    length = int(''.join(map(str, length_bits)), 2)
    
    payload = payload_raw[32:32+length]
    return bits_to_text(payload), extracted_bits

# --- Benchmarking ---
def benchmark():
    original = "original.jpg" # Make sure this exists in cwd
    if not os.path.exists(original):
        # Create a dummy image if original doesn't exist
        print(f"Creating dummy {original}")
        dummy = np.random.randint(0, 256, (1080, 1920, 3), dtype=np.uint8)
        cv2.imwrite(original, dummy)
        
    watermarked = "v3_watermarked.png"
    payload = "proofKrypt-9876543210"
    
    print(f"Embedding v3 Watermark: {payload}")
    ground_truth_interleaved = embed_v3(original, watermarked, payload)
    
    qualities = [100, 95, 90, 80, 70, 60, 50, 40]
    
    print("\n--- BENCHMARK RESULTS ---")
    print(f"{'Quality':<10} | {'BER (Raw)':<15} | {'Extracted Text':<20}")
    print("-" * 50)
    
    for q in qualities:
        test_img = f"test_q{q}.jpg"
        img = cv2.imread(watermarked)
        cv2.imwrite(test_img, img, [int(cv2.IMWRITE_JPEG_QUALITY), q])
        
        try:
            extracted_text, raw_extracted = extract_v3(test_img, len(ground_truth_interleaved))
            
            # Calculate BER on raw interleaved bits
            errors = sum(1 for a, b in zip(ground_truth_interleaved, raw_extracted) if a != b)
            ber = errors / len(ground_truth_interleaved)
            
            text_disp = extracted_text if extracted_text else "[FAILED TO DECODE]"
            print(f"JPEG {q:<5} | {ber:.4f} ({errors:4d} err) | {text_disp}")
        except Exception as e:
            print(f"JPEG {q:<5} | ERROR           | {str(e)}")
            
if __name__ == "__main__":
    benchmark()
