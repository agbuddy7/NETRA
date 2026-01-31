// Global variables
let uploadedImage = null;
let originalPixelData = null;
let originalConstellationData = null; // New global for JSON
let imageCanvas = document.getElementById('imageCanvas');
let imageCtx = imageCanvas.getContext('2d');

// DOM elements
const imageInput = document.getElementById('imageInput');
const pixelDataInput = document.getElementById('pixelDataInput');
// New Input
const constellationInput = document.getElementById('constellationInput');
const constellFileName = document.getElementById('constellFileName');

const verifyBtn = document.getElementById('verifyBtn');
const searchDbBtn = document.getElementById('searchDbBtn');
const registerDbBtn = document.getElementById('registerDbBtn');
const imageFileName = document.getElementById('imageFileName');
const pixelFileName = document.getElementById('pixelFileName');
const previewSection = document.getElementById('previewSection');
const progressSection = document.getElementById('progressSection');
const resultsSection = document.getElementById('resultsSection');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

// Update current time
function updateTime() {
    const now = new Date();
    const utcTime = now.toISOString().slice(0, 19).replace('T', ' ');
    document.getElementById('currentTime').textContent = utcTime;
}
updateTime();
setInterval(updateTime, 1000);

// Image upload handler
imageInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        imageFileName.textContent = file.name;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                uploadedImage = img;
                displayImagePreview(img);
                checkReadyToVerify();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// Pixel data file upload handler
pixelDataInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        pixelFileName.textContent = file.name;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                originalPixelData = parsePixelDataFile(event.target.result);
                checkReadyToVerify();
            } catch (error) {
                alert('Error parsing pixel data file: ' + error.message);
                console.error('Parse error:', error);
            }
        };
        reader.readAsText(file);
    }
});

// NEW: Constellation JSON upload handler
constellationInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        constellFileName.textContent = file.name;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                originalConstellationData = JSON.parse(event.target.result);
                console.log("Loaded Constellation Data:", originalConstellationData);
                checkReadyToVerify();
            } catch (error) {
                alert('Error parsing JSON file. Make sure you selected the right file.');
                console.error(error);
            }
        };
        reader.readAsText(file);
    }
});

// Display image preview
function displayImagePreview(img) {
    const maxWidth = 800;
    const scale = Math.min(1, maxWidth / img.width);
    
    imageCanvas.width = img.width * scale;
    imageCanvas.height = img.height * scale;
    
    imageCtx.drawImage(img, 0, 0, imageCanvas.width, imageCanvas.height);
    
    // Check dimension match with original data
    let dimensionWarning = '';
    if (originalPixelData) {
        const expectedWidth = originalPixelData.metadata.width;
        const expectedHeight = originalPixelData.metadata.height;
        
        // Check both orientations
        const isMatch = (img.width === expectedWidth && img.height === expectedHeight);
        const isRotated = (img.width === expectedHeight && img.height === expectedWidth);
        
        if (!isMatch && !isRotated) {
            dimensionWarning = `
                <p style="color: #000; font-weight: 600; margin-top: 10px;">
                    Warning: Dimension mismatch detected!<br>
                    Expected: ${expectedWidth} x ${expectedHeight}<br>
                    Got: ${img.width} x ${img.height}<br>
                    <span style="font-size: 0.9em;">This image may have been cropped or resized.</span>
                </p>
            `;
        } else if (isRotated) {
            dimensionWarning = `
                <p style="color: #000; font-weight: 600; margin-top: 10px;">
                    Image appears to be rotated!<br>
                    Expected: ${expectedWidth} x ${expectedHeight}<br>
                    Got: ${img.width} x ${img.height} (swapped)<br>
                    <span style="font-size: 0.9em;">Verification may fail. Try rotating the image 90°.</span>
                </p>
            `;
        } else {
            dimensionWarning = `
                <p style="color: #000; font-weight: 600; margin-top: 10px;">
                    Dimensions match expected values!
                </p>
            `;
        }
    }
    
    document.getElementById('imageInfo').innerHTML = `
        <p><strong>Image Dimensions:</strong> ${img.width} x ${img.height} pixels</p>
        <p><strong>Display Size:</strong> ${imageCanvas.width} x ${imageCanvas.height} pixels</p>
        ${dimensionWarning}
    `;
    
    previewSection.style.display = 'block';
}

