const path = require('path');

let dbType = 'sqlite';
let sqliteDb;
let pgClient;

// 1. Determine DB Type based on Env Var
if (process.env.SUPABASE_URL) {
    dbType = 'supabase';
    console.log("Using Supabase Database");

    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY; // Use Service Role Key if strict RLS, or Anon Key if policies allow

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Override Exports for Supabase

    // 1. REGISTER
    exports.registerSignature = async (data) => {
        let { image_id, author, device_model, timestamp, watermark_payload } = data;
        
        const constellationStr = watermark_payload;

        // Supabase Insert
        const { data: result, error } = await supabase
            .from('signatures')
            .insert([
                { 
                    image_id, 
                    author: author || 'Anonymous', 
                    device_model, 
                    timestamp, 
                    constellation_data: constellationStr 
                }
            ])
            .select();

        if (error) {
            console.error("Supabase Error:", error);
            throw new Error(error.message);
        }
        
        // Return object with inserted ID
        return { id: (result && result[0]) ? result[0].id : 'new-rec' };
    };

    // 2. GET ALL
    exports.getAllSignatures = async () => {
        const { data, error } = await supabase
            .from('signatures')
            .select('*');

        if (error) {
            console.error("Supabase Select Error:", error);
            throw new Error(error.message);
        }
        return data; 
    };

    // No initSchema needed for Supabase client, user manages it via Dashboard

} else {

    // ---------------------------------------------------------
    // FALLBACK: POSTGRESQL (Render Native) OR SQLITE (Local)
    // ---------------------------------------------------------

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
    
    
    }
    
    else
        
    {
    
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
            const { image_id, author, device_model, timestamp, watermark_payload } = data;
            const constellationStr = watermark_payload;
    
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

    // GET ALL
    exports.getAllSignatures = () => {
        return new Promise((resolve, reject) => {
            if (dbType === 'postgres') {
                pgClient.query('SELECT * FROM signatures')
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

}
