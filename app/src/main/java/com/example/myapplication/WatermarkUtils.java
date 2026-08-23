package com.example.myapplication;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

public class WatermarkUtils {
    private static final String TAG = "WatermarkUtils";
    private static final double ALPHA = 30.0;
    
    // Convert string payload to bits
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
        Log.d(TAG, "Starting DCT Watermark Embedding...");
        long startTime = System.currentTimeMillis();

        int width = src.getWidth();
        int height = src.getHeight();
        
        // Ensure dimensions are multiples of 8
        int padWidth = width - (width % 8);
        int padHeight = height - (height % 8);
        
        Bitmap watermarked = src.copy(Bitmap.Config.ARGB_8888, true);
        
        List<Integer> watermarkBits = textToBits(payload);
        int bitIdx = 0;
        
        int maxCapacity = (padWidth / 8) * (padHeight / 8);
        if (watermarkBits.size() > maxCapacity) {
            Log.w(TAG, "Payload too large for image capacity.");
        }
        
        // Simple manual block DCT for Y channel
        double[][] block = new double[8][8];
        int[][] pixels = new int[8][8];
        
        for (int y = 0; y < padHeight; y += 8) {
            for (int x = 0; x < padWidth; x += 8) {
                if (bitIdx >= watermarkBits.size()) {
                    break;
                }
                
                // Read 8x8 block and extract luminance (simplified Y channel)
                for (int i = 0; i < 8; i++) {
                    for (int j = 0; j < 8; j++) {
                        int pixel = src.getPixel(x + j, y + i);
                        pixels[i][j] = pixel;
                        int r = Color.red(pixel);
                        int g = Color.green(pixel);
                        int b = Color.blue(pixel);
                        // Y = 0.299R + 0.587G + 0.114B
                        block[i][j] = 0.299 * r + 0.587 * g + 0.114 * b;
                    }
                }
                
                // Apply 2D DCT
                double[][] dctBlock = compute2DDCT(block);
                
                // Modify coefficient (4, 4)
                double coeff = dctBlock[4][4];
                int bit = watermarkBits.get(bitIdx);
                
                long q = Math.round(coeff / ALPHA);
                if (bit == 1) {
                    if (q % 2 == 0) q += 1;
                } else {
                    if (q % 2 != 0) q += 1;
                }
                dctBlock[4][4] = q * ALPHA;
                
                // Apply 2D IDCT
                double[][] idctBlock = compute2DIDCT(dctBlock);
                
                // Reconstruct pixels and write back
                for (int i = 0; i < 8; i++) {
                    for (int j = 0; j < 8; j++) {
                        double newY = idctBlock[i][j];
                        
                        // Limit bounds
                        if (newY < 0) newY = 0;
                        if (newY > 255) newY = 255;
                        
                        int origPixel = pixels[i][j];
                        int r = Color.red(origPixel);
                        int g = Color.green(origPixel);
                        int b = Color.blue(origPixel);
                        
                        double oldY = 0.299 * r + 0.587 * g + 0.114 * b;
                        double diffY = newY - oldY;
                        
                        int newR = Math.min(255, Math.max(0, (int)(r + diffY)));
                        int newG = Math.min(255, Math.max(0, (int)(g + diffY)));
                        int newB = Math.min(255, Math.max(0, (int)(b + diffY)));
                        
                        watermarked.setPixel(x + j, y + i, Color.rgb(newR, newG, newB));
                    }
                }
                
                bitIdx++;
            }
        }
        
        Log.d(TAG, "Watermark Embedded in " + (System.currentTimeMillis() - startTime) + "ms");
        return watermarked;
    }
    
    // Very basic slow DCT algorithm for 8x8
    private static double[][] compute2DDCT(double[][] input) {
        double[][] output = new double[8][8];
        double c0 = 1.0 / Math.sqrt(2.0);
        
        for (int u = 0; u < 8; u++) {
            for (int v = 0; v < 8; v++) {
                double sum = 0.0;
                for (int i = 0; i < 8; i++) {
                    for (int j = 0; j < 8; j++) {
                        sum += input[i][j] * 
                               Math.cos((2.0 * i + 1.0) * u * Math.PI / 16.0) * 
                               Math.cos((2.0 * j + 1.0) * v * Math.PI / 16.0);
                    }
                }
                double cu = (u == 0) ? c0 : 1.0;
                double cv = (v == 0) ? c0 : 1.0;
                output[u][v] = 0.25 * cu * cv * sum;
            }
        }
        return output;
    }

    private static double[][] compute2DIDCT(double[][] input) {
        double[][] output = new double[8][8];
        double c0 = 1.0 / Math.sqrt(2.0);
        
        for (int i = 0; i < 8; i++) {
            for (int j = 0; j < 8; j++) {
                double sum = 0.0;
                for (int u = 0; u < 8; u++) {
                    for (int v = 0; v < 8; v++) {
                        double cu = (u == 0) ? c0 : 1.0;
                        double cv = (v == 0) ? c0 : 1.0;
                        sum += cu * cv * input[u][v] * 
                               Math.cos((2.0 * i + 1.0) * u * Math.PI / 16.0) * 
                               Math.cos((2.0 * j + 1.0) * v * Math.PI / 16.0);
                    }
                }
                output[i][j] = 0.25 * sum;
            }
        }
        return output;
    }
}
