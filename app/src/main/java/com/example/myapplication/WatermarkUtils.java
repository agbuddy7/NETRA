package com.example.myapplication;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

public class WatermarkUtils {
    private static final String TAG = "WatermarkUtils";
    private static final double ALPHA = 30.0;

    // Embed coefficient position — (3,1) survives JPEG much better than (4,4)
    private static final int COEFF_U = 3;
    private static final int COEFF_V = 1;

    // Each payload bit is embedded N times; extraction uses majority vote
    private static final int REDUNDANCY = 7;

    // Magic marker "PK" (0x50, 0x4B) = 16 bits, used to detect if image is watermarked
    private static final int[] MAGIC_BITS = {
        0,1,0,1,0,0,0,0,  // 0x50 = 'P'
        0,1,0,0,1,0,1,1   // 0x4B = 'K'
    };

    // Precomputed cosine table for 8x8 DCT (performance)
    private static final double[][] COS_TABLE = new double[8][8];
    static {
        for (int n = 0; n < 8; n++) {
            for (int k = 0; k < 8; k++) {
                COS_TABLE[n][k] = Math.cos((2.0 * n + 1.0) * k * Math.PI / 16.0);
            }
        }
    }
    private static final double C0 = 1.0 / Math.sqrt(2.0);

    // Convert string to bit list
    private static List<Integer> textToBits(String text) {
        List<Integer> bits = new ArrayList<>();
        byte[] bytes = text.getBytes();
        for (byte b : bytes) {
            for (int i = 7; i >= 0; i--) {
                bits.add((b >> i) & 1);
            }
        }
        return bits;
    }

    /**
     * Build the full bitstream: [16-bit magic "PK"] [16-bit length] [payload bits]
     */
    private static List<Integer> buildBitstream(String payload) {
        List<Integer> payloadBits = textToBits(payload);
        int length = payloadBits.size();

        List<Integer> stream = new ArrayList<>();

        // 1. Magic marker (16 bits)
        for (int b : MAGIC_BITS) {
            stream.add(b);
        }

        // 2. Length header (16 bits, big-endian)
        for (int i = 15; i >= 0; i--) {
            stream.add((length >> i) & 1);
        }

        // 3. Payload
        stream.addAll(payloadBits);

        return stream;
    }

