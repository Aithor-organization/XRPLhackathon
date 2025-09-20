const express = require('express');
const router = express.Router();
const walletAuthService = require('../services/auth/walletAuth');
const licenseModel = require('../models/License');
const aiAgentModel = require('../models/AIAgent');
const logger = require('../services/logger');
const {
    asyncHandler,
    ValidationError,
    NotFoundError
} = require('../middleware/errorHandler');

// GET /api/licenses/my - Get user's licenses (purchases)
router.get('/my', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const buyerWallet = req.user.walletAddress;
    const {
        limit = 50,
        offset = 0,
        status = 'active',
        sortBy = 'purchased_at',
        sortOrder = 'desc'
    } = req.query;

    const result = await licenseModel.getUserPurchases(buyerWallet, {
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
        status: status,
        sortBy: sortBy,
        sortOrder: sortOrder
    });

    res.json({
        success: true,
        ...result
    });
}));

// GET /api/licenses/sales - Get user's sales
router.get('/sales', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const sellerWallet = req.user.walletAddress;
    const {
        limit = 50,
        offset = 0,
        sortBy = 'purchased_at',
        sortOrder = 'desc'
    } = req.query;

    const result = await licenseModel.getUserSales(sellerWallet, {
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

// GET /api/licenses/:id - Get license details
router.get('/:id', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userWallet = req.user.walletAddress;

    const license = await licenseModel.findById(id);
    if (!license) {
        throw new NotFoundError('License not found');
    }

    // Only buyer or seller can view license details
    if (license.buyer_wallet !== userWallet && license.seller_wallet !== userWallet) {
        throw new ValidationError('You do not have permission to view this license');
    }

    res.json({
        success: true,
        license: license
    });
}));

// GET /api/licenses/verify/:credentialId - Verify license by credential ID
router.get('/verify/:credentialId', asyncHandler(async (req, res) => {
    const { credentialId } = req.params;

    const license = await licenseModel.findByCredentialId(credentialId);
    if (!license) {
        throw new NotFoundError('License not found');
    }

    // Get agent details
    const agent = await aiAgentModel.findById(license.agent_id);

    res.json({
        success: true,
        valid: license.status === 'active',
        license: {
            licenseId: license.license_id,
            credentialId: license.credential_id,
            agentId: license.agent_id,
            agentName: agent ? agent.name : 'Unknown',
            buyerWallet: license.buyer_wallet,
            purchasedAt: license.purchased_at,
            expiresAt: license.expires_at,
            status: license.status
        }
    });
}));

// GET /api/licenses/agent/:agentId - Get licenses for an agent (owner only)
router.get('/agent/:agentId', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const userWallet = req.user.walletAddress;
    const {
        limit = 50,
        offset = 0
    } = req.query;

    // Verify agent ownership
    const agent = await aiAgentModel.findById(agentId);
    if (!agent) {
        throw new NotFoundError('Agent not found');
    }

    if (agent.wallet_address !== userWallet) {
        throw new ValidationError('You do not have permission to view licenses for this agent');
    }

    const result = await licenseModel.findAll({
        agentId: agentId,
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
        sortBy: 'purchased_at',
        sortOrder: 'desc'
    });

    res.json({
        success: true,
        ...result
    });
}));

// POST /api/licenses/:id/revoke - Revoke a license (seller only)
router.post('/:id/revoke', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userWallet = req.user.walletAddress;
    const { reason } = req.body;

    const license = await licenseModel.findById(id);
    if (!license) {
        throw new NotFoundError('License not found');
    }

    // Only seller can revoke license
    if (license.seller_wallet !== userWallet) {
        throw new ValidationError('You do not have permission to revoke this license');
    }

    if (license.status === 'revoked') {
        throw new ValidationError('License is already revoked');
    }

    await licenseModel.update(id, {
        status: 'revoked',
        updated_at: new Date().toISOString()
    });

    logger.info('License revoked', {
        licenseId: id,
        seller: userWallet,
        reason: reason || 'No reason provided'
    });

    res.json({
        success: true,
        message: 'License revoked successfully'
    });
}));

// GET /api/licenses/stats - Get license statistics
router.get('/stats', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const userWallet = req.user.walletAddress;

    const purchaseStats = await licenseModel.getLicenseStats({
        buyerWallet: userWallet
    });

    const salesStats = await licenseModel.getLicenseStats({
        sellerWallet: userWallet
    });

    res.json({
        success: true,
        purchases: purchaseStats,
        sales: salesStats
    });
}));

module.exports = router;