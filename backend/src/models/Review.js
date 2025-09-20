const xrpl = require('xrpl');
const crypto = require('crypto');
const dbConnection = require('../db/connection');
const logger = require('../services/logger');
const licenseModel = require('./License');
const aiAgentModel = require('./AIAgent');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    DatabaseError,
    AuthorizationError
} = require('../middleware/errorHandler');

class ReviewModel {
    constructor() {
        this.tableName = 'reviews';
        this.requiredFields = ['agent_id', 'license_id', 'reviewer_wallet', 'rating'];
        this.minRating = 1;
        this.maxRating = 5;
    }

    // Generate unique review ID
    generateReviewId() {
        return `review_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    // Validate review data
    validateReviewData(reviewData) {
        const errors = [];

        // Check required fields (except review_id which is auto-generated)
        const requiredForValidation = this.requiredFields.filter(field => field !== 'review_id');
        for (const field of requiredForValidation) {
            if (reviewData[field] === undefined || reviewData[field] === null) {
                errors.push(`${field} is required`);
            }
        }

        // Validate reviewer wallet address
        if (reviewData.reviewer_wallet && !xrpl.isValidClassicAddress(reviewData.reviewer_wallet)) {
            errors.push('Invalid reviewer wallet address format');
        }

        // Validate rating
        if (reviewData.rating !== undefined) {
            const rating = parseInt(reviewData.rating);
            if (isNaN(rating) || rating < this.minRating || rating > this.maxRating) {
                errors.push(`Rating must be between ${this.minRating} and ${this.maxRating}`);
            }
        }

        // Validate comment length
        if (reviewData.comment && reviewData.comment.length > 500) {
            errors.push('Comment exceeds maximum length of 500 characters');
        }

        if (errors.length > 0) {
            throw new ValidationError(`Review validation failed: ${errors.join(', ')}`);
        }

        return true;
    }

    // Create new review
    async create(reviewData) {
        try {
            // Generate review ID
            const reviewId = this.generateReviewId();
            const reviewToCreate = {
                ...reviewData,
                review_id: reviewId
            };

            this.validateReviewData(reviewToCreate);

            // Verify license exists and belongs to reviewer
            const license = await licenseModel.findById(reviewData.license_id);
            if (!license) {
                throw new NotFoundError('License not found');
            }

            if (license.buyer_wallet !== reviewData.reviewer_wallet) {
                throw new AuthorizationError('Only the license buyer can submit a review');
            }

            // Verify agent exists
            const agent = await aiAgentModel.findById(reviewData.agent_id);
            if (!agent) {
                throw new NotFoundError('Agent not found');
            }

            // Check if review already exists for this license
            const existingReview = await this.findByLicenseId(reviewData.license_id);
            if (existingReview) {
                throw new ConflictError('Review already exists for this license');
            }

            // Prepare review data with defaults
            const completeReviewData = {
                review_id: reviewId,
                agent_id: reviewToCreate.agent_id,
                license_id: reviewToCreate.license_id,
                reviewer_wallet: reviewToCreate.reviewer_wallet,
                rating: parseInt(reviewToCreate.rating),
                comment: reviewToCreate.comment || null,
                rep_token_id: reviewToCreate.rep_token_id || null,
                created_at: new Date().toISOString()
            };

            // Insert review into database
            await dbConnection.run(
                `INSERT INTO reviews (
                    review_id, agent_id, license_id, reviewer_wallet,
                    rating, comment, rep_token_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    completeReviewData.review_id,
                    completeReviewData.agent_id,
                    completeReviewData.license_id,
                    completeReviewData.reviewer_wallet,
                    completeReviewData.rating,
                    completeReviewData.comment,
                    completeReviewData.rep_token_id,
                    completeReviewData.created_at
                ]
            );

            logger.logDatabase('insert', this.tableName, {
                reviewId: reviewId,
                agentId: completeReviewData.agent_id,
                licenseId: completeReviewData.license_id,
                reviewer: completeReviewData.reviewer_wallet,
                rating: completeReviewData.rating
            });

            // Update agent's average rating
            await aiAgentModel.updateAverageRating(completeReviewData.agent_id);

            return completeReviewData;

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.create' });

