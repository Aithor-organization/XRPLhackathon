const express = require('express');
const router = express.Router();
const walletAuthService = require('../services/auth/walletAuth');
const reviewModel = require('../models/Review');
// const licenseModel = require('../models/License'); // Removed - using XRPL Credentials
const aiAgentModel = require('../models/AIAgent');
const userModel = require('../models/User');
const repHistoryModel = require('../models/RepHistory');
const mpTokenService = require('../services/xrpl/mptoken');
const credentialsService = require('../services/xrpl/credentials');
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
        credentialId,  // Now using credentialId instead of licenseId
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
    if (!agentId || !credentialId || !rating) {
        throw new ValidationError('Agent ID, credential ID, and rating are required');
    }

    // Validate rating range
    const ratingValue = parseInt(rating);
    if (isNaN(ratingValue) || ratingValue < 1 || ratingValue > 5) {
        throw new ValidationError('Rating must be between 1 and 5');
    }

    // Verify credential ownership
    const credentialVerification = await credentialsService.verifyCredential(credentialId, reviewerWallet);
    if (!credentialVerification.valid) {
        throw new AuthorizationError('You must own a valid credential for this agent to review it');
    }

    // Check if review already exists
    const existingReview = await reviewModel.findByCredentialId(credentialId);
    if (existingReview) {
        throw new ConflictError('You have already reviewed this purchase');
    }

    // Create review
    const reviewData = {
        agent_id: agentId,
        credential_id: credentialId,  // Store credential_id instead of license_id
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

    // Issue MPToken REP tokens for submitting review
    const isFirstReview = await reviewModel.isFirstReviewByUser(reviewerWallet);
    const repAmount = mpTokenService.calculateReputationReward(ratingValue, isFirstReview);

    const repResult = await mpTokenService.issueREPTokens(
        reviewerWallet,
        repAmount,
        `Review submitted for agent ${agentId} with rating ${ratingValue}`
    );

    // Store MPToken ID in review record
    await reviewModel.updateMPToken(createdReview.review_id, repResult.tokenId);

    logger.info('Review submitted successfully', {
        reviewId: createdReview.review_id,
        agentId: agentId,
        reviewer: reviewerWallet,
        rating: ratingValue,
        repAmount: repResult.repAmount
    });

    res.status(201).json({
        success: true,
        review: {
            reviewId: createdReview.review_id,
            agentId: createdReview.agent_id,
            credentialId: createdReview.credential_id,
            rating: createdReview.rating,
            comment: createdReview.comment,
            createdAt: createdReview.created_at
        },
        repToken: {
            authorizationTx: repResult.authorizationTx,
            paymentTx: repResult.paymentTx,
            amount: repResult.amount,
            tokenId: repResult.tokenId,
            message: 'MPToken REP transactions prepared. Sign and submit to receive ' + repResult.amount + ' REP tokens'
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

// GET /api/reviews/rep-balance/:walletAddress - Get MPToken REP balance for a user
router.get('/rep-balance/:walletAddress', asyncHandler(async (req, res) => {
    const { walletAddress } = req.params;

    const balanceResult = await mpTokenService.getUserREPBalance(walletAddress);

    res.json({
        success: true,
        wallet: walletAddress,
        repBalance: balanceResult.balance,
        authorized: balanceResult.authorized,
        lockedAmount: balanceResult.lockedAmount || 0,
        message: `User has ${balanceResult.balance} REP tokens (MPToken)`
    });
}));

// GET /api/reviews/my-rep-balance - Get current user's MPToken REP balance
router.get('/my-rep-balance', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const userWallet = req.user.walletAddress;

    const balanceResult = await mpTokenService.getUserREPBalance(userWallet);

    res.json({
        success: true,
        wallet: userWallet,
        repBalance: balanceResult.balance,
        authorized: balanceResult.authorized,
        lockedAmount: balanceResult.lockedAmount || 0,
        message: `You have ${balanceResult.balance} REP tokens (MPToken)`
    });
}));

// POST /api/reviews/evaluate-reviewer - Buyer evaluates reviewer with REP tokens (0-5)
router.post('/evaluate-reviewer', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const {
        reviewId,
        credentialId,
        repAmount,
        reason,
        memo
    } = req.body;

    const buyerWallet = req.user.walletAddress;

    logger.info('Buyer evaluation attempt', {
        reviewId: reviewId,
        credentialId: credentialId,
        buyer: buyerWallet,
        repAmount: repAmount
    });

    // Validate required fields
    if (!reviewId || !credentialId || repAmount === undefined) {
        throw new ValidationError('Review ID, credential ID, and REP amount are required');
    }

    // Validate REP amount (0-5)
    const repValue = parseInt(repAmount);
    if (isNaN(repValue) || repValue < 0 || repValue > 5) {
        throw new ValidationError('REP amount must be between 0 and 5');
    }

    // Get the review to validate
    const review = await reviewModel.findById(reviewId);
    if (!review) {
        throw new NotFoundError('Review not found');
    }

    // Verify credential ownership by buyer
    const credentialVerification = await credentialsService.verifyCredential(credentialId, buyerWallet);
    if (!credentialVerification.valid) {
        throw new AuthorizationError('You must own a valid credential for this agent to evaluate the reviewer');
    }

    // Check if review credential matches the provided credential
    if (review.credential_id !== credentialId) {
        throw new ValidationError('Review credential ID does not match provided credential ID');
    }

    // Check if buyer has already evaluated this license
    const hasEvaluated = await repHistoryModel.hasEvaluatedLicense(buyerWallet, credentialId);
    if (hasEvaluated) {
        throw new ConflictError('You have already evaluated this purchase');
    }

    const reviewerWallet = review.reviewer_wallet;

    // Issue REP tokens to reviewer (even for 0 amount to record evaluation)
    const repResult = await mpTokenService.issueREPTokens(
        reviewerWallet,
        repValue,
        reason || `Buyer evaluation: ${repValue}/5 stars`,
        {
            reviewId: reviewId,
            credentialId: credentialId,
            buyerWallet: buyerWallet,
            evaluationType: 'buyer_to_reviewer'
        }
    );

    // Record in REP history
    const repHistoryData = {
        buyer_wallet: buyerWallet,
        reviewer_wallet: reviewerWallet,
        license_id: credentialId,
        rep_amount: repValue,
        transaction_hash: null, // Will be filled when transaction is submitted
        memo: memo || null,
        reason: reason || `Buyer evaluation: ${repValue}/5 stars`,
        metadata: {
            reviewId: reviewId,
            evaluationType: 'buyer_to_reviewer',
            platform: 'AgentTrust'
        }
    };

    const repHistory = await repHistoryModel.recordRepDistribution(repHistoryData);

    // Update review record with buyer evaluation
    await reviewModel.update(reviewId, {
        buyer_rep_given: repValue,
        rep_memo: memo || null
    });

    logger.info('Buyer evaluation completed', {
        historyId: repHistory.id,
        reviewId: reviewId,
        buyer: buyerWallet,
        reviewer: reviewerWallet,
        repAmount: repValue
    });

    res.status(201).json({
        success: true,
        evaluation: {
            historyId: repHistory.id,
            reviewId: reviewId,
            credentialId: credentialId,
            buyerWallet: buyerWallet,
            reviewerWallet: reviewerWallet,
            repAmount: repValue,
            reason: reason,
            memo: memo,
            evaluatedAt: repHistory.distributed_at
        },
        repToken: {
            transaction: repResult.transaction,
            amount: repResult.amount,
            tokenId: repResult.tokenId,
            recipient: repResult.recipient,
            message: repResult.message
        }
    });
}));

