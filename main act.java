package com.example.myapplication;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.ContentObserver;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Log;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.EdgeToEdge;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MainActivity";
    private ContentObserver imageObserver;
    private ImageView imageView;
    private TextView statusText;
    private TextView resolutionText;
    private TextView photoCountText;
    private long lastImageId = -1;
    private Handler mainHandler;
    private int photosCapturedCount = 0;

    // Queue system
    private BlockingQueue<Long> imageQueue;
    private ExecutorService queueProcessor;
    private volatile boolean isProcessorRunning = false;

    // Settings
    private static final String CAPTURED_BY = "agbuddy7";

    private final ActivityResultLauncher<String> requestPermissionLauncher =
            registerForActivityResult(new ActivityResultContracts.RequestPermission(), isGranted -> {
                if (isGranted) {
                    updateStatus("Permission granted. Listening for new photos...");
                    initializeLastImageId();
                    registerImageObserver();
                } else {
                    updateStatus("Permission denied. Cannot detect new photos.");
                    Toast.makeText(this, "Permission denied.", Toast.LENGTH_LONG).show();
                }
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        setContentView(R.layout.activity_main);

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.main), (v, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return insets;
        });

        imageView = findViewById(R.id.imageView);
        statusText = findViewById(R.id.statusText);
        resolutionText = findViewById(R.id.resolutionText);
        photoCountText = findViewById(R.id.photoCountText);
        mainHandler = new Handler(Looper.getMainLooper());

        imageQueue = new LinkedBlockingQueue<>();
        queueProcessor = Executors.newSingleThreadExecutor();

        Log.d(TAG, "Image Provenance System - 3 Vertical Strands (Raw Pixel Data)");

        startQueueProcessor();
        checkPermissionAndRegisterObserver();
    }

    private void updateStatus(String message) {
        runOnUiThread(() -> {
            statusText.setText(message);
            Log.d(TAG, message);
        });
    }

    private void updateResolution(String resolution) {
        runOnUiThread(() -> resolutionText.setText(resolution));
    }

    private void updatePhotoCount() {
        runOnUiThread(() -> {
            photoCountText.setText(String.format("Photos: %d | Queue: %d",
                    photosCapturedCount, imageQueue.size()));
        });
    }

    private void checkPermissionAndRegisterObserver() {
        String permission = getRequiredPermission();

        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) {
            updateStatus("Listening for new photos...");
            initializeLastImageId();
            registerImageObserver();
        } else {
            updateStatus("Requesting permission...");
            requestPermissionLauncher.launch(permission);
        }
    }

    private String getRequiredPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return Manifest.permission.READ_MEDIA_IMAGES;
        } else {
            return Manifest.permission.READ_EXTERNAL_STORAGE;
        }
    }

    private void initializeLastImageId() {
        try {
            ContentResolver contentResolver = getContentResolver();
            Uri collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            String[] projection = {MediaStore.Images.Media._ID};
            String sortOrder = MediaStore.Images.Media.DATE_ADDED + " DESC";

            try (Cursor cursor = contentResolver.query(collection, projection, null, null, sortOrder)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                    lastImageId = cursor.getLong(idColumn);
                    Log.d(TAG, "Initialized with last image ID: " + lastImageId);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error initializing last image ID", e);
        }
    }

    private void registerImageObserver() {
        try {
            ContentResolver contentResolver = getContentResolver();

            imageObserver = new ContentObserver(mainHandler) {
                @Override
                public void onChange(boolean selfChange) {
                    super.onChange(selfChange);
                    onMediaStoreChange();
                }

                @Override
                public void onChange(boolean selfChange, Uri uri) {
                    super.onChange(selfChange, uri);
                    onMediaStoreChange();
                }
            };

            contentResolver.registerContentObserver(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    true,
                    imageObserver
            );

            Log.d(TAG, "Image observer registered");

        } catch (Exception e) {
            Log.e(TAG, "Failed to register image observer", e);
        }
    }

    private void onMediaStoreChange() {
        mainHandler.postDelayed(() -> checkForNewImage(), 800);
    }

    private void checkForNewImage() {
        new Thread(() -> {
            try {
                ContentResolver contentResolver = getContentResolver();
                if (contentResolver == null) return;

                Uri collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                String[] projection = {MediaStore.Images.Media._ID};
                String sortOrder = MediaStore.Images.Media._ID + " DESC";

                try (Cursor cursor = contentResolver.query(collection, projection, null, null, sortOrder)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                        long imageId = cursor.getLong(idColumn);

                        if (imageId > lastImageId) {
                            Log.d(TAG, "🔔 New image detected! ID: " + imageId);
                            lastImageId = imageId;

                            if (imageQueue.offer(imageId)) {
                                runOnUiThread(() -> updatePhotoCount());
                            }
                        }
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Error checking for new image", e);
            }
        }).start();
    }

    private void startQueueProcessor() {
        isProcessorRunning = true;

        queueProcessor.execute(() -> {
            Log.d(TAG, "📋 Queue processor started");

            while (isProcessorRunning) {
                try {
                    Long imageId = imageQueue.take();
                    Log.d(TAG, "🔄 Processing image ID: " + imageId);
                    runOnUiThread(() -> updateStatus("Processing photo..."));

                    processImageById(imageId);
                    Thread.sleep(300);

                } catch (InterruptedException e) {
                    break;
                } catch (Exception e) {
                    Log.e(TAG, "Error in queue processor", e);
                }
            }
        });
    }

    private void processImageById(long imageId) {
        try {
            ContentResolver contentResolver = getContentResolver();
            if (contentResolver == null) return;

            Uri collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            String[] projection = {
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.WIDTH,
                    MediaStore.Images.Media.HEIGHT,
                    MediaStore.Images.Media.SIZE
            };

            String selection = MediaStore.Images.Media._ID + " = ?";
            String[] selectionArgs = {String.valueOf(imageId)};

            try (Cursor cursor = contentResolver.query(collection, projection, selection, selectionArgs, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    String displayName = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME));
                    int width = cursor.getInt(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH));
                    int height = cursor.getInt(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT));
                    long fileSize = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE));

                    photosCapturedCount++;
                    Uri imageUri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, imageId);

                    Log.d(TAG, "Processing: " + displayName);

                    loadAndExtract3Strands(imageUri, displayName, width, height, fileSize, imageId);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error processing image", e);
        }
    }

    private void loadAndExtract3Strands(Uri imageUri, String displayName, int width, int height, long fileSize, long imageId) {
        try {
            InputStream inputStream = getContentResolver().openInputStream(imageUri);
            if (inputStream == null) return;

            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeStream(inputStream, null, options);
            inputStream.close();

            int imageWidth = options.outWidth;
            int imageHeight = options.outHeight;

            // Load full resolution
            inputStream = getContentResolver().openInputStream(imageUri);
            if (inputStream == null) return;

            options.inJustDecodeBounds = false;
            options.inSampleSize = 1;
            options.inPreferredConfig = Bitmap.Config.ARGB_8888;

            Bitmap fullBitmap = BitmapFactory.decodeStream(inputStream, null, options);
            inputStream.close();

            if (fullBitmap == null) return;

            int actualWidth = width > 0 ? width : imageWidth;
            int actualHeight = height > 0 ? height : imageHeight;

            // Extract 3 vertical strands
            runOnUiThread(() -> updateStatus("Extracting 3 vertical strands..."));
            extract3VerticalStrands(fullBitmap, imageId, displayName, actualWidth, actualHeight, fileSize, imageUri.toString());

            // Extract Constellation (Geometric Keypoints)
            runOnUiThread(() -> updateStatus("Generating Constellation Signature..."));
            extractAndSaveConstellation(fullBitmap, imageId);

            // Create display bitmap
            Bitmap displayBitmap = createDisplayBitmap(imageUri);

            // Update UI
            runOnUiThread(() -> {
                try {
                    imageView.setImageDrawable(null);
                    imageView.setImageBitmap(displayBitmap);
                    imageView.invalidate();

                    updateStatus("Photo: " + displayName);
                    updateResolution(String.format("%dx%d | %.2f MB",
                            actualWidth, actualHeight, fileSize / (1024.0 * 1024.0)));
                    updatePhotoCount();

                    Toast.makeText(this, "Photo #" + photosCapturedCount + " - 3 strands extracted!", Toast.LENGTH_SHORT).show();

                } catch (Exception e) {
                    Log.e(TAG, "Error updating UI", e);
                }
            });

            if (fullBitmap != displayBitmap) {
                fullBitmap.recycle();
            }

        } catch (Exception e) {
            Log.e(TAG, "Error loading image", e);
        }
    }

    private void extract3VerticalStrands(Bitmap bitmap, long imageId, String displayName, int width, int height, long fileSize, String uri) {
        try {
            long startTime = System.currentTimeMillis();

            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault());
            String timestamp = sdf.format(new Date());

            File directory = new File(getExternalFilesDir(null), "PhotoProvenance");
            if (!directory.exists()) {
                directory.mkdirs();
            }

            String pixelFileName = "pixel_strands_" + imageId + ".txt";
            File pixelFile = new File(directory, pixelFileName);

            FileOutputStream fos = new FileOutputStream(pixelFile);
            OutputStreamWriter writer = new OutputStreamWriter(fos);

            // Write header
            writer.write("==============================================\n");
            writer.write("3 VERTICAL PIXEL STRANDS\n");
            writer.write("==============================================\n\n");
            writer.write("Image ID: " + imageId + "\n");
            writer.write("File Name: " + displayName + "\n");
            writer.write("Image Dimensions: " + width + " x " + height + " pixels\n");
            writer.write("File Size: " + String.format("%.2f MB", fileSize / (1024.0 * 1024.0)) + "\n");
            writer.write("URI: " + uri + "\n");
            writer.write("Captured At: " + timestamp + "\n");
            writer.write("Captured By: " + CAPTURED_BY + "\n");
            writer.write("Total Strands: 3 (Vertical)\n");
            writer.write("Strand Height: " + (height / 3) + " pixels each\n");
            writer.write("Format: X,Y,RGB,HEX\n");
            writer.write("\n==============================================\n\n");

            int strandHeight = height / 3; // Each strand covers 1/3 of image height

            // Calculate X positions: 15%, 50%, 80% of width
            int x1 = (int)(width * 0.15); // 15% from left
            int x2 = (int)(width * 0.50); // 50% (middle)
            int x3 = (int)(width * 0.80); // 80% from left

            // Calculate Y starting positions: bottom, middle, top
            int y1_start = height - strandHeight; // Bottom strand
            int y2_start = (height - strandHeight) / 2; // Middle strand
            int y3_start = 0; // Top strand

            Log.d(TAG, "Strand 1 (Bottom): X=" + x1 + ", Y=" + y1_start + " to " + (y1_start + strandHeight));
            Log.d(TAG, "Strand 2 (Middle): X=" + x2 + ", Y=" + y2_start + " to " + (y2_start + strandHeight));
            Log.d(TAG, "Strand 3 (Top): X=" + x3 + ", Y=" + y3_start + " to " + (y3_start + strandHeight));

            // ============ STRAND 1: Bottom (X=15%) ============
            writer.write("--- STRAND 1: BOTTOM (X=" + x1 + ", 15% from left) ---\n");
            writer.write("Start: (" + x1 + "," + y1_start + ") | End: (" + x1 + "," + (y1_start + strandHeight - 1) + ")\n\n");

            int count1 = 0;
            for (int y = y1_start; y < y1_start + strandHeight && y < height; y++) {
                int pixel = bitmap.getPixel(x1, y);
                int r = Color.red(pixel);
                int g = Color.green(pixel);
                int b = Color.blue(pixel);
                String hex = String.format("#%02X%02X%02X", r, g, b);

                writer.write(String.format("X=%d,Y=%d,RGB(%d,%d,%d),%s\n", x1, y, r, g, b, hex));
                count1++;
            }
            writer.write("\n");

            // ============ STRAND 2: Middle (X=50%) ============
            writer.write("--- STRAND 2: MIDDLE (X=" + x2 + ", 50% from left) ---\n");
            writer.write("Start: (" + x2 + "," + y2_start + ") | End: (" + x2 + "," + (y2_start + strandHeight - 1) + ")\n\n");

            int count2 = 0;
            for (int y = y2_start; y < y2_start + strandHeight && y < height; y++) {
                int pixel = bitmap.getPixel(x2, y);
                int r = Color.red(pixel);
                int g = Color.green(pixel);
                int b = Color.blue(pixel);
                String hex = String.format("#%02X%02X%02X", r, g, b);

                writer.write(String.format("X=%d,Y=%d,RGB(%d,%d,%d),%s\n", x2, y, r, g, b, hex));
                count2++;
            }
            writer.write("\n");

            // ============ STRAND 3: Top (X=80%) ============
            writer.write("--- STRAND 3: TOP (X=" + x3 + ", 80% from left) ---\n");
            writer.write("Start: (" + x3 + "," + y3_start + ") | End: (" + x3 + "," + (y3_start + strandHeight - 1) + ")\n\n");

            int count3 = 0;
            for (int y = y3_start; y < y3_start + strandHeight && y < height; y++) {
                int pixel = bitmap.getPixel(x3, y);
                int r = Color.red(pixel);
                int g = Color.green(pixel);
                int b = Color.blue(pixel);
                String hex = String.format("#%02X%02X%02X", r, g, b);

                writer.write(String.format("X=%d,Y=%d,RGB(%d,%d,%d),%s\n", x3, y, r, g, b, hex));
                count3++;
            }
            writer.write("\n");

            // Write footer
            writer.write("==============================================\n");
            writer.write("EXTRACTION SUMMARY\n");
            writer.write("==============================================\n");
            writer.write("Strand 1 pixels: " + count1 + "\n");
            writer.write("Strand 2 pixels: " + count2 + "\n");
            writer.write("Strand 3 pixels: " + count3 + "\n");
            writer.write("Total pixels extracted: " + (count1 + count2 + count3) + "\n");
            writer.write("==============================================\n");

            writer.close();
            fos.close();

            long endTime = System.currentTimeMillis();
            long duration = endTime - startTime;

            Log.d(TAG, "✓ 3 vertical strands extracted in " + duration + "ms");
            Log.d(TAG, "✓ File saved: " + pixelFile.getAbsolutePath());
            Log.d(TAG, "✓ File size: " + (pixelFile.length() / 1024) + " KB");
            Log.d(TAG, "✓ Total pixels: " + (count1 + count2 + count3));

            // Save metadata summary
            saveMetadataSummary(imageId, displayName, width, height, fileSize, uri, timestamp,
                    x1, x2, x3, y1_start, y2_start, y3_start, strandHeight, count1, count2, count3);

        } catch (Exception e) {
            Log.e(TAG, "Error extracting strands", e);
            e.printStackTrace();
        }
    }

    private void extractAndSaveConstellation(Bitmap bitmap, long imageId) {
        try {
            long startTime = System.currentTimeMillis();
            
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            int gridSize = 8; // UPDATED to 8x8 Grid for Database
            float cellW = width / (float) gridSize;
            float cellH = height / (float) gridSize;

            StringBuilder jsonBuilder = new StringBuilder();
            jsonBuilder.append("[\n");

            for (int row = 0; row < gridSize; row++) {
                for (int col = 0; col < gridSize; col++) {
                    int startX = (int) (col * cellW);
                    int startY = (int) (row * cellH);
                    int w = (int) cellW;
                    int h = (int) cellH;
                    
                    // Safety check for edge pixels
                    if (startX + w > width) w = width - startX;
                    if (startY + h > height) h = height - startY;

                    float maxVal = -1;
                    int maxX = 0;
                    int maxY = 0;

                    // Scan the cell for the "Brightest Star"
                    for (int y = 0; y < h; y++) {
                        for (int x = 0; x < w; x++) {
                            int pixel = bitmap.getPixel(startX + x, startY + y);
                            // Luminance
                            float brightness = (0.299f * Color.red(pixel)) + (0.587f * Color.green(pixel)) + (0.114f * Color.blue(pixel));

                            if (brightness > maxVal) {
                                maxVal = brightness;
                                maxX = x;
                                maxY = y;
                            }
                        }
                    }

                    // Save Normalized Coordinates (0.0 to 1.0)
                    float normX = (startX + maxX) / (float) width;
                    float normY = (startY + maxY) / (float) height;
                    float normB = maxVal / 255.0f;

                    jsonBuilder.append(String.format(Locale.US, "  { \"row\": %d, \"col\": %d, \"x\": %.4f, \"y\": %.4f, \"b\": %.2f }", row, col, normX, normY, normB));
                    
                    if (row < gridSize - 1 || col < gridSize - 1) jsonBuilder.append(",\n");
                    else jsonBuilder.append("\n");
                }
            }
            jsonBuilder.append("]");
            
            String finalJson = jsonBuilder.toString();

            // Save to a NEW separate file: constellation_ID.json
            File directory = new File(getExternalFilesDir(null), "PhotoProvenance");
            if (!directory.exists()) directory.mkdirs();
            
            File constFile = new File(directory, "constellation_" + imageId + ".json");
            FileOutputStream fos = new FileOutputStream(constFile);
            OutputStreamWriter writer = new OutputStreamWriter(fos);
            writer.write(finalJson);
            writer.close();
            fos.close();
            
            // NEW: Upload to Database
            sendSignatureToDatabase(imageId, finalJson);
            
            long duration = System.currentTimeMillis() - startTime;
            Log.d(TAG, "✓ Constellation JSON saved (" + duration + "ms): " + constFile.getAbsolutePath());

        } catch (Exception e) {
            Log.e(TAG, "Error generating constellation", e);
        }
    }

    private void saveMetadataSummary(long imageId, String displayName, int width, int height, long fileSize, String uri,
                                     String timestamp, int x1, int x2, int x3, int y1_start, int y2_start, int y3_start,
                                     int strandHeight, int count1, int count2, int count3) {
        try {
            File directory = new File(getExternalFilesDir(null), "PhotoProvenance");
            String summaryFileName = "metadata_" + imageId + ".txt";
            File summaryFile = new File(directory, summaryFileName);

            FileOutputStream fos = new FileOutputStream(summaryFile);
            OutputStreamWriter writer = new OutputStreamWriter(fos);

            writer.write("==============================================\n");
            writer.write("PHOTO METADATA\n");
            writer.write("==============================================\n\n");
            writer.write("Image ID: " + imageId + "\n");
            writer.write("File Name: " + displayName + "\n");
            writer.write("Resolution: " + width + " x " + height + " pixels\n");
            writer.write("File Size: " + String.format("%.2f MB", fileSize / (1024.0 * 1024.0)) + "\n");
            writer.write("URI: " + uri + "\n");
            writer.write("Captured At: " + timestamp + "\n");
            writer.write("Captured By: " + CAPTURED_BY + "\n");
            writer.write("Photo Number: " + photosCapturedCount + "\n\n");

            writer.write("STRAND CONFIGURATION:\n");
            writer.write("Total Strands: 3 (Vertical)\n");
            writer.write("Strand Height: " + strandHeight + " pixels (" + (height / 3) + " per strand)\n\n");

            writer.write("Strand 1 (Bottom):\n");
            writer.write("  X Position: " + x1 + " (15% from left)\n");
            writer.write("  Y Range: " + y1_start + " to " + (y1_start + strandHeight - 1) + "\n");
            writer.write("  Pixels: " + count1 + "\n\n");

            writer.write("Strand 2 (Middle):\n");
            writer.write("  X Position: " + x2 + " (50% from left)\n");
            writer.write("  Y Range: " + y2_start + " to " + (y2_start + strandHeight - 1) + "\n");
            writer.write("  Pixels: " + count2 + "\n\n");

            writer.write("Strand 3 (Top):\n");
            writer.write("  X Position: " + x3 + " (80% from left)\n");
            writer.write("  Y Range: " + y3_start + " to " + (y3_start + strandHeight - 1) + "\n");
            writer.write("  Pixels: " + count3 + "\n\n");

            writer.write("Total Pixels Extracted: " + (count1 + count2 + count3) + "\n");
            writer.write("Pixel Data File: pixel_strands_" + imageId + ".txt\n");
            writer.write("\n==============================================\n");

            writer.close();
            fos.close();

            Log.d(TAG, "✓ Metadata summary saved");

            // Update master log
            updateMasterLog(imageId, displayName, width, height, fileSize, timestamp, count1 + count2 + count3);

        } catch (Exception e) {
            Log.e(TAG, "Error saving metadata summary", e);
        }
    }

    private void updateMasterLog(long imageId, String displayName, int width, int height, long fileSize, String timestamp, int totalPixels) {
        try {
            File directory = new File(getExternalFilesDir(null), "PhotoProvenance");
            File masterLog = new File(directory, "master_log.txt");

            FileOutputStream fos = new FileOutputStream(masterLog, true);
            OutputStreamWriter writer = new OutputStreamWriter(fos);

            String logEntry = String.format("[%s] ID:%d | %s | %dx%d | %.2fMB | 3V | Pixels:%d\n",
                    timestamp, imageId, displayName, width, height,
                    fileSize / (1024.0 * 1024.0), totalPixels);

            writer.write(logEntry);
            writer.close();
            fos.close();

        } catch (Exception e) {
            Log.e(TAG, "Error updating master log", e);
        }
    }

    private Bitmap createDisplayBitmap(Uri imageUri) {
        try {
            InputStream inputStream = getContentResolver().openInputStream(imageUri);
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeStream(inputStream, null, options);
            inputStream.close();

            inputStream = getContentResolver().openInputStream(imageUri);
            options.inJustDecodeBounds = false;
            options.inSampleSize = calculateInSampleSize(options, 1080, 1920);
            options.inPreferredConfig = Bitmap.Config.RGB_565;
            Bitmap bitmap = BitmapFactory.decodeStream(inputStream, null, options);
            inputStream.close();
            return bitmap;
        } catch (Exception e) {
            return null;
        }
    }

    private int calculateInSampleSize(BitmapFactory.Options options, int reqWidth, int reqHeight) {
        final int height = options.outHeight;
        final int width = options.outWidth;
        int inSampleSize = 1;

        if (height > reqHeight || width > reqWidth) {
            final int halfHeight = height / 2;
            final int halfWidth = width / 2;

            while ((halfHeight / inSampleSize) >= reqHeight && (halfWidth / inSampleSize) >= reqWidth) {
                inSampleSize *= 2;
            }
        }

        return inSampleSize;
    }

    private void sendSignatureToDatabase(long imageId, String constellationJson) {
        new Thread(() -> {
            try {
                // CHANGED: Using Render Deployment URL
                java.net.URL url = new java.net.URL("https://netra-1.onrender.com/register");
                
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; utf-8");
                conn.setRequestProperty("Accept", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000); // Increased timeout for cloud

                String jsonInputString = String.format(
                    "{\"image_id\": \"%d\", \"author\": \"%s\", \"device_model\": \"%s\", \"timestamp\": \"%s\", \"constellation\": %s}",
                    imageId,
                    CAPTURED_BY,
                    Build.MODEL,
                    new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(new Date()),
                    constellationJson
                );

                try(java.io.OutputStream os = conn.getOutputStream()) {
                    byte[] input = jsonInputString.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    os.write(input, 0, input.length);
                }

                int code = conn.getResponseCode();
                Log.d(TAG, "Database Upload Status: " + code);
                
                // Read response if needed
                if(code == 200) {
                   runOnUiThread(() -> Toast.makeText(this, "Signature Registered Globally!", Toast.LENGTH_SHORT).show());
                }
                
            } catch (Exception e) {
                 Log.e(TAG, "Database Upload Failed", e);
            }
        }).start();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();

        isProcessorRunning = false;
        if (queueProcessor != null) {
            queueProcessor.shutdownNow();
        }

        if (imageObserver != null) {
            try {
                getContentResolver().unregisterContentObserver(imageObserver);
                Log.d(TAG, "Observer unregistered");
            } catch (Exception e) {
                Log.e(TAG, "Error unregistering observer", e);
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        initializeLastImageId();
        updateStatus("Listening for new photos...");
        updateResolution("No photo captured yet");
        updatePhotoCount();
    }
}