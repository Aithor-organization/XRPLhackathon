const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || './data/marketplace.db';
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

async function initDatabase() {
    try {
        // Create data directory if it doesn't exist
        const dataDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
            console.log(`Created data directory: ${dataDir}`);
        }

        // Read schema file
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

        // Create database connection
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                throw err;
            }
            console.log('Connected to SQLite database');
        });

        // Execute schema
        return new Promise((resolve, reject) => {
            db.exec(schema, (err) => {
                if (err) {
                    console.error('Error executing schema:', err.message);
                    reject(err);
                    return;
                }

                console.log('✅ Database schema initialized successfully');
                console.log('✅ All tables created');
                console.log('✅ All indexes created');
                console.log('✅ Agent categories seeded');

                db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err.message);
                        reject(err);
                        return;
                    }
                    console.log('Database connection closed');
                    resolve();
                });
            });
        });

    } catch (error) {
        console.error('Failed to initialize database:', error.message);
        throw error;
    }
}

// Run initialization if this file is executed directly
if (require.main === module) {
    require('dotenv').config();

    initDatabase()
        .then(() => {
            console.log('🎉 Database initialization completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Database initialization failed:', error.message);
            process.exit(1);
        });
}

module.exports = { initDatabase };