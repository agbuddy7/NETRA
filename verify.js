let uploadedImage = null;

document.addEventListener('DOMContentLoaded', () => {
    setupDropZones();
    setupVerifyButton();
});

function setupDropZones() {
    const imageDropZone = document.getElementById('imageDropZone');
    const imageInput = document.getElementById('imageInput');
    
    imageDropZone.addEventListener('click', () => imageInput.click());
    imageDropZone.addEventListener('dragover', handleDragOver);
    imageDropZone.addEventListener('dragleave', (e) => e.currentTarget.classList.remove('active'));
    imageDropZone.addEventListener('drop', (e) => handleDrop(e, 'image'));
    imageInput.addEventListener('change', (e) => handleFileSelect(e, 'image'));
}

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('active');
}

function handleDrop(e, type) {
    e.preventDefault();
    e.currentTarget.classList.remove('active');
    const files = e.dataTransfer.files;
    if (files.length > 0) processFile(files[0], type);
}

function handleFileSelect(e, type) {
    const files = e.target.files;
    if (files.length > 0) processFile(files[0], type);
}

function processFile(file, type) {
    if (type === 'image') {
        if (!file.type.startsWith('image/')) {
            showError('Please upload a valid image file');
            return;
        }
        
        uploadedImage = file;
        document.getElementById('imageInfo').textContent = `✓ ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        document.getElementById('imageInfo').classList.add('show');
        document.getElementById('verifyButton').disabled = false;
    }
}

function setupVerifyButton() {
    document.getElementById('verifyButton').addEventListener('click', startVerification);
}

async function startVerification() {
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('resultContainer').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
    
    try {
        console.log('Starting verification...');
        
        // Load image to canvas
        const canvas = await loadImageToCanvas(uploadedImage);
        console.log('Image loaded:', canvas.width, 'x', canvas.height);
        
        // Extract watermark (v2: auto-detects length from embedded header)
        let extractedPayload = await extractDCTWatermark(canvas);
        
        console.log("Extracted payload:", extractedPayload);
        
        document.querySelector('#loading p').textContent = "Querying Global Database...";
        
        // Query Supabase Directly
        const url = `https://zvddeaxqkygtppwvlycn.supabase.co/rest/v1/signatures?constellation_data=eq.${encodeURIComponent(extractedPayload)}&select=*&limit=1`;
        const response = await fetch(url, {
            method: 'GET',
            headers: { 
                'apikey': 'sb_publishable_UW7LOZp-os9-TIO0P0NAiA_0PvLfZrJ',
                'Authorization': 'Bearer sb_publishable_UW7LOZp-os9-TIO0P0NAiA_0PvLfZrJ',
                'Accept': 'application/json'
            }
        });
        
        const rows = await response.json();
        console.log("Supabase response:", rows);
        
        const isMatch = rows && rows.length > 0;
        let dataToDisplay = null;
        
        if (isMatch) {
            const match = rows[0];
            dataToDisplay = {
                metadata: {
                    author: match.author,
                    device: match.device_model,
                    original_timestamp: match.timestamp,
                    image_id: match.image_id,
                    registered_at: match.created_at || match.timestamp
                }
            };
        }
        
        displayResults(isMatch, extractedPayload, dataToDisplay);
        
    } catch (error) {
        console.error('Verification error:', error);
        showError('Verification failed: ' + error.message);
    } finally {
        document.getElementById('loading').style.display = 'none';
        document.querySelector('#loading p').textContent = "Extracting invisible watermark...";
    }
}

function loadImageToCanvas(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas);
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

// ----------------------------------------------------------------------------
// DCT MATH v2 - Matches WatermarkUtils.java and dct_watermark.py exactly
// ----------------------------------------------------------------------------
const ALPHA = 30.0;
const COEFF_U = 3;
const COEFF_V = 1;
const REDUNDANCY = 7;
const MAGIC_BITS = [
    0,1,0,1,0,0,0,0,  // 0x50 = 'P'
    0,1,0,0,1,0,1,1   // 0x4B = 'K'
];

// Precomputed cosine table
const COS_TABLE = [];
for (let n = 0; n < 8; n++) {
    COS_TABLE[n] = [];
    for (let k = 0; k < 8; k++) {
        COS_TABLE[n][k] = Math.cos((2.0 * n + 1.0) * k * Math.PI / 16.0);
    }
}
const C0 = 1.0 / Math.sqrt(2.0);

