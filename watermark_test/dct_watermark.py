import cv2
import numpy as np
import sys

def text_to_bits(text):
    bits = bin(int.from_bytes(text.encode('utf-8'), 'big'))[2:]
    return [int(b) for b in bits.zfill(8 * ((len(bits) + 7) // 8))]

def bits_to_text(bits):
    n = int(''.join(map(str, bits)), 2)
    try:
        return n.to_bytes((n.bit_length() + 7) // 8, 'big').decode('utf-8')
    except:
        return "<corrupted string>"

def embed_dct(image_path, output_path, payload, alpha=30.0):
    print(f"--- Embedding DCT Watermark ---")
    img = cv2.imread(image_path)
    if img is None:
        print("Could not read image")
        return 0
        
    watermark_bits = text_to_bits(payload)
    
    # We embed the watermark in the luminance (Y) channel for robustness
    img_yuv = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
    y_channel = np.float32(img_yuv[:,:,0])
    
    h, w = y_channel.shape
    
    # Ensure dimensions are multiples of 8 for DCT blocks
    h_pad = h - (h % 8)
    w_pad = w - (w % 8)
    y_channel = y_channel[:h_pad, :w_pad]
    
    watermarked_y = np.copy(y_channel)
    
    idx = 0
    max_capacity = (h_pad // 8) * (w_pad // 8)
    if len(watermark_bits) > max_capacity:
        print(f"Warning: Payload ({len(watermark_bits)} bits) is too large for image capacity ({max_capacity} bits)")
        
    # Process 8x8 blocks
    for i in range(0, h_pad, 8):
        for j in range(0, w_pad, 8):
            if idx >= len(watermark_bits):
                break
                
            block = y_channel[i:i+8, j:j+8]
            dct_block = cv2.dct(block)
            
            # Modify a mid-frequency coefficient. (4, 4) is a good balance between robustness and imperceptibility.
            coeff = dct_block[4, 4]
            bit = watermark_bits[idx]
            
            # Quantization embedding (alpha controls the strength/robustness)
            q = round(coeff / alpha)
            if bit == 1:
                if q % 2 == 0: q += 1
            else:
                if q % 2 != 0: q += 1
                
            dct_block[4, 4] = q * alpha
            
            idct_block = cv2.idct(dct_block)
            watermarked_y[i:i+8, j:j+8] = idct_block
            idx += 1
            
    img_yuv[:h_pad, :w_pad, 0] = np.clip(watermarked_y, 0, 255)
    final_img = cv2.cvtColor(img_yuv, cv2.COLOR_YCrCb2BGR)
    
    cv2.imwrite(output_path, final_img)
    print(f"Embedded {len(watermark_bits)} bits into {output_path}")
    print(f"IMPORTANT: Run extractor with length: {len(watermark_bits)}")
    return len(watermark_bits)

def extract_dct(image_path, length, alpha=30.0):
    print(f"\n--- Extracting DCT Watermark from {image_path} ---")
    img = cv2.imread(image_path)
    if img is None:
        print("Could not read image")
        return
        
    img_yuv = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
    y_channel = np.float32(img_yuv[:,:,0])
    
    h, w = y_channel.shape
    h_pad = h - (h % 8)
    w_pad = w - (w % 8)
    
    extracted_bits = []
    idx = 0
    
    for i in range(0, h_pad, 8):
        for j in range(0, w_pad, 8):
            if idx >= length:
                break
                
            block = y_channel[i:i+8, j:j+8]
            dct_block = cv2.dct(block)
            
            coeff = dct_block[4, 4]
            q = round(coeff / alpha)
            
            if q % 2 == 0:
                extracted_bits.append(0)
            else:
                extracted_bits.append(1)
                
            idx += 1
            
    payload = bits_to_text(extracted_bits)
    print(f"Extracted Payload: '{payload}'")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  To embed:  python dct_watermark.py embed <input.jpg> <output.png> 'my secret'")
        print("  To extract: python dct_watermark.py extract <image.jpg> <bit_length>")
        sys.exit(1)
        
    mode = sys.argv[1]
    
    # You can tweak this. Higher = more robust but more visible artifacts.
    # Lower = less visible but breaks easily under JPEG compression.
    STRENGTH = 30.0 
    
    if mode == "embed":
        if len(sys.argv) != 5:
            print("Missing args for embed")
            sys.exit(1)
        embed_dct(sys.argv[2], sys.argv[3], sys.argv[4], alpha=STRENGTH)
        
    elif mode == "extract":
        if len(sys.argv) != 4:
            print("Missing args for extract")
            sys.exit(1)
        extract_dct(sys.argv[2], int(sys.argv[3]), alpha=STRENGTH)
