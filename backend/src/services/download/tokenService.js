const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../logger');
const dbConnection = require('../../db/connection');
const {
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    DatabaseError
} = require('../../middleware/errorHandler');

class DownloadTokenService {
    constructor() {
        this.tokenExpiry = config.download.tokenExpiry;
        this.maxAttempts = config.download.maxAttempts;
        this.jwtSecret = config.jwt.secret;
        console.log('Download Token Service initialized');
    }

    // Generate secure download token
    generateDownloadToken(licenseData, agentData, userWallet) {
        try {
            const tokenId = crypto.randomBytes(32).toString('hex');
            const now = new Date();
            const expiresAt = new Date(now.getTime() + this.parseExpiry(this.tokenExpiry));

            const tokenPayload = {
                tokenId: tokenId,
                licenseId: licenseData.licenseId,
                agentId: agentData.agentId,
                buyerWallet: userWallet,
                ipfsHash: agentData.ipfsHash,
                createdAt: now.toISOString(),
                expiresAt: expiresAt.toISOString(),
                type: 'download'
            };

            const jwtToken = jwt.sign(tokenPayload, this.jwtSecret, {
                expiresIn: this.tokenExpiry,
                issuer: config.platform.name,
                audience: 'download-service'
            });

            logger.info('Download token generated', {
                tokenId: tokenId,
                licenseId: licenseData.licenseId,
                agentId: agentData.agentId,
                buyer: userWallet,
                expiresAt: expiresAt.toISOString()
            });

            return {
                token: tokenId,
                jwtToken: jwtToken,
                expiresAt: expiresAt,
                payload: tokenPayload
            };

        } catch (error) {
            logger.logError(error, { context: 'generateDownloadToken' });
            throw new Error('Failed to generate download token');
        }
    }

    // Parse expiry string to milliseconds
    parseExpiry(expiry) {
        const match = expiry.match(/^(\d+)([smhd])$/);
        if (!match) {
            return 24 * 60 * 60 * 1000; // Default to 24 hours
        }

        const value = parseInt(match[1]);
        const unit = match[2];

        switch (unit) {
            case 's': return value * 1000;
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: return 24 * 60 * 60 * 1000;
        }
    }

