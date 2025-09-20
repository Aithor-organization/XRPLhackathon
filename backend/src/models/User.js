const xrpl = require('xrpl');
const dbConnection = require('../db/connection');
const logger = require('../services/logger');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    DatabaseError
} = require('../middleware/errorHandler');

class UserModel {
    constructor() {
        this.tableName = 'users';
        this.requiredFields = ['wallet_address', 'user_type'];
        this.allowedUserTypes = ['developer', 'buyer', 'both'];
    }

    // Validate user data
    validateUserData(userData) {
        const errors = [];

        // Check required fields
        for (const field of this.requiredFields) {
            if (!userData[field]) {
                errors.push(`${field} is required`);
            }
        }

        // Validate wallet address
        if (userData.wallet_address && !xrpl.isValidClassicAddress(userData.wallet_address)) {
            errors.push('Invalid wallet address format');
        }

        // Validate user type
        if (userData.user_type && !this.allowedUserTypes.includes(userData.user_type)) {
            errors.push(`User type must be one of: ${this.allowedUserTypes.join(', ')}`);
        }

        // Validate reputation score
        if (userData.reputation_score !== undefined) {
            const score = parseFloat(userData.reputation_score);
            if (isNaN(score) || score < 0 || score > 5) {
                errors.push('Reputation score must be between 0 and 5');
            }
        }

        // Validate numeric fields
        const numericFields = ['total_sales', 'total_purchases'];
        for (const field of numericFields) {
            if (userData[field] !== undefined) {
                const value = parseInt(userData[field]);
                if (isNaN(value) || value < 0) {
                    errors.push(`${field} must be a non-negative integer`);
                }
            }
        }

        if (errors.length > 0) {
            throw new ValidationError(`User validation failed: ${errors.join(', ')}`);
        }

        return true;
    }