// Parse pixel data file
function parsePixelDataFile(content) {
    const lines = content.split('\n');
    const data = {
        metadata: {},
        strands: []
    };
    
    let currentStrand = null;
    let inStrandData = false;
    
    for (let line of lines) {
        line = line.trim();
        
        // Parse metadata
        if (line.includes('Image ID:')) {
            data.metadata.imageId = line.split(':')[1].trim();
        } else if (line.includes('File Name:')) {
            data.metadata.fileName = line.split(':')[1].trim();
        } else if (line.includes('Image Dimensions:')) {
            const dims = line.match(/(\d+) x (\d+)/);
            if (dims) {
                data.metadata.width = parseInt(dims[1]);
                data.metadata.height = parseInt(dims[2]);
            }
        } else if (line.includes('Captured At:')) {
            data.metadata.capturedAt = line.split('Captured At:')[1].trim();
        } else if (line.includes('Captured By:')) {
            data.metadata.capturedBy = line.split('Captured By:')[1].trim();
        }
        
        // Detect strand start
        if (line.startsWith('--- STRAND')) {
            if (currentStrand) {
                data.strands.push(currentStrand);
            }
            
            const strandNum = parseInt(line.match(/STRAND (\d+)/)[1]);
            const xMatch = line.match(/X=(\d+)/);
            
            // Determine strand name from the line
            let strandName = 'Unknown';
            if (line.includes('BOTTOM')) strandName = 'Bottom';
            else if (line.includes('MIDDLE')) strandName = 'Middle';
            else if (line.includes('TOP')) strandName = 'Top';
            
            currentStrand = {
                id: strandNum,
                name: strandName,
                xPosition: xMatch ? parseInt(xMatch[1]) : null,
                pixels: []
            };
            inStrandData = false;
        }
        
        // Detect start coordinates
        if (line.startsWith('Start:')) {
            const coords = line.match(/\((\d+),(\d+)\)/);
            if (coords && currentStrand) {
                currentStrand.startX = parseInt(coords[1]);
                currentStrand.startY = parseInt(coords[2]);
            }
            inStrandData = true;
        }
        
        // Parse pixel data
        if (inStrandData && line.match(/^X=\d+,Y=\d+/)) {
            const matches = line.match(/X=(\d+),Y=(\d+),RGB\((\d+),(\d+),(\d+)\),(#[0-9A-F]{6})/);
            if (matches) {
                currentStrand.pixels.push({
                    x: parseInt(matches[1]),
                    y: parseInt(matches[2]),
                    r: parseInt(matches[3]),
                    g: parseInt(matches[4]),
                    b: parseInt(matches[5]),
                    hex: matches[6]
                });
            }
        }
        
        // Stop parsing pixels when we hit summary
        if (line.startsWith('===') && currentStrand && currentStrand.pixels.length > 0) {
            inStrandData = false;
        }
    }
    
    if (currentStrand && currentStrand.pixels.length > 0) {
        data.strands.push(currentStrand);
    }
    
    console.log('Parsed pixel data:', data);
    return data;
}

// Check if ready to verify
function checkReadyToVerify() {
    // Enable global search if image exists (no file needed)
    if (uploadedImage) {
        if(searchDbBtn) searchDbBtn.disabled = false;
        if(registerDbBtn) registerDbBtn.disabled = false;
    }

    // Enable local verify if image exists AND at least one verification file is loaded
    if (uploadedImage && (originalPixelData || originalConstellationData)) {
        verifyBtn.disabled = false;
        
        // Re-display preview with dimension check if pixel data exists
        if(originalPixelData) { 
            displayImagePreview(uploadedImage);
        }
    }
}

// Verify button handler
verifyBtn.addEventListener('click', async function() {
    // 1. Dimension Check (Only if doing strict verification)
    if (originalPixelData) {
        const isExactMatch = (uploadedImage.width === originalPixelData.metadata.width && 
                             uploadedImage.height === originalPixelData.metadata.height);
        const isRotated = (uploadedImage.width === originalPixelData.metadata.height && 
                          uploadedImage.height === originalPixelData.metadata.width);
        
        if (!isExactMatch && !isRotated) {
             console.warn("Dimension mismatch (Strict Mode might fail)");
             // We don't block execution anymore because Constellation might still pass!
        } else if (isRotated) {
            alert('Image Appears Rotated. Please fix orientation for best results.');
        }
    }

    resultsSection.innerHTML = ''; // Clear previous
    resultsSection.style.display = 'none';
    progressSection.style.display = 'block';
    
    // --- START VERIFICATION PIPELINE ---
    
    // 1. Constellation Verification (Resilient)
    let constellationResult = null;
    if (originalConstellationData) {
        progressBar.style.width = '30%';
        progressText.textContent = 'Running Geometric Constellation Check...';
        await new Promise(r => setTimeout(r, 500));
        
        // Draw to temp canvas
        const canvas = document.createElement('canvas');
        canvas.width = uploadedImage.width;
        canvas.height = uploadedImage.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(uploadedImage, 0, 0);
        
        constellationResult = verifyConstellation(ctx, canvas.width, canvas.height, originalConstellationData);
    }

    // 2. Pixel Verification (Strict)
    let pixelResult = null;
    if (originalPixelData) {
        progressBar.style.width = '60%';
        progressText.textContent = 'Running Strict Pixel Analysis...';
        await animateProgress(60);
        
        // Extract strands from uploaded image
        const extractedStrands = extractStrandsFromImage(uploadedImage, originalPixelData.metadata);
        
        progressText.textContent = 'Comparing pixel data...';
        await animateProgress(80);
        
        // Compare (Use existing function compareStrands)
        pixelResult = compareStrands(originalPixelData.strands, extractedStrands);
    }

    progressBar.style.width = '100%';
    progressText.textContent = 'Finalizing Report...';
    await new Promise(r => setTimeout(r, 400));
    
    displayCombinedResults(pixelResult, constellationResult);
});

// --- NEW: GLOBAL DATABASE SEARCH ---
if(searchDbBtn) {
    searchDbBtn.addEventListener('click', async function() {
        if(!uploadedImage) return;

        resultsSection.innerHTML = '';
        resultsSection.style.display = 'none';
        progressSection.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = 'Extracting Constellation Signature...';

        await new Promise(r => setTimeout(r, 200));

        // Refactored Extraction
        const canvas = document.createElement('canvas');
        canvas.width = uploadedImage.width;
        canvas.height = uploadedImage.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(uploadedImage, 0, 0);
        
        const signature = extractConstellation(ctx, canvas.width, canvas.height);
        
        progressBar.style.width = '50%';
        progressText.textContent = 'Querying Global Authenticity Database...';

        try {
            // Assume backend is on localhost:3000
            const response = await fetch('http://localhost:3000/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ signature })
            });

            const data = await response.json();
            progressBar.style.width = '100%';
            
            displayDatabaseResult(data);

        } catch (err) {
            alert("Server Error: Is the backend running? " + err.message);
            progressSection.style.display = 'none';
        }
    });
}

// Global Register (Optional Debugging)
if(registerDbBtn) {
    registerDbBtn.addEventListener('click', async function() {
        if(!uploadedImage) return;
        const author = prompt("Enter Author Name for Registration:", "Anonymous");
        if(!author) return;

        const canvas = document.createElement('canvas');
        canvas.width = uploadedImage.width;
        canvas.height = uploadedImage.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(uploadedImage, 0, 0);
        const signature = extractConstellation(ctx, canvas.width, canvas.height);

        try {
            const res = await fetch('http://localhost:3000/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image_id: "WEB-" + Date.now(),
                    author: author,
                    device_model: "Web Browser",
                    timestamp: new Date().toISOString(),
                    constellation: signature
                })
            });
            const d = await res.json();
            alert("Registration " + (d.success ? "Success" : "Failed") + ": " + (d.message || d.error));
        } catch(e) { alert("Error: " + e.message); }
    });
}