    // Store download token in database
    async storeDownloadToken(tokenData, ipAddress = null) {
        try {
            await dbConnection.run(
                `INSERT INTO download_tokens (
                    token, license_id, agent_id, buyer_wallet,
                    created_at, expires_at, download_count, ip_address
                ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
                [
                    tokenData.token,
                    tokenData.payload.licenseId,
                    tokenData.payload.agentId,
                    tokenData.payload.buyerWallet,
                    tokenData.payload.createdAt,
                    tokenData.payload.expiresAt,
                    ipAddress
                ]
            );

            logger.logDatabase('insert', 'download_tokens', {
                token: tokenData.token,
                licenseId: tokenData.payload.licenseId,
                buyer: tokenData.payload.buyerWallet
            });

        } catch (error) {
            logger.logError(error, { context: 'storeDownloadToken' });
            throw new DatabaseError('Failed to store download token', error);
        }
    }

    // Create download token for a license
    async createDownloadToken(licenseId, userWallet, ipAddress = null) {
        try {
            // Verify license exists and belongs to user
            const license = await this.verifyLicenseOwnership(licenseId, userWallet);

            // Get agent data
            const agent = await this.getAgentData(license.agent_id);

            // Check if user already has an active token
            const existingToken = await this.getActiveToken(licenseId, userWallet);
            if (existingToken) {
                logger.info('Returning existing active download token', {
                    tokenId: existingToken.token,
                    licenseId: licenseId,
                    buyer: userWallet
                });

                return {
                    success: true,
                    token: existingToken.token,
                    expiresAt: existingToken.expires_at,
                    downloadUrl: `/api/downloads/${existingToken.token}`,
                    remainingAttempts: this.maxAttempts - existingToken.download_count
                };
            }

            // Generate new token
            const tokenData = this.generateDownloadToken(license, agent, userWallet);

            // Store in database
            await this.storeDownloadToken(tokenData, ipAddress);

            return {
                success: true,
                token: tokenData.token,
                expiresAt: tokenData.expiresAt,
                downloadUrl: `/api/downloads/${tokenData.token}`,
                remainingAttempts: this.maxAttempts
            };

        } catch (error) {
            logger.logError(error, { context: 'createDownloadToken' });
            throw error;
        }
    }

    // Verify license ownership
    async verifyLicenseOwnership(licenseId, userWallet) {
        try {
            const license = await dbConnection.get(
                'SELECT * FROM licenses WHERE license_id = ? AND buyer_wallet = ? AND status = "active"',
                [licenseId, userWallet]
            );

            if (!license) {
                throw new AuthorizationError('License not found or access denied');
            }

            // Check if license has expired
            if (license.expires_at && new Date(license.expires_at) < new Date()) {
                throw new AuthorizationError('License has expired');
            }

            return license;

        } catch (error) {
            logger.logError(error, { context: 'verifyLicenseOwnership' });
            throw error;
        }
    }

    // Get agent data
    async getAgentData(agentId) {
        try {
            const agent = await dbConnection.get(
                'SELECT * FROM ai_agents WHERE agent_id = ? AND status = "active"',
                [agentId]
            );

            if (!agent) {
                throw new NotFoundError('AI agent not found');
            }

            return agent;

        } catch (error) {
            logger.logError(error, { context: 'getAgentData' });
            throw error;
        }
    }

    // Get active token for user
    async getActiveToken(licenseId, userWallet) {
        try {
            const token = await dbConnection.get(
                `SELECT * FROM download_tokens
                 WHERE license_id = ? AND buyer_wallet = ?
                 AND expires_at > datetime('now')
                 AND download_count < ?
                 ORDER BY created_at DESC LIMIT 1`,
                [licenseId, userWallet, this.maxAttempts]
            );

            return token;

        } catch (error) {
            logger.logError(error, { context: 'getActiveToken' });
            throw new DatabaseError('Failed to check for active tokens', error);
        }
    }

    // Validate download token
    async validateDownloadToken(token, ipAddress = null) {
        try {
            // Get token from database
            const tokenRecord = await dbConnection.get(
                'SELECT dt.*, l.*, a.ipfs_hash, a.name as agent_name FROM download_tokens dt ' +
                'JOIN licenses l ON dt.license_id = l.license_id ' +
                'JOIN ai_agents a ON dt.agent_id = a.agent_id ' +
                'WHERE dt.token = ?',
                [token]
            );

            if (!tokenRecord) {
                throw new AuthenticationError('Invalid download token');
            }

            // Check if token has expired
            const now = new Date();
            const expiresAt = new Date(tokenRecord.expires_at);

            if (now > expiresAt) {
                logger.logSecurity('expired_token_used', {
                    token: token,
                    expiredAt: tokenRecord.expires_at,
                    ipAddress: ipAddress
                });
                throw new AuthenticationError('Download token has expired');
            }

            // Check download count
            if (tokenRecord.download_count >= this.maxAttempts) {
                logger.logSecurity('max_downloads_exceeded', {
                    token: token,
                    downloadCount: tokenRecord.download_count,
                    maxAttempts: this.maxAttempts,
                    ipAddress: ipAddress
                });
                throw new AuthenticationError('Maximum download attempts exceeded');
            }

            // Check license status
            if (tokenRecord.status !== 'active') {
                throw new AuthorizationError('License is not active');
            }

            // Log successful validation
            logger.info('Download token validated successfully', {
                token: token,
                licenseId: tokenRecord.license_id,
                agentId: tokenRecord.agent_id,
                buyer: tokenRecord.buyer_wallet,
                downloadCount: tokenRecord.download_count,
                ipAddress: ipAddress
            });

            return {
                valid: true,
                tokenRecord: tokenRecord,
                ipfsHash: tokenRecord.ipfs_hash,
                agentName: tokenRecord.agent_name,
                remainingAttempts: this.maxAttempts - tokenRecord.download_count
            };

        } catch (error) {
            logger.logError(error, { context: 'validateDownloadToken' });
            throw error;
        }
    }

    // Record download attempt
    async recordDownloadAttempt(token, ipAddress = null, success = true) {
        try {
            const updateTime = success ? ', used_at = CURRENT_TIMESTAMP' : '';

            await dbConnection.run(
                `UPDATE download_tokens
                 SET download_count = download_count + 1, ip_address = ?${updateTime}
                 WHERE token = ?`,
                [ipAddress, token]
            );

            logger.info('Download attempt recorded', {
                token: token,
                success: success,
                ipAddress: ipAddress
            });

        } catch (error) {
            logger.logError(error, { context: 'recordDownloadAttempt' });
            throw new DatabaseError('Failed to record download attempt', error);
        }
    }

    // Get token information (without sensitive data)
    async getTokenInfo(token) {
        try {
            const tokenRecord = await dbConnection.get(
                `SELECT dt.token, dt.created_at, dt.expires_at, dt.download_count,
                        l.license_id, a.agent_id, a.name as agent_name
                 FROM download_tokens dt
                 JOIN licenses l ON dt.license_id = l.license_id
                 JOIN ai_agents a ON dt.agent_id = a.agent_id
                 WHERE dt.token = ?`,
                [token]
            );

            if (!tokenRecord) {
                throw new NotFoundError('Download token not found');
            }

            const now = new Date();
            const expiresAt = new Date(tokenRecord.expires_at);
            const isExpired = now > expiresAt;
            const attemptsRemaining = Math.max(0, this.maxAttempts - tokenRecord.download_count);

            return {
                token: tokenRecord.token,
                licenseId: tokenRecord.license_id,
                agentId: tokenRecord.agent_id,
                agentName: tokenRecord.agent_name,
                createdAt: tokenRecord.created_at,
                expiresAt: tokenRecord.expires_at,
                isExpired: isExpired,
                downloadCount: tokenRecord.download_count,
                maxAttempts: this.maxAttempts,
                attemptsRemaining: attemptsRemaining,
                isValid: !isExpired && attemptsRemaining > 0
            };

        } catch (error) {
            logger.logError(error, { context: 'getTokenInfo' });
            throw error;
        }
    }

    // Clean up expired tokens
    async cleanupExpiredTokens() {
        try {
            const result = await dbConnection.run(
                'DELETE FROM download_tokens WHERE expires_at < datetime("now")'
            );

            logger.info('Expired download tokens cleaned up', {
                deletedCount: result.changes
            });

            return result.changes;

        } catch (error) {
            logger.logError(error, { context: 'cleanupExpiredTokens' });
            throw new DatabaseError('Failed to cleanup expired tokens', error);
        }
    }

    // Get user's download history
    async getUserDownloadHistory(userWallet, options = {}) {
        try {
            const limit = options.limit || 50;
            const offset = options.offset || 0;

            const downloads = await dbConnection.query(
                `SELECT dt.token, dt.created_at, dt.used_at, dt.download_count,
                        dt.expires_at, a.name as agent_name, a.agent_id
                 FROM download_tokens dt
                 JOIN ai_agents a ON dt.agent_id = a.agent_id
                 WHERE dt.buyer_wallet = ?
                 ORDER BY dt.created_at DESC
                 LIMIT ? OFFSET ?`,
                [userWallet, limit, offset]
            );

            return {
                downloads: downloads,
                total: downloads.length,
                limit: limit,
                offset: offset
            };

        } catch (error) {
            logger.logError(error, { context: 'getUserDownloadHistory' });
            throw new DatabaseError('Failed to get download history', error);
        }
    }

    // Get download statistics
    async getDownloadStats(agentId = null, timeframe = '7d') {
        try {
            let timeCondition = '';
            const timeValue = this.parseExpiry(timeframe);
            const startDate = new Date(Date.now() - timeValue).toISOString();

            timeCondition = `AND dt.created_at >= '${startDate}'`;

            let agentCondition = '';
            let params = [];

            if (agentId) {
                agentCondition = 'WHERE dt.agent_id = ?';
                params.push(agentId);
            }

            const query = `
                SELECT
                    COUNT(*) as total_tokens,
                    COUNT(CASE WHEN dt.used_at IS NOT NULL THEN 1 END) as used_tokens,
                    SUM(dt.download_count) as total_downloads,
                    COUNT(DISTINCT dt.buyer_wallet) as unique_downloaders
                FROM download_tokens dt
                ${agentCondition}
                ${timeCondition}
            `;

            const stats = await dbConnection.get(query, params);

            return {
                timeframe: timeframe,
                agentId: agentId,
                totalTokens: stats.total_tokens || 0,
                usedTokens: stats.used_tokens || 0,
                totalDownloads: stats.total_downloads || 0,
                uniqueDownloaders: stats.unique_downloaders || 0,
                usageRate: stats.total_tokens > 0 ? (stats.used_tokens / stats.total_tokens) : 0
            };

        } catch (error) {
            logger.logError(error, { context: 'getDownloadStats' });
            throw new DatabaseError('Failed to get download statistics', error);
        }
    }
}

// Create singleton instance
const downloadTokenService = new DownloadTokenService();

module.exports = downloadTokenService;