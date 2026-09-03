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
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Supabase returned ${response.status}: ${errText}`);
        }
        
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
// DCT MATH v3 - Matches WatermarkUtils.java and v3_prototype.py exactly
// ----------------------------------------------------------------------------
const REDUNDANCY = 7;
const PRNG_SEED = 123456789;
const MAGIC_BITS = [
    0,1,0,1,0,0,0,0,  // 0x50 = 'P'
    0,1,0,0,1,0,1,1   // 0x4B = 'K'
];
const PAIRS = [
    [[2,3], [3,2]],
    [[1,3], [3,1]],
    [[2,4], [4,2]]
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

// --- LCG PRNG ---
class PRNG {
    constructor(seed) {
        this.state = seed & 0xFFFFFFFF;
    }
    next() {
        // Use BigInt to prevent 32-bit overflow issues in JS before modulo
        this.state = Number((BigInt(this.state) * 1103515245n + 12345n) & 0x7FFFFFFFn);
        return this.state;
    }
}

// --- Hamming Decode ---
function hammingDecode(encodedBits) {
    let decoded = [];
    for (let i = 0; i < encodedBits.length; i += 7) {
        let chunk = encodedBits.slice(i, i + 7);
        if (chunk.length < 7) break;
        
        let p1 = chunk[0], p2 = chunk[1], d1 = chunk[2];
        let p3 = chunk[3], d2 = chunk[4], d3 = chunk[5], d4 = chunk[6];
        
        let s1 = p1 ^ d1 ^ d2 ^ d4;
        let s2 = p2 ^ d1 ^ d3 ^ d4;
        let s3 = p3 ^ d2 ^ d3 ^ d4;
        
        let errorPos = s1 * 1 + s2 * 2 + s3 * 4;
        if (errorPos !== 0) {
            chunk[errorPos - 1] ^= 1; // Correct error
        }
        decoded.push(chunk[2], chunk[4], chunk[5], chunk[6]);
    }
    return decoded;
}

// --- Deinterleave ---
function deinterleave(bits, seed) {
    let prng = new PRNG(seed);
    let indices = Array.from({length: bits.length}, (_, i) => i);
    
    for (let i = indices.length - 1; i > 0; i--) {
        let j = prng.next() % (i + 1);
        let temp = indices[i];
        indices[i] = indices[j];
        indices[j] = temp;
    }
    
    let unshuffled = new Array(bits.length);
    for (let i = 0; i < indices.length; i++) {
        unshuffled[i] = bits[indices[i]];
    }
    return unshuffled;
}

async function extractDCTWatermark(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    
    const padWidth = width - (width % 8);
    const padHeight = height - (height % 8);
    
    const imageData = ctx.getImageData(0, 0, padWidth, padHeight);
    const pixels = imageData.data;
    
    let Y = new Float32Array(padWidth * padHeight);
    for (let by = 0; by < padHeight; by++) {
        for (let bx = 0; bx < padWidth; bx++) {
            let pIdx = (by * padWidth + bx) * 4;
            let r = pixels[pIdx];
            let g = pixels[pIdx+1];
            let b = pixels[pIdx+2];
            Y[by * padWidth + bx] = 0.299 * r + 0.587 * g + 0.114 * b;
        }
    }
    
    // Spreading logic
    const numBlocks = (padWidth / 8) * (padHeight / 8);
    let prng = new PRNG(PRNG_SEED);
    let blockIndices = Array.from({length: numBlocks}, (_, i) => i);
    for (let i = numBlocks - 1; i > 0; i--) {
        let j = prng.next() % (i + 1);
        let temp = blockIndices[i];
        blockIndices[i] = blockIndices[j];
        blockIndices[j] = temp;
    }
    
    // We don't know the exact payload length yet, but max length is e.g. 500 chars (500 * 8 = 4000 logical bits -> + 32 header = 4032 -> * 7/4 ECC = 7056 -> * 7 redundancy = 49392 blocks max). Let's just extract all available blocks up to max capacity.
    const maxExtract = Math.min(numBlocks, 60000); // safety bound
    let extractedBits = [];
    let blocksW = padWidth / 8;
    
    for (let i = 0; i < maxExtract; i++) {
        let bIdx = blockIndices[i];
        let by = Math.floor(bIdx / blocksW) * 8;
        let bx = (bIdx % blocksW) * 8;
        
        let block = [];
        for (let r = 0; r < 8; r++) {
            block[r] = [];
            for (let c = 0; c < 8; c++) {
                block[r][c] = Y[(by + r) * padWidth + (bx + c)];
            }
        }
        
        let dctBlock = compute2DDCT(block);
        
        let pair = PAIRS[i % PAIRS.length];
        let r1 = pair[0][0], c1 = pair[0][1];
        let r2 = pair[1][0], c2 = pair[1][1];
        
        let A = dctBlock[r1][c1];
        let B = dctBlock[r2][c2];
        
        extractedBits.push(A > B ? 1 : 0);
    }
    
    // Recovery
    // Header is first 392 bits (32 bits -> 56 ECC -> 392 Redundant)
    if (extractedBits.length < 392) return "";
    
    let headerBits = extractedBits.slice(0, 392);
    let headerVoted = [];
    let headerChunkSize = 392 / REDUNDANCY;
    for (let i = 0; i < headerChunkSize; i++) {
        let votes = 0;
        for (let r = 0; r < REDUNDANCY; r++) votes += headerBits[i + r * headerChunkSize];
        headerVoted.push(votes > Math.floor(REDUNDANCY / 2) ? 1 : 0);
    }
    
    let headerRaw = hammingDecode(headerVoted);
    if (headerRaw.length < 32) return "";
    
    let magic = headerRaw.slice(0, 16);
    let magicMatch = true;
    for (let i = 0; i < 16; i++) {
        if (magic[i] !== MAGIC_BITS[i]) magicMatch = false;
    }
    if (!magicMatch) {
        console.log("No watermark detected (magic marker mismatch v3)");
        return "";
    }
    
    console.log("✅ Magic marker 'PK' found (v3)!");
    
    let lengthBits = headerRaw.slice(16, 32);
    let payloadLength = 0;
    for (let b of lengthBits) payloadLength = (payloadLength << 1) | b;
    
    console.log(`Payload length: ${payloadLength} bits (${Math.floor(payloadLength / 8)} chars)`);
    
    // Now extract exactly the payload bits
    // payloadLength bits -> (payloadLength * 7/4) ECC -> * 7 Redundancy
    let payloadEccLen = Math.ceil(payloadLength / 4) * 7;
    let payloadRedundantLen = payloadEccLen * REDUNDANCY;
    
    let payloadBits = extractedBits.slice(392, 392 + payloadRedundantLen);
    
    if (payloadBits.length < payloadRedundantLen) {
        console.log("Warning: truncated payload in v3");
        // We can't properly deinterleave if it's truncated, but we try with what we have
    }
    
    let deinterleaved = deinterleave(payloadBits, PRNG_SEED);
    
    let payloadVoted = [];
    let payloadChunkSize = Math.floor(deinterleaved.length / REDUNDANCY);
    for (let i = 0; i < payloadChunkSize; i++) {
        let votes = 0;
        for (let r = 0; r < REDUNDANCY; r++) votes += deinterleaved[i + r * payloadChunkSize];
        payloadVoted.push(votes > Math.floor(REDUNDANCY / 2) ? 1 : 0);
    }
    
    let payloadRaw = hammingDecode(payloadVoted);
    
    return bitsToText(payloadRaw.slice(0, payloadLength));
}

function compute2DDCT(input) {
    let temp = [];
    let output = [];

    for (let i = 0; i < 8; i++) {
        temp[i] = [];
        for (let k = 0; k < 8; k++) {
            let sum = 0.0;
            for (let n = 0; n < 8; n++) sum += input[i][n] * COS_TABLE[n][k];
            let ck = (k === 0) ? C0 : 1.0;
            temp[i][k] = 0.5 * ck * sum;
        }
    }

    for (let k = 0; k < 8; k++) {
        output[k] = [];
        for (let j = 0; j < 8; j++) {
            let sum = 0.0;
            for (let n = 0; n < 8; n++) sum += temp[n][j] * COS_TABLE[n][k];
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