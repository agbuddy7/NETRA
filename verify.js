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
    document.getElementById('errorMessage').classList.remove('show');
    document.getElementById('resultContainer').classList.remove('show');
    document.getElementById('loading').classList.add('show');
    
    try {
        console.log('Starting verification...');
        
        // Load image to canvas
        const canvas = await loadImageToCanvas(uploadedImage);
        console.log('Image loaded:', canvas.width, 'x', canvas.height);
        
        // Extract watermark (extracting up to 24 characters = 192 bits)
        let extractedPayload = await extractDCTWatermark(canvas, 192);
        
        // Clean up extracted string (remove non-printable characters)
        extractedPayload = extractedPayload.replace(/[^\x20-\x7E]/g, '');
        console.log("Extracted clean payload:", extractedPayload);
        
        document.querySelector('#loading p').textContent = "Querying Global Database...";
        
        // Query Database
        const response = await fetch('https://netra-1.onrender.com/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signature: extractedPayload })
        });
        
        const data = await response.json();
        console.log("Database response:", data);
        
        displayResults(data.match, extractedPayload, data);
        
    } catch (error) {
        console.error('Verification error:', error);
        showError('Verification failed: ' + error.message);
    } finally {
        document.getElementById('loading').classList.remove('show');
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
// DCT MATH - Required to extract the invisible watermark
// ----------------------------------------------------------------------------
async function extractDCTWatermark(canvas, bitLength) {
    const ALPHA = 30.0;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    
    // Ensure dimensions are multiples of 8 (just like JPEG compression)
    const padWidth = width - (width % 8);
    const padHeight = height - (height % 8);
    
    const imageData = ctx.getImageData(0, 0, padWidth, padHeight);
    const pixels = imageData.data;
    
    const extractedBits = [];
    let idx = 0;
    
    for (let y = 0; y < padHeight; y += 8) {
        for (let x = 0; x < padWidth; x += 8) {
            if (idx >= bitLength) {
                return bitsToText(extractedBits);
            }
            
            // Build 8x8 luminance block
            let block = [];
            for (let i = 0; i < 8; i++) {
                block[i] = [];
                for (let j = 0; j < 8; j++) {
                    let pIdx = ((y + i) * padWidth + (x + j)) * 4;
                    let r = pixels[pIdx];
                    let g = pixels[pIdx+1];
                    let b = pixels[pIdx+2];
                    // Y = 0.299R + 0.587G + 0.114B (Extract Luminance)
                    block[i][j] = 0.299 * r + 0.587 * g + 0.114 * b;
                }
            }
            
            let dctBlock = compute2DDCT(block);
            let coeff = dctBlock[4][4];
            let q = Math.round(coeff / ALPHA);
            
            if (q % 2 === 0) {
                extractedBits.push(0);
            } else {
                extractedBits.push(1);
            }
            
            idx++;
        }
    }
    
    return bitsToText(extractedBits);
}

function compute2DDCT(input) {
    let output = [];
    let c0 = 1.0 / Math.sqrt(2.0);
    
    for (let u = 0; u < 8; u++) {
        output[u] = [];
        for (let v = 0; v < 8; v++) {
            let sum = 0.0;
            for (let i = 0; i < 8; i++) {
                for (let j = 0; j < 8; j++) {
                    sum += input[i][j] * 
                           Math.cos((2.0 * i + 1.0) * u * Math.PI / 16.0) * 
                           Math.cos((2.0 * j + 1.0) * v * Math.PI / 16.0);
                }
            }
            let cu = (u === 0) ? c0 : 1.0;
            let cv = (v === 0) ? c0 : 1.0;
            output[u][v] = 0.25 * cu * cv * sum;
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
    document.getElementById('resultContainer').classList.add('show');
    
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
    document.getElementById('errorMessage').classList.add('show');
}