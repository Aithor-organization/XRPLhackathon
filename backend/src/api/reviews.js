const express = require('express');
const router = express.Router();
const walletAuthService = require('../services/auth/walletAuth');
const reviewModel = require('../models/Review');
const licenseModel = require('../models/License');
const aiAgentModel = require('../models/AIAgent');
const userModel = require('../models/User');
const logger = require('../services/logger');
const {
    asyncHandler,
    ValidationError,
    NotFoundError,
    ConflictError,
    AuthorizationError
} = require('../middleware/errorHandler');

// POST /api/reviews - Submit review for purchased agent
router.post('/', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const {
        agentId,
        licenseId,
        rating,
        comment
    } = req.body;

    const reviewerWallet = req.user.walletAddress;

    logger.info('Review submission attempt', {
        agentId: agentId,
        licenseId: licenseId,
        reviewer: reviewerWallet,
        rating: rating
    });

    // Validate required fields
    if (!agentId || !licenseId || !rating) {
        throw new ValidationError('Agent ID, license ID, and rating are required');
    }

    // Validate rating range
    const ratingValue = parseInt(rating);
    if (isNaN(ratingValue) || ratingValue < 1 || ratingValue > 5) {
        throw new ValidationError('Rating must be between 1 and 5');
    }

    // Verify license ownership
    await licenseModel.verifyOwnership(licenseId, reviewerWallet);

    // Check if review already exists
    const existingReview = await reviewModel.findByLicenseId(licenseId);
    if (existingReview) {
        throw new ConflictError('You have already reviewed this purchase');
    }

    // Create review
    const reviewData = {
        agent_id: agentId,
        license_id: licenseId,
        reviewer_wallet: reviewerWallet,
        rating: ratingValue,
        comment: comment || null
    };

    const createdReview = await reviewModel.create(reviewData);

    // Update agent's average rating
    await aiAgentModel.updateAverageRating(agentId);

    // Calculate and update seller's reputation
    const agent = await aiAgentModel.findById(agentId);
    await userModel.calculateReputation(agent.wallet_address);

    // TODO: Mint REP token (simplified for MVP)
    // In production, this would create an actual NFT REP token on XRPL
    const repTokenId = `rep_${createdReview.review_id}_${Date.now()}`;
    await reviewModel.updateREPToken(createdReview.review_id, repTokenId);

    logger.info('Review submitted successfully', {
        reviewId: createdReview.review_id,
        agentId: agentId,
        reviewer: reviewerWallet,
        rating: ratingValue,
        repTokenId: repTokenId
    });

    res.status(201).json({
        success: true,
        review: {
            reviewId: createdReview.review_id,
            agentId: createdReview.agent_id,
            licenseId: createdReview.license_id,
            rating: createdReview.rating,
            comment: createdReview.comment,
            createdAt: createdReview.created_at
        },
        repToken: {
            tokenId: repTokenId,
            rating: ratingValue,
            message: 'REP token minted successfully'
        }
    });
}));

// GET /api/reviews/agent/:agentId - Get reviews for an agent
router.get('/agent/:agentId', asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const {
        limit = 50,
        offset = 0,
        sortBy = 'created_at',
        sortOrder = 'desc'
    } = req.query;

    const result = await reviewModel.getAgentReviews(agentId, {
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
        sortBy: sortBy,
        sortOrder: sortOrder
    });

    res.json({
        success: true,
        ...result
    });
}));

// GET /api/reviews/user/:walletAddress - Get reviews by a user
router.get('/user/:walletAddress', asyncHandler(async (req, res) => {
    const { walletAddress } = req.params;
    const {
        limit = 50,
        offset = 0
    } = req.query;

    const result = await reviewModel.getUserReviews(walletAddress, {
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0
    });

    res.json({
        success: true,
        ...result
    });
}));

// GET /api/reviews/my - Get current user's reviews
router.get('/my', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const reviewerWallet = req.user.walletAddress;
    const {
        limit = 50,
        offset = 0
    } = req.query;

    const result = await reviewModel.getUserReviews(reviewerWallet, {
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0
    });

    res.json({
        success: true,
        ...result
    });
}));

// GET /api/reviews/stats/:agentId - Get review statistics for an agent
router.get('/stats/:agentId', asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    const stats = await reviewModel.getAgentReviewStats(agentId);

    res.json({
        success: true,
        stats: stats
    });
}));

// GET /api/reviews/recent - Get recent reviews
router.get('/recent', asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;

    const reviews = await reviewModel.getRecentReviews(
        Math.min(parseInt(limit) || 10, 50)
    );

    res.json({
        success: true,
        reviews: reviews
    });
}));

// GET /api/reviews/top-rated - Get top-rated agents
router.get('/top-rated', asyncHandler(async (req, res) => {
    const {
        limit = 10,
        minReviews = 3
    } = req.query;

    const agents = await reviewModel.getTopRatedAgents(
        Math.min(parseInt(limit) || 10, 50),
        parseInt(minReviews) || 3
    );

    res.json({
        success: true,
        agents: agents
    });
}));

// GET /api/reviews/can-review/:agentId - Check if user can review an agent
router.get('/can-review/:agentId', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const reviewerWallet = req.user.walletAddress;

    const canReview = await reviewModel.canUserReview(agentId, reviewerWallet);

    res.json({
        success: true,
        ...canReview
    });
}));

// PUT /api/reviews/:reviewId - Update review (limited to comment only)
router.put('/:reviewId', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { reviewId } = req.params;
    const { comment } = req.body;
    const reviewerWallet = req.user.walletAddress;

    // Get review to verify ownership
    const review = await reviewModel.findById(reviewId);
    if (!review) {
        throw new NotFoundError('Review not found');
    }

    if (review.reviewer_wallet !== reviewerWallet) {
        throw new AuthorizationError('You can only update your own reviews');
    }

    // Only allow updating comment
    const updatedReview = await reviewModel.update(reviewId, {
        comment: comment
    });

    logger.info('Review updated', {
        reviewId: reviewId,
        reviewer: reviewerWallet
    });

    res.json({
        success: true,
        review: updatedReview
    });
}));

module.exports = router;