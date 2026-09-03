require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' })); // Allow large JSON for signatures

// ======   ====================================
// ROUTES
// ==========================================

// 1. Health Check
app.get('/', (req, res) => {
    res.send({ status: 'Online', system: ' Global Verifier' });
});

// 2. REGISTER (From Android App)
// Saves the signature so the world can verify it later
app.post('/register', async (req, res) => {
    const { image_id, author, device_model, timestamp, watermark_payload } = req.body;

    if (!watermark_payload || typeof watermark_payload !== 'string') {
        return res.status(400).json({ error: 'Invalid watermark payload data' });
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
    const { signature } = req.body; // The extracted string

    if (typeof signature !== 'string') {
        return res.status(400).json({ error: 'Invalid query signature format' });
    }
    
    if (!signature) {
        return res.json({
            match: false,
            message: 'No watermark detected in the image.'
        });
    }

    try {
        // Direct indexed lookup instead of scanning all rows
        const match = await db.findByPayload(signature);

        if (match) {
            res.json({
                match: true,
                metadata: {
                    author: match.author,
                    device: match.device_model,
                    original_timestamp: match.timestamp,
                    image_id: match.image_id,
                    registered_at: match.created_at || match.timestamp
                }
            });
        } else {
            res.json({
                match: false,
                message: 'No authentic record found for this image.'
            });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database query failed' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`ProofKrypt Backend running on http://localhost:${PORT}`);
});
