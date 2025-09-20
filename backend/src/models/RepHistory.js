const db = require('../db/connection');
const logger = require('../services/logger');

class RepHistory {
  constructor(data = {}) {
    this.id = data.id || null;
    this.userAddress = data.user_address || null;
    this.changeType = data.change_type || null; // 'earn', 'spend', 'bonus', 'penalty'
    this.amount = data.amount || 0;
    this.reason = data.reason || null;
    this.relatedTransactionId = data.related_transaction_id || null;
    this.relatedAgentId = data.related_agent_id || null;
    this.balanceBefore = data.balance_before || 0;
    this.balanceAfter = data.balance_after || 0;
    this.createdAt = data.created_at || null;
    this.metadata = data.metadata || {};
  }

  static async createTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS rep_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_address TEXT NOT NULL,
        change_type TEXT NOT NULL,
        amount DECIMAL(15,6) NOT NULL,
        reason TEXT,
        related_transaction_id INTEGER,
        related_agent_id INTEGER,
        balance_before DECIMAL(15,6) DEFAULT 0,
        balance_after DECIMAL(15,6) DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (related_transaction_id) REFERENCES transactions(id),
        FOREIGN KEY (related_agent_id) REFERENCES agents(id)
      )
    `;

    try {
      await db.run(query);
      logger.info('RepHistory table created/verified');
    } catch (error) {
      logger.error('Failed to create rep_history table:', error);
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
      logger.error('Failed to save rep history:', error);
      throw error;
    }
  }

  async create() {
    const query = `
      INSERT INTO rep_history (
        user_address, change_type, amount, reason,
        related_transaction_id, related_agent_id,
        balance_before, balance_after, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      this.userAddress,
      this.changeType,
      this.amount,
      this.reason,
      this.relatedTransactionId,
      this.relatedAgentId,
      this.balanceBefore,
      this.balanceAfter,
      JSON.stringify(this.metadata)
    ];

    try {
      const result = await db.run(query, params);
      this.id = result.lastID;
      this.createdAt = new Date().toISOString();

      logger.info(`Rep history created with ID: ${this.id}`);
      return this;
    } catch (error) {
      logger.error('Failed to create rep history:', error);
      throw error;
    }
  }

  async update() {
    const query = `
      UPDATE rep_history SET
        user_address = ?, change_type = ?, amount = ?, reason = ?,
        related_transaction_id = ?, related_agent_id = ?,
        balance_before = ?, balance_after = ?, metadata = ?
      WHERE id = ?
    `;

    const params = [
      this.userAddress,
      this.changeType,
      this.amount,
      this.reason,
      this.relatedTransactionId,
      this.relatedAgentId,
      this.balanceBefore,
      this.balanceAfter,
      JSON.stringify(this.metadata),
      this.id
    ];

    try {
      await db.run(query, params);
      logger.info(`Rep history updated: ${this.id}`);
      return this;
    } catch (error) {
      logger.error('Failed to update rep history:', error);
      throw error;
    }
  }

  static async findById(id) {
    const query = 'SELECT * FROM rep_history WHERE id = ?';

    try {
      const row = await db.get(query, [id]);
      return row ? new RepHistory(row) : null;
    } catch (error) {
      logger.error('Failed to find rep history by ID:', error);
      throw error;
    }
  }

  static async findByUser(userAddress, limit = 50, offset = 0) {
    const query = `
      SELECT * FROM rep_history
      WHERE user_address = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    try {
      const rows = await db.all(query, [userAddress, limit, offset]);
      return rows.map(row => new RepHistory(row));
    } catch (error) {
      logger.error('Failed to find rep history by user:', error);
      throw error;
    }
  }

  static async getUserBalance(userAddress) {
    const query = `
      SELECT
        COALESCE(SUM(amount), 0) as total_rep
      FROM rep_history
      WHERE user_address = ?
    `;

    try {
      const row = await db.get(query, [userAddress]);
      return row.total_rep || 0;
    } catch (error) {
      logger.error('Failed to get user rep balance:', error);
      throw error;
    }
  }

  static async addRepChange(userAddress, changeType, amount, reason, relatedData = {}) {
    try {
      // Get current balance
      const currentBalance = await RepHistory.getUserBalance(userAddress);
      const newBalance = currentBalance + amount;

      // Create rep history entry
      const repHistory = new RepHistory({
        user_address: userAddress,
        change_type: changeType,
        amount: amount,
        reason: reason,
        related_transaction_id: relatedData.transactionId || null,
        related_agent_id: relatedData.agentId || null,
        balance_before: currentBalance,
        balance_after: newBalance,
        metadata: relatedData.metadata || {}
      });

      await repHistory.save();

      logger.info('Rep change recorded', {
        userAddress,
        changeType,
        amount,
        balanceBefore: currentBalance,
        balanceAfter: newBalance
      });

      return {
        success: true,
        repHistory,
        balanceBefore: currentBalance,
        balanceAfter: newBalance
      };

    } catch (error) {
      logger.error('Failed to add rep change:', error);
      throw error;
    }
  }

  static async getRepStats() {
    const query = `
      SELECT
        COUNT(*) as total_changes,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_earned,
        SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total_spent,
        COUNT(DISTINCT user_address) as active_users
      FROM rep_history
    `;

    try {
      const row = await db.get(query);
      return {
        totalChanges: row.total_changes || 0,
        totalEarned: row.total_earned || 0,
        totalSpent: row.total_spent || 0,
        activeUsers: row.active_users || 0
      };
    } catch (error) {
      logger.error('Failed to get rep stats:', error);
      throw error;
    }
  }

  toJSON() {
    return {
      id: this.id,
      userAddress: this.userAddress,
      changeType: this.changeType,
      amount: this.amount,
      reason: this.reason,
      relatedTransactionId: this.relatedTransactionId,
      relatedAgentId: this.relatedAgentId,
      balanceBefore: this.balanceBefore,
      balanceAfter: this.balanceAfter,
      metadata: this.metadata,
      createdAt: this.createdAt
    };
  }
}

module.exports = RepHistory;