async function extractDCTWatermark(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    
    const padWidth = width - (width % 8);
    const padHeight = height - (height % 8);
    
    const imageData = ctx.getImageData(0, 0, padWidth, padHeight);
    const pixels = imageData.data;
    
    // Step 1: Extract raw bits from every block
    const rawBitsPerBlock = [];
    
    for (let y = 0; y < padHeight; y += 8) {
        for (let x = 0; x < padWidth; x += 8) {
            // Build 8x8 luminance block using shared formula
            let block = [];
            for (let i = 0; i < 8; i++) {
                block[i] = [];
                for (let j = 0; j < 8; j++) {
                    let pIdx = ((y + i) * padWidth + (x + j)) * 4;
                    let r = pixels[pIdx];
                    let g = pixels[pIdx+1];
                    let b = pixels[pIdx+2];
                    block[i][j] = 0.299 * r + 0.587 * g + 0.114 * b;
                }
            }
            
            let dctBlock = compute2DDCT(block);
            let coeff = dctBlock[COEFF_U][COEFF_V];
            let q = Math.round(coeff / ALPHA);
            
            rawBitsPerBlock.push((q % 2 === 0) ? 0 : 1);
        }
    }
    
    // Step 2: Majority voting to decode logical bits
    const logicalBits = [];
    for (let i = 0; i < rawBitsPerBlock.length; i += REDUNDANCY) {
        let chunk = rawBitsPerBlock.slice(i, i + REDUNDANCY);
        if (chunk.length < REDUNDANCY) break;
        let ones = chunk.reduce((a, b) => a + b, 0);
        logicalBits.push(ones > Math.floor(REDUNDANCY / 2) ? 1 : 0);
    }
    
    // Step 3: Check magic marker
    if (logicalBits.length < 32) {
        console.log("Image too small for watermark header");
        return "";
    }
    
    const magic = logicalBits.slice(0, 16);
    let magicMatch = true;
    for (let i = 0; i < 16; i++) {
        if (magic[i] !== MAGIC_BITS[i]) {
            magicMatch = false;
            break;
        }
    }
    
    if (!magicMatch) {
        console.log("No watermark detected (magic marker mismatch)");
        console.log("Expected:", MAGIC_BITS.join(''));
        console.log("Got:     ", magic.join(''));
        return "";
    }
    
    console.log("✅ Magic marker 'PK' found!");
    
    // Step 4: Read length header
    const lengthBits = logicalBits.slice(16, 32);
    let payloadLength = 0;
    for (let b of lengthBits) {
        payloadLength = (payloadLength << 1) | b;
    }
    console.log(`Payload length: ${payloadLength} bits (${Math.floor(payloadLength / 8)} chars)`);
    
    // Step 5: Extract payload
    const totalNeeded = 32 + payloadLength;
    let payloadBits;
    if (logicalBits.length < totalNeeded) {
        console.log("Warning: truncated payload");
        payloadBits = logicalBits.slice(32);
    } else {
        payloadBits = logicalBits.slice(32, totalNeeded);
    }
    
    return bitsToText(payloadBits);
}

function compute2DDCT(input) {
    // Separable 2D DCT using precomputed cosine table
    let temp = [];
    let output = [];

    // 1D DCT on rows
    for (let i = 0; i < 8; i++) {
        temp[i] = [];
        for (let k = 0; k < 8; k++) {
            let sum = 0.0;
            for (let n = 0; n < 8; n++) {
                sum += input[i][n] * COS_TABLE[n][k];
            }
            let ck = (k === 0) ? C0 : 1.0;
            temp[i][k] = 0.5 * ck * sum;
        }
    }

    // 1D DCT on columns
    for (let k = 0; k < 8; k++) {
        output[k] = [];
        for (let j = 0; j < 8; j++) {
            let sum = 0.0;
            for (let n = 0; n < 8; n++) {
                sum += temp[n][j] * COS_TABLE[n][k];
            }
            let ck = (k === 0) ? C0 : 1.0;
            output[k][j] = 0.5 * ck * sum;
        }
    }
    return output;
}

function bitsToText(bits) {
    let str = "";
    for (let i = 0; i < bits.length; i += 8) {
        let byteBits = bits.slice(i, i + 8);
        if (byteBits.length < 8) break;
        let byteVal = parseInt(byteBits.join(''), 2);
        str += String.fromCharCode(byteVal);
    }
    return str;
}

function displayResults(isMatch, extractedPayload, dbData) {
    document.getElementById('resultContainer').style.display = 'block';
    
    const pf = document.getElementById('progressFill');
    if (isMatch) {
        pf.style.width = '100%';
        pf.textContent = '100%';
        pf.style.background = 'linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%)';
        document.getElementById('resultIcon').textContent = '✅';
        document.getElementById('resultTitle').textContent = 'Authentic Image - Match Found';
        document.getElementById('resultSubtitle').textContent = 'This image is registered in the global provenance database.';
    } else {
        pf.style.width = '0%';
        pf.textContent = '0%';
        pf.style.background = 'linear-gradient(90deg, #F44336 0%, #E91E63 100%)';
        document.getElementById('resultIcon').textContent = '❌';
        document.getElementById('resultTitle').textContent = 'Unregistered or Modified';
        document.getElementById('resultSubtitle').textContent = 'The extracted watermark does not match any registered image.';
    }
    
    let dbDetails = '';
    if (isMatch && dbData && dbData.metadata) {
        dbDetails = `
            <p style="margin: 5px 0; color: #4CAF50;"><strong>Verified Author:</strong> ${dbData.metadata.author || 'Unknown'}</p>
            <p style="margin: 5px 0; color: #4CAF50;"><strong>Device:</strong> ${dbData.metadata.device || 'Unknown'}</p>
            <p style="margin: 5px 0; color: #4CAF50;"><strong>Timestamp:</strong> ${dbData.metadata.original_timestamp || 'Unknown'}</p>
        `;
    }
    
    const detailsHtml = `
        <div style="margin-top: 15px; text-align: left; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px;">
            <p style="margin: 5px 0; color: #aaa; font-size: 0.9em;">Extracted Payload:</p>
            <p style="margin: 5px 0; color: white; font-family: monospace; word-break: break-all;">${extractedPayload || "[Nothing Extracted]"}</p>
            <div style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
                ${dbDetails}
            </div>
        </div>
    `;
    
    const matchGrid = document.querySelector('.match-grid');
    if (matchGrid) {
        matchGrid.innerHTML = detailsHtml;
    }
}

function showError(msg) {
    document.getElementById('errorMessage').textContent = '⚠️ ' + msg;
    document.getElementById('errorMessage').style.display = 'block';
}