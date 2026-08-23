import sys
try:
    from blind_watermark import WaterMark
except ImportError:
    print("Please install the library first: pip install blind-watermark opencv-python")
    sys.exit(1)
import cv2
import numpy as np

def create_sample_image(filename):
    print(f"Creating a sample image: {filename}")
    img = np.zeros((512, 512, 3), np.uint8)
    img[:] = (200, 210, 220) 
    cv2.putText(img, 'Original Image', (150, 256), cv2.FONT_HERSHEY_SIMPLEX, 1, (50, 50, 50), 2)
    cv2.imwrite(filename, img)

def embed_watermark(input_img, output_img, payload):
    print(f"--- Embedding Watermark ---")
    bwm = WaterMark(password_img=1, password_wm=1)
    bwm.read_img(input_img)
    bwm.read_wm(payload, mode='str')
    bwm.embed(output_img)
    
    len_wm = len(bwm.wm_bit)
    print(f"Success! Watermark embedded into '{output_img}'.")
    print(f"=========================================================")
    print(f" IMPORTANT: Run the extractor using this exact length: {len_wm}")
    print(f" Command: python extract.py {output_img} {len_wm}")
    print(f"=========================================================")

if __name__ == "__main__":
    original = 'original.jpg'
    watermarked = 'watermarked.png'
    secret_payload = "ProofKrypt-Device-12345"
    
    create_sample_image(original)
    embed_watermark(original, watermarked, secret_payload)
