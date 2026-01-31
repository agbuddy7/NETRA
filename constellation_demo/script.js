// ==========================================
// CORE LOGIC: Keypoint Extraction
// ==========================================

function extractConstellation(ctx, width, height) {
    const gridSize = 8; // 8x8 Grid = 64 Stars (Higher Precision)
    const cellW = width / gridSize;
    const cellH = height / gridSize;
    
    let stars = [];

    // Loop through each grid cell
    for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
            
            // Define cell boundaries
            const startX = Math.floor(col * cellW);
            const startY = Math.floor(row * cellH);
            const w = Math.floor(cellW);
            const h = Math.floor(cellH); // Handle last pixel edge cases in real app
            
            const imageData = ctx.getImageData(startX, startY, w, h);
            const data = imageData.data;
            
            // Find "Brightest Star" in this cell
            let maxVal = -1;
            let maxX = 0;
            let maxY = 0;

            // Iterate pixels
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    // Luminance
                    const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
                    
                    if (brightness > maxVal) {
                        maxVal = brightness;
                        maxX = x;
                        maxY = y;
                    }
                }
            }

            // Normalization: Save Percentage (0.0 - 1.0) instead of pixels
            // This is what makes it "Screenshot Proof"
            stars.push({
                row: row,
                col: col,
                x: (startX + maxX) / width, // Relative X
                y: (startY + maxY) / height, // Relative Y
                b: parseFloat((maxVal / 255).toFixed(2)) // Relative Brightness
            });
        }
    }
    return stars;
}


// ==========================================
// UI HANDLING
// ==========================================

const genInput = document.getElementById('genInput');
const genCanvas = document.getElementById('genCanvas');
const genOutput = document.getElementById('genOutput');

const verInput = document.getElementById('verInput');
const verCanvas = document.getElementById('verCanvas');
const verJsonInput = document.getElementById('verJsonInput');
const resultDisplay = document.getElementById('resultDisplay');

// 1. GENERATOR: Handle Image Upload
genInput.addEventListener('change', (e) => {
    handleImageUpload(e.target.files[0], genCanvas, (ctx, width, height) => {
        // Run Algorithm
        const stars = extractConstellation(ctx, width, height);
        
        // Output JSON
        genOutput.value = JSON.stringify(stars, null, 2);
        
        // Visualise
        drawOverlay(ctx, stars, width, height, '#00b894');
    });
});

// 2. VERIFIER: Handle Image Upload (Preview only)
verInput.addEventListener('change', (e) => {
    handleImageUpload(e.target.files[0], verCanvas, (ctx, w, h) => {
        // Just clear output, waiting for verify click
        resultDisplay.style.display = 'none';
    });
});

// 3. VERIFIER: Run Verification
function runVerification() {
    // Get JSON
    let originalStars;
    try {
        originalStars = JSON.parse(verJsonInput.value);
    } catch(e) {
        alert("Please provide valid JSON in the text area!");
        return;
    }

    if(!verInput.files[0]) {
        alert("Please upload an image to verify!");
        return;
    }

    // Re-process the Verification Image
    handleImageUpload(verInput.files[0], verCanvas, (ctx, width, height) => {
        // 1. Extract NEW stars from this image
        const uploadedStars = extractConstellation(ctx, width, height);
        
        // 2. Compare 
        const result = compare(uploadedStars, originalStars);
        
        // 3. Visualize Comparison
        drawOverlay(ctx, uploadedStars, width, height, result.score > 80 ? '#00b894' : '#d63031');
        drawConnections(ctx, uploadedStars, originalStars, width, height);

        // 4. Show Report
        resultDisplay.style.display = 'block';
        resultDisplay.className = 'result-box ' + (result.score > 80 ? 'match' : 'fail');
        resultDisplay.innerHTML = `
            SCORE: ${result.score.toFixed(1)}% <br>
            Avg Deviation: ${(result.avgDistance * 100).toFixed(2)}% screen width
            <br>
            ${result.score > 80 ? "✅ PASSED: Same Structure" : "❌ FAILED: Shapes Moved"}
        `;
    });
}


// ==========================================
// HELPERS
// ==========================================

function handleImageUpload(file, canvas, callback) {
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            // Resize for consistency/performance (optional but good for demos)
            // Keeping original aspect ratio
            const maxWidth = 500;
            const scale = Math.min(maxWidth / img.width, 1);
            
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            callback(ctx, canvas.width, canvas.height);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function drawOverlay(ctx, stars, width, height, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.fillStyle = 'yellow'; // The 'Star' center

    // Draw Grid Lines (Transparent)
    const cw = width / 8;
    const ch = height / 8;
    ctx.beginPath();
    for(let i=1; i<8; i++) {
        ctx.moveTo(i*cw, 0); ctx.lineTo(i*cw, height);
        ctx.moveTo(0, i*ch); ctx.lineTo(width, i*ch);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.stroke();

    // Draw Stars
    ctx.strokeStyle = color;
    stars.forEach(star => {
        const x = star.x * width;
        const y = star.y * height;
        
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI*2);
        ctx.stroke();
        ctx.fill();
    });
}

function drawConnections(ctx, newStars, oldStars, width, height) {
    ctx.strokeStyle = 'red'; // Error lines
    ctx.lineWidth = 2;
    
    for(let i=0; i<newStars.length; i++) {
        const n = newStars[i]; // New
        const o = oldStars[i]; // Old (Target)
        
        // Draw line from where it IS to where it SHOULD be
        ctx.beginPath();
        ctx.moveTo(n.x * width, n.y * height);
        ctx.lineTo(o.x * width, o.y * height);
        
        // Only draw if there is a noticeable error
        const dist = Math.sqrt(Math.pow(n.x-o.x, 2) + Math.pow(n.y-o.y, 2));
        if(dist > 0.02) { 
             ctx.stroke();
        }
    }
}

function compare(current, original) {
    let totalDist = 0;
    
    // Compare star by star (assuming same grid order)
    for(let i=0; i<current.length; i++) {
        const p1 = current[i];
        const p2 = original[i];
        
        // Euclidean distance in Percentage Space
        // e.g. 0.05 means "5% of screen width away"
        const dist = Math.sqrt(
            Math.pow(p1.x - p2.x, 2) + 
            Math.pow(p1.y - p2.y, 2)
        );
        totalDist += dist;
    }
    
    
    // 0.0 is perfect, 1.0 is bad. 
    // Avg Dist of 0.02 (2%) is excellent
    const avgDist = totalDist / 64;
    const score = Math.max(0, 100 - (avgDist * 500)); // Heuristic scoring
    
    return {
        score: score,
        avgDistance: avgDist,
        passed: score > 75
    };
}

function copyToClipboard() {
    genOutput.select();
    document.execCommand('copy');
    alert("Copied to clipboard!");
}