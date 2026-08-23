import sys
try:
    from blind_watermark import WaterMark
except ImportError:
    print("Please install the library first: pip install blind-watermark opencv-python")
    sys.exit(1)

def verify_watermark(watermarked_img, len_wm):
    print(f"\n--- Extracting Watermark from '{watermarked_img}' ---")
    bwm_extract = WaterMark(password_img=1, password_wm=1)
    try:
        extracted_data = bwm_extract.extract(watermarked_img, wm_shape=len_wm, mode='str')
        print(f"\n✅ Extracted Payload: '{extracted_data}'\n")
    except Exception as e:
        print(f"\n❌ Failed to extract watermark. Error: {e}\n")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python extract.py <image_path> <watermark_length>")
        print("Example: python extract.py watermarked.png 183")
        sys.exit(1)
        
    image_path = sys.argv[1]
    bit_length = int(sys.argv[2])
    
    verify_watermark(image_path, bit_length)
