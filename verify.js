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
        
        // 1. Extract Geometric Constellation Signature (Resolution-Invariant 8x8 Grid)
        let extractedConstellation = extractConstellation(canvas);
        console.log("Extracted 64-star constellation from uploaded image");

        // 2. Extract Invisible Watermark (if preserved)
        let extractedPayload = await extractDCTWatermark(canvas);
        console.log("Extracted payload:", extractedPayload);
        
        document.querySelector('#loading p').textContent = "Querying Global Database...";
        
        let isMatch = false;
        let dataToDisplay = null;

        // --- PATH A: Watermark Detected ---
        if (extractedPayload && extractedPayload.trim().length > 0) {
            const rawId = extractedPayload.replace("proofKrypt-", "");
            
            // Try query by image_id (ANDROID-[id]) or constellation_data
            const exactUrl = `https://zvddeaxqkygtppwvlycn.supabase.co/rest/v1/signatures?or=(image_id.eq.ANDROID-${encodeURIComponent(rawId)},constellation_data.eq.${encodeURIComponent(extractedPayload)})&select=*&limit=1`;
            const exactResponse = await fetch(exactUrl, {
                method: 'GET',
                headers: { 
                    'apikey': 'sb_publishable_UW7LOZp-os9-TIO0P0NAiA_0PvLfZrJ',
                    'Authorization': 'Bearer sb_publishable_UW7LOZp-os9-TIO0P0NAiA_0PvLfZrJ',
                    'Accept': 'application/json'
                }
            });

            if (exactResponse.ok) {
                const exactRows = await exactResponse.json();
                if (exactRows && exactRows.length > 0) {
                    const match = exactRows[0];
                    isMatch = true;

                    // If match contains constellation JSON, verify geometric consistency
                    let constellScore = null;
                    try {
                        if (match.constellation_data && match.constellation_data.startsWith('[')) {
                            const origStars = JSON.parse(match.constellation_data);
                            constellScore = compareConstellations(extractedConstellation, origStars);
                        }
                    } catch (e) { console.warn("Constellation parse error:", e); }

                    dataToDisplay = {
                        matchType: 'exact',
                        similarity: 1.0,
                        constellationScore: constellScore ? constellScore.score : null,
                        registeredPayload: extractedPayload,
                        metadata: {
                            author: match.author,
                            device: match.device_model,
                            original_timestamp: match.timestamp,
                            image_id: match.image_id,
                            registered_at: match.created_at || match.timestamp
                        }
                    };
                    console.log("✅ Exact match found:", match);
                }
            }

            // Fuzzy Watermark Fallback (minor bit flips)
            if (!isMatch) {
                console.log("Exact match failed, running Fuzzy Matching fallback...");
                document.querySelector('#loading p').textContent = "Analyzing signature similarity...";
                
                const candUrl = `https://zvddeaxqkygtppwvlycn.supabase.co/rest/v1/signatures?select=*&order=created_at.desc&limit=100`;
                const candResponse = await fetch(candUrl, {
                    method: 'GET',
                    headers: { 
                        'apikey': 'sb_publishable_UW7LOZp-os9-TIO0P0NAiA_0PvLfZrJ',
                        'Authorization': 'Bearer sb_publishable_UW7LOZp-os9-TIO0P0NAiA_0PvLfZrJ',
                        'Accept': 'application/json'
                    }
                });

                if (candResponse.ok) {
                    const candRows = await candResponse.json();
                    let bestMatch = null;
                    let highestSim = 0;

                    for (const cand of candRows) {
                        const refPayload = cand.image_id ? cand.image_id.replace("ANDROID-", "proofKrypt-") : cand.constellation_data;
                        if (!refPayload) continue;
                        const sim = calculateSimilarity(extractedPayload, refPayload);
                        if (sim > highestSim) {
                            highestSim = sim;
                            bestMatch = cand;
                        }
                    }

                    if (highestSim >= 0.80 && bestMatch) {
                        isMatch = true;
                        dataToDisplay = {
                            matchType: 'fuzzy',
                            similarity: highestSim,
                            registeredPayload: bestMatch.image_id ? bestMatch.image_id.replace("ANDROID-", "proofKrypt-") : bestMatch.constellation_data,
                            metadata: {
                                author: bestMatch.author,
                                device: bestMatch.device_model,
                                original_timestamp: bestMatch.timestamp,
                                image_id: bestMatch.image_id,
                                registered_at: bestMatch.created_at || bestMatch.timestamp
                            }
                        };
                        console.log("🛡️ High-confidence fuzzy match found:", bestMatch);
                    }
                }
            }
        }

        // --- PATH B: Watermark Missing (Social Media Resizing / Cropping) -> Geometric Constellation Fallback ---
        if (!isMatch) {
            console.log("No watermark detected or matched. Running Geometric Constellation search...");
            document.querySelector('#loading p').textContent = "Watermark missing (likely resized). Checking Geometric Constellation...";

            const candUrl = `https://zvddeaxqkygtppwvlycn.supabase.co/rest/v1/signatures?select=*&order=created_at.desc&limit=100`;
            const candResponse = await fetch(candUrl, {
                method: 'GET',
                headers: { 
                    'apikey': 'sb_publishable_UW7LOZp-os9-TIO0P0NAiA_0PvLfZrJ',
                    'Authorization': 'Bearer sb_publishable_UW7LOZp-os9-TIO0P0NAiA_0PvLfZrJ',
                    'Accept': 'application/json'
                }
            });

            if (candResponse.ok) {
                const candRows = await candResponse.json();
                let bestConstellMatch = null;
                let highestScore = 0;
                let bestAvgDist = 1.0;

                for (const cand of candRows) {
                    if (!cand.constellation_data || !cand.constellation_data.startsWith('[')) continue;
                    try {
                        const candStars = JSON.parse(cand.constellation_data);
                        const comp = compareConstellations(extractedConstellation, candStars);
                        if (comp.score > highestScore) {
                            highestScore = comp.score;
                            bestAvgDist = comp.avgDistance;
                            bestConstellMatch = cand;
                        }
                    } catch (e) { /* skip unparseable */ }
                }

                console.log(`Highest constellation match score: ${highestScore.toFixed(1)}% (drift: ${(bestAvgDist * 100).toFixed(2)}%)`);

                // Threshold: >= 75% structural match verifies the photo across resizing/screenshots
                if (highestScore >= 75 && bestConstellMatch) {
                    isMatch = true;
                    dataToDisplay = {
                        matchType: 'constellation',
                        similarity: highestScore / 100.0,
                        avgDistance: bestAvgDist,
                        registeredPayload: bestConstellMatch.image_id,
                        metadata: {
                            author: bestConstellMatch.author,
                            device: bestConstellMatch.device_model,
                            original_timestamp: bestConstellMatch.timestamp,
                            image_id: bestConstellMatch.image_id,
                            registered_at: bestConstellMatch.created_at || bestConstellMatch.timestamp
                        }
                    };
                    console.log("✨ Authentic image verified via Geometric Constellation:", bestConstellMatch);
                }
            }
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

// --- 1D K-Means Thresholding ---
function findKMeansThreshold(values) {
    if (!values || values.length === 0) return 0.0;
    let minV = values[0], maxV = values[0];
    for (let v of values) {
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
    }
    if (minV >= maxV) return 0.0;

    let sorted = [...values].sort((a, b) => a - b);
    let c0 = sorted[Math.floor(sorted.length * 0.25)];
    let c1 = sorted[Math.floor(sorted.length * 0.75)];
    if (c0 === c1) {
        c0 = minV;
        c1 = maxV;
    }

    for (let iter = 0; iter < 20; iter++) {
        let thresh = (c0 + c1) / 2.0;
        let sum0 = 0, count0 = 0;
        let sum1 = 0, count1 = 0;
        for (let v of values) {
            if (v < thresh) {
                sum0 += v;
                count0++;
            } else {
                sum1 += v;
                count1++;
            }
        }
        let newC0 = count0 > 0 ? sum0 / count0 : c0;
        let newC1 = count1 > 0 ? sum1 / count1 : c1;

        if (Math.abs(newC0 - c0) < 1e-4 && Math.abs(newC1 - c1) < 1e-4) {
            break;
        }
        c0 = newC0;
        c1 = newC1;
    }
    return (c0 + c1) / 2.0;
}

async function extractDCTWatermark(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    
    const padWidth = width - (width % 8);
    const padHeight = height - (height % 8);
    
    const imageData = ctx.getImageData(0, 0, padWidth, padHeight);
    const pixels = imageData.data;
    
    // Multi-Channel Color Separation: Y, Cb, Cr
    let Y = new Float32Array(padWidth * padHeight);
    let Cb = new Float32Array(padWidth * padHeight);
    let Cr = new Float32Array(padWidth * padHeight);
    
    for (let by = 0; by < padHeight; by++) {
        for (let bx = 0; bx < padWidth; bx++) {
            let pIdx = (by * padWidth + bx) * 4;
            let r = pixels[pIdx];
            let g = pixels[pIdx+1];
            let b = pixels[pIdx+2];
            let idx = by * padWidth + bx;
            
            Y[idx]  =  0.299 * r + 0.587 * g + 0.114 * b;
            Cb[idx] = -0.1687 * r - 0.3313 * g + 0.500 * b + 128.0;
            Cr[idx] =  0.500 * r - 0.4187 * g - 0.0813 * b + 128.0;
        }
    }
    
    // Spreading logic (block selection)
    const numBlocks = (padWidth / 8) * (padHeight / 8);
    let prng = new PRNG(PRNG_SEED);
    let blockIndices = Array.from({length: numBlocks}, (_, i) => i);
    for (let i = numBlocks - 1; i > 0; i--) {
        let j = prng.next() % (i + 1);
        let temp = blockIndices[i];
        blockIndices[i] = blockIndices[j];
        blockIndices[j] = temp;
    }
    
    let blocksW = padWidth / 8;
    
    // Helper to compute continuous soft differential across Y + Cb + Cr
    function getSoftDiff(blockSeqIdx) {
        let bIdx = blockIndices[blockSeqIdx];
        let by = Math.floor(bIdx / blocksW) * 8;
        let bx = (bIdx % blocksW) * 8;
        
        let blockY = [], blockCb = [], blockCr = [];
        for (let r = 0; r < 8; r++) {
            blockY[r] = [];
            blockCb[r] = [];
            blockCr[r] = [];
            for (let c = 0; c < 8; c++) {
                let pixelIdx = (by + r) * padWidth + (bx + c);
                blockY[r][c]  = Y[pixelIdx];
                blockCb[r][c] = Cb[pixelIdx];
                blockCr[r][c] = Cr[pixelIdx];
            }
        }
        
        let dctY  = compute2DDCT(blockY);
        let dctCb = compute2DDCT(blockCb);
        let dctCr = compute2DDCT(blockCr);
        
        let pair = PAIRS[blockSeqIdx % PAIRS.length];
        let r1 = pair[0][0], c1 = pair[0][1];
        let r2 = pair[1][0], c2 = pair[1][1];
        
        let diffY  = dctY[r1][c1]  - dctY[r2][c2];
        let diffCb = dctCb[r1][c1] - dctCb[r2][c2];
        let diffCr = dctCr[r1][c1] - dctCr[r2][c2];
        
        // Multi-channel fused soft score
        return 1.0 * diffY + 0.8 * diffCb + 0.8 * diffCr;
    }
    
    // 1. Extract 392 Header Blocks (uninterleaved, 7x redundant)
    if (numBlocks < 392) return "";
    
    let headerSoft = [];
    for (let i = 0; i < 392; i++) {
        headerSoft.push(getSoftDiff(i));
    }
    
    let headerChunkSize = 392 / REDUNDANCY; // 56
    let headerVoted = [];
    for (let i = 0; i < headerChunkSize; i++) {
        let sum = 0;
        for (let r = 0; r < REDUNDANCY; r++) {
            sum += headerSoft[i + r * headerChunkSize];
        }
        headerVoted.push(sum / REDUNDANCY);
    }
    
    let headerThresh = findKMeansThreshold(headerVoted);
    let headerBits = headerVoted.map(v => (v >= headerThresh ? 1 : 0));
    let headerRaw = hammingDecode(headerBits);
    
    // Fallback if K-Means threshold drifted
    if (headerRaw.length < 32 || headerRaw.slice(0, 16).some((b, idx) => b !== MAGIC_BITS[idx])) {
        headerBits = headerVoted.map(v => (v >= 0.0 ? 1 : 0));
        headerRaw = hammingDecode(headerBits);
    }
    
    if (headerRaw.length < 32) return "";
    let magicMatch = true;
    for (let i = 0; i < 16; i++) {
        if (headerRaw[i] !== MAGIC_BITS[i]) magicMatch = false;
    }
    if (!magicMatch) {
        console.log("No watermark detected (magic marker mismatch v3)");
        return "";
    }
    
    console.log("✅ Magic marker 'PK' found (v3 multi-channel soft)!");
    
    let lengthBits = headerRaw.slice(16, 32);
    let payloadLength = 0;
    for (let b of lengthBits) payloadLength = (payloadLength << 1) | b;
    
    console.log(`Payload length: ${payloadLength} bits (${Math.floor(payloadLength / 8)} chars)`);
    
    // 2. Extract and Soft-Average Payload Blocks
    let payloadEccLen = Math.ceil(payloadLength / 4) * 7;
    let payloadRedundantLen = payloadEccLen * REDUNDANCY;
    
    if (392 + payloadRedundantLen > numBlocks) {
        console.log("Warning: image too small for encoded payload length");
        return "";
    }
    
    let payloadSoft = [];
    for (let i = 0; i < payloadRedundantLen; i++) {
        payloadSoft.push(getSoftDiff(392 + i));
    }
    
    // Analog de-interleave the floating-point soft differences
    let deinterleavedSoft = deinterleave(payloadSoft, PRNG_SEED);
    
    // Soft average across the 7 redundant copies
    let payloadVoted = [];
    for (let i = 0; i < payloadEccLen; i++) {
        let sum = 0;
        for (let r = 0; r < REDUNDANCY; r++) {
            sum += deinterleavedSoft[i + r * payloadEccLen];
        }
        payloadVoted.push(sum / REDUNDANCY);
    }
    
    // K-Means clustering decision (with zero fallback)
    let payloadThresh = findKMeansThreshold(payloadVoted);
    let payloadEccBits = payloadVoted.map(v => (v >= payloadThresh ? 1 : 0));
    let payloadRaw = hammingDecode(payloadEccBits);
    
    let text = bitsToText(payloadRaw.slice(0, payloadLength));
    return text;
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

// --- Geometric Constellation Extraction & Matching (Resolution-Invariant) ---
function extractConstellation(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    const gridSize = 8; // 8x8 Grid = 64 Stars
    const cellW = width / gridSize;
    const cellH = height / gridSize;
    let stars = [];

    for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
            const startX = Math.floor(col * cellW);
            const startY = Math.floor(row * cellH);
            const w = Math.min(Math.floor(cellW), width - startX);
            const h = Math.min(Math.floor(cellH), height - startY);

            if (w <= 0 || h <= 0) {
                stars.push({ row, col, x: col / 8.0, y: row / 8.0, b: 0 });
                continue;
            }

            const imgData = ctx.getImageData(startX, startY, w, h);
            const d = imgData.data;
            let maxVal = -1;
            let maxX = 0;
            let maxY = 0;

            for (let y = 0; y < h; y++) {
                const rowOffset = y * w * 4;
                for (let x = 0; x < w; x++) {
                    const idx = rowOffset + (x * 4);
                    const brightness = 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
                    if (brightness > maxVal) {
                        maxVal = brightness;
                        maxX = x;
                        maxY = y;
                    }
                }
            }

            stars.push({
                row: row,
                col: col,
                x: parseFloat(((startX + maxX) / width).toFixed(4)),
                y: parseFloat(((startY + maxY) / height).toFixed(4)),
                b: parseFloat((maxVal / 255).toFixed(2))
            });
        }
    }
    return stars;
}

