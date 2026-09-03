package com.example.myapplication;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class WatermarkUtils {
    private static final String TAG = "WatermarkUtils";
    
    // V3 Config
    private static final int REDUNDANCY = 7;
    private static final double MIN_MARGIN = 20.0;
    private static final double MAX_MARGIN = 50.0;
    private static final long PRNG_SEED = 123456789L;
    
    private static final int[] MAGIC_BITS = {
        0,1,0,1,0,0,0,0,  // 0x50 = 'P'
        0,1,0,0,1,0,1,1   // 0x4B = 'K'
    };
    
    private static final int[][][] PAIRS = {
        {{2,3}, {3,2}},
        {{1,3}, {3,1}},
        {{2,4}, {4,2}}
    };

    // Precomputed cosine table for 8x8 DCT
    private static final double[][] COS_TABLE = new double[8][8];
    static {
        for (int n = 0; n < 8; n++) {
            for (int k = 0; k < 8; k++) {
                COS_TABLE[n][k] = Math.cos((2.0 * n + 1.0) * k * Math.PI / 16.0);
            }
        }
    }
    private static final double C0 = 1.0 / Math.sqrt(2.0);
    
    // --- LCG PRNG (Deterministic) ---
    private static class PRNG {
        private long state;
        public PRNG(long seed) {
            this.state = seed & 0xFFFFFFFFL;
        }
        public long next() {
            this.state = (this.state * 1103515245L + 12345L) & 0x7FFFFFFFL;
            return this.state;
        }
    }

    // --- Hamming(7,4) Encode ---
    private static List<Integer> hammingEncode(List<Integer> dataBits) {
        List<Integer> encoded = new ArrayList<>();
        for (int i = 0; i < dataBits.size(); i += 4) {
            List<Integer> d = new ArrayList<>();
            for (int j = 0; j < 4; j++) {
                if (i + j < dataBits.size()) {
                    d.add(dataBits.get(i + j));
                } else {
                    d.add(0); // Pad
                }
            }
            int p1 = d.get(0) ^ d.get(1) ^ d.get(3);
            int p2 = d.get(0) ^ d.get(2) ^ d.get(3);
            int p3 = d.get(1) ^ d.get(2) ^ d.get(3);
            encoded.add(p1);
            encoded.add(p2);
            encoded.add(d.get(0));
            encoded.add(p3);
            encoded.add(d.get(1));
            encoded.add(d.get(2));
            encoded.add(d.get(3));
        }
        return encoded;
    }
    
    // --- Interleaving ---
    private static List<Integer> interleave(List<Integer> bits, long seed) {
        PRNG prng = new PRNG(seed);
        int[] indices = new int[bits.size()];
        for (int i = 0; i < indices.length; i++) indices[i] = i;
        
        // Fisher-Yates
        for (int i = indices.length - 1; i > 0; i--) {
            int j = (int)(prng.next() % (i + 1));
            int temp = indices[i];
            indices[i] = indices[j];
            indices[j] = temp;
        }
        
        Integer[] shuffled = new Integer[bits.size()];
        for (int i = 0; i < bits.size(); i++) {
            shuffled[indices[i]] = bits.get(i);
        }
        
        List<Integer> result = new ArrayList<>();
        Collections.addAll(result, shuffled);
        return result;
    }
    
    private static double getAdaptiveMargin(double[][] dctBlock) {
        double acEnergy = 0.0;
        for (int i = 0; i < 8; i++) {
            for (int j = 0; j < 8; j++) {
                acEnergy += Math.abs(dctBlock[i][j]);
            }
        }
        acEnergy -= Math.abs(dctBlock[0][0]);
        
        double normalized = (acEnergy - 500.0) / 2500.0;
        normalized = Math.max(0.0, Math.min(1.0, normalized));
        return MIN_MARGIN + normalized * (MAX_MARGIN - MIN_MARGIN);
    }

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

    public static Bitmap embedDCTWatermark(Bitmap src, String payload) {
        Log.d(TAG, "Starting DCT Watermark v3 Embedding...");
        long startTime = System.currentTimeMillis();

        int width = src.getWidth();
        int height = src.getHeight();

        int padWidth = width - (width % 8);
        int padHeight = height - (height % 8);

        int[] allPixels = new int[width * height];
        src.getPixels(allPixels, 0, width, 0, 0, width, height);

        // Payload prep
        List<Integer> payloadBits = textToBits(payload);
        int length = payloadBits.size();
        
        List<Integer> rawPayload = new ArrayList<>();
        for (int b : MAGIC_BITS) rawPayload.add(b);
        for (int i = 15; i >= 0; i--) rawPayload.add((length >> i) & 1);
        rawPayload.addAll(payloadBits);
        
        List<Integer> eccBits = hammingEncode(rawPayload);
        
        List<Integer> redundantBits = new ArrayList<>();
        for (int r = 0; r < REDUNDANCY; r++) {
            redundantBits.addAll(eccBits);
        }
        
        List<Integer> interleavedBits = interleave(redundantBits, PRNG_SEED);
        
        int numBlocks = (padWidth / 8) * (padHeight / 8);
        if (interleavedBits.size() > numBlocks) {
            Log.e(TAG, "Image too small. Need " + interleavedBits.size() + " blocks, have " + numBlocks);
            return src; // Fallback
        }
        
        // Spreading
        PRNG prng = new PRNG(PRNG_SEED);
        int[] blockIndices = new int[numBlocks];
        for (int i = 0; i < numBlocks; i++) blockIndices[i] = i;
        
        for (int i = numBlocks - 1; i > 0; i--) {
            int j = (int)(prng.next() % (i + 1));
            int temp = blockIndices[i];
            blockIndices[i] = blockIndices[j];
            blockIndices[j] = temp;
        }

        int blocksW = padWidth / 8;
        
        // Embed directly into allPixels block by block to save memory and CPU
        for (int i = 0; i < interleavedBits.size(); i++) {
            int bit = interleavedBits.get(i);
            int bIdx = blockIndices[i];
            
            int by = (bIdx / blocksW) * 8;
            int bx = (bIdx % blocksW) * 8;
            
            double[][] block = new double[8][8];
            double[][] cbBlock = new double[8][8];
            double[][] crBlock = new double[8][8];
            
            // Extract and convert only this 8x8 block
            for (int r = 0; r < 8; r++) {
                for (int c = 0; c < 8; c++) {
                    int pixel = allPixels[(by + r) * width + (bx + c)];
                    int pR = Color.red(pixel);
                    int pG = Color.green(pixel);
                    int pB = Color.blue(pixel);
                    
                    block[r][c] =  0.299 * pR + 0.587 * pG + 0.114 * pB;
                    cbBlock[r][c] = -0.1687 * pR - 0.3313 * pG + 0.500 * pB + 128.0;
                    crBlock[r][c] =  0.500 * pR - 0.4187 * pG - 0.0813 * pB + 128.0;
                }
            }
            
            double[][] dctBlock = compute2DDCT(block);
            double margin = getAdaptiveMargin(dctBlock);
            
            int[][] pair = PAIRS[i % PAIRS.length];
            int r1 = pair[0][0], c1 = pair[0][1];
            int r2 = pair[1][0], c2 = pair[1][1];
            
            double A = dctBlock[r1][c1];
            double B = dctBlock[r2][c2];
            double diff = A - B;
            
            if (bit == 1) {
                if (diff < margin) {
                    double adjust = (margin - diff) / 2.0;
                    dctBlock[r1][c1] += adjust;
                    dctBlock[r2][c2] -= adjust;
                }
            } else {
                if (diff > -margin) {
                    double adjust = (diff - (-margin)) / 2.0;
                    dctBlock[r1][c1] -= adjust;
                    dctBlock[r2][c2] += adjust;
                }
            }
            
            double[][] newBlock = compute2DIDCT(dctBlock);
            
            // Reconstruct RGB and write back to allPixels
            for (int r = 0; r < 8; r++) {
                for (int c = 0; c < 8; c++) {
                    double y = newBlock[r][c];
                    double cb = cbBlock[r][c] - 128.0;
                    double cr = crBlock[r][c] - 128.0;
                    
                    int newR = clamp((int) Math.round(y + 1.402 * cr));
                    int newG = clamp((int) Math.round(y - 0.34414 * cb - 0.71414 * cr));
                    int newB = clamp((int) Math.round(y + 1.772 * cb));
                    
                    allPixels[(by + r) * width + (bx + c)] = Color.rgb(newR, newG, newB);
                }
            }
        }

        Bitmap watermarked = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        watermarked.setPixels(allPixels, 0, width, 0, 0, width, height);

        long elapsed = System.currentTimeMillis() - startTime;
        Log.d(TAG, "Watermark Embedded in " + elapsed + "ms (v3)");
        return watermarked;
    }

    private static int clamp(int val) {
        return Math.min(255, Math.max(0, val));
    }

    private static double[][] compute2DDCT(double[][] input) {
        double[][] temp = new double[8][8];
        double[][] output = new double[8][8];
        for (int i = 0; i < 8; i++) {
            for (int k = 0; k < 8; k++) {
                double sum = 0.0;
                for (int n = 0; n < 8; n++) sum += input[i][n] * COS_TABLE[n][k];
                temp[i][k] = 0.5 * ((k == 0) ? C0 : 1.0) * sum;
            }
        }
        for (int k = 0; k < 8; k++) {
            for (int j = 0; j < 8; j++) {
                double sum = 0.0;
                for (int n = 0; n < 8; n++) sum += temp[n][j] * COS_TABLE[n][k];
                output[k][j] = 0.5 * ((k == 0) ? C0 : 1.0) * sum;
            }
        }
        return output;
    }

    private static double[][] compute2DIDCT(double[][] input) {
        double[][] temp = new double[8][8];
        double[][] output = new double[8][8];
        for (int i = 0; i < 8; i++) {
            for (int n = 0; n < 8; n++) {
                double sum = 0.0;
                for (int k = 0; k < 8; k++) sum += ((k == 0) ? C0 : 1.0) * input[i][k] * COS_TABLE[n][k];
                temp[i][n] = 0.5 * sum;
            }
        }
        for (int j = 0; j < 8; j++) {
            for (int n = 0; n < 8; n++) {
                double sum = 0.0;
                for (int k = 0; k < 8; k++) sum += ((k == 0) ? C0 : 1.0) * temp[k][j] * COS_TABLE[n][k];
                output[n][j] = 0.5 * sum;
            }
        }
        return output;
    }
}
