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

import org.json.JSONArray;
import org.json.JSONObject;

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

        // Debug network permissions and security policy
        checkNetworkPermissions();

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

                    processAndWatermarkImage(imageUri, displayName, width, height, fileSize, imageId);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error processing image", e);
        }
    }

    private void processAndWatermarkImage(Uri imageUri, String displayName, int width, int height, long fileSize, long imageId) {
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
            runOnUiThread(() -> updateStatus("Embedding Invisible Watermark..."));
            String payload = "proofKrypt-" + imageId;
            Bitmap watermarkedBitmap = WatermarkUtils.embedDCTWatermark(fullBitmap, payload);
            
            // Save watermarked bitmap
            File directory = new File(getExternalFilesDir(null), "PhotoProvenance");
            if (!directory.exists()) directory.mkdirs();
            File outFile = new File(directory, "watermarked_" + imageId + ".png");
            
            FileOutputStream out = new FileOutputStream(outFile);
            watermarkedBitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
            out.flush();
            out.close();

            // Send to database
            runOnUiThread(() -> updateStatus("Generating Signature..."));
            sendSignatureToDatabase(imageId, null);

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

                    Toast.makeText(this, "Photo #" + photosCapturedCount + " - Watermark embedded!", Toast.LENGTH_SHORT).show();

                } catch (Exception e) {
                    Log.e(TAG, "Error updating UI", e);
                }
            });

            if (fullBitmap != displayBitmap) {
                fullBitmap.recycle();
            }
            if (watermarkedBitmap != displayBitmap) {
                watermarkedBitmap.recycle();
            }

        } catch (Exception e) {
            Log.e(TAG, "Error loading image", e);
        }
    }

    // Removed legacy strand methods

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
                Log.d(TAG, "🌐 Uploading to Render Database...");
                java.net.URL url = new java.net.URL("https://netra-1.onrender.com/register");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8"); // Fixed charset syntax
                conn.setRequestProperty("Accept", "application/json");
                conn.setDoOutput(true);
                conn.setDoInput(true); // Explicitly enable input
                conn.setConnectTimeout(15000);

                // 1. Timestamp
                SimpleDateFormat isoFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                isoFormat.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                String isoTimestamp = isoFormat.format(new Date());

                // 2. Build JSON
                JSONObject jsonBody = new JSONObject();
                jsonBody.put("image_id", "ANDROID-" + imageId);
                jsonBody.put("author", CAPTURED_BY);
                jsonBody.put("device_model", Build.MODEL);
                jsonBody.put("timestamp", isoTimestamp);

                // CRITICAL: Updated payload format for DCT watermark system
                jsonBody.put("watermark_payload", "proofKrypt-" + imageId);

                String jsonInputString = jsonBody.toString();

                // Log payload to be sure
                Log.d("UPLOAD_DEBUG", "Payload: " + jsonInputString);

                // 3. Send
                byte[] input = jsonInputString.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                // Set content length to help the server parser
                conn.setRequestProperty("Content-Length", String.valueOf(input.length));

                try(java.io.OutputStream os = conn.getOutputStream()) {
                    os.write(input, 0, input.length);
                    os.flush(); // Ensure everything is written
                }

                int code = conn.getResponseCode();
                Log.d(TAG, "💎 Response Code: " + code);

                if(code >= 200 && code < 300) {
                    // Success
                    // ...
                } else {
                    // Error reading
                    java.io.InputStream err = conn.getErrorStream();
                    if(err != null) {
                        java.util.Scanner s = new java.util.Scanner(err).useDelimiter("\\A");
                        Log.e(TAG, "❌ Server Rejected: " + (s.hasNext() ? s.next() : ""));
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Error: " + e.getMessage());
                e.printStackTrace();
            }
        }).start();
    }

    private void testNetworkConnectivity() {
        try {
            // Test basic internet connectivity
            Log.d(TAG, "🔍 Testing network connectivity...");

            // Test DNS resolution for our domain
            java.net.InetAddress[] addresses = java.net.InetAddress.getAllByName("netra-1.onrender.com");
            Log.d(TAG, "✅ DNS Resolution Success: " + addresses[0].getHostAddress());

        } catch (java.net.UnknownHostException e) {
            Log.e(TAG, "❌ DNS Resolution Failed for netra-1.onrender.com");
            Log.e(TAG, "🔧 NETWORK ISSUE: " + e.getMessage());

            // Try resolving a known good domain
            try {
                java.net.InetAddress.getAllByName("google.com");
                Log.d(TAG, "✅ Internet works - DNS issue specific to our domain");
                runOnUiThread(() -> Toast.makeText(this, "❌ Server domain blocked/filtered", Toast.LENGTH_LONG).show());
            } catch (Exception e2) {
                Log.e(TAG, "❌ No internet connectivity at all");
                runOnUiThread(() -> Toast.makeText(this, "❌ No Internet Connection", Toast.LENGTH_LONG).show());
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Network test error: " + e.getMessage());
        }
    }

    private void checkNetworkPermissions() {
        // Check if Internet permission is granted
        if (checkSelfPermission(android.Manifest.permission.INTERNET) == PackageManager.PERMISSION_GRANTED) {
            Log.d(TAG, "✅ INTERNET permission granted");
        } else {
            Log.e(TAG, "❌ INTERNET permission DENIED");
        }

        // Check network state permission
        if (checkSelfPermission(android.Manifest.permission.ACCESS_NETWORK_STATE) == PackageManager.PERMISSION_GRANTED) {
            Log.d(TAG, "✅ NETWORK_STATE permission granted");
        } else {
            Log.w(TAG, "⚠️ NETWORK_STATE permission not granted (optional)");
        }

        // Check if cleartext traffic is allowed
        try {
            boolean cleartextPermitted = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_USES_CLEARTEXT_TRAFFIC) != 0;
            Log.d(TAG, "🔒 Cleartext traffic permitted: " + cleartextPermitted);
            } catch (Exception e) {
            Log.e(TAG, "❌ Error checking cleartext policy: " + e.getMessage());
        }
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