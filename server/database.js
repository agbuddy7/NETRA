const path = require('path');

let dbType = 'sqlite';
let sqliteDb;
let pgClient;

// 1. Determine DB Type based on Env Var
if (process.env.DATABASE_URL) {
    dbType = 'postgres';
    console.log("Using PostgreSQL Database (Render/Production)");
    
    // Lazy load pg
    const { Client } = require('pg');
    
    pgClient = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Required for Render Postgres
    });

    pgClient.connect()
        .then(() => {
            console.log("Connected to PostgreSQL");
            initSchema();
        })
        .catch(err => console.error("Postgres connection error", err));

} else {
    // Fallback to SQLite (Local)
    dbType = 'sqlite';
    console.log("Using SQLite Database (Local Development)");
    
    // Lazy load sqlite3
    const sqlite3 = require('sqlite3').verbose();
    
    const dbPath = path.resolve(__dirname, 'proofkrypt.db');
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) console.error('Could not connect to SQLite', err);
        else {
            console.log('Connected to SQLite at ' + dbPath);
            initSchema();
        }
    });
}

// 2. Initialize Tables
function initSchema() {
    // SQLite uses INTEGER PRIMARY KEY AUTOINCREMENT, Postgres uses SERIAL
    // We handle them separately for robust compatibility
    
    if (dbType === 'postgres') {
        const pgSchema = `
            CREATE TABLE IF NOT EXISTS signatures (
                id SERIAL PRIMARY KEY, 
                image_id TEXT,
                author TEXT,
                device_model TEXT,
                timestamp TEXT,
                constellation_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        pgClient.query(pgSchema)
            .catch(e => console.error("Schema Init Error (PG):", e));
    } else {
        const sqliteSchema = `
            CREATE TABLE IF NOT EXISTS signatures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                image_id TEXT,
                author TEXT,
                device_model TEXT,
                timestamp TEXT,
                constellation_data TEXT, -- JSON string
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        sqliteDb.serialize(() => {
            sqliteDb.run(sqliteSchema);
        });
    }
}

// 3. Exported Methods

// REGISTER
exports.registerSignature = (data) => {
    return new Promise((resolve, reject) => {
        const { image_id, author, device_model, timestamp, constellation } = data;
        const constellationStr = JSON.stringify(constellation);

        if (dbType === 'postgres') {
            const query = `
                INSERT INTO signatures (image_id, author, device_model, timestamp, constellation_data) 
                VALUES ($1, $2, $3, $4, $5) 
                RETURNING id;
            `;
            const values = [image_id, author, device_model, timestamp, constellationStr];
            
            pgClient.query(query, values)
                .then(res => resolve({ id: res.rows[0].id }))
                .catch(err => reject(err));
        } else {
            const stmt = sqliteDb.prepare(`
                INSERT INTO signatures (image_id, author, device_model, timestamp, constellation_data) 
                VALUES (?, ?, ?, ?, ?)
            `);
            stmt.run(image_id, author, device_model, timestamp, constellationStr, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
            stmt.finalize();
        }
    });
};

// GET ALL (For verification comparison)
exports.getAllSignatures = () => {
    return new Promise((resolve, reject) => {
        if (dbType === 'postgres') {
            pgClient.query("SELECT * FROM signatures")
                .then(res => resolve(res.rows))
                .catch(err => reject(err));
        } else {
            sqliteDb.all("SELECT * FROM signatures", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        }
    });
};