            if (error.isOperational) {
                throw error;
            }

            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new ConflictError('Review already exists for this license');
            }

            throw new DatabaseError('Failed to create review', error);
        }
    }

    // Find review by ID
    async findById(reviewId) {
        try {
            if (!reviewId) {
                throw new ValidationError('Review ID is required');
            }

            const review = await dbConnection.get(
                'SELECT * FROM reviews WHERE review_id = ?',
                [reviewId]
            );

            return review || null;

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.findById' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find review', error);
        }
    }

    // Find review by license ID (unique constraint - one review per license)
    async findByLicenseId(licenseId) {
        try {
            if (!licenseId) {
                throw new ValidationError('License ID is required');
            }

            const review = await dbConnection.get(
                'SELECT * FROM reviews WHERE license_id = ?',
                [licenseId]
            );

            return review || null;

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.findByLicenseId' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to find review by license ID', error);
        }
    }

    // Get reviews for an agent
    async getAgentReviews(agentId, options = {}) {
        try {
            const limit = Math.min(options.limit || 50, 100);
            const offset = options.offset || 0;
            const sortBy = options.sortBy || 'created_at';
            const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

            // Validate sort field
            const allowedSortFields = ['created_at', 'rating'];
            if (!allowedSortFields.includes(sortBy)) {
                throw new ValidationError(`Invalid sort field: ${sortBy}`);
            }

            const reviews = await dbConnection.query(
                `SELECT r.*, u.user_type as reviewer_type, u.reputation_score as reviewer_reputation
                 FROM reviews r
                 LEFT JOIN users u ON r.reviewer_wallet = u.wallet_address
                 WHERE r.agent_id = ?
                 ORDER BY r.${sortBy} ${sortOrder}
                 LIMIT ? OFFSET ?`,
                [agentId, limit, offset]
            );

            // Get total count
            const countResult = await dbConnection.get(
                'SELECT COUNT(*) as total FROM reviews WHERE agent_id = ?',
                [agentId]
            );

            // Get rating distribution
            const distribution = await dbConnection.query(
                `SELECT rating, COUNT(*) as count
                 FROM reviews WHERE agent_id = ?
                 GROUP BY rating
                 ORDER BY rating DESC`,
                [agentId]
            );

            return {
                reviews: reviews,
                pagination: {
                    total: countResult.total,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + reviews.length < countResult.total
                },
                statistics: {
                    distribution: distribution,
                    totalReviews: countResult.total
                }
            };

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.getAgentReviews' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to get agent reviews', error);
        }
    }

    // Get user's reviews
    async getUserReviews(reviewerWallet, options = {}) {
        try {
            const limit = Math.min(options.limit || 50, 100);
            const offset = options.offset || 0;

            const reviews = await dbConnection.query(
                `SELECT r.*, a.name as agent_name, a.category as agent_category
                 FROM reviews r
                 LEFT JOIN ai_agents a ON r.agent_id = a.agent_id
                 WHERE r.reviewer_wallet = ?
                 ORDER BY r.created_at DESC
                 LIMIT ? OFFSET ?`,
                [reviewerWallet, limit, offset]
            );

            // Get total count
            const countResult = await dbConnection.get(
                'SELECT COUNT(*) as total FROM reviews WHERE reviewer_wallet = ?',
                [reviewerWallet]
            );

            return {
                reviews: reviews,
                pagination: {
                    total: countResult.total,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + reviews.length < countResult.total
                }
            };

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.getUserReviews' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to get user reviews', error);
        }
    }

    // Update review (limited fields)
    async update(reviewId, updateData) {
        try {
            if (!reviewId) {
                throw new ValidationError('Review ID is required');
            }

            // Only allow updating comment and rep_token_id
            const allowedFields = ['comment', 'rep_token_id'];
            const allowedUpdates = {};

            for (const field of allowedFields) {
                if (updateData[field] !== undefined) {
                    allowedUpdates[field] = updateData[field];
                }
            }

            if (Object.keys(allowedUpdates).length === 0) {
                throw new ValidationError('No valid fields to update');
            }

            // Check if review exists
            const existingReview = await this.findById(reviewId);
            if (!existingReview) {
                throw new NotFoundError('Review not found');
            }

            // Build update query
            const updateFields = [];
            const updateValues = [];

            for (const [field, value] of Object.entries(allowedUpdates)) {
                updateFields.push(`${field} = ?`);
                updateValues.push(value);
            }

            updateValues.push(reviewId);

            const result = await dbConnection.run(
                `UPDATE reviews SET ${updateFields.join(', ')} WHERE review_id = ?`,
                updateValues
            );

            if (result.changes === 0) {
                throw new NotFoundError('Review not found');
            }

            logger.logDatabase('update', this.tableName, {
                reviewId: reviewId,
                updatedFields: Object.keys(allowedUpdates)
            });

            // Return updated review
            return await this.findById(reviewId);

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.update' });

            if (error.isOperational) {
                throw error;
            }

            throw new DatabaseError('Failed to update review', error);
        }
    }

    // Update REP token ID after minting
    async updateREPToken(reviewId, repTokenId) {
        try {
            return await this.update(reviewId, { rep_token_id: repTokenId });

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.updateREPToken' });
            throw error;
        }
    }

    // Delete review (soft delete by removing from display)
    async delete(reviewId) {
        try {
            // Note: In production, you might want to implement soft delete
            // instead of actually removing the record
            throw new ValidationError('Review deletion not supported');

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.delete' });
            throw error;
        }
    }

    // Get review statistics for an agent
    async getAgentReviewStats(agentId) {
        try {
            const stats = await dbConnection.get(
                `SELECT
                    COUNT(*) as total_reviews,
                    AVG(rating) as average_rating,
                    MIN(rating) as min_rating,
                    MAX(rating) as max_rating,
                    COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
                    COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
                    COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
                    COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
                    COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star,
                    COUNT(CASE WHEN comment IS NOT NULL THEN 1 END) as reviews_with_comments
                 FROM reviews
                 WHERE agent_id = ?`,
                [agentId]
            );

            return {
                agentId: agentId,
                totalReviews: stats.total_reviews || 0,
                averageRating: stats.average_rating ? Math.round(stats.average_rating * 10) / 10 : 0,
                minRating: stats.min_rating || 0,
                maxRating: stats.max_rating || 0,
                distribution: {
                    5: stats.five_star || 0,
                    4: stats.four_star || 0,
                    3: stats.three_star || 0,
                    2: stats.two_star || 0,
                    1: stats.one_star || 0
                },
                reviewsWithComments: stats.reviews_with_comments || 0,
                percentageWithComments: stats.total_reviews > 0
                    ? Math.round((stats.reviews_with_comments / stats.total_reviews) * 100)
                    : 0
            };

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.getAgentReviewStats' });
            throw new DatabaseError('Failed to get review statistics', error);
        }
    }

    // Get recent reviews for homepage/dashboard
    async getRecentReviews(limit = 10) {
        try {
            const reviews = await dbConnection.query(
                `SELECT r.*, a.name as agent_name, a.category as agent_category,
                        u.user_type as reviewer_type
                 FROM reviews r
                 LEFT JOIN ai_agents a ON r.agent_id = a.agent_id
                 LEFT JOIN users u ON r.reviewer_wallet = u.wallet_address
                 WHERE r.comment IS NOT NULL
                 ORDER BY r.created_at DESC
                 LIMIT ?`,
                [Math.min(limit, 50)]
            );

            return reviews;

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.getRecentReviews' });
            throw new DatabaseError('Failed to get recent reviews', error);
        }
    }

    // Get top-rated agents based on reviews
    async getTopRatedAgents(limit = 10, minReviews = 3) {
        try {
            const agents = await dbConnection.query(
                `SELECT a.agent_id, a.name, a.category, a.price_xrp,
                        COUNT(r.review_id) as review_count,
                        AVG(r.rating) as avg_rating
                 FROM ai_agents a
                 INNER JOIN reviews r ON a.agent_id = r.agent_id
                 WHERE a.status = 'active'
                 GROUP BY a.agent_id
                 HAVING review_count >= ?
                 ORDER BY avg_rating DESC, review_count DESC
                 LIMIT ?`,
                [minReviews, Math.min(limit, 50)]
            );

            return agents.map(agent => ({
                ...agent,
                avg_rating: Math.round(agent.avg_rating * 10) / 10
            }));

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.getTopRatedAgents' });
            throw new DatabaseError('Failed to get top rated agents', error);
        }
    }

    // Check if user can review (has valid license and hasn't reviewed yet)
    async canUserReview(agentId, reviewerWallet) {
        try {
            // Check if user has a valid license for this agent
            const license = await dbConnection.get(
                `SELECT l.license_id FROM licenses l
                 WHERE l.agent_id = ? AND l.buyer_wallet = ? AND l.status = 'active'
                 LIMIT 1`,
                [agentId, reviewerWallet]
            );

            if (!license) {
                return {
                    canReview: false,
                    reason: 'No valid license found for this agent'
                };
            }

            // Check if user has already reviewed
            const existingReview = await this.findByLicenseId(license.license_id);
            if (existingReview) {
                return {
                    canReview: false,
                    reason: 'Review already submitted for this purchase'
                };
            }

            return {
                canReview: true,
                licenseId: license.license_id
            };

        } catch (error) {
            logger.logError(error, { context: 'ReviewModel.canUserReview' });
            throw error;
        }
    }
}

// Create singleton instance
const reviewModel = new ReviewModel();

module.exports = reviewModel;