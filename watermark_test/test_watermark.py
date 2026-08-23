import os
try:
    from blind_watermark import WaterMark
except ImportError:
    print("Please install the library first: pip install blind-watermark opencv-python")
    exit(1)
import cv2
import numpy as np

def create_sample_image(filename):
    # Create a simple 512x512 image for testing
    img = np.zeros((512, 512, 3), np.uint8)
    # Fill with a gradient or solid color
    img[:] = (200, 210, 220) 
    cv2.putText(img, 'Original Image', (150, 256), cv2.FONT_HERSHEY_SIMPLEX, 1, (50, 50, 50), 2)
    cv2.imwrite(filename, img)
    print(f"Created sample image: {filename}")

def embed_watermark(input_img, output_img, payload):
    print(f"\n--- Embedding Watermark ---")
    # password_img and password_wm act as the secret keys for embedding and extracting
    bwm = WaterMark(password_img=1, password_wm=1)
    bwm.read_img(input_img)
    bwm.read_wm(payload, mode='str')
    bwm.embed(output_img)
    
    # We need to remember the length of the watermark bits to extract it later
    len_wm = len(bwm.wm_bit)
    print(f"Success! Watermark embedded into '{output_img}'.")
    print(f"IMPORTANT: Store this watermark length for extraction: {len_wm}")
    return len_wm

def verify_watermark(watermarked_img, len_wm):
    print(f"\n--- Extracting Watermark ---")
    bwm_extract = WaterMark(password_img=1, password_wm=1)
    # Extract using the exact same passwords and the length of the bits
    extracted_data = bwm_extract.extract(watermarked_img, wm_shape=len_wm, mode='str')
    print(f"Extracted Payload: '{extracted_data}'")
    return extracted_data

if __name__ == "__main__":
    original = 'original.jpg'
    watermarked = 'watermarked.png'
    secret_payload = "ProofKrypt-Device-12345"
    
    # 1. Create a dummy image to test on
    create_sample_image(original)
    
    # 2. Embed the watermark
    bit_length = embed_watermark(original, watermarked, secret_payload)
    
    # 3. Verify and extract the watermark
    verify_watermark(watermarked, bit_length)