// GET /api/reviews/rep-history/:walletAddress - Get REP history for a reviewer
router.get('/rep-history/:walletAddress', asyncHandler(async (req, res) => {
    const { walletAddress } = req.params;
    const {
        limit = 50,
        offset = 0,
        includeZero = true
    } = req.query;

    const result = await repHistoryModel.getReviewerRepHistory(walletAddress, {
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
        includeZero: includeZero === 'true'
    });

    res.json({
        success: true,
        walletAddress: walletAddress,
        ...result
    });
}));

// GET /api/reviews/rep-summary/:walletAddress - Get REP summary for a reviewer
router.get('/rep-summary/:walletAddress', asyncHandler(async (req, res) => {
    const { walletAddress } = req.params;

    const summary = await repHistoryModel.getReviewerRepSummary(walletAddress);

    res.json({
        success: true,
        walletAddress: walletAddress,
        summary: summary
    });
}));

// GET /api/reviews/my-evaluations - Get current user's evaluations given to reviewers
router.get('/my-evaluations', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const buyerWallet = req.user.walletAddress;
    const {
        limit = 50,
        offset = 0
    } = req.query;

    const result = await repHistoryModel.getBuyerRepHistory(buyerWallet, {
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0
    });

    res.json({
        success: true,
        buyerWallet: buyerWallet,
        ...result
    });
}));

// GET /api/reviews/rep-leaderboard - Get REP leaderboard
router.get('/rep-leaderboard', asyncHandler(async (req, res) => {
    const {
        limit = 10,
        minEvaluations = 1
    } = req.query;

    const leaderboard = await repHistoryModel.getRepLeaderboard({
        limit: Math.min(parseInt(limit) || 10, 50),
        minEvaluations: parseInt(minEvaluations) || 1
    });

    res.json({
        success: true,
        leaderboard: leaderboard
    });
}));

// GET /api/reviews/platform-rep-stats - Get platform-wide REP statistics
router.get('/platform-rep-stats', asyncHandler(async (req, res) => {
    const stats = await repHistoryModel.getPlatformRepStats();

    res.json({
        success: true,
        stats: stats
    });
}));

module.exports = router;