const crypto = require('crypto');
const dbConnection = require('../db/connection');
const logger = require('../services/logger');
const licenseModel = require('./License');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    DatabaseError,
    AuthorizationError
} = require('../middleware/errorHandler');

class DownloadTokenModel {
    constructor() {
        this.tableName = 'download_tokens';
        this.requiredFields = ['license_id', 'agent_id', 'buyer_wallet', 'expires_at'];
        this.defaultExpiry = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        this.maxDownloadAttempts = 3;
    }

    // Generate secure download token
    generateToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    // Calculate token expiry
    calculateExpiry(hoursFromNow = 24) {
        const now = new Date();
        const expiry = new Date(now.getTime() + (hoursFromNow * 60 * 60 * 1000));
        return expiry.toISOString();
    }

    // Validate token data
    validateTokenData(tokenData) {
        const errors = [];

        // Check required fields
        for (const field of this.requiredFields) {
            if (!tokenData[field]) {
                errors.push(`${field} is required`);
            }
        }

        // Validate download count
        if (tokenData.download_count !== undefined) {
            const count = parseInt(tokenData.download_count);
            if (isNaN(count) || count < 0) {
                errors.push('Download count must be a non-negative integer');
            }
        }

        // Validate expiry date
        if (tokenData.expires_at) {
            const expiryDate = new Date(tokenData.expires_at);
            const now = new Date();
            if (isNaN(expiryDate.getTime())) {
                errors.push('Invalid expiry date format');
            }
        }

        if (errors.length > 0) {
            throw new ValidationError(`Download token validation failed: ${errors.join(', ')}`);
        }

        return true;
    }