function compareConstellations(current, original) {
    if (!current || !original || current.length !== 64 || original.length !== 64) {
        return { score: 0, avgDistance: 1.0, passed: false };
    }
    let totalDist = 0;
    for (let i = 0; i < 64; i++) {
        const p1 = current[i];
        const p2 = original[i];
        const dist = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
        totalDist += dist;
    }
    const avgDist = totalDist / 64.0;
    const score = Math.max(0, 100 - (avgDist * 500)); // avgDist <= 0.04 (4%) gives score >= 80%
    return {
        score: score,
        avgDistance: avgDist,
        passed: score >= 75
    };
}

// --- Levenshtein Distance & Similarity Calculation ---
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1.0;
    
    const len1 = str1.length;
    const len2 = str2.length;
    const maxLen = Math.max(len1, len2);
    if (maxLen === 0) return 1.0;
    
    let prev = new Array(len2 + 1);
    let curr = new Array(len2 + 1);
    
    for (let j = 0; j <= len2; j++) prev[j] = j;
    
    for (let i = 1; i <= len1; i++) {
        curr[0] = i;
        const char1 = str1.charCodeAt(i - 1);
        for (let j = 1; j <= len2; j++) {
            const cost = (char1 === str2.charCodeAt(j - 1)) ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,        // deletion
                curr[j - 1] + 1,    // insertion
                prev[j - 1] + cost  // substitution
            );
        }
        for (let j = 0; j <= len2; j++) prev[j] = curr[j];
    }
    
    const distance = prev[len2];
    return Math.max(0, 1 - (distance / maxLen));
}

