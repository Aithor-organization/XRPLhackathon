const db = require('../db/connection');
const logger = require('../services/logger');

class Transaction {
  constructor(data = {}) {
    this.id = data.id || null;
    this.transactionHash = data.transaction_hash || null;
    this.fromAddress = data.from_address || null;
    this.toAddress = data.to_address || null;
    this.amount = data.amount || 0;
    this.currency = data.currency || 'XRP';
    this.type = data.type || 'purchase'; // purchase, sale, fee, refund
    this.status = data.status || 'pending'; // pending, confirmed, failed
    this.agentId = data.agent_id || null;
    this.licenseId = data.license_id || null;
    this.fee = data.fee || 0;
    this.platformFee = data.platform_fee || 0;
    this.createdAt = data.created_at || null;
    this.updatedAt = data.updated_at || null;
    this.metadata = data.metadata || {};
  }

  static async createTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_hash TEXT UNIQUE,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        amount DECIMAL(15,6) NOT NULL,
        currency TEXT DEFAULT 'XRP',
        type TEXT NOT NULL DEFAULT 'purchase',
        status TEXT NOT NULL DEFAULT 'pending',
        agent_id INTEGER,
        license_id INTEGER,
        fee DECIMAL(15,6) DEFAULT 0,
        platform_fee DECIMAL(15,6) DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (license_id) REFERENCES licenses(id)
      )
    `;

    try {
      await db.run(query);
      logger.info('Transactions table created/verified');
    } catch (error) {
      logger.error('Failed to create transactions table:', error);
      throw error;
    }
  }

  async save() {
    try {
      if (this.id) {
        return await this.update();
      } else {
        return await this.create();
      }
    } catch (error) {
      logger.error('Failed to save transaction:', error);
      throw error;
    }
  }

  async create() {
    const query = `
      INSERT INTO transactions (
        transaction_hash, from_address, to_address, amount, currency,
        type, status, agent_id, license_id, fee, platform_fee, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      this.transactionHash,
      this.fromAddress,
      this.toAddress,
      this.amount,
      this.currency,
      this.type,
      this.status,
      this.agentId,
      this.licenseId,
      this.fee,
      this.platformFee,
      JSON.stringify(this.metadata)
    ];

    try {
      const result = await db.run(query, params);
      this.id = result.lastID;
      this.createdAt = new Date().toISOString();
      this.updatedAt = new Date().toISOString();

      logger.info(`Transaction created with ID: ${this.id}`);
      return this;
    } catch (error) {
      logger.error('Failed to create transaction:', error);
      throw error;
    }
  }

  async update() {
    const query = `
      UPDATE transactions SET
        transaction_hash = ?, from_address = ?, to_address = ?, amount = ?,
        currency = ?, type = ?, status = ?, agent_id = ?, license_id = ?,
        fee = ?, platform_fee = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    const params = [
      this.transactionHash,
      this.fromAddress,
      this.toAddress,
      this.amount,
      this.currency,
      this.type,
      this.status,
      this.agentId,
      this.licenseId,
      this.fee,
      this.platformFee,
      JSON.stringify(this.metadata),
      this.id
    ];

    try {
      await db.run(query, params);
      this.updatedAt = new Date().toISOString();

      logger.info(`Transaction updated: ${this.id}`);
      return this;
    } catch (error) {
      logger.error('Failed to update transaction:', error);
      throw error;
    }
  }

  static async findById(id) {
    const query = 'SELECT * FROM transactions WHERE id = ?';

    try {
      const row = await db.get(query, [id]);
      return row ? new Transaction(row) : null;
    } catch (error) {
      logger.error('Failed to find transaction by ID:', error);
      throw error;
    }
  }

  static async findByHash(transactionHash) {
    const query = 'SELECT * FROM transactions WHERE transaction_hash = ?';

    try {
      const row = await db.get(query, [transactionHash]);
      return row ? new Transaction(row) : null;
    } catch (error) {
      logger.error('Failed to find transaction by hash:', error);
      throw error;
    }
  }

  static async findByAddress(address, limit = 50, offset = 0) {
    const query = `
      SELECT * FROM transactions
      WHERE from_address = ? OR to_address = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    try {
      const rows = await db.all(query, [address, address, limit, offset]);
      return rows.map(row => new Transaction(row));
    } catch (error) {
      logger.error('Failed to find transactions by address:', error);
      throw error;
    }
  }

  static async findByAgent(agentId, limit = 50, offset = 0) {
    const query = `
      SELECT * FROM transactions
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    try {
      const rows = await db.all(query, [agentId, limit, offset]);
      return rows.map(row => new Transaction(row));
    } catch (error) {
      logger.error('Failed to find transactions by agent:', error);
      throw error;
    }
  }

  static async getAgentRevenue(agentId) {
    const query = `
      SELECT
        SUM(amount - platform_fee) as total_revenue,
        COUNT(*) as total_sales,
        SUM(platform_fee) as total_fees
      FROM transactions
      WHERE agent_id = ? AND status = 'confirmed' AND type = 'purchase'
    `;

    try {
      const row = await db.get(query, [agentId]);
      return {
        totalRevenue: row.total_revenue || 0,
        totalSales: row.total_sales || 0,
        totalFees: row.total_fees || 0
      };
    } catch (error) {
      logger.error('Failed to get agent revenue:', error);
      throw error;
    }
  }

  static async getPlatformStats() {
    const query = `
      SELECT
        SUM(platform_fee) as total_platform_revenue,
        SUM(amount) as total_volume,
        COUNT(*) as total_transactions
      FROM transactions
      WHERE status = 'confirmed'
    `;

    try {
      const row = await db.get(query);
      return {
        totalPlatformRevenue: row.total_platform_revenue || 0,
        totalVolume: row.total_volume || 0,
        totalTransactions: row.total_transactions || 0
      };
    } catch (error) {
      logger.error('Failed to get platform stats:', error);
      throw error;
    }
  }

  toJSON() {
    return {
      id: this.id,
      transactionHash: this.transactionHash,
      fromAddress: this.fromAddress,
      toAddress: this.toAddress,
      amount: this.amount,
      currency: this.currency,
      type: this.type,
      status: this.status,
      agentId: this.agentId,
      licenseId: this.licenseId,
      fee: this.fee,
      platformFee: this.platformFee,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Transaction;