function displayDatabaseResult(data) {
    progressSection.style.display = 'none';
    resultsSection.innerHTML = '';
    resultsSection.style.display = 'block';

    const color = data.match ? '#00b894' : '#d63031';
    const title = data.match ? '✅ MATCH FOUND IN DATABASE' : '❌ NO MATCH FOUND';
    
    let detailsHtml = '';
    if (data.match) {
        detailsHtml = `
            <div style="margin-top:15px; text-align:left;">
                <p><strong>Image ID:</strong> ${data.metadata.image_id}</p>
                <p><strong>Author:</strong> ${data.metadata.author}</p>
                <p><strong>Device:</strong> ${data.metadata.device}</p>
                <p><strong>Original Time:</strong> ${data.metadata.original_timestamp}</p>
                <p><strong>Confidence:</strong> ${data.score.toFixed(2)}%</p>
            </div>
        `;
    } else {
         detailsHtml = `
            <p>This image does not match any registered signature in the global database.</p>
            <p style="font-size:0.9em; color:#666;">Confidence: ${data.score.toFixed(2)}% (Threshold: 75%)</p>
        `;
    }

    const card = document.createElement('div');
    card.className = 'result-card';
    card.style.borderTop = `5px solid ${color}`;
    card.style.padding = '20px';
    card.style.background = '#fff';
    card.style.textAlign = 'center';
    
    card.innerHTML = `
        <h2 style="color:${color}; margin-top:0;">${title}</h2>
        ${detailsHtml}
    `;
    resultsSection.appendChild(card);
}

