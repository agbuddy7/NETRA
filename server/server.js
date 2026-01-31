const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); // Allow large JSON for signatures

// ==========================================
// ROUTES
// ==========================================

// 1. Health Check
app.get('/', (req, res) => {
    res.send({ status: 'Online', system: 'ProofKrypt Global Verifier' });
});

// 2. REGISTER (From Android App)
// Saves the signature so the world can verify it later
app.post('/register', async (req, res) => {
    const { image_id, author, device_model, timestamp, constellation } = req.body;

    if (!constellation || !Array.isArray(constellation)) {
        return res.status(400).json({ error: 'Invalid constellation data' });
    }

    try {
        const result = await db.registerSignature(req.body);
        res.json({ success: true, id: result.id, message: 'Signature registered successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// 3. VERIFY (From Web Viewer)
// Compares uploaded image signature against ALL database records
app.post('/verify', async (req, res) => {
    const { signature } = req.body; // The 64 points from the uploaded image

    if (!signature || !Array.isArray(signature)) {
        return res.status(400).json({ error: 'Invalid query signature' });
    }

    try {
        // Fetch all signatures to compare (In prod, use a spatial index or vector DB)
        const rows = await db.getAllSignatures();
        
        let bestMatch = null;
        let highestScore = 0;

        // --- THE COMPARISON LOGIC (Server Side) ---
        rows.forEach(row => {
            const dbStars = JSON.parse(row.constellation_data);
            const score = calculateMatchScore(signature, dbStars);

            if (score > highestScore) {
                highestScore = score;
                bestMatch = row;
            }
        });

        // Threshold: 75% confidence
        if (highestScore > 75 && bestMatch) {
            res.json({
                match: true,
                score: highestScore,
                metadata: {
                    author: bestMatch.author,
                    device: bestMatch.device_model,
                    original_timestamp: bestMatch.timestamp,
                    image_id: bestMatch.image_id,
                    registered_at: bestMatch.created_at
                }
            });
        } else {
            res.json({
                match: false,
                score: highestScore,
                message: 'No authentic record found for this image.'
            });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database query failed' });
    }
});


// ==========================================
// HELPER FUNCTIONS
// ==========================================

function calculateMatchScore(uploadedStars, dbStars) {
    // Logic must match script.js verifyConstellation
    let totalDist = 0;
    let matchedStars = 0;
    const gridPoints = uploadedStars.length; // Should be 64

    for (let i = 0; i < gridPoints; i++) {
        const u = uploadedStars[i];
        
        // Find matching star in DB record (by grid position)
        const o = dbStars.find(s => s.row === u.row && s.col === u.col);

        if (o) {
            // Euclidean distance
            const dist = Math.sqrt(Math.pow(u.x - o.x, 2) + Math.pow(u.y - o.y, 2));
            totalDist += dist;
            
            // Tight match?
            if (dist < 0.05) matchedStars++;
        } else {
            // Penalize missing stars (shouldn't happen if grid is same)
            totalDist += 0.5; 
        }
    }

    const avgDist = totalDist / gridPoints;
    
    // Scoring: 100 - (Error * Weight)
    let score = Math.max(0, 100 - (avgDist * 500));
    return score;
}

// Start Server
app.listen(PORT, () => {
    console.log(`ProofKrypt Backend running on http://localhost:${PORT}`);
});
