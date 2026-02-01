# NETRA: The Global Registry of Authentic Imagery

NETRA is a comprehensive image provenance system designed to combat the rise of Deepfakes and Generative AI. Unlike hardware-based solutions that require new cameras, NETRA works on existing smartphones. By extracting a unique "Celestial Signature" (a geometric luminance map) from a photo the moment it is captured, NETRA creates a digital fingerprint stored in a global database.

---

## Live Demo

*   **Web Verifier:** https://netra-star.vercel.app/
*   **Backend API:** https://netra-1.onrender.com (Live on Render)

---

## Features

*   **Snap-to-Sign (Android App):** Automatically captures photos and processes them locally on-device. The raw image never leaves the phone—only the mathematical signature is uploaded.
*   **Geometric Constellation Hashing:** Uses a specialized computer vision algorithm to extract the "brightest stars" (luminance peaks) in an 8x8 grid.
*   **Zero-Knowledge Integrity:** No biometric data or full image files are ever stored on the server.
*   **Global Registry:** Signatures are instantly verifiable via the public web portal.

---

## Tech Stack

*   **Mobile:** Android (Java), ContentObserver, OkHttp.
*   **Backend:** Node.js, Express.js (Deployed on Render).
*   **Database:** PostgreSQL.
*   **Frontend:** HTML5/JS (Deployed on Vercel).
*   **Algorithm:** Custom Luminance Keypoint Extraction.

---

## How to Test (Step-by-Step)

### 1. Install the App
Since the backend and frontend are already live, you only need to install the **Android Client**.

1.  Download the **`app-debug.apk`** file from this repository.
2.  Transfer it to your Android device (or download directly on your phone).
3.  Tap to install (Allow "Install from Unknown Sources" if prompted).
4.  Open the app and grant **Camera** and **Files/Media** permissions.

### 2. Capture & Register
1.  Keep the NETRA app open or in the background.
2.  Open your phone's native **Camera App**.
3.  Take a photo.
4.  Watch for a notification from NETRA:
    *   "Processing photo..."
    *   "Files Generated"

### 3. Verify on Web
1.  Go to the [NETRA Web Verifier](https://netra-star.vercel.app/).
2.  Upload the photo.
3.  Click **Verify**.

---

## Generated Files (For Debugging)

For transparency, the app saves intermediate data on your phone's internal storage. You can inspect these to understand how the signature is created.

**Location:** Internal Storage > Android > data > com.example.myapplication > files > PhotoProvenance

You will find two types of files for every photo:

1.  **constellation_[ID].json**
    *   **What is it?** This is the "Celestial Signature."
    *   **Content:** An array of 64 coordinates (x, y, brightness) representing the geometric hash of your image. This is what gets sent to the server.

2.  **pixel_strands_[ID].txt**
    *   **What is it?** Raw sensor data validation.
    *   **Content:** Analyzing specific vertical lines of pixels to ensure the image came from a real sensor and wasn't pasted/edited at a bit-level.

---

## Important Usage Notes

### Rotation Sensitivity
The geometric hash is currently **orientation-sensitive**.
*   Android phones often save photos internally as "Landscape" with a metadata flag to "Rotate 90 degrees."
*   If the Web Verifier says **"No Match"** for a valid photo, try **rotating the image 90 degrees** (left or right) on your computer and uploading it again.
*   Future Update: We are working on auto-rotation normalization for v2.0.

### Network Requirements
*   The app requires an active Internet connection to register signatures.
*   If you are offline, the app will process the local files but fail to upload to the global database.

---

## Security

*   **Protection:** The 8x8 Geometric Hash is resilient to compression (JPEG artifacts) and resizing but fails when structural elements (faces, objects) are moved or AI-generated patches are added.
*   **Anti-Bias:** The algorithm relies purely on luminance values (physics), ensuring it works equally well across all demographics and scenes without bias.

---



## License

Distributed under the MIT License.

---

NETRA Team - Securing Reality, One Pixel at a Time.
