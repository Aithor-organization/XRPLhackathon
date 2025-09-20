const xrpl = require('xrpl');
const crypto = require('crypto');
const config = require('../config');
const dbConnection = require('../db/connection');
const logger = require('../services/logger');
const userModel = require('./User');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    DatabaseError
} = require('../middleware/errorHandler');

class AIAgentModel {
    constructor() {
        this.tableName = 'ai_agents';
        this.requiredFields = ['nft_id', 'wallet_address', 'name', 'description', 'category', 'price_xrp', 'ipfs_hash', 'credential_type'];
        this.allowedCategories = config.validation.allowedCategories;
        this.allowedStatuses = ['active', 'inactive', 'pending'];
    }

    // Generate unique agent ID
    generateAgentId() {
        return `agent_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    // Validate agent data
    validateAgentData(agentData) {
        const errors = [];

        // Check required fields (except agent_id which is auto-generated)
        const requiredForValidation = this.requiredFields.filter(field => field !== 'agent_id');
        for (const field of requiredForValidation) {
            if (!agentData[field]) {
                errors.push(`${field} is required`);
            }
        }

        // Validate wallet address
        if (agentData.wallet_address && !xrpl.isValidClassicAddress(agentData.wallet_address)) {
            errors.push('Invalid wallet address format');
        }

        // Validate IPFS hash
        if (agentData.ipfs_hash && !config.validation.ipfsHashRegex.test(agentData.ipfs_hash)) {
            errors.push('Invalid IPFS hash format');
        }

        // Validate category
        if (agentData.category && !this.allowedCategories.includes(agentData.category)) {
            errors.push(`Category must be one of: ${this.allowedCategories.join(', ')}`);
        }

        // Validate price
        if (agentData.price_xrp !== undefined) {
            const price = parseFloat(agentData.price_xrp);
            if (isNaN(price) || price < config.validation.minPriceXRP || price > config.validation.maxPriceXRP) {
                errors.push(`Price must be between ${config.validation.minPriceXRP} and ${config.validation.maxPriceXRP} XRP`);
            }
        }

        // Validate text lengths
        if (agentData.name && agentData.name.length > config.validation.maxNameLength) {
            errors.push(`Name exceeds maximum length of ${config.validation.maxNameLength} characters`);
        }

        if (agentData.description && agentData.description.length > config.validation.maxDescriptionLength) {
            errors.push(`Description exceeds maximum length of ${config.validation.maxDescriptionLength} characters`);
        }

        // Validate status
        if (agentData.status && !this.allowedStatuses.includes(agentData.status)) {
            errors.push(`Status must be one of: ${this.allowedStatuses.join(', ')}`);
        }

        // Validate numeric fields
        const numericFields = ['total_sales', 'average_rating'];
        for (const field of numericFields) {
            if (agentData[field] !== undefined) {
                const value = parseFloat(agentData[field]);
                if (isNaN(value) || value < 0) {
                    errors.push(`${field} must be a non-negative number`);
                }
            }
        }

        // Validate average rating range
        if (agentData.average_rating !== undefined) {
            const rating = parseFloat(agentData.average_rating);
            if (rating > 5) {
                errors.push('Average rating cannot exceed 5.0');
            }
        }

        if (errors.length > 0) {
            throw new ValidationError(`Agent validation failed: ${errors.join(', ')}`);
        }

        return true;
    }

    // Create new AI agent
    async create(agentData) {
        try {
            // Generate agent ID
            const agentId = this.generateAgentId();
            const agentToCreate = {
                ...agentData,
                agent_id: agentId
            };

            this.validateAgentData(agentToCreate);

            // Verify owner exists
            const owner = await userModel.findByWallet(agentData.wallet_address);
            if (!owner) {
                throw new ValidationError('Owner wallet address not found in users');
            }

            // Check for duplicate IPFS hash
            const existingAgent = await this.findByIPFSHash(agentData.ipfs_hash);
            if (existingAgent) {
                throw new ConflictError('Agent with this IPFS hash already exists');
            }

            // Check for duplicate NFT ID
            if (agentData.nft_id) {
                const existingNFT = await this.findByNFTId(agentData.nft_id);
                if (existingNFT) {
                    throw new ConflictError('Agent with this NFT ID already exists');
                }
            }

            // Prepare agent data with defaults
            const completeAgentData = {
                agent_id: agentId,
                nft_id: agentToCreate.nft_id,
                wallet_address: agentToCreate.wallet_address,
                name: agentToCreate.name,
                description: agentToCreate.description,
                category: agentToCreate.category,
                price_xrp: parseFloat(agentToCreate.price_xrp),
                image_url: agentToCreate.image_url || null,
                ipfs_hash: agentToCreate.ipfs_hash,
                credential_type: agentToCreate.credential_type,
                did_id: agentToCreate.did_id || null,
                did_document: agentToCreate.did_document || null,
                status: agentToCreate.status || 'active',
                created_at: new Date().toISOString(),
                total_sales: 0,
                average_rating: 0.0
            };

            // Insert agent into database
            await dbConnection.run(
                `INSERT INTO ai_agents (
                    agent_id, nft_id, wallet_address, name, description, category,
                    price_xrp, image_url, ipfs_hash, credential_type, did_id, did_document,
                    status, created_at, total_sales, average_rating
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    completeAgentData.agent_id,
                    completeAgentData.nft_id,
                    completeAgentData.wallet_address,
                    completeAgentData.name,
                    completeAgentData.description,
                    completeAgentData.category,
                    completeAgentData.price_xrp,
                    completeAgentData.image_url,
                    completeAgentData.ipfs_hash,
                    completeAgentData.credential_type,
                    completeAgentData.did_id,
                    completeAgentData.did_document,
                    completeAgentData.status,
                    completeAgentData.created_at,
                    completeAgentData.total_sales,
                    completeAgentData.average_rating
                ]
            );

