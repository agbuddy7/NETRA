# NETRA — Image Provenance System

**NETRA** is a full-stack image provenance and authenticity verification system that proves a photograph was captured by a real physical camera at a specific moment in time — even after social media platforms strip all metadata and aggressively compress the image.

Unlike metadata-based approaches (EXIF, Adobe C2PA) that are permanently destroyed when a photo is shared on WhatsApp, Twitter, Instagram, or Telegram, NETRA embeds verification directly into the image pixels themselves using two independent, complementary techniques:

1. **Invisible DCT Frequency Watermarking** — A cryptographic payload is embedded into the Discrete Cosine Transform coefficients across 3 color channels (Y, Cb, Cr) with 7x redundancy and Hamming(7,4) error correction. Survives JPEG compression up to ~85% quality.

2. **64-Star Geometric Constellation Hashing** — A resolution-invariant spatial fingerprint is computed from the image's luminance structure using an 8×8 grid of brightness peaks. Survives aggressive resizing, re-encoding, and even screenshots.

The original photo never leaves the device — only a lightweight mathematical signature (author, device model, timestamp) is registered to a global database.

---

## Live Demo

| Resource | Link |
| :--- | :--- |
| **Web Inspector** | [netra-star.vercel.app](https://netra-star.vercel.app/) |
| **Android APK** | [`app-debug.apk`](app-debug.apk) (Direct download from this repo) |

---

## The Problem

Every social media platform strips EXIF metadata and re-encodes images on upload:

| Platform | EXIF Stripped | Image Re-encoded | C2PA Manifest Preserved |
| :--- | :---: | :---: | :---: |
| WhatsApp | Yes | Yes (heavy JPEG) | No |
| Twitter / X | Yes | Yes | No |
| Instagram | Yes | Yes | No |
| Telegram | Yes | Yes (unless sent as file) | No |
| Reddit | Yes | Yes | No |

This means existing standards like **Adobe Content Credentials (C2PA)** and raw EXIF-based provenance are destroyed the moment a photo enters the real-world internet. There is no way to verify that a photo received on social media is authentic, unmodified, or AI-generated.

**NETRA bridges this gap** by embedding proof *inside the pixels* where it cannot be stripped by platform processing pipelines.

---

## How It Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    ANDROID DEVICE                       │
│                                                         │
│  ┌──────────┐    ┌──────────────────┐    ┌───────────┐  │
│  │  CameraX  │──▶│ DCT Watermark    │──▶│ Save to   │  │
│  │  Capture  │   │ Embedding (Y+Cb  │   │ Gallery   │  │
│  │           │   │ +Cr, 7x redund.) │   │ (PNG)     │  │
│  └──────────┘    └──────────────────┘    └───────────┘  │
│                          │                              │
│                          ▼                              │
│               ┌──────────────────┐                      │
│               │ 64-Star Geomet.  │                      │
│               │ Constellation    │                      │
│               │ Extraction       │                      │
│               └────────┬─────────┘                      │
│                        │                                │
│                        ▼                                │
│              ┌───────────────────┐                      │
│              │  Upload Signature │ (author, device,     │
│              │  to Supabase DB   │  timestamp, stars)   │
│              └───────────────────┘                      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  GLOBAL DATABASE                        │
│              (Supabase / PostgreSQL)                    │
│                                                         │
│  ┌────────────────────────────────────────────────────┐ │
│  │ image_id │ author │ device │ timestamp │ constell. │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  WEB INSPECTOR                          │
│            (Browser-Side Verification)                  │
│                                                         │
│   Upload Image ──▶ Extract DCT Watermark               │
│                  ──▶ Extract Constellation              │
│                  ──▶ Query Database                     │
│                  ──▶ 3-Tier Match Result                │
│                                                         │
│   Tier 1: Exact Watermark Match (100%)                  │
│   Tier 2: Fuzzy Soft-Averaging Match (≥80%)             │
│   Tier 3: Constellation Fallback (≥75%)                 │
└─────────────────────────────────────────────────────────┘
```

### Watermark Embedding (DCT Domain)

1. The image is divided into non-overlapping 8×8 pixel blocks.
2. A deterministic PRNG (seeded with a fixed key) selects which blocks carry watermark data.
3. For each payload bit, the DCT coefficients of two mid-frequency positions are modified:
   - Bit `1` → Force `Coeff_A > Coeff_B` by a margin
   - Bit `0` → Force `Coeff_B > Coeff_A` by a margin
4. This is repeated across **3 color channels** (Y, Cb, Cr) and **7 redundant copies** per bit.
5. A 16-bit magic header (`PK` = `0x50 0x4B`) prefixes the payload for validation.
6. **Hamming(7,4)** error-correcting codes protect each 4-bit nibble against single-bit flips from JPEG quantization.

### Watermark Extraction (Web Inspector)

1. The browser-side JavaScript performs a full 2D DCT on each 8×8 block.
2. Instead of hard majority voting, **soft-decision averaging** accumulates the raw differential `Δ = Coeff_A - Coeff_B` across all redundant copies and channels.
3. The averaged analog score is thresholded to recover each bit.
4. Hamming decoding corrects single-bit errors per codeword.
5. The magic header is validated; if present, the payload string is extracted.

### Geometric Constellation Hashing

1. The image is divided into an 8×8 grid (64 cells).
2. Within each cell, the pixel with the highest luminance value is selected as a "star."
3. The (x, y) coordinates are normalized to `[0, 1]` (resolution-invariant).
4. This produces a 64-element array of `{x, y, brightness}` — the **constellation signature**.
5. During verification, constellations are compared using average Euclidean drift across all 64 stars.

---

## Project Structure

```
proofKrypt/
├── MyApplication/                    # Android App (Java)
│   ├── app/src/main/java/.../
│   │   ├── MainActivity.java         # CameraX capture, watermark embedding, DB upload
│   │   └── WatermarkUtils.java       # DCT watermark embed/extract, constellation extraction
│   ├── app/src/main/res/
│   │   ├── layout/activity_main.xml  # Camera UI layout
│   │   └── values/strings.xml        # App name: "NETRA"
│   └── app/build.gradle.kts          # Android SDK 24–36, CameraX dependencies
│
├── server/                           # Backend API (Node.js + Express)
│   ├── server.js                     # /register and /verify endpoints
│   └── database.js                   # Supabase (PostgreSQL) client
│
├── index.html                        # Web Inspector frontend
├── style.css                         # Monochrome black & white design system
├── verify.js                         # Browser-side DCT extraction, constellation
│                                     # comparison, fuzzy matching, DB queries
│
├── watermark_test/                   # Python prototyping & testing scripts
│   ├── v3_prototype.py               # Reference DCT implementation (NumPy/SciPy)
│   ├── embed.py                      # Standalone watermark embedding test
│   └── extract.py                    # Standalone watermark extraction test
│
├── constellation_demo/               # Standalone constellation visualization demo
│
└── app-debug.apk                     # Pre-built Android APK (ready to install)
```

---

## Quick Start

### 1. Install the Android App

1. Download **`app-debug.apk`** from this repository (or from the [web inspector](https://netra-star.vercel.app/)).
2. Transfer to your Android device and install (enable "Install from Unknown Sources" if prompted).
3. Open the app and grant **Camera** permissions.

### 2. Capture & Register a Photo

1. The app opens directly to the camera viewfinder.
2. Tap the capture button to take a photo.
3. NETRA automatically:
   - Embeds an invisible DCT watermark into the image
   - Extracts the 64-star geometric constellation
   - Registers the signature (author, device, timestamp) to the global database
4. The watermarked photo is saved to your gallery — visually identical to the original.

### 3. Test the Compression Survival

1. Send the photo to yourself via **WhatsApp** (which compresses and strips metadata).
2. Download the compressed photo back to your PC.
3. Go to the [NETRA Web Inspector](https://netra-star.vercel.app/).
4. Drag and drop the compressed photo.
5. Click **VERIFY AGAINST GLOBAL REGISTRY**.
6. The inspector will display the verification result with author, device, and timestamp.

---

## Verification Tiers

The web inspector uses a 3-tier matching system to maximize verification resilience:

| Tier | Method | Threshold | When It Fires |
| :--- | :--- | :---: | :--- |
| **Tier 1** | Exact Watermark Match | 100% | Watermark perfectly preserved (original PNG or light compression) |
| **Tier 2** | Fuzzy Soft-Decision Match | ≥ 80% | Watermark partially corrupted by JPEG compression, recovered via Levenshtein similarity |
| **Tier 3** | Geometric Constellation Fallback | ≥ 75% | Watermark completely destroyed by aggressive resizing/screenshots, but spatial structure intact |

---

## Database Schema

The `signatures` table in Supabase (PostgreSQL):

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `SERIAL PRIMARY KEY` | Auto-increment row ID |
| `image_id` | `TEXT` | Unique identifier (e.g., `ANDROID-1729123456789`) |
| `author` | `TEXT` | Photographer identity (set in the Android app) |
| `device_model` | `TEXT` | Hardware model from `android.os.Build.MODEL` |
| `timestamp` | `TEXT` | ISO 8601 UTC timestamp at capture time |
| `constellation_data` | `TEXT` | JSON array of 64 stars OR the watermark payload string |
| `created_at` | `TIMESTAMPTZ` | Server-side insertion timestamp |

---

## Privacy

- The **original photo never leaves the device**. Only a lightweight mathematical signature is uploaded.
- No biometric data, GPS coordinates, or image pixels are stored on the server.
- The watermark is **imperceptible** — zero visible quality degradation to the human eye.
- The signature contains only: author name, device model, and timestamp.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Android App** | Java, CameraX, ARGB Bitmap processing |
| **Watermark Engine** | Custom 2D DCT (8×8 block), Hamming(7,4) ECC, 3-channel Y+Cb+Cr embedding |
| **Constellation Engine** | 8×8 grid luminance peak extraction, normalized coordinate hashing |
| **Web Inspector** | Vanilla HTML/CSS/JS, browser-side DCT extraction, Supabase REST API |
| **Database** | Supabase (PostgreSQL) |
| **Backend API** | Node.js, Express.js |
| **Deployment** | Vercel (frontend), Supabase (database) |

---

## Competitors & Differentiation

| Feature | C2PA (Adobe) | Truepic | Numbers Protocol | ProofMode | **NETRA** |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Survives EXIF stripping | No | Partial | No | No | **Yes** |
| Survives JPEG compression | No | Partial | No | No | **Yes** |
| Survives resizing / screenshots | No | No | No | No | **Yes (Constellation)** |
| No blockchain / wallet needed | Yes | Yes | No | Yes | **Yes** |
| Free public web verifier | Limited | No | Limited | No | **Yes** |

---

## Known Limitations

- **Orientation Sensitivity:** The constellation hash is orientation-dependent. If a photo is auto-rotated by the OS, the constellation may not match. Rotating the image 90° before verification can resolve this.
- **Heavy Cropping:** If more than ~30% of the image is cropped, both the watermark and constellation may fail.
- **Author Name:** Currently hardcoded as a constant in the Android app (`CAPTURED_BY`). A future update will allow user-configurable author identity.
- **Android Only:** No iOS client yet.

---

## License

This project is proprietary. All rights reserved.
