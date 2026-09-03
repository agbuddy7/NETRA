package com.example.myapplication;

import android.Manifest;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.EdgeToEdge;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MainActivity";
    private static final String CAPTURED_BY = "agbuddy7";

    private PreviewView viewFinder;
    private ImageView imageView;
    private TextView statusText;
    private TextView resolutionText;
    private TextView photoCountText;
    private Button captureButton;

    private ImageCapture imageCapture;
    private ExecutorService cameraExecutor;
    private int photosCapturedCount = 0;

    private final ActivityResultLauncher<String[]> requestPermissionsLauncher =
            registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), permissions -> {
                boolean allGranted = true;
                for (Boolean isGranted : permissions.values()) {
                    if (!isGranted) {
                        allGranted = false;
                        break;
                    }
                }
                
                if (allGranted) {
                    startCamera();
                } else {
                    updateStatus("Permissions denied. Cannot use camera.");
                    Toast.makeText(this, "Permissions not granted by the user.", Toast.LENGTH_SHORT).show();
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

        viewFinder = findViewById(R.id.viewFinder);
        imageView = findViewById(R.id.imageView);
        statusText = findViewById(R.id.statusText);
        resolutionText = findViewById(R.id.resolutionText);
        photoCountText = findViewById(R.id.photoCountText);
        captureButton = findViewById(R.id.captureButton);

        cameraExecutor = Executors.newSingleThreadExecutor();

        captureButton.setOnClickListener(v -> takePhoto());

        if (allPermissionsGranted()) {
            startCamera();
        } else {
            requestPermissionsLauncher.launch(getRequiredPermissions());
        }
    }

    private boolean allPermissionsGranted() {
        for (String permission : getRequiredPermissions()) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return true;
    }

    private String[] getRequiredPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return new String[]{Manifest.permission.CAMERA, Manifest.permission.READ_MEDIA_IMAGES};
        } else {
            return new String[]{Manifest.permission.CAMERA, Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE};
        }
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> cameraProviderFuture = ProcessCameraProvider.getInstance(this);

        cameraProviderFuture.addListener(() -> {
            try {
                ProcessCameraProvider cameraProvider = cameraProviderFuture.get();

                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(viewFinder.getSurfaceProvider());

                imageCapture = new ImageCapture.Builder().build();

                CameraSelector cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA;

                cameraProvider.unbindAll();
                cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageCapture);

                updateStatus("Camera ready");

            } catch (Exception exc) {
                Log.e(TAG, "Use case binding failed", exc);
                updateStatus("Failed to start camera");
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void takePhoto() {
        if (imageCapture == null) return;

        updateStatus("Capturing photo...");
        captureButton.setEnabled(false);

        String name = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
        ContentValues contentValues = new ContentValues();
        contentValues.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        contentValues.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.P) {
            contentValues.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/CameraX-Image");
        }

        ImageCapture.OutputFileOptions outputOptions = new ImageCapture.OutputFileOptions.Builder(
                getContentResolver(),
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                contentValues
        ).build();

        imageCapture.takePicture(
                outputOptions,
                ContextCompat.getMainExecutor(this),
                new ImageCapture.OnImageSavedCallback() {
                    @Override
                    public void onImageSaved(@NonNull ImageCapture.OutputFileResults output) {
                        Uri savedUri = output.getSavedUri();
                        if (savedUri != null) {
                            Log.d(TAG, "Photo capture succeeded: " + savedUri);
                            updateStatus("Processing photo...");
                            
                            long imageId = System.currentTimeMillis();
                            
                            new Thread(() -> processAndWatermarkImage(savedUri, name + ".jpg", imageId)).start();
                        }
                    }

                    @Override
                    public void onError(@NonNull ImageCaptureException exc) {
                        Log.e(TAG, "Photo capture failed: " + exc.getMessage(), exc);
                        updateStatus("Capture failed!");
                        captureButton.setEnabled(true);
                    }
                }
        );
    }

    private void processAndWatermarkImage(Uri imageUri, String displayName, long imageId) {
        try {
            InputStream inputStream = getContentResolver().openInputStream(imageUri);
            if (inputStream == null) return;

            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeStream(inputStream, null, options);
            inputStream.close();

            int imageWidth = options.outWidth;
            int imageHeight = options.outHeight;

            inputStream = getContentResolver().openInputStream(imageUri);
            if (inputStream == null) return;

            options.inJustDecodeBounds = false;
            options.inSampleSize = 1;
            options.inPreferredConfig = Bitmap.Config.ARGB_8888;

            Bitmap fullBitmap = BitmapFactory.decodeStream(inputStream, null, options);
            inputStream.close();

            if (fullBitmap == null) {
                runOnUiThread(() -> captureButton.setEnabled(true));
                return;
            }
            
            long fileSize = -1;

            runOnUiThread(() -> updateStatus("Embedding Invisible Watermark..."));
            String payload = "proofKrypt-" + imageId;
            Bitmap watermarkedBitmap = WatermarkUtils.embedDCTWatermark(fullBitmap, payload);
            
            try {
                OutputStream out = getContentResolver().openOutputStream(imageUri, "wt");
                if (out != null) {
                    watermarkedBitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
                    out.flush();
                    out.close();
                    Log.d(TAG, "Successfully replaced the original photo with the watermarked version.");
                    
                    fileSize = fullBitmap.getByteCount();
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to replace original photo", e);
                File directory = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES);
                File outFile = new File(directory, "watermarked_" + imageId + ".png");
                try {
                    java.io.FileOutputStream fallbackOut = new java.io.FileOutputStream(outFile);
                    watermarkedBitmap.compress(Bitmap.CompressFormat.PNG, 100, fallbackOut);
                    fallbackOut.flush();
                    fallbackOut.close();
                    
                    android.media.MediaScannerConnection.scanFile(this, 
                        new String[]{outFile.getAbsolutePath()}, 
                        new String[]{"image/png"}, 
                        null);
                        
                    Log.d(TAG, "Fallback save successful.");
                    fileSize = outFile.length();
                } catch (Exception ex) {
                    Log.e(TAG, "Fallback save failed", ex);
                }
            }

            runOnUiThread(() -> updateStatus("Generating Signature..."));
            sendSignatureToDatabase(imageId, null);

            Bitmap displayBitmap = createDisplayBitmap(imageUri);

            photosCapturedCount++;
            
            final long finalFileSize = fileSize;
            
            runOnUiThread(() -> {
                try {
                    imageView.setVisibility(View.VISIBLE);
                    imageView.setImageDrawable(null);
                    imageView.setImageBitmap(displayBitmap);
                    imageView.invalidate();

                    updateStatus("Ready");
                    updateResolution(String.format("%dx%d | %.2f MB",
                            imageWidth, imageHeight, finalFileSize / (1024.0 * 1024.0)));
                    updatePhotoCount();
                    
                    captureButton.setEnabled(true);

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
            Log.e(TAG, "Error processing image", e);
            runOnUiThread(() -> captureButton.setEnabled(true));
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
                Log.d(TAG, "Uploading to Supabase...");
                // Supabase REST API endpoint for the 'signatures' table
                java.net.URL url = new java.net.URL("https://zvddeaxqkygtppwvlycn.supabase.co/rest/v1/signatures");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setRequestProperty("Accept", "application/json");
                // Add Supabase authentication headers
                conn.setRequestProperty("apikey", "sb_publishable_UW7LOZp-os9-TIO0P0NAiA_0PvLfZrJ");
                conn.setRequestProperty("Authorization", "Bearer sb_publishable_UW7LOZp-os9-TIO0P0NAiA_0PvLfZrJ");
                conn.setRequestProperty("Prefer", "return=minimal"); // Don't need the inserted row back
                conn.setDoOutput(true);
                conn.setDoInput(true);
                conn.setConnectTimeout(15000);

                SimpleDateFormat isoFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                isoFormat.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                String isoTimestamp = isoFormat.format(new Date());

                JSONObject jsonBody = new JSONObject();
                jsonBody.put("image_id", "ANDROID-" + imageId);
                jsonBody.put("author", CAPTURED_BY);
                jsonBody.put("device_model", Build.MODEL);
                jsonBody.put("timestamp", isoTimestamp);
                // The column in Supabase is constellation_data
                jsonBody.put("constellation_data", "proofKrypt-" + imageId);

                String jsonInputString = jsonBody.toString();

                byte[] input = jsonInputString.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                conn.setRequestProperty("Content-Length", String.valueOf(input.length));

                try(java.io.OutputStream os = conn.getOutputStream()) {
                    os.write(input, 0, input.length);
                    os.flush();
                }

                int code = conn.getResponseCode();
                Log.d(TAG, "Response Code: " + code);

                if(code >= 200 && code < 300) {
                    Log.d(TAG, "Successfully registered signature with Supabase");
                } else {
                    java.io.InputStream err = conn.getErrorStream();
                    if(err != null) {
                        java.util.Scanner s = new java.util.Scanner(err).useDelimiter("\\A");
                        Log.e(TAG, "Supabase Rejected: " + (s.hasNext() ? s.next() : ""));
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Error: " + e.getMessage());
                e.printStackTrace();
            }
        }).start();
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
            photoCountText.setText(String.format("Photos: %d", photosCapturedCount));
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        cameraExecutor.shutdown();
    }
}