    // Create new download token
    async create(tokenData) {
        try {
            // Generate token
            const token = tokenData.token || this.generateToken();
            const tokenToCreate = {
                ...tokenData,
                token: token
            };

            this.validateTokenData(tokenToCreate);

            // Verify license exists and is valid
            const license = await licenseModel.findById(tokenData.license_id);
            if (!license) {
                throw new NotFoundError('License not found');
            }

            if (license.buyer_wallet !== tokenData.buyer_wallet) {
                throw new AuthorizationError('License does not belong to this buyer');
            }

            if (license.status !== 'active') {
                throw new ValidationError('License is not active');
            }

            // Check for existing active token
            const existingToken = await this.getActiveTokenForLicense(tokenData.license_id);
            if (existingToken) {
                logger.info('Active download token already exists', {
                    licenseId: tokenData.license_id,
                    existingToken: existingToken.token.substring(0, 10) + '...'
                });
                return existingToken;
            }

            // Prepare token data with defaults
            const completeTokenData = {
                token: token,
                license_id: tokenToCreate.license_id,
                agent_id: tokenToCreate.agent_id,
                buyer_wallet: tokenToCreate.buyer_wallet,
                created_at: new Date().toISOString(),
                expires_at: tokenToCreate.expires_at || this.calculateExpiry(),
                used_at: null,
                download_count: 0,
                ip_address: tokenToCreate.ip_address || null
            };

            // Insert token into database
            await dbConnection.run(
                `INSERT INTO download_tokens (
                    token, license_id, agent_id, buyer_wallet,
                    created_at, expires_at, used_at, download_count, ip_address
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    completeTokenData.token,
                    completeTokenData.license_id,
                    completeTokenData.agent_id,
                    completeTokenData.buyer_wallet,
                    completeTokenData.created_at,
                    completeTokenData.expires_at,
                    completeTokenData.used_at,
                    completeTokenData.download_count,
                    completeTokenData.ip_address
                ]
            );

            logger.logDatabase('insert', this.tableName, {
                token: token.substring(0, 10) + '...',
                licenseId: completeTokenData.license_id,
                agentId: completeTokenData.agent_id,
                buyer: completeTokenData.buyer_wallet
            });

            return completeTokenData;

        } catch (error) {
            logger.logError(error, { context: 'DownloadTokenModel.create' });

            if (error.isOperational) {
                throw error;
            }

            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new ConflictError('Download token already exists');
            }

            throw new DatabaseError('Failed to create download token', error);
        }
    }

    // Find token by token string
    async findByToken(token) {
        try {
            if (!token) {
                throw new ValidationError('Token is required');
            }

            const tokenRecord = await dbConnection.get(
                'SELECT * FROM download_tokens WHERE token = ?',
                [token]
            );

            return tokenRecord || null;

        } catch (error) {
            logger.logError(error, { context: 'DownloadTokenModel.findByToken' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find download token', error);
        }
    }

    // Get active token for license
    async getActiveTokenForLicense(licenseId) {
        try {
            const token = await dbConnection.get(
                `SELECT * FROM download_tokens
                 WHERE license_id = ?
                 AND expires_at > datetime('now')
                 AND download_count < ?
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [licenseId, this.maxDownloadAttempts]
            );

            return token || null;

        } catch (error) {
            logger.logError(error, { context: 'DownloadTokenModel.getActiveTokenForLicense' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find active token', error);
        }
    }

    // Validate token and get details
    async validateToken(token) {
        try {
            const tokenRecord = await this.findByToken(token);
            if (!tokenRecord) {
                throw new NotFoundError('Invalid download token');
            }

            // Check if token has expired
            const now = new Date();
            const expiryDate = new Date(tokenRecord.expires_at);

            if (now > expiryDate) {
                throw new ValidationError('Download token has expired');
            }

            // Check download count
            if (tokenRecord.download_count >= this.maxDownloadAttempts) {
                throw new ValidationError('Maximum download attempts exceeded');
            }

            // Get related data
            const tokenWithDetails = await dbConnection.get(
                `SELECT dt.*, a.ipfs_hash, a.name as agent_name, l.status as license_status
                 FROM download_tokens dt
                 JOIN ai_agents a ON dt.agent_id = a.agent_id
                 JOIN licenses l ON dt.license_id = l.license_id
                 WHERE dt.token = ?`,
                [token]
            );

            // Verify license is still active
            if (tokenWithDetails.license_status !== 'active') {
                throw new ValidationError('Associated license is not active');
            }

            return {
                valid: true,
                token: tokenWithDetails,
                remainingAttempts: this.maxDownloadAttempts - tokenWithDetails.download_count
            };

        } catch (error) {
            logger.logError(error, { context: 'DownloadTokenModel.validateToken' });
            throw error;
        }
    }

    // Increment download count
    async incrementDownloadCount(token, ipAddress = null) {
        try {
            const tokenRecord = await this.findByToken(token);
            if (!tokenRecord) {
                throw new NotFoundError('Token not found');
            }

            const newCount = tokenRecord.download_count + 1;
            const updateData = {
                download_count: newCount
            };

            // Update used_at on first download
            if (tokenRecord.download_count === 0) {
                updateData.used_at = new Date().toISOString();
            }

            // Update IP address if provided
            if (ipAddress) {
                updateData.ip_address = ipAddress;
            }

            const updateFields = Object.keys(updateData).map(field => `${field} = ?`).join(', ');
            const updateValues = Object.values(updateData);
            updateValues.push(token);

            await dbConnection.run(
                `UPDATE download_tokens SET ${updateFields} WHERE token = ?`,
                updateValues
            );

            logger.logDatabase('update', this.tableName, {
                token: token.substring(0, 10) + '...',
                newCount: newCount,
                ipAddress: ipAddress
            });

            return {
                success: true,
                downloadCount: newCount,
                remainingAttempts: Math.max(0, this.maxDownloadAttempts - newCount)
            };

        } catch (error) {
            logger.logError(error, { context: 'DownloadTokenModel.incrementDownloadCount' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to increment download count', error);
        }
    }

    // Get user's download tokens
    async getUserTokens(buyerWallet, options = {}) {
        try {
            const limit = Math.min(options.limit || 50, 100);
            const offset = options.offset || 0;
            const includeExpired = options.includeExpired || false;

            let sql = `
                SELECT dt.*, a.name as agent_name, a.category as agent_category
                FROM download_tokens dt
                LEFT JOIN ai_agents a ON dt.agent_id = a.agent_id
                WHERE dt.buyer_wallet = ?
            `;
            let params = [buyerWallet];

            if (!includeExpired) {
                sql += ` AND dt.expires_at > datetime('now')`;
            }

            sql += ` ORDER BY dt.created_at DESC LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            const tokens = await dbConnection.query(sql, params);

            // Get total count
            let countSql = 'SELECT COUNT(*) as total FROM download_tokens WHERE buyer_wallet = ?';
            let countParams = [buyerWallet];

            if (!includeExpired) {
                countSql += ` AND expires_at > datetime('now')`;
            }

            const countResult = await dbConnection.get(countSql, countParams);

            // Calculate status for each token
            const now = new Date();
            const tokensWithStatus = tokens.map(token => {
                const expiryDate = new Date(token.expires_at);
                const isExpired = now > expiryDate;
                const isExhausted = token.download_count >= this.maxDownloadAttempts;

                return {
                    ...token,
                    status: isExpired ? 'expired' : (isExhausted ? 'exhausted' : 'active'),
                    remainingAttempts: Math.max(0, this.maxDownloadAttempts - token.download_count)
                };
            });

            return {
                tokens: tokensWithStatus,
                pagination: {
                    total: countResult.total,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + tokens.length < countResult.total
                }
            };

        } catch (error) {
            logger.logError(error, { context: 'DownloadTokenModel.getUserTokens' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to get user tokens', error);
        }
    }

    // Clean up expired tokens
    async cleanupExpiredTokens() {
        try {
            const result = await dbConnection.run(
                'DELETE FROM download_tokens WHERE expires_at < datetime("now")'
            );

            logger.logDatabase('batch_delete', this.tableName, {
                action: 'cleanup_expired',
                count: result.changes
            });

            return result.changes;

        } catch (error) {
            logger.logError(error, { context: 'DownloadTokenModel.cleanupExpiredTokens' });
            throw new DatabaseError('Failed to cleanup expired tokens', error);
        }
    }

    // Get download statistics
    async getDownloadStats(agentId = null, timeframe = '30d') {
        try {
            // Calculate date range
            const timeValue = this.parseTimeframe(timeframe);
            const startDate = new Date(Date.now() - timeValue).toISOString();

            let sql = `
                SELECT
                    COUNT(*) as total_tokens,
                    COUNT(CASE WHEN used_at IS NOT NULL THEN 1 END) as used_tokens,
                    SUM(download_count) as total_downloads,
                    AVG(download_count) as avg_downloads_per_token,
                    COUNT(DISTINCT buyer_wallet) as unique_downloaders
                FROM download_tokens
                WHERE created_at >= ?
            `;
            let params = [startDate];

            if (agentId) {
                sql += ' AND agent_id = ?';
                params.push(agentId);
            }

            const stats = await dbConnection.get(sql, params);

            // Get hourly distribution for the last 24 hours
            const hourlyDistribution = await dbConnection.query(
                `SELECT strftime('%H', created_at) as hour, COUNT(*) as count
                 FROM download_tokens
                 WHERE created_at >= datetime('now', '-24 hours')
                 ${agentId ? 'AND agent_id = ?' : ''}
                 GROUP BY hour
                 ORDER BY hour`,
                agentId ? [agentId] : []
            );

            return {
                timeframe: timeframe,
                agentId: agentId,
                totalTokens: stats.total_tokens || 0,
                usedTokens: stats.used_tokens || 0,
                totalDownloads: stats.total_downloads || 0,
                avgDownloadsPerToken: stats.avg_downloads_per_token || 0,
                uniqueDownloaders: stats.unique_downloaders || 0,
                usageRate: stats.total_tokens > 0 ? (stats.used_tokens / stats.total_tokens) : 0,
                hourlyDistribution: hourlyDistribution
            };

        } catch (error) {
            logger.logError(error, { context: 'DownloadTokenModel.getDownloadStats' });
            throw new DatabaseError('Failed to get download statistics', error);
        }
    }

    // Get most downloaded agents
    async getMostDownloadedAgents(limit = 10, timeframe = '30d') {
        try {
            const timeValue = this.parseTimeframe(timeframe);
            const startDate = new Date(Date.now() - timeValue).toISOString();

            const agents = await dbConnection.query(
                `SELECT a.agent_id, a.name, a.category,
                        COUNT(dt.token) as token_count,
                        SUM(dt.download_count) as total_downloads,
                        COUNT(DISTINCT dt.buyer_wallet) as unique_downloaders
                 FROM download_tokens dt
                 JOIN ai_agents a ON dt.agent_id = a.agent_id
                 WHERE dt.created_at >= ?
                 GROUP BY a.agent_id
                 ORDER BY total_downloads DESC
                 LIMIT ?`,
                [startDate, Math.min(limit, 50)]
            );

            return agents;

        } catch (error) {
            logger.logError(error, { context: 'DownloadTokenModel.getMostDownloadedAgents' });
            throw new DatabaseError('Failed to get most downloaded agents', error);
        }
    }

    // Parse timeframe string to milliseconds
    parseTimeframe(timeframe) {
        const match = timeframe.match(/^(\d+)([dhmw])$/);
        if (!match) {
            return 30 * 24 * 60 * 60 * 1000; // Default to 30 days
        }

        const value = parseInt(match[1]);
        const unit = match[2];

        switch (unit) {
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            case 'w': return value * 7 * 24 * 60 * 60 * 1000;
            case 'm': return value * 30 * 24 * 60 * 60 * 1000;
            default: return 30 * 24 * 60 * 60 * 1000;
        }
    }

    // Revoke token
    async revokeToken(token) {
        try {
            const tokenRecord = await this.findByToken(token);
            if (!tokenRecord) {
                throw new NotFoundError('Token not found');
            }

            // Set expiry to now to effectively revoke it
            await dbConnection.run(
                `UPDATE download_tokens SET expires_at = datetime('now') WHERE token = ?`,
                [token]
            );

            logger.logDatabase('update', this.tableName, {
                action: 'revoke_token',
                token: token.substring(0, 10) + '...'
            });

            return { success: true };

        } catch (error) {
            logger.logError(error, { context: 'DownloadTokenModel.revokeToken' });
            throw error;
        }
    }
}

// Create singleton instance
const downloadTokenModel = new DownloadTokenModel();

module.exports = downloadTokenModel;