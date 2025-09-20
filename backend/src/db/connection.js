const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const config = require('../config');

class DatabaseConnection {
    constructor() {
        this.db = null;
        this.isConnected = false;
        this.dbPath = config.database.path;
        console.log(`Database connection service initialized for: ${this.dbPath}`);
    }

    async connect() {
        return new Promise((resolve, reject) => {
            if (this.isConnected && this.db) {
                console.log('Database is already connected');
                resolve(this.db);
                return;
            }

            console.log(`Connecting to SQLite database: ${this.dbPath}`);

            this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE, (err) => {
                if (err) {
                    console.error('Failed to connect to database:', err.message);
                    reject(err);
                    return;
                }

                console.log('✅ Connected to SQLite database');
                this.isConnected = true;

                // Enable foreign key constraints
                this.db.run('PRAGMA foreign_keys = ON', (err) => {
                    if (err) {
                        console.error('Failed to enable foreign keys:', err.message);
                        reject(err);
                        return;
                    }
                    console.log('✅ Foreign key constraints enabled');
                    resolve(this.db);
                });
            });

            // Set up error handler
            this.db.on('error', (err) => {
                console.error('Database error:', err.message);
                this.isConnected = false;
            });
        });
    }

    async close() {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                resolve();
                return;
            }

            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err.message);
                    reject(err);
                    return;
                }

                console.log('Database connection closed');
                this.isConnected = false;
                this.db = null;
                resolve();
            });
        });
    }

    getDatabase() {
        if (!this.isConnected || !this.db) {
            throw new Error('Database is not connected. Call connect() first.');
        }
        return this.db;
    }

    // Query helper - returns a promise for SELECT queries
    async query(sql, params = []) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();

            db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('Query error:', err.message);
                    console.error('SQL:', sql);
                    console.error('Params:', params);
                    reject(err);
                    return;
                }

                resolve(rows);
            });
        });
    }

    // Get helper - returns a single row
    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();

            db.get(sql, params, (err, row) => {
                if (err) {
                    console.error('Get query error:', err.message);
                    console.error('SQL:', sql);
                    console.error('Params:', params);
                    reject(err);
                    return;
                }

                resolve(row);
            });
        });
    }

    // Run helper - for INSERT, UPDATE, DELETE queries
    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();

            db.run(sql, params, function(err) {
                if (err) {
                    console.error('Run query error:', err.message);
                    console.error('SQL:', sql);
                    console.error('Params:', params);
                    reject(err);
                    return;
                }

                // 'this' context contains lastID and changes
                resolve({
                    lastID: this.lastID,
                    changes: this.changes
                });
            });
        });
    }

    // Transaction helper
    async transaction(operations) {
        const db = this.getDatabase();

        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION', (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Execute all operations
                    Promise.all(operations.map(op => {
                        if (typeof op === 'function') {
                            return op(this);
                        } else {
                            return this.run(op.sql, op.params);
                        }
                    }))
                    .then((results) => {
                        db.run('COMMIT', (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            console.log('✅ Transaction committed successfully');
                            resolve(results);
                        });
                    })
                    .catch((error) => {
                        db.run('ROLLBACK', (rollbackErr) => {
                            if (rollbackErr) {
                                console.error('Rollback error:', rollbackErr.message);
                            } else {
                                console.log('❌ Transaction rolled back');
                            }
                            reject(error);
                        });
                    });
                });
            });
        });
    }

    // Batch insert helper
    async batchInsert(table, columns, data) {
        if (!data || data.length === 0) {
            return { changes: 0 };
        }

        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

        const operations = data.map(row => ({
            sql: sql,
            params: columns.map(col => row[col])
        }));

        return await this.transaction(operations);
    }

    // Health check
    async healthCheck() {
        try {
            await this.query('SELECT 1 as health');
            return {
                status: 'healthy',
                connected: this.isConnected,
                database: this.dbPath
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                connected: false,
                error: error.message,
                database: this.dbPath
            };
        }
    }

    // Get table info
    async getTableInfo(tableName) {
        try {
            const columns = await this.query(`PRAGMA table_info(${tableName})`);
            const indexes = await this.query(`PRAGMA index_list(${tableName})`);

            return {
                table: tableName,
                columns: columns,
                indexes: indexes
            };
        } catch (error) {
            console.error(`Failed to get table info for ${tableName}:`, error.message);
            throw error;
        }
    }

    // Execute raw SQL (for migrations, etc.)
    async execute(sql) {
        return new Promise((resolve, reject) => {
            const db = this.getDatabase();

            db.exec(sql, (err) => {
                if (err) {
                    console.error('Execute error:', err.message);
                    reject(err);
                    return;
                }

                resolve();
            });
        });
    }
}

// Create singleton instance
const dbConnection = new DatabaseConnection();

module.exports = dbConnection;