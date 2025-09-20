const crypto = require('crypto');
const dbConnection = require('../../db/connection');
const logger = require('../logger');

class CredentialTokenService {
  constructor() {
    this.initializeDatabase();
  }

  async initializeDatabase() {
    try {
      // Create download_tokens table if not exists
      await dbConnection.run(`
        CREATE TABLE IF NOT EXISTS download_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token TEXT UNIQUE NOT NULL,
          credential_id TEXT NOT NULL,
          user_address TEXT NOT NULL,
          ip_address TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          max_attempts INTEGER DEFAULT 3,
          remaining_attempts INTEGER DEFAULT 3,
          used_at DATETIME,
          is_active BOOLEAN DEFAULT 1
        )
      `);
      logger.info('Download tokens table initialized');
    } catch (error) {
      logger.error('Failed to initialize download tokens table:', error);
    }
  }

  // Generate secure download token
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Create download token for credential access
  async createDownloadToken(credentialId, userAddress, ipAddress = null) {
    try {
      const token = this.generateToken();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

      const maxAttempts = 3;
      const remainingAttempts = maxAttempts;

      await dbConnection.run(`
        INSERT INTO download_tokens (
          token, credential_id, user_address, ip_address,
          expires_at, max_attempts, remaining_attempts
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [token, credentialId, userAddress, ipAddress, expiresAt.toISOString(), maxAttempts, remainingAttempts]);

      logger.info('Download token created', {
        token: token.substring(0, 8) + '...',
        credentialId,
        userAddress,
        expiresAt: expiresAt.toISOString()
      });

      return {
        token,
        downloadUrl: `/api/downloads/${token}`,
        expiresAt: expiresAt.toISOString(),
        maxAttempts,
        remainingAttempts
      };

    } catch (error) {
      logger.error('Failed to create download token:', error);
      throw new Error('Failed to create download token');
    }
  }

  // Validate and consume download token
  async validateAndConsumeToken(token, ipAddress = null) {
    try {
      // Get token details
      const tokenRecord = await dbConnection.get(`
        SELECT * FROM download_tokens
        WHERE token = ? AND is_active = 1
      `, [token]);

      if (!tokenRecord) {
        throw new Error('Invalid or expired download token');
      }

      // Check expiry
      const now = new Date();
      const expiresAt = new Date(tokenRecord.expires_at);
      if (now > expiresAt) {
        // Deactivate expired token
        await dbConnection.run(`
          UPDATE download_tokens
          SET is_active = 0
          WHERE token = ?
        `, [token]);
        throw new Error('Download token has expired');
      }

      // Check remaining attempts
      if (tokenRecord.remaining_attempts <= 0) {
        await dbConnection.run(`
          UPDATE download_tokens
          SET is_active = 0
          WHERE token = ?
        `, [token]);
        throw new Error('Download token attempts exhausted');
      }

      // Optional IP validation (if provided during creation)
      if (tokenRecord.ip_address && ipAddress && tokenRecord.ip_address !== ipAddress) {
        logger.warn('IP address mismatch for download token', {
          token: token.substring(0, 8) + '...',
          expectedIp: tokenRecord.ip_address,
          actualIp: ipAddress
        });
        // Note: We could be strict about IP validation, but for flexibility we'll just log it
      }

      // Consume one attempt
      const newRemainingAttempts = tokenRecord.remaining_attempts - 1;
      const isActive = newRemainingAttempts > 0 ? 1 : 0;
      const usedAt = new Date().toISOString();

      await dbConnection.run(`
        UPDATE download_tokens
        SET remaining_attempts = ?, is_active = ?, used_at = ?
        WHERE token = ?
      `, [newRemainingAttempts, isActive, usedAt, token]);

      logger.info('Download token consumed', {
        token: token.substring(0, 8) + '...',
        credentialId: tokenRecord.credential_id,
        userAddress: tokenRecord.user_address,
        remainingAttempts: newRemainingAttempts
      });

      return {
        valid: true,
        credentialId: tokenRecord.credential_id,
        userAddress: tokenRecord.user_address,
        remainingAttempts: newRemainingAttempts,
        tokenData: tokenRecord
      };

    } catch (error) {
      logger.error('Token validation failed:', error);
      throw error;
    }
  }

  // Get token info without consuming
  async getTokenInfo(token) {
    try {
      const tokenRecord = await dbConnection.get(`
        SELECT token, credential_id, user_address, created_at, expires_at,
               max_attempts, remaining_attempts, is_active
        FROM download_tokens
        WHERE token = ?
      `, [token]);

      if (!tokenRecord) {
        return null;
      }

      const now = new Date();
      const expiresAt = new Date(tokenRecord.expires_at);
      const isExpired = now > expiresAt;

      return {
        token: token.substring(0, 8) + '...',
        credentialId: tokenRecord.credential_id,
        userAddress: tokenRecord.user_address,
        createdAt: tokenRecord.created_at,
        expiresAt: tokenRecord.expires_at,
        maxAttempts: tokenRecord.max_attempts,
        remainingAttempts: tokenRecord.remaining_attempts,
        isActive: tokenRecord.is_active && !isExpired,
        isExpired
      };

    } catch (error) {
      logger.error('Failed to get token info:', error);
      throw error;
    }
  }

  // Cleanup expired tokens
  async cleanupExpiredTokens() {
    try {
      const result = await dbConnection.run(`
        UPDATE download_tokens
        SET is_active = 0
        WHERE expires_at < datetime('now') AND is_active = 1
      `);

      if (result.changes > 0) {
        logger.info(`Cleaned up ${result.changes} expired download tokens`);
      }

      return result.changes;

    } catch (error) {
      logger.error('Failed to cleanup expired tokens:', error);
      throw error;
    }
  }

  // Get user's active download tokens
  async getUserTokens(userAddress, limit = 10) {
    try {
      const tokens = await dbConnection.all(`
        SELECT token, credential_id, created_at, expires_at,
               max_attempts, remaining_attempts, is_active
        FROM download_tokens
        WHERE user_address = ?
        ORDER BY created_at DESC
        LIMIT ?
      `, [userAddress, limit]);

      return tokens.map(token => ({
        token: token.token.substring(0, 8) + '...',
        credentialId: token.credential_id,
        createdAt: token.created_at,
        expiresAt: token.expires_at,
        maxAttempts: token.max_attempts,
        remainingAttempts: token.remaining_attempts,
        isActive: token.is_active,
        isExpired: new Date() > new Date(token.expires_at)
      }));

    } catch (error) {
      logger.error('Failed to get user tokens:', error);
      throw error;
    }
  }

  // Revoke token (admin function)
  async revokeToken(token, reason = 'revoked') {
    try {
      await dbConnection.run(`
        UPDATE download_tokens
        SET is_active = 0, used_at = CURRENT_TIMESTAMP
        WHERE token = ?
      `, [token]);

      logger.info('Download token revoked', {
        token: token.substring(0, 8) + '...',
        reason
      });

      return { success: true, reason };

    } catch (error) {
      logger.error('Failed to revoke token:', error);
      throw error;
    }
  }
}

// Create singleton instance
const credentialTokenService = new CredentialTokenService();

module.exports = credentialTokenService;