// ------ LOGIC B: CONSTELLATION VERIFICATION (New) ------
function verifyConstellation(ctx, width, height, originalStars) {
    const uploadedStars = extractConstellation(ctx, width, height);
    
    let totalDist = 0;
    let matchedStars = 0;

    for(let i=0; i<uploadedStars.length; i++) {
        const u = uploadedStars[i];
        // Match by grid position (row/col)
        const o = originalStars.find(s => s.row === u.row && s.col === u.col);
        
        if(o) {
            const dist = Math.sqrt(Math.pow(u.x - o.x, 2) + Math.pow(u.y - o.y, 2));
            totalDist += dist;
            if(dist < 0.05) matchedStars++; 
        }
    }
    
    const avgDist = totalDist / 16;
    const score = Math.max(0, 100 - (avgDist * 500)); 
    
    return { score, avgDist, passed: score > 75 };
}

function extractConstellation(ctx, width, height) {
    const gridSize = 8; // UPDATED to 8x8 for Database Accuracy
    const cellW = width / gridSize;
    const cellH = height / gridSize;
    let stars = [];

    for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
            const startX = Math.floor(col * cellW);
            const startY = Math.floor(row * cellH);
            const w = Math.floor(cellW);
            const h = Math.floor(cellH);
            
            const safeW = (startX + w > width) ? width - startX : w;
            const safeH = (startY + h > height) ? height - startY : h;

            const data = ctx.getImageData(startX, startY, safeW, safeH).data;
            let maxVal = -1;
            let maxX = 0;
            let maxY = 0;

            for (let y = 0; y < safeH; y++) {
                for (let x = 0; x < safeW; x++) {
                    const i = (y * safeW + x) * 4;
                    const b = (0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
                    if (b > maxVal) { maxVal = b; maxX = x; maxY = y; }
                }
            }

            stars.push({
                row, col,
                x: (startX + maxX) / width,
                y: (startY + maxY) / height
            });
        }
    }
    return stars;
}