    public static Bitmap embedDCTWatermark(Bitmap src, String payload) {
        Log.d(TAG, "Starting DCT Watermark Embedding (v2 — redundancy + marker)...");
        long startTime = System.currentTimeMillis();

        int width = src.getWidth();
        int height = src.getHeight();

        int padWidth = width - (width % 8);
        int padHeight = height - (height % 8);

        // Batch pixel read (much faster than getPixel per pixel)
        int[] allPixels = new int[width * height];
        src.getPixels(allPixels, 0, width, 0, 0, width, height);

        // Build full bitstream with header
        List<Integer> bitstream = buildBitstream(payload);

        // With redundancy, each logical bit uses REDUNDANCY blocks
        int totalBlocksNeeded = bitstream.size() * REDUNDANCY;
        int maxBlocks = (padWidth / 8) * (padHeight / 8);

        if (totalBlocksNeeded > maxBlocks) {
            Log.w(TAG, "Payload too large! Need " + totalBlocksNeeded + " blocks, have " + maxBlocks);
            // Truncate if necessary — embed as many bits as we can
        }

        int logicalBitIdx = 0;
        int redundancyIdx = 0;
        double[][] block = new double[8][8];

        for (int by = 0; by < padHeight; by += 8) {
            for (int bx = 0; bx < padWidth; bx += 8) {
                if (logicalBitIdx >= bitstream.size()) break;

                // --- Read 8x8 block: extract Y, Cb, Cr per pixel ---
                double[][] yBlock = new double[8][8];
                double[][] cbBlock = new double[8][8];
                double[][] crBlock = new double[8][8];

                for (int i = 0; i < 8; i++) {
                    for (int j = 0; j < 8; j++) {
                        int pixel = allPixels[(by + i) * width + (bx + j)];
                        int r = Color.red(pixel);
                        int g = Color.green(pixel);
                        int b = Color.blue(pixel);

                        // RGB → YCbCr (same formula used in all codebases)
                        yBlock[i][j]  =  0.299 * r + 0.587 * g + 0.114 * b;
                        cbBlock[i][j] = -0.169 * r - 0.331 * g + 0.500 * b + 128.0;
                        crBlock[i][j] =  0.500 * r - 0.419 * g - 0.081 * b + 128.0;
                    }
                }

                // --- DCT on Y channel ---
                double[][] dctY = compute2DDCT(yBlock);

                // --- Embed bit via quantization ---
                int bit = bitstream.get(logicalBitIdx);
                double coeff = dctY[COEFF_U][COEFF_V];

                long q = Math.round(coeff / ALPHA);
                if (bit == 1) {
                    if (q % 2 == 0) q += 1;
                } else {
                    if (q % 2 != 0) q += 1;
                }
                dctY[COEFF_U][COEFF_V] = q * ALPHA;

                // --- IDCT on Y channel ---
                double[][] newY = compute2DIDCT(dctY);

                // --- Reconstruct RGB from modified Y + original Cb, Cr ---
                for (int i = 0; i < 8; i++) {
                    for (int j = 0; j < 8; j++) {
                        double y  = newY[i][j];
                        double cb = cbBlock[i][j] - 128.0;
                        double cr = crBlock[i][j] - 128.0;

                        // YCbCr → RGB
                        int newR = clamp((int) Math.round(y + 1.402 * cr));
                        int newG = clamp((int) Math.round(y - 0.344 * cb - 0.714 * cr));
                        int newB = clamp((int) Math.round(y + 1.772 * cb));

                        allPixels[(by + i) * width + (bx + j)] = Color.rgb(newR, newG, newB);
                    }
                }

                // Advance redundancy counter
                redundancyIdx++;
                if (redundancyIdx >= REDUNDANCY) {
                    redundancyIdx = 0;
                    logicalBitIdx++;
                }
            }
            if (logicalBitIdx >= bitstream.size()) break;
        }

        // Batch pixel write
        Bitmap watermarked = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        watermarked.setPixels(allPixels, 0, width, 0, 0, width, height);

        long elapsed = System.currentTimeMillis() - startTime;
        Log.d(TAG, "Watermark Embedded in " + elapsed + "ms (" + bitstream.size() + " logical bits × " + REDUNDANCY + " redundancy)");
        return watermarked;
    }

    private static int clamp(int val) {
        return Math.min(255, Math.max(0, val));
    }

    // Separable 2D DCT using precomputed cosine table
    private static double[][] compute2DDCT(double[][] input) {
        double[][] temp = new double[8][8];
        double[][] output = new double[8][8];

        // 1D DCT on rows
        for (int i = 0; i < 8; i++) {
            for (int k = 0; k < 8; k++) {
                double sum = 0.0;
                for (int n = 0; n < 8; n++) {
                    sum += input[i][n] * COS_TABLE[n][k];
                }
                double ck = (k == 0) ? C0 : 1.0;
                temp[i][k] = 0.5 * ck * sum;
            }
        }

        // 1D DCT on columns of result
        for (int k = 0; k < 8; k++) {
            for (int j = 0; j < 8; j++) {
                double sum = 0.0;
                for (int n = 0; n < 8; n++) {
                    sum += temp[n][j] * COS_TABLE[n][k];
                }
                double ck = (k == 0) ? C0 : 1.0;
                output[k][j] = 0.5 * ck * sum;
            }
        }
        return output;
    }

    // Separable 2D IDCT using precomputed cosine table
    private static double[][] compute2DIDCT(double[][] input) {
        double[][] temp = new double[8][8];
        double[][] output = new double[8][8];

        // 1D IDCT on rows
        for (int i = 0; i < 8; i++) {
            for (int n = 0; n < 8; n++) {
                double sum = 0.0;
                for (int k = 0; k < 8; k++) {
                    double ck = (k == 0) ? C0 : 1.0;
                    sum += ck * input[i][k] * COS_TABLE[n][k];
                }
                temp[i][n] = 0.5 * sum;
            }
        }

        // 1D IDCT on columns
        for (int j = 0; j < 8; j++) {
            for (int n = 0; n < 8; n++) {
                double sum = 0.0;
                for (int k = 0; k < 8; k++) {
                    double ck = (k == 0) ? C0 : 1.0;
                    sum += ck * temp[k][j] * COS_TABLE[n][k];
                }
                output[n][j] = 0.5 * sum;
            }
        }
        return output;
    }
}
