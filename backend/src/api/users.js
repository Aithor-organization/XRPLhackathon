const express = require('express');
const router = express.Router();
const walletAuthService = require('../services/auth/walletAuth');
const userModel = require('../models/User');
const aiAgentModel = require('../models/AIAgent');
const licenseModel = require('../models/License');
const reviewModel = require('../models/Review');
const transactionService = require('../services/xrpl/transactions');
const logger = require('../services/logger');
const {
    asyncHandler,
    ValidationError,
    NotFoundError
} = require('../middleware/errorHandler');

// GET /api/users/mypage - Get user dashboard data
router.get('/mypage', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const walletAddress = req.user.walletAddress;

    logger.info('MyPage data requested', { wallet: walletAddress });

    // Get user profile
    const profile = await userModel.getProfile(walletAddress);

    // Get user's agents
    const myAgents = await aiAgentModel.findAll({
        ownerId: walletAddress,
        limit: 100,
        sortBy: 'created_at',
        sortOrder: 'desc'
    });

    // Get user's purchases (licenses)
    const myLicenses = await licenseModel.getUserPurchases(walletAddress, {
        limit: 100,
        sortBy: 'purchased_at',
        sortOrder: 'desc'
    });

    // Get user's sales
    const mySales = await licenseModel.getUserSales(walletAddress, {
        limit: 100,
        sortBy: 'purchased_at',
        sortOrder: 'desc'
    });

    // Calculate sales analytics
    const salesAnalytics = {
        totalRevenue: mySales.licenses.reduce((sum, license) => sum + parseFloat(license.seller_revenue), 0),
        totalSales: mySales.pagination.total,
        averageRating: myAgents.agents.length > 0
            ? myAgents.agents.reduce((sum, agent) => sum + parseFloat(agent.average_rating), 0) / myAgents.agents.length
            : 0,
        platformFees: mySales.licenses.reduce((sum, license) => sum + parseFloat(license.platform_fee), 0),
        activeAgents: myAgents.agents.filter(agent => agent.status === 'active').length,
        totalAgents: myAgents.pagination.total
    };

    // Get recent transactions
    const transactions = await transactionService.getUserTransactions(walletAddress, {
        limit: 50,
        sortBy: 'created_at',
        sortOrder: 'desc'
    });

    // Get user's reviews
    const myReviews = await reviewModel.getUserReviews(walletAddress, {
        limit: 20
    });

    res.json({
        success: true,
        profile: profile,
        myAgents: myAgents.agents,
        myLicenses: myLicenses.licenses,
        mySales: mySales.licenses,
        salesAnalytics: salesAnalytics,
        transactions: transactions.transactions,
        myReviews: myReviews.reviews
    });
}));

// GET /api/users/profile/:walletAddress - Get user public profile
router.get('/profile/:walletAddress', asyncHandler(async (req, res) => {
    const { walletAddress } = req.params;

    const profile = await userModel.findByWallet(walletAddress);
    if (!profile) {
        throw new NotFoundError('User not found');
    }

    // Get user's public agents
    const userAgents = await aiAgentModel.findAll({
        ownerId: walletAddress,
        status: 'active',
        limit: 50,
        sortBy: 'total_sales',
        sortOrder: 'desc'
    });

    // Get user's public reviews
    const userReviews = await reviewModel.getUserReviews(walletAddress, {
        limit: 10
    });

    res.json({
        success: true,
        profile: {
            walletAddress: profile.wallet_address,
            userType: profile.user_type,
            createdAt: profile.created_at,
            totalSales: profile.total_sales,
            reputationScore: profile.reputation_score
        },
        agents: userAgents.agents,
        reviews: userReviews.reviews
    });
}));

// PUT /api/users/profile - Update user profile
router.put('/profile', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const walletAddress = req.user.walletAddress;
    const { userType } = req.body;

    // Only allow updating user type
    const allowedUpdates = {};
    if (userType && ['developer', 'buyer', 'both'].includes(userType)) {
        allowedUpdates.user_type = userType;
    }

    if (Object.keys(allowedUpdates).length === 0) {
        throw new ValidationError('No valid fields to update');
    }

    const updatedUser = await userModel.update(walletAddress, allowedUpdates);

    logger.info('User profile updated', {
        wallet: walletAddress,
        updates: allowedUpdates
    });

    res.json({
        success: true,
        user: updatedUser
    });
}));

// GET /api/users/top-sellers - Get top sellers
router.get('/top-sellers', asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;

    const topSellers = await userModel.getTopByReputation(
        Math.min(parseInt(limit) || 10, 50)
    );

    res.json({
        success: true,
        sellers: topSellers
    });
}));

// GET /api/users/stats - Get user statistics
router.get('/stats', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const walletAddress = req.user.walletAddress;

    // Get comprehensive user statistics
    const user = await userModel.findByWallet(walletAddress);

    // Agent statistics
    const agentStats = await aiAgentModel.findAll({
        ownerId: walletAddress,
        limit: 1
    });

    // License statistics
    const purchaseStats = await licenseModel.getLicenseStats({
        buyerWallet: walletAddress
    });

    const salesStats = await licenseModel.getLicenseStats({
        sellerWallet: walletAddress
    });

    // Review statistics
    const reviewStats = await reviewModel.getUserReviews(walletAddress, {
        limit: 1
    });

    res.json({
        success: true,
        stats: {
            user: {
                walletAddress: user.wallet_address,
                userType: user.user_type,
                createdAt: user.created_at,
                lastLogin: user.last_login,
                totalSales: user.total_sales,
                totalPurchases: user.total_purchases,
                reputationScore: user.reputation_score
            },
            agents: {
                total: agentStats.pagination.total,
                active: agentStats.agents.filter(a => a.status === 'active').length
            },
            purchases: purchaseStats,
            sales: salesStats,
            reviews: {
                total: reviewStats.pagination.total
            }
        }
    });
}));

// POST /api/users/calculate-reputation - Recalculate user reputation
router.post('/calculate-reputation', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const walletAddress = req.user.walletAddress;

    const newReputation = await userModel.calculateReputation(walletAddress);

    logger.info('Reputation recalculated', {
        wallet: walletAddress,
        newReputation: newReputation
    });

    res.json({
        success: true,
        reputationScore: newReputation,
        message: 'Reputation score recalculated successfully'
    });
}));

module.exports = router;