function displayCombinedResults(pixelResult, constellRes) {
    progressSection.style.display = 'none';
    resultsSection.innerHTML = '';
    
    // 1. Show Resilient Result (Constellation)
    if (constellRes) {
        const color = constellRes.passed ? '#00b894' : '#d63031';
        const msg = constellRes.passed ? 'AUTHENTIC (Structure Matches)' : 'SUSPICIOUS (Structure Altered)';
        
        const card = document.createElement('div');
        card.className = 'result-card';
        card.style.borderLeft = `5px solid ${color}`;
        card.style.padding = '15px';
        card.style.background = '#fff';
        card.style.marginBottom = '20px';
        card.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
        
        card.innerHTML = `
            <h3>✨ Resilient Constellation Verification</h3>
            <h4 style="color:${color}; margin: 10px 0;">${msg}</h4>
            <p>Confidence Score: <strong>${constellRes.score.toFixed(1)}%</strong></p>
            <p>Avg Geometric Shift: <strong>${(constellRes.avgDist*100).toFixed(2)}%</strong></p>
            ${constellRes.passed ? '<p style="color:#666; font-size:0.9em;"><em>Image content is authentic despite potential compression or resizing.</em></p>' : ''}
        `;
        resultsSection.appendChild(card);
    }

    // 2. Show Strict Result (Pixels)
    if (pixelResult) {
        // We use the comparePixelsAndDisplay() logic but tailored for our new layout
        // Or simply call the old display function if available
        // Here I will manually render the strict result card
        const strictCard = document.createElement('div');
        strictCard.className = 'result-card';
        strictCard.style.padding = '15px';
        strictCard.style.background = '#fff';
        strictCard.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
        strictCard.innerHTML = `<h3>🔍 Strict Pixel Verification</h3>`;
        
        // Reuse your logic for generating pixel HTML
        const resultHTML = generateLegacyResultHTML(pixelResult);
        strictCard.innerHTML += resultHTML;
        
        resultsSection.appendChild(strictCard);
    }

    resultsSection.style.display = 'block';
}

function generateLegacyResultHTML(results) {
    // Adapted to the actual structure returned by compareStrands
    const isSuccess = parseFloat(results.matchPercentage) > 90;
    
    let html = `
        <div class="result-header" style="background:${isSuccess ? '#d4edda' : '#f8d7da'}; color:${isSuccess ? '#155724' : '#721c24'}; padding:15px; text-align:center; border-radius:4px;">
            <h2 style="margin:0">${isSuccess ? 'PIXEL VERIFICATION PASSED' : 'PIXEL VERIFICATION FAILED'}</h2>
            <p style="font-size:1.2em; font-weight:bold">${results.matchPercentage}% Overall Match</p>
        </div>
        <div class="result-details" style="margin-top:10px;">
    `;
    
    if (results.dimensionMatch === false) {
        html += `<div style="color:orange; font-weight:bold; margin-bottom:10px;">⚠️ Dimension Mismatch Detected</div>`;
    }

    if (results.strandResults) {
        results.strandResults.forEach(strand => {
             const color = strand.isMatch ? 'green' : 'red';
             html += `
                <div style="border-bottom:1px solid #eee; padding:5px 0;">
                    <p style="margin:5px 0;"><strong>${strand.name}:</strong> <span style="color:${color}">${strand.matchPercentage}%</span> match (${strand.mismatchingPixels} mismatches)</p>
                </div>
             `;
        });
    }
    
    html += `</div>`;
    return html;
}
/*
        // Compare strands
        const comparisonResults = compareStrands(originalPixelData.strands, extractedStrands);
        
        progressText.textContent = 'Generating verification report...';
        await animateProgress(90);
        
        // Display results
        displayVerificationResults(comparisonResults);
        
        await animateProgress(100);
        
        setTimeout(() => {
            progressSection.style.display = 'none';
            resultsSection.style.display = 'block';
            visualizeStrands(uploadedImage, originalPixelData.strands);
        }, 500);
        
    } catch (error) {
        alert('Verification error: ' + error.message);
        console.error('Verification error:', error);
        progressSection.style.display = 'none';
    }
*/

// Animate progress bar
function animateProgress(target) {
    return new Promise(resolve => {
        let current = parseInt(progressBar.style.width) || 0;
        const interval = setInterval(() => {
            current += 2;
            progressBar.style.width = current + '%';
            if (current >= target) {
                clearInterval(interval);
                resolve();
            }
        }, 50);
    });
}

