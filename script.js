// Global variables
let uploadedImage = null;
let originalPixelData = null;
let imageCanvas = document.getElementById('imageCanvas');
let imageCtx = imageCanvas.getContext('2d');

// DOM elements
const imageInput = document.getElementById('imageInput');
const pixelDataInput = document.getElementById('pixelDataInput');
const verifyBtn = document.getElementById('verifyBtn');
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
    if (uploadedImage && originalPixelData) {
        verifyBtn.disabled = false;
        
        // Re-display preview with dimension check
        displayImagePreview(uploadedImage);
    }
}

// Verify button handler
verifyBtn.addEventListener('click', async function() {
    // Check dimensions first
    const isExactMatch = (uploadedImage.width === originalPixelData.metadata.width && 
                         uploadedImage.height === originalPixelData.metadata.height);
    const isRotated = (uploadedImage.width === originalPixelData.metadata.height && 
                      uploadedImage.height === originalPixelData.metadata.width);
    
    if (!isExactMatch && !isRotated) {
        alert(
            `DIMENSION MISMATCH!\n\n` +
            `Expected: ${originalPixelData.metadata.width} x ${originalPixelData.metadata.height}\n` +
            `Got: ${uploadedImage.width} x ${uploadedImage.height}\n\n` +
            `This image appears to be cropped, resized, or is not the original image.\n` +
            `Verification will likely fail.`
        );
    } else if (isRotated) {
        alert(
            `IMAGE ROTATED!\n\n` +
            `The image dimensions are swapped (rotated 90°).\n` +
            `Expected: ${originalPixelData.metadata.width} x ${originalPixelData.metadata.height}\n` +
            `Got: ${uploadedImage.width} x ${uploadedImage.height}\n\n` +
            `Please rotate the image and try again, or verification will fail.`
        );
        return;
    }
    
    resultsSection.style.display = 'none';
    progressSection.style.display = 'block';
    progressBar.style.width = '0%';
    progressText.textContent = 'Extracting pixel strands from uploaded image...';
    
    // Simulate progress
    await animateProgress(30);
    
    try {
        // Extract strands from uploaded image
        const extractedStrands = extractStrandsFromImage(uploadedImage, originalPixelData.metadata);
        
        progressText.textContent = 'Comparing pixel data...';
        await animateProgress(60);
        
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
});

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