            logger.logDatabase('insert', this.tableName, {
                agentId: agentId,
                owner: completeAgentData.wallet_address,
                category: completeAgentData.category,
                price: completeAgentData.price_xrp
            });

            return completeAgentData;

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.create' });

            if (error.isOperational) {
                throw error;
            }

            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new ConflictError('Agent with this identifier already exists');
            }

            throw new DatabaseError('Failed to create AI agent', error);
        }
    }

    // Find agent by ID
    async findById(agentId) {
        try {
            if (!agentId) {
                throw new ValidationError('Agent ID is required');
            }

            const agent = await dbConnection.get(
                'SELECT * FROM ai_agents WHERE agent_id = ?',
                [agentId]
            );

            return agent || null;

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.findById' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find agent', error);
        }
    }

    // Find agent by NFT ID
    async findByNFTId(nftId) {
        try {
            if (!nftId) {
                throw new ValidationError('NFT ID is required');
            }

            const agent = await dbConnection.get(
                'SELECT * FROM ai_agents WHERE nft_id = ?',
                [nftId]
            );

            return agent || null;

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.findByNFTId' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find agent by NFT ID', error);
        }
    }

    // Find agent by IPFS hash
    async findByIPFSHash(ipfsHash) {
        try {
            if (!ipfsHash) {
                throw new ValidationError('IPFS hash is required');
            }

            const agent = await dbConnection.get(
                'SELECT * FROM ai_agents WHERE ipfs_hash = ?',
                [ipfsHash]
            );

            return agent || null;

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.findByIPFSHash' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find agent by IPFS hash', error);
        }
    }

    // Find agent by DID ID
    async findByDIDId(didId) {
        try {
            if (!didId) {
                throw new ValidationError('DID ID is required');
            }

            const agent = await dbConnection.get(
                'SELECT * FROM ai_agents WHERE did_id = ?',
                [didId]
            );

            return agent || null;

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.findByDIDId' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find agent by DID ID', error);
        }
    }

    // Get agents with pagination and filtering
    async findAll(options = {}) {
        try {
            const limit = Math.min(options.limit || 20, 100);
            const offset = options.offset || 0;
            const category = options.category;
            const status = options.status || 'active';
            const ownerId = options.ownerId;
            const sortBy = options.sortBy || 'created_at';
            const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

            // Validate sort field
            const allowedSortFields = ['created_at', 'price_xrp', 'total_sales', 'average_rating', 'name'];
            if (!allowedSortFields.includes(sortBy)) {
                throw new ValidationError(`Invalid sort field: ${sortBy}`);
            }

            let sql = 'SELECT * FROM ai_agents WHERE 1=1';
            let params = [];

            // Add filters
            if (status) {
                sql += ' AND status = ?';
                params.push(status);
            }

            if (category && this.allowedCategories.includes(category)) {
                sql += ' AND category = ?';
                params.push(category);
            }

            if (ownerId) {
                sql += ' AND wallet_address = ?';
                params.push(ownerId);
            }

            // Add sorting and pagination
            sql += ` ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
            params.push(limit, offset);

            const agents = await dbConnection.query(sql, params);

            // Get total count for pagination
            let countSql = 'SELECT COUNT(*) as total FROM ai_agents WHERE 1=1';
            let countParams = [];

            if (status) {
                countSql += ' AND status = ?';
                countParams.push(status);
            }

            if (category && this.allowedCategories.includes(category)) {
                countSql += ' AND category = ?';
                countParams.push(category);
            }

            if (ownerId) {
                countSql += ' AND wallet_address = ?';
                countParams.push(ownerId);
            }

            const countResult = await dbConnection.get(countSql, countParams);

            return {
                agents: agents,
                pagination: {
                    total: countResult.total,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + agents.length < countResult.total
                }
            };

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.findAll' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to fetch agents', error);
        }
    }

    // Get agent details with reviews
    // Get unique sellers (for sync)
    async getUniqueSellers() {
        try {
            const sql = `
                SELECT DISTINCT wallet_address
                FROM ${this.tableName}
                WHERE status IN ('active', 'pending')
            `;

            const sellers = await dbConnection.all(sql);

            logger.logDatabase('select', this.tableName, {
                operation: 'getUniqueSellers',
                count: sellers.length
            });

            return sellers;

        } catch (error) {
            logger.logError(error, { context: 'getUniqueSellers' });
            throw new DatabaseError('Failed to get unique sellers', error);
        }
    }

    async getAgentDetails(agentId) {
        try {
            const agent = await this.findById(agentId);
            if (!agent) {
                throw new NotFoundError('Agent not found');
            }

            // Get reviews
            const reviews = await dbConnection.query(
                `SELECT r.*, u.user_type as reviewer_type
                 FROM reviews r
                 LEFT JOIN users u ON r.reviewer_wallet = u.wallet_address
                 WHERE r.agent_id = ?
                 ORDER BY r.created_at DESC
                 LIMIT 20`,
                [agentId]
            );

            // Get owner info
            const owner = await userModel.findByWallet(agent.wallet_address);

            return {
                ...agent,
                owner: owner ? {
                    walletAddress: owner.wallet_address,
                    userType: owner.user_type,
                    reputationScore: owner.reputation_score,
                    totalSales: owner.total_sales
                } : null,
                reviews: reviews
            };

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.getAgentDetails' });
            throw error;
        }
    }

    // Update agent
    async update(agentId, updateData) {
        try {
            if (!agentId) {
                throw new ValidationError('Agent ID is required');
            }

            // Remove immutable fields from update data
            const { agent_id, nft_id, wallet_address, ipfs_hash, credential_type, did_id, created_at, ...allowedUpdates } = updateData;

            if (Object.keys(allowedUpdates).length === 0) {
                throw new ValidationError('No valid fields to update');
            }

            // Validate update data
            this.validateAgentData({ agent_id: agentId, ...allowedUpdates });

            // Check if agent exists
            const existingAgent = await this.findById(agentId);
            if (!existingAgent) {
                throw new NotFoundError('Agent not found');
            }

            // Build update query
            const updateFields = [];
            const updateValues = [];

            for (const [field, value] of Object.entries(allowedUpdates)) {
                updateFields.push(`${field} = ?`);
                updateValues.push(value);
            }

            updateValues.push(agentId);

            const result = await dbConnection.run(
                `UPDATE ai_agents SET ${updateFields.join(', ')} WHERE agent_id = ?`,
                updateValues
            );

            if (result.changes === 0) {
                throw new NotFoundError('Agent not found');
            }

            logger.logDatabase('update', this.tableName, {
                agentId: agentId,
                updatedFields: Object.keys(allowedUpdates)
            });

            // Return updated agent
            return await this.findById(agentId);

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.update' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to update agent', error);
        }
    }

    // Update agent status
    async updateStatus(agentId, status) {
        try {
            if (!this.allowedStatuses.includes(status)) {
                throw new ValidationError(`Invalid status: ${status}`);
            }

            return await this.update(agentId, { status: status });

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.updateStatus' });
            throw error;
        }
    }

    // Increment sales count
    async incrementSales(agentId, amount = 1) {
        try {
            const result = await dbConnection.run(
                'UPDATE ai_agents SET total_sales = total_sales + ? WHERE agent_id = ?',
                [amount, agentId]
            );

            if (result.changes === 0) {
                throw new NotFoundError('Agent not found');
            }

            logger.logDatabase('update', this.tableName, {
                agentId: agentId,
                action: 'increment_sales',
                amount: amount
            });

            return true;

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.incrementSales' });
            throw new DatabaseError('Failed to increment sales count', error);
        }
    }

    // Calculate and update average rating
    async updateAverageRating(agentId) {
        try {
            const ratingData = await dbConnection.get(
                'SELECT AVG(rating) as avg_rating, COUNT(*) as review_count FROM reviews WHERE agent_id = ?',
                [agentId]
            );

            const averageRating = ratingData.avg_rating || 0;

            await dbConnection.run(
                'UPDATE ai_agents SET average_rating = ? WHERE agent_id = ?',
                [Math.round(averageRating * 10) / 10, agentId] // Round to 1 decimal place
            );

            logger.logDatabase('update', this.tableName, {
                agentId: agentId,
                action: 'update_rating',
                newRating: averageRating,
                reviewCount: ratingData.review_count
            });

            return averageRating;

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.updateAverageRating' });
            throw new DatabaseError('Failed to update average rating', error);
        }
    }

    // Get agents by category for marketplace display
    async getByCategory(category, limit = 20) {
        try {
            if (!this.allowedCategories.includes(category)) {
                throw new ValidationError(`Invalid category: ${category}`);
            }

            const agents = await dbConnection.query(
                `SELECT agent_id, name, description, category, price_xrp, image_url,
                        total_sales, average_rating, created_at
                 FROM ai_agents
                 WHERE category = ? AND status = 'active'
                 ORDER BY total_sales DESC, average_rating DESC, created_at DESC
                 LIMIT ?`,
                [category, Math.min(limit, 50)]
            );

            return agents;

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.getByCategory' });
            throw new DatabaseError('Failed to get agents by category', error);
        }
    }

    // Get popular agents
    async getPopular(limit = 20) {
        try {
            const agents = await dbConnection.query(
                `SELECT agent_id, name, description, category, price_xrp, image_url,
                        total_sales, average_rating, created_at
                 FROM ai_agents
                 WHERE status = 'active'
                 ORDER BY total_sales DESC, average_rating DESC
                 LIMIT ?`,
                [Math.min(limit, 50)]
            );

            return agents;

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.getPopular' });
            throw new DatabaseError('Failed to get popular agents', error);
        }
    }

    // Get recently created agents
    async getRecent(limit = 20) {
        try {
            const agents = await dbConnection.query(
                `SELECT agent_id, name, description, category, price_xrp, image_url,
                        total_sales, average_rating, created_at
                 FROM ai_agents
                 WHERE status = 'active'
                 ORDER BY created_at DESC
                 LIMIT ?`,
                [Math.min(limit, 50)]
            );

            return agents;

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.getRecent' });
            throw new DatabaseError('Failed to get recent agents', error);
        }
    }

    // Search agents
    async search(query, options = {}) {
        try {
            const limit = Math.min(options.limit || 20, 100);
            const offset = options.offset || 0;
            const category = options.category;

            let sql = `
                SELECT agent_id, name, description, category, price_xrp, image_url,
                       total_sales, average_rating, created_at
                FROM ai_agents
                WHERE status = 'active'
                AND (name LIKE ? OR description LIKE ?)
            `;
            let params = [`%${query}%`, `%${query}%`];

            if (category && this.allowedCategories.includes(category)) {
                sql += ' AND category = ?';
                params.push(category);
            }

            sql += ' ORDER BY total_sales DESC, average_rating DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const agents = await dbConnection.query(sql, params);

            return {
                agents: agents,
                query: query,
                pagination: {
                    limit: limit,
                    offset: offset,
                    hasMore: agents.length === limit
                }
            };

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.search' });
            throw new DatabaseError('Failed to search agents', error);
        }
    }

    // Get agent statistics
    async getAgentStats(agentId) {
        try {
            const agent = await this.findById(agentId);
            if (!agent) {
                throw new NotFoundError('Agent not found');
            }

            // Get additional statistics
            const licenseCount = await dbConnection.get(
                'SELECT COUNT(*) as count FROM licenses WHERE agent_id = ? AND status = "active"',
                [agentId]
            );

            const reviewStats = await dbConnection.get(
                'SELECT COUNT(*) as count, AVG(rating) as avg_rating FROM reviews WHERE agent_id = ?',
                [agentId]
            );

            const recentSales = await dbConnection.query(
                'SELECT purchased_at, price_paid FROM licenses WHERE agent_id = ? ORDER BY purchased_at DESC LIMIT 10',
                [agentId]
            );

            return {
                agentId: agentId,
                totalSales: agent.total_sales,
                activeLicenses: licenseCount.count,
                averageRating: reviewStats.avg_rating || 0,
                reviewCount: reviewStats.count || 0,
                recentSales: recentSales
            };

        } catch (error) {
            logger.logError(error, { context: 'AIAgentModel.getAgentStats' });
            throw error;
        }
    }
}

// Create singleton instance
const aiAgentModel = new AIAgentModel();

module.exports = aiAgentModel;