function displayResults(isMatch, extractedPayload, dbData) {
    document.getElementById('resultContainer').style.display = 'block';
    
    const pf = document.getElementById('progressFill');
    const resultIcon = document.getElementById('resultIcon');
    const resultTitle = document.getElementById('resultTitle');
    const resultSubtitle = document.getElementById('resultSubtitle');

    if (isMatch) {
        if (dbData && dbData.matchType === 'constellation') {
            const pct = Math.round((dbData.similarity || 0.8) * 100);
            pf.style.width = `${pct}%`;
            pf.textContent = `${pct}% Landmark Match`;
            pf.style.background = 'linear-gradient(90deg, #9C27B0 0%, #2196F3 100%)';
            resultIcon.textContent = '✨';
            resultTitle.textContent = `Authentic Image - Constellation Match (${pct}%)`;
            resultSubtitle.textContent = 'Watermark was stripped (social media downscaling/resizing), but the 64-star Geometric Constellation verifies this image is authentic!';
        } else if (dbData && dbData.matchType === 'fuzzy') {
            const pct = Math.round((dbData.similarity || 0.85) * 100);
            pf.style.width = `${pct}%`;
            pf.textContent = `${pct}% Match`;
            pf.style.background = 'linear-gradient(90deg, #FF9800 0%, #4CAF50 100%)';
            resultIcon.textContent = '🛡️';
            resultTitle.textContent = `Authentic Image - High Confidence (${pct}%)`;
            resultSubtitle.textContent = 'Verified match found with minor JPEG compression / transmission noise.';
        } else {
            pf.style.width = '100%';
            pf.textContent = '100% Match';
            pf.style.background = 'linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%)';
            resultIcon.textContent = '✅';
            resultTitle.textContent = 'Authentic Image - Exact Match Found';
            resultSubtitle.textContent = 'This image is registered in the global provenance database.';
        }
    } else {
        pf.style.width = '0%';
        pf.textContent = '0%';
        pf.style.background = 'linear-gradient(90deg, #F44336 0%, #E91E63 100%)';
        resultIcon.textContent = '❌';
        resultTitle.textContent = 'Unregistered or Modified';
        resultSubtitle.textContent = 'Neither the invisible watermark nor the geometric constellation matched any registered image.';
    }
    
    let dbDetails = '';
    if (isMatch && dbData && dbData.metadata) {
        let integrityBadge = '';
        if (dbData.matchType === 'constellation') {
            integrityBadge = `<p style="margin: 5px 0; color: #BA68C8;"><strong>Verification Method:</strong> Geometric Constellation Landmark Hashing (Resolution-Invariant)</p>
               <p style="margin: 5px 0; color: #4CAF50;"><strong>Constellation Match:</strong> ${Math.round(dbData.similarity * 100)}% (Avg Drift: ${(dbData.avgDistance * 100).toFixed(1)}%)</p>`;
        } else if (dbData.matchType === 'fuzzy') {
            integrityBadge = `<p style="margin: 5px 0; color: #FFB300;"><strong>Signal Integrity:</strong> ${Math.round(dbData.similarity * 100)}% (Compression noise detected)</p>
               <p style="margin: 5px 0; color: #aaa; font-size: 0.85em;"><strong>Registered Signature:</strong> <span style="color:#4CAF50; font-family: monospace;">${dbData.registeredPayload}</span></p>`;
        } else {
            const constellText = (dbData.constellationScore !== null) 
                ? ` + Constellation Integrity: ${Math.round(dbData.constellationScore)}%`
                : '';
            integrityBadge = `<p style="margin: 5px 0; color: #4CAF50;"><strong>Signal Integrity:</strong> 100% Lossless Watermark${constellText}</p>`;
        }

        dbDetails = `
            ${integrityBadge}
            <p style="margin: 5px 0; color: #4CAF50;"><strong>Verified Author:</strong> ${dbData.metadata.author || 'Unknown'}</p>
            <p style="margin: 5px 0; color: #4CAF50;"><strong>Device:</strong> ${dbData.metadata.device || 'Unknown'}</p>
            <p style="margin: 5px 0; color: #4CAF50;"><strong>Timestamp:</strong> ${dbData.metadata.original_timestamp || 'Unknown'}</p>
            <p style="margin: 5px 0; color: #aaa; font-size: 0.85em;"><strong>Image ID:</strong> ${dbData.metadata.image_id || 'Unknown'}</p>
        `;
    }
    
    const detailsHtml = `
        <div style="margin-top: 15px; text-align: left; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px;">
            <p style="margin: 5px 0; color: #aaa; font-size: 0.9em;">Extracted Payload / Landmark Status:</p>
            <p style="margin: 5px 0; color: white; font-family: monospace; word-break: break-all;">${extractedPayload || "[Watermark stripped by resizing - Constellation active]"}</p>
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