// Extract strands from uploaded image
function extractStrandsFromImage(img, metadata) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const strands = [];
    
    const strandHeight = Math.floor(canvas.height / 3);
    
    // Calculate X positions (15%, 50%, 80%)
    const x1 = Math.floor(canvas.width * 0.15);
    const x2 = Math.floor(canvas.width * 0.50);
    const x3 = Math.floor(canvas.width * 0.80);
    
    // Calculate Y starting positions
    const y1_start = canvas.height - strandHeight; // Bottom
    const y2_start = Math.floor((canvas.height - strandHeight) / 2); // Middle
    const y3_start = 0; // Top
    
    const positions = [
        { id: 1, x: x1, yStart: y1_start, name: 'Bottom' },
        { id: 2, x: x2, yStart: y2_start, name: 'Middle' },
        { id: 3, x: x3, yStart: y3_start, name: 'Top' }
    ];
    
    console.log('Extracting strands from image:', canvas.width, 'x', canvas.height);
    console.log('Strand positions:', positions);
    
    for (let pos of positions) {
        const strand = {
            id: pos.id,
            xPosition: pos.x,
            startX: pos.x,
            startY: pos.yStart,
            name: pos.name,
            pixels: []
        };
        
        for (let y = pos.yStart; y < pos.yStart + strandHeight && y < canvas.height; y++) {
            const pixel = getPixelAt(imageData, pos.x, y);
            strand.pixels.push({
                x: pos.x,
                y: y,
                r: pixel.r,
                g: pixel.g,
                b: pixel.b,
                hex: rgbToHex(pixel.r, pixel.g, pixel.b)
            });
        }
        
        strands.push(strand);
        console.log(`Strand ${pos.id} (${pos.name}): ${strand.pixels.length} pixels`);
    }
    
    return strands;
}

// Get pixel at coordinates
function getPixelAt(imageData, x, y) {
    const index = (y * imageData.width + x) * 4;
    return {
        r: imageData.data[index],
        g: imageData.data[index + 1],
        b: imageData.data[index + 2],
        a: imageData.data[index + 3]
    };
}

// RGB to Hex conversion
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('').toUpperCase();
}

// Compare strands
function compareStrands(originalStrands, extractedStrands) {
    const results = {
        overallMatch: true,
        matchPercentage: 0,
        strandResults: [],
        dimensionMatch: true
    };
    
    let totalPixels = 0;
    let matchingPixels = 0;
    
    console.log('Comparing strands...');
    console.log('Original strands:', originalStrands.length);
    console.log('Extracted strands:', extractedStrands.length);
    
    for (let i = 0; i < Math.min(originalStrands.length, extractedStrands.length); i++) {
        const original = originalStrands[i];
        const extracted = extractedStrands[i];
        
        console.log(`Comparing Strand ${i + 1}:`);
        console.log('  Original pixels:', original.pixels.length);
        console.log('  Extracted pixels:', extracted.pixels.length);
        
        const strandResult = {
            id: original.id,
            name: extracted.name || `Strand ${original.id}`,
            totalPixels: original.pixels.length,
            matchingPixels: 0,
            mismatchingPixels: 0,
            matchPercentage: 0,
            isMatch: false,
            sampleMismatches: []
        };
        
        const minLength = Math.min(original.pixels.length, extracted.pixels.length);
        
        // Check if pixel counts are significantly different
        if (Math.abs(original.pixels.length - extracted.pixels.length) > 10) {
            results.dimensionMatch = false;
        }
        
        for (let j = 0; j < minLength; j++) {
            const origPixel = original.pixels[j];
            const extrPixel = extracted.pixels[j];
            
            // Allow tolerance for JPEG compression artifacts
            const tolerance = 5;
            const rDiff = Math.abs(origPixel.r - extrPixel.r);
            const gDiff = Math.abs(origPixel.g - extrPixel.g);
            const bDiff = Math.abs(origPixel.b - extrPixel.b);
            
            if (rDiff <= tolerance && gDiff <= tolerance && bDiff <= tolerance) {
                strandResult.matchingPixels++;
                matchingPixels++;
            } else {
                strandResult.mismatchingPixels++;
                
                // Store first 5 mismatches for display
                if (strandResult.sampleMismatches.length < 5) {
                    strandResult.sampleMismatches.push({
                        position: j,
                        y: extrPixel.y,
                        original: origPixel,
                        extracted: extrPixel,
                        diff: { r: rDiff, g: gDiff, b: bDiff }
                    });
                }
            }
            
            totalPixels++;
        }
        
        strandResult.matchPercentage = (strandResult.matchingPixels / strandResult.totalPixels * 100).toFixed(2);
        strandResult.isMatch = strandResult.matchPercentage > 90;
        
        if (!strandResult.isMatch) {
            results.overallMatch = false;
        }
        
        console.log(`  Match: ${strandResult.matchPercentage}%`);
        
        results.strandResults.push(strandResult);
    }
    
    results.matchPercentage = totalPixels > 0 ? (matchingPixels / totalPixels * 100).toFixed(2) : 0;
    console.log('Overall match:', results.matchPercentage + '%');
    
    return results;
}