    // Create new user
    async create(userData) {
        try {
            this.validateUserData(userData);

            // Check if user already exists
            const existingUser = await this.findByWallet(userData.wallet_address);
            if (existingUser) {
                throw new ConflictError('User with this wallet address already exists');
            }

            // Prepare user data with defaults
            const userToCreate = {
                wallet_address: userData.wallet_address,
                user_type: userData.user_type || 'both',
                created_at: new Date().toISOString(),
                last_login: new Date().toISOString(),
                total_sales: userData.total_sales || 0,
                total_purchases: userData.total_purchases || 0,
                reputation_score: userData.reputation_score || 0.00
            };

            // Insert user into database
            await dbConnection.run(
                `INSERT INTO users (
                    wallet_address, user_type, created_at, last_login,
                    total_sales, total_purchases, reputation_score
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    userToCreate.wallet_address,
                    userToCreate.user_type,
                    userToCreate.created_at,
                    userToCreate.last_login,
                    userToCreate.total_sales,
                    userToCreate.total_purchases,
                    userToCreate.reputation_score
                ]
            );

            logger.logDatabase('insert', this.tableName, {
                wallet: userToCreate.wallet_address,
                userType: userToCreate.user_type
            });

            return userToCreate;

        } catch (error) {
            logger.logError(error, { context: 'UserModel.create' });

            if (error.isOperational) {
                throw error;
            }

            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new ConflictError('User with this wallet address already exists');
            }

            throw new DatabaseError('Failed to create user', error);
        }
    }

    // Find user by wallet address
    async findByWallet(walletAddress) {
        try {
            if (!walletAddress) {
                throw new ValidationError('Wallet address is required');
            }

            if (!xrpl.isValidClassicAddress(walletAddress)) {
                throw new ValidationError('Invalid wallet address format');
            }

            const user = await dbConnection.get(
                'SELECT * FROM users WHERE wallet_address = ?',
                [walletAddress]
            );

            return user || null;

        } catch (error) {
            logger.logError(error, { context: 'UserModel.findByWallet' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find user', error);
        }
    }

    // Get all users with pagination
    async findAll(options = {}) {
        try {
            const limit = Math.min(options.limit || 50, 100); // Max 100 users per request
            const offset = options.offset || 0;
            const userType = options.userType;
            const sortBy = options.sortBy || 'created_at';
            const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

            // Validate sort field
            const allowedSortFields = ['created_at', 'last_login', 'total_sales', 'total_purchases', 'reputation_score'];
            if (!allowedSortFields.includes(sortBy)) {
                throw new ValidationError(`Invalid sort field: ${sortBy}`);
            }

            let sql = 'SELECT * FROM users WHERE 1=1';
            let params = [];

            // Add user type filter
            if (userType && this.allowedUserTypes.includes(userType)) {
                sql += ' AND user_type = ?';
                params.push(userType);
            }

            // Add sorting and pagination
            sql += ` ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            const users = await dbConnection.query(sql, params);

            // Get total count for pagination
            let countSql = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
            let countParams = [];

            if (userType && this.allowedUserTypes.includes(userType)) {
                countSql += ' AND user_type = ?';
                countParams.push(userType);
            }

            const countResult = await dbConnection.get(countSql, countParams);

            return {
                users: users,
                pagination: {
                    total: countResult.total,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + users.length < countResult.total
                }
            };

        } catch (error) {
            logger.logError(error, { context: 'UserModel.findAll' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to fetch users', error);
        }
    }

    // Update user
    async update(walletAddress, updateData) {
        try {
            if (!walletAddress) {
                throw new ValidationError('Wallet address is required');
            }

            // Remove wallet_address from update data if present
            const { wallet_address, created_at, ...allowedUpdates } = updateData;

            if (Object.keys(allowedUpdates).length === 0) {
                throw new ValidationError('No valid fields to update');
            }

            // Validate update data
            this.validateUserData({ wallet_address: walletAddress, ...allowedUpdates });

            // Check if user exists
            const existingUser = await this.findByWallet(walletAddress);
            if (!existingUser) {
                throw new NotFoundError('User not found');
            }

            // Build update query
            const updateFields = [];
            const updateValues = [];

            for (const [field, value] of Object.entries(allowedUpdates)) {
                updateFields.push(`${field} = ?`);
                updateValues.push(value);
            }

            updateValues.push(walletAddress);

            const result = await dbConnection.run(
                `UPDATE users SET ${updateFields.join(', ')} WHERE wallet_address = ?`,
                updateValues
            );

            if (result.changes === 0) {
                throw new NotFoundError('User not found');
            }

            logger.logDatabase('update', this.tableName, {
                wallet: walletAddress,
                updatedFields: Object.keys(allowedUpdates)
            });

            // Return updated user
            return await this.findByWallet(walletAddress);

        } catch (error) {
            logger.logError(error, { context: 'UserModel.update' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to update user', error);
        }
    }

    // Update last login timestamp
    async updateLastLogin(walletAddress) {
        try {
            const result = await dbConnection.run(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE wallet_address = ?',
                [walletAddress]
            );

            if (result.changes === 0) {
                throw new NotFoundError('User not found');
            }

            logger.logDatabase('update', this.tableName, {
                wallet: walletAddress,
                field: 'last_login'
            });

            return true;

        } catch (error) {
            logger.logError(error, { context: 'UserModel.updateLastLogin' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to update last login', error);
        }
    }

    // Update user statistics
    async updateStats(walletAddress, stats) {
        try {
            const allowedStats = ['total_sales', 'total_purchases', 'reputation_score'];
            const updateData = {};

            for (const [field, value] of Object.entries(stats)) {
                if (allowedStats.includes(field)) {
                    updateData[field] = value;
                }
            }

            if (Object.keys(updateData).length === 0) {
                throw new ValidationError('No valid statistics to update');
            }

            return await this.update(walletAddress, updateData);

        } catch (error) {
            logger.logError(error, { context: 'UserModel.updateStats' });
            throw error;
        }
    }

    // Increment sales count
    async incrementSales(walletAddress, amount = 1) {
        try {
            const result = await dbConnection.run(
                'UPDATE users SET total_sales = total_sales + ? WHERE wallet_address = ?',
                [amount, walletAddress]
            );

            if (result.changes === 0) {
                throw new NotFoundError('User not found');
            }

            logger.logDatabase('update', this.tableName, {
                wallet: walletAddress,
                action: 'increment_sales',
                amount: amount
            });

            return true;

        } catch (error) {
            logger.logError(error, { context: 'UserModel.incrementSales' });
            throw new DatabaseError('Failed to increment sales count', error);
        }
    }

    // Increment purchases count
    async incrementPurchases(walletAddress, amount = 1) {
        try {
            const result = await dbConnection.run(
                'UPDATE users SET total_purchases = total_purchases + ? WHERE wallet_address = ?',
                [amount, walletAddress]
            );

            if (result.changes === 0) {
                throw new NotFoundError('User not found');
            }

            logger.logDatabase('update', this.tableName, {
                wallet: walletAddress,
                action: 'increment_purchases',
                amount: amount
            });

            return true;

        } catch (error) {
            logger.logError(error, { context: 'UserModel.incrementPurchases' });
            throw new DatabaseError('Failed to increment purchases count', error);
        }
    }

    // Calculate and update reputation score
    async calculateReputation(walletAddress) {
        try {
            // Get user's reviews as a seller
            const reviews = await dbConnection.query(
                `SELECT AVG(rating) as avg_rating, COUNT(*) as review_count
                 FROM reviews r
                 JOIN licenses l ON r.license_id = l.license_id
                 WHERE l.seller_wallet = ?`,
                [walletAddress]
            );

            const avgRating = reviews[0]?.avg_rating || 0;
            const reviewCount = reviews[0]?.review_count || 0;

            // Simple reputation calculation
            // You can make this more sophisticated based on business rules
            let reputationScore = 0;

            if (reviewCount > 0) {
                // Base score from average rating
                reputationScore = avgRating;

                // Boost for more reviews (up to 10% bonus)
                const reviewBonus = Math.min(reviewCount / 100, 0.1) * avgRating;
                reputationScore += reviewBonus;

                // Cap at 5.0
                reputationScore = Math.min(reputationScore, 5.0);
            }

            // Update reputation score
            await this.updateStats(walletAddress, {
                reputation_score: Math.round(reputationScore * 100) / 100 // Round to 2 decimal places
            });

            logger.logDatabase('update', this.tableName, {
                wallet: walletAddress,
                action: 'calculate_reputation',
                avgRating: avgRating,
                reviewCount: reviewCount,
                newReputation: reputationScore
            });

            return reputationScore;

        } catch (error) {
            logger.logError(error, { context: 'UserModel.calculateReputation' });
            throw new DatabaseError('Failed to calculate reputation', error);
        }
    }

    // Get user profile with additional statistics
    async getProfile(walletAddress) {
        try {
            const user = await this.findByWallet(walletAddress);
            if (!user) {
                throw new NotFoundError('User not found');
            }

            // Get additional statistics
            const agentCount = await dbConnection.get(
                'SELECT COUNT(*) as count FROM ai_agents WHERE wallet_address = ? AND status = "active"',
                [walletAddress]
            );

            const purchaseCount = await dbConnection.get(
                'SELECT COUNT(*) as count FROM licenses WHERE buyer_wallet = ? AND status = "active"',
                [walletAddress]
            );

            const recentActivity = await dbConnection.query(
                `SELECT 'sale' as type, created_at, agent_id as reference_id
                 FROM licenses WHERE seller_wallet = ?
                 UNION ALL
                 SELECT 'purchase' as type, purchased_at as created_at, agent_id as reference_id
                 FROM licenses WHERE buyer_wallet = ?
                 ORDER BY created_at DESC LIMIT 10`,
                [walletAddress, walletAddress]
            );

            return {
                ...user,
                statistics: {
                    agentsCreated: agentCount.count,
                    activeLicenses: purchaseCount.count,
                    recentActivity: recentActivity
                }
            };

        } catch (error) {
            logger.logError(error, { context: 'UserModel.getProfile' });
            throw error;
        }
    }

    // Delete user (soft delete by deactivating)
    async delete(walletAddress) {
        try {
            // Note: In a real system, you might want to implement soft delete
            // by adding a 'status' field instead of actually deleting the record
            // For now, we'll throw an error since user deletion affects referential integrity

            throw new ValidationError('User deletion not supported. Consider deactivating instead.');

        } catch (error) {
            logger.logError(error, { context: 'UserModel.delete' });
            throw error;
        }
    }

    // Get top users by reputation
    async getTopByReputation(limit = 10) {
        try {
            const users = await dbConnection.query(
                `SELECT wallet_address, user_type, reputation_score, total_sales, total_purchases
                 FROM users
                 WHERE reputation_score > 0
                 ORDER BY reputation_score DESC, total_sales DESC
                 LIMIT ?`,
                [Math.min(limit, 50)]
            );

            return users;

        } catch (error) {
            logger.logError(error, { context: 'UserModel.getTopByReputation' });
            throw new DatabaseError('Failed to get top users', error);
        }
    }
}

// Create singleton instance
const userModel = new UserModel();

module.exports = userModel;