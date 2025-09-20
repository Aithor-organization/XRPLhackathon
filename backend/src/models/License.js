const xrpl = require('xrpl');
const crypto = require('crypto');
const config = require('../config');
const dbConnection = require('../db/connection');
const logger = require('../services/logger');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    DatabaseError
} = require('../middleware/errorHandler');

class LicenseModel {
    constructor() {
        this.tableName = 'licenses';
        this.requiredFields = ['credential_id', 'agent_id', 'buyer_wallet', 'seller_wallet', 'transaction_hash', 'price_paid'];
        this.allowedStatuses = ['active', 'expired', 'revoked'];
    }

    // Generate unique license ID
    generateLicenseId() {
        return `license_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    // Validate license data
    validateLicenseData(licenseData) {
        const errors = [];

        // Check required fields (except license_id which is auto-generated)
        const requiredForValidation = this.requiredFields.filter(field => field !== 'license_id');
        for (const field of requiredForValidation) {
            if (!licenseData[field]) {
                errors.push(`${field} is required`);
            }
        }

        // Validate wallet addresses
        if (licenseData.buyer_wallet && !xrpl.isValidClassicAddress(licenseData.buyer_wallet)) {
            errors.push('Invalid buyer wallet address format');
        }

        if (licenseData.seller_wallet && !xrpl.isValidClassicAddress(licenseData.seller_wallet)) {
            errors.push('Invalid seller wallet address format');
        }

        // Validate price fields
        const priceFields = ['price_paid', 'platform_fee', 'seller_revenue'];
        for (const field of priceFields) {
            if (licenseData[field] !== undefined) {
                const value = parseFloat(licenseData[field]);
                if (isNaN(value) || value < 0) {
                    errors.push(`${field} must be a non-negative number`);
                }
            }
        }

        // Validate status
        if (licenseData.status && !this.allowedStatuses.includes(licenseData.status)) {
            errors.push(`Status must be one of: ${this.allowedStatuses.join(', ')}`);
        }

        // Validate fee calculations if all price fields are provided
        if (licenseData.price_paid && licenseData.platform_fee && licenseData.seller_revenue) {
            const total = parseFloat(licenseData.platform_fee) + parseFloat(licenseData.seller_revenue);
            const pricePaid = parseFloat(licenseData.price_paid);

            if (Math.abs(total - pricePaid) > 0.01) { // Allow for small rounding differences
                errors.push('Platform fee and seller revenue must sum to price paid');
            }
        }

        if (errors.length > 0) {
            throw new ValidationError(`License validation failed: ${errors.join(', ')}`);
        }

        return true;
    }

    // Calculate license expiry (1 year from purchase)
    calculateExpiry(purchasedAt) {
        const purchase = new Date(purchasedAt);
        const expiry = new Date(purchase);
        expiry.setFullYear(expiry.getFullYear() + 1); // Add 1 year
        return expiry.toISOString();
    }

    // Create new license
    async create(licenseData) {
        try {
            // Generate license ID
            const licenseId = this.generateLicenseId();
            const licenseToCreate = {
                ...licenseData,
                license_id: licenseId
            };

            this.validateLicenseData(licenseToCreate);

            // Calculate fees if not provided
            const fees = config.calculateFees(licenseData.price_paid);

            // Prepare license data with defaults
            const completeLicenseData = {
                license_id: licenseId,
                credential_id: licenseToCreate.credential_id,
                agent_id: licenseToCreate.agent_id,
                buyer_wallet: licenseToCreate.buyer_wallet,
                seller_wallet: licenseToCreate.seller_wallet,
                transaction_hash: licenseToCreate.transaction_hash,
                price_paid: parseFloat(licenseToCreate.price_paid),
                platform_fee: licenseToCreate.platform_fee || fees.platformFee,
                seller_revenue: licenseToCreate.seller_revenue || fees.sellerRevenue,
                status: licenseToCreate.status || 'active',
                purchased_at: licenseToCreate.purchased_at || new Date().toISOString(),
                expires_at: licenseToCreate.expires_at || this.calculateExpiry(licenseToCreate.purchased_at || new Date().toISOString())
            };

            // Check for duplicate credential ID
            const existingCredential = await this.findByCredentialId(completeLicenseData.credential_id);
            if (existingCredential) {
                throw new ConflictError('License with this credential ID already exists');
            }

            // Check for duplicate transaction hash
            const existingTransaction = await this.findByTransactionHash(completeLicenseData.transaction_hash);
            if (existingTransaction) {
                throw new ConflictError('License with this transaction hash already exists');
            }

            // Insert license into database
            await dbConnection.run(
                `INSERT INTO licenses (
                    license_id, credential_id, agent_id, buyer_wallet, seller_wallet,
                    transaction_hash, price_paid, platform_fee, seller_revenue,
                    status, purchased_at, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    completeLicenseData.license_id,
                    completeLicenseData.credential_id,
                    completeLicenseData.agent_id,
                    completeLicenseData.buyer_wallet,
                    completeLicenseData.seller_wallet,
                    completeLicenseData.transaction_hash,
                    completeLicenseData.price_paid,
                    completeLicenseData.platform_fee,
                    completeLicenseData.seller_revenue,
                    completeLicenseData.status,
                    completeLicenseData.purchased_at,
                    completeLicenseData.expires_at
                ]
            );