// Display verification results
function displayVerificationResults(results) {
    const resultCard = document.getElementById('verificationResult');
    const strandsDetails = document.getElementById('strandsDetails');
    
    // Overall result
    let resultClass = '';
    let resultText = '';
    let resultIcon = '';
    
    if (results.matchPercentage >= 95) {
        resultClass = 'authentic';
        resultText = 'IMAGE AUTHENTIC';
    } else if (results.matchPercentage >= 80) {
        resultClass = 'modified';
        resultText = 'IMAGE MODIFIED (Minor Changes)';
    } else {
        resultClass = 'forged';
        resultText = 'IMAGE VERIFICATION FAILED';
    }
    
    let dimensionWarning = '';
    if (!results.dimensionMatch) {
        dimensionWarning = '<div style="margin-top: 15px; font-size: 0.9rem;">Dimension mismatch detected - Image may be cropped</div>';
    }
    
    resultCard.className = `result-card ${resultClass}`;
    resultCard.innerHTML = `
        <div>${resultText}</div>
        <div style="font-size: 2rem; margin-top: 15px;">${results.matchPercentage}% Match</div>
        ${dimensionWarning}
    `;
    
    // Strand details
    strandsDetails.innerHTML = '';
    
    for (let strand of results.strandResults) {
        const strandDiv = document.createElement('div');
        strandDiv.className = `strand-detail ${strand.isMatch ? 'match' : 'mismatch'}`;
        
        let mismatchDetails = '';
        if (strand.sampleMismatches.length > 0) {
            mismatchDetails = `
                <div style="margin-top: 15px; padding: 10px; background: #eee; border: 1px solid #000; border-radius: 0;">
                    <strong>Sample Mismatches:</strong>
                    ${strand.sampleMismatches.map(mm => `
                        <div style="margin: 5px 0; font-size: 0.85rem; font-family: monospace;">
                            Y=${mm.y}: 
                            ${mm.original.hex} → ${mm.extracted.hex}
                            (ΔR:${mm.diff.r}, ΔG:${mm.diff.g}, ΔB:${mm.diff.b})
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        strandDiv.innerHTML = `
            <h4>${strand.isMatch ? 'MATCH' : 'MISMATCH'} - Strand ${strand.id} (${strand.name})</h4>
            <div class="strand-stats">
                <div class="stat-item">
                    <div class="stat-label">Total Pixels</div>
                    <div class="stat-value">${strand.totalPixels}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Matching</div>
                    <div class="stat-value" style="color: #000;">${strand.matchingPixels}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Mismatching</div>
                    <div class="stat-value" style="color: #000;">${strand.mismatchingPixels}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Match %</div>
                    <div class="stat-value">${strand.matchPercentage}%</div>
                </div>
            </div>
            ${mismatchDetails}
        `;
        
        strandsDetails.appendChild(strandDiv);
    }
}

// Visualize strands on image
function visualizeStrands(img, strands) {
    const canvas = document.getElementById('strandCanvas');
    const maxWidth = 1000;
    const scale = Math.min(1, maxWidth / img.width);
    
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    // Draw strand lines
    const colors = ['#FF0000', '#00FF00', '#0000FF'];
    const names = ['Bottom', 'Middle', 'Top'];
    
    for (let i = 0; i < Math.min(strands.length, 3); i++) {
        const strand = strands[i];
        const x = strand.xPosition * scale;
        
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
        
        // Label with background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x + 5, 5 + (i * 35), 150, 30);
        
        ctx.fillStyle = colors[i];
        ctx.font = 'bold 16px Arial';
        ctx.fillText(`Strand ${strand.id} (${strand.name || names[i]})`, x + 10, 25 + (i * 35));
    }
}