            logger.logDatabase('insert', this.tableName, {
                licenseId: licenseId,
                agentId: completeLicenseData.agent_id,
                buyer: completeLicenseData.buyer_wallet,
                seller: completeLicenseData.seller_wallet,
                price: completeLicenseData.price_paid
            });

            return completeLicenseData;

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.create' });

            if (error.isOperational) {
                throw error;
            }

            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new ConflictError('License with this identifier already exists');
            }

            throw new DatabaseError('Failed to create license', error);
        }
    }

    // Find license by ID
    async findById(licenseId) {
        try {
            if (!licenseId) {
                throw new ValidationError('License ID is required');
            }

            const license = await dbConnection.get(
                'SELECT * FROM licenses WHERE license_id = ?',
                [licenseId]
            );

            return license || null;

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.findById' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find license', error);
        }
    }

    // Find license by credential ID
    async findByCredentialId(credentialId) {
        try {
            if (!credentialId) {
                throw new ValidationError('Credential ID is required');
            }

            const license = await dbConnection.get(
                'SELECT * FROM licenses WHERE credential_id = ?',
                [credentialId]
            );

            return license || null;

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.findByCredentialId' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find license by credential ID', error);
        }
    }

    // Find license by transaction hash
    async findByTransactionHash(transactionHash) {
        try {
            if (!transactionHash) {
                throw new ValidationError('Transaction hash is required');
            }

            const license = await dbConnection.get(
                'SELECT * FROM licenses WHERE transaction_hash = ?',
                [transactionHash]
            );

            return license || null;

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.findByTransactionHash' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find license by transaction hash', error);
        }
    }

    // Get licenses with pagination and filtering
    async findAll(options = {}) {
        try {
            const limit = Math.min(options.limit || 50, 100);
            const offset = options.offset || 0;
            const buyerWallet = options.buyerWallet;
            const sellerWallet = options.sellerWallet;
            const agentId = options.agentId;
            const status = options.status;
            const sortBy = options.sortBy || 'purchased_at';
            const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

            // Validate sort field
            const allowedSortFields = ['purchased_at', 'price_paid', 'expires_at'];
            if (!allowedSortFields.includes(sortBy)) {
                throw new ValidationError(`Invalid sort field: ${sortBy}`);
            }

            let sql = `
                SELECT l.*, a.name as agent_name, a.category as agent_category,
                       u_buyer.user_type as buyer_type, u_seller.user_type as seller_type
                FROM licenses l
                LEFT JOIN ai_agents a ON l.agent_id = a.agent_id
                LEFT JOIN users u_buyer ON l.buyer_wallet = u_buyer.wallet_address
                LEFT JOIN users u_seller ON l.seller_wallet = u_seller.wallet_address
                WHERE 1=1
            `;
            let params = [];

            // Add filters
            if (buyerWallet) {
                sql += ' AND l.buyer_wallet = ?';
                params.push(buyerWallet);
            }

            if (sellerWallet) {
                sql += ' AND l.seller_wallet = ?';
                params.push(sellerWallet);
            }

            if (agentId) {
                sql += ' AND l.agent_id = ?';
                params.push(agentId);
            }

            if (status && this.allowedStatuses.includes(status)) {
                sql += ' AND l.status = ?';
                params.push(status);
            }

            // Add sorting and pagination
            sql += ` ORDER BY l.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            const licenses = await dbConnection.query(sql, params);

            // Get total count for pagination
            let countSql = 'SELECT COUNT(*) as total FROM licenses l WHERE 1=1';
            let countParams = [];

            if (buyerWallet) {
                countSql += ' AND l.buyer_wallet = ?';
                countParams.push(buyerWallet);
            }

            if (sellerWallet) {
                countSql += ' AND l.seller_wallet = ?';
                countParams.push(sellerWallet);
            }

            if (agentId) {
                countSql += ' AND l.agent_id = ?';
                countParams.push(agentId);
            }

            if (status && this.allowedStatuses.includes(status)) {
                countSql += ' AND l.status = ?';
                countParams.push(status);
            }

            const countResult = await dbConnection.get(countSql, countParams);

            return {
                licenses: licenses,
                pagination: {
                    total: countResult.total,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + licenses.length < countResult.total
                }
            };

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.findAll' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to fetch licenses', error);
        }
    }

    // Get user's purchased licenses
    async getUserPurchases(buyerWallet, options = {}) {
        try {
            const result = await this.findAll({
                ...options,
                buyerWallet: buyerWallet
            });

            return result;

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.getUserPurchases' });
            throw error;
        }
    }

    // Get user's sold licenses
    async getUserSales(sellerWallet, options = {}) {
        try {
            const result = await this.findAll({
                ...options,
                sellerWallet: sellerWallet
            });

            return result;

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.getUserSales' });
            throw error;
        }
    }

    // Update license
    async update(licenseId, updateData) {
        try {
            if (!licenseId) {
                throw new ValidationError('License ID is required');
            }

            // Remove immutable fields from update data
            const { license_id, credential_id, agent_id, transaction_hash, purchased_at, ...allowedUpdates } = updateData;

            if (Object.keys(allowedUpdates).length === 0) {
                throw new ValidationError('No valid fields to update');
            }

            // Validate update data
            this.validateLicenseData({ license_id: licenseId, ...allowedUpdates });

            // Check if license exists
            const existingLicense = await this.findById(licenseId);
            if (!existingLicense) {
                throw new NotFoundError('License not found');
            }

            // Build update query
            const updateFields = [];
            const updateValues = [];

            for (const [field, value] of Object.entries(allowedUpdates)) {
                updateFields.push(`${field} = ?`);
                updateValues.push(value);
            }

            updateValues.push(licenseId);

            const result = await dbConnection.run(
                `UPDATE licenses SET ${updateFields.join(', ')} WHERE license_id = ?`,
                updateValues
            );

            if (result.changes === 0) {
                throw new NotFoundError('License not found');
            }

            logger.logDatabase('update', this.tableName, {
                licenseId: licenseId,
                updatedFields: Object.keys(allowedUpdates)
            });

            // Return updated license
            return await this.findById(licenseId);

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.update' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to update license', error);
        }
    }

    // Update license status
    async updateStatus(licenseId, status) {
        try {
            if (!this.allowedStatuses.includes(status)) {
                throw new ValidationError(`Invalid status: ${status}`);
            }

            return await this.update(licenseId, { status: status });

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.updateStatus' });
            throw error;
        }
    }

    // Check if license is valid (active and not expired)
    async isLicenseValid(licenseId) {
        try {
            const license = await this.findById(licenseId);
            if (!license) {
                return false;
            }

            // Check status
            if (license.status !== 'active') {
                return false;
            }

            // Check expiry
            if (license.expires_at) {
                const now = new Date();
                const expiryDate = new Date(license.expires_at);
                if (now > expiryDate) {
                    // Auto-update status to expired
                    await this.updateStatus(licenseId, 'expired');
                    return false;
                }
            }

            return true;

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.isLicenseValid' });
            throw error;
        }
    }

    // Verify license ownership
    async verifyOwnership(licenseId, buyerWallet) {
        try {
            const license = await this.findById(licenseId);
            if (!license) {
                throw new NotFoundError('License not found');
            }

            if (license.buyer_wallet !== buyerWallet) {
                throw new ValidationError('License does not belong to this buyer');
            }

            const isValid = await this.isLicenseValid(licenseId);
            if (!isValid) {
                throw new ValidationError('License is not valid or has expired');
            }

            return license;

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.verifyOwnership' });
            throw error;
        }
    }

    // Get expired licenses for cleanup
    async getExpiredLicenses(limit = 100) {
        try {
            const licenses = await dbConnection.query(
                `SELECT license_id, expires_at FROM licenses
                 WHERE status = 'active' AND expires_at < datetime('now')
                 LIMIT ?`,
                [limit]
            );

            return licenses;

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.getExpiredLicenses' });
            throw new DatabaseError('Failed to get expired licenses', error);
        }
    }

    // Mark expired licenses
    async markExpiredLicenses() {
        try {
            const result = await dbConnection.run(
                `UPDATE licenses SET status = 'expired'
                 WHERE status = 'active' AND expires_at < datetime('now')`
            );

            logger.logDatabase('batch_update', this.tableName, {
                action: 'mark_expired',
                count: result.changes
            });

            return result.changes;

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.markExpiredLicenses' });
            throw new DatabaseError('Failed to mark expired licenses', error);
        }
    }

    // Get license statistics
    async getLicenseStats(options = {}) {
        try {
            const agentId = options.agentId;
            const sellerWallet = options.sellerWallet;
            const timeframe = options.timeframe || '30d'; // 30 days default

            // Calculate date range
            const timeValue = this.parseTimeframe(timeframe);
            const startDate = new Date(Date.now() - timeValue).toISOString();

            let sql = `
                SELECT
                    COUNT(*) as total_licenses,
                    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_licenses,
                    COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired_licenses,
                    SUM(price_paid) as total_revenue,
                    AVG(price_paid) as avg_price,
                    COUNT(DISTINCT buyer_wallet) as unique_buyers
                FROM licenses
                WHERE purchased_at >= ?
            `;
            let params = [startDate];

            if (agentId) {
                sql += ' AND agent_id = ?';
                params.push(agentId);
            }

            if (sellerWallet) {
                sql += ' AND seller_wallet = ?';
                params.push(sellerWallet);
            }

            const stats = await dbConnection.get(sql, params);

            return {
                timeframe: timeframe,
                agentId: agentId,
                sellerWallet: sellerWallet,
                totalLicenses: stats.total_licenses || 0,
                activeLicenses: stats.active_licenses || 0,
                expiredLicenses: stats.expired_licenses || 0,
                totalRevenue: stats.total_revenue || 0,
                averagePrice: stats.avg_price || 0,
                uniqueBuyers: stats.unique_buyers || 0
            };

        } catch (error) {
            logger.logError(error, { context: 'LicenseModel.getLicenseStats' });
            throw new DatabaseError('Failed to get license statistics', error);
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
}

// Create singleton instance
const licenseModel = new LicenseModel();

module.exports = licenseModel;