const express = require('express');
const router = express.Router();
const walletAuthService = require('../services/auth/walletAuth');
const downloadTokenService = require('../services/download/tokenService');
const ipfsProxyService = require('../services/ipfs/proxy');
const licenseModel = require('../models/License');
const aiAgentModel = require('../models/AIAgent');
const downloadTokenModel = require('../models/DownloadToken');
const logger = require('../services/logger');
const {
    asyncHandler,
    ValidationError,
    NotFoundError,
    AuthorizationError
} = require('../middleware/errorHandler');

// POST /api/downloads/request - Request new download token
router.post('/request', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { licenseId } = req.body;
    const buyerWallet = req.user.walletAddress;
    const ipAddress = req.ip;

    if (!licenseId) {
        throw new ValidationError('License ID is required');
    }

    logger.info('Download token request', {
        licenseId: licenseId,
        buyer: buyerWallet,
        ip: ipAddress
    });

    // Create or get existing download token
    const tokenResult = await downloadTokenService.createDownloadToken(
        licenseId,
        buyerWallet,
        ipAddress
    );

    logger.info('Download token generated', {
        token: tokenResult.token.substring(0, 10) + '...',
        licenseId: licenseId,
        buyer: buyerWallet,
        expiresAt: tokenResult.expiresAt
    });

    res.json({
        success: true,
        token: tokenResult.token,
        expiresAt: tokenResult.expiresAt,
        downloadUrl: tokenResult.downloadUrl,
        remainingAttempts: tokenResult.remainingAttempts
    });
}));

// GET /api/downloads/:token - Download with token
router.get('/:token', asyncHandler(async (req, res) => {
    const { token } = req.params;
    const ipAddress = req.ip;

    logger.info('Download attempt', {
        token: token.substring(0, 10) + '...',
        ip: ipAddress
    });

    // Validate token
    const validation = await downloadTokenService.validateDownloadToken(token, ipAddress);

    if (!validation.valid) {
        throw new AuthorizationError('Invalid or expired download token');
    }

    const tokenRecord = validation.tokenRecord;
    const ipfsHash = validation.ipfsHash;
    const agentName = validation.agentName;

    // Record download attempt
    await downloadTokenService.recordDownloadAttempt(token, ipAddress, false); // Mark as false initially

    try {
        // Set appropriate headers for download
        res.setHeader('Content-Disposition', `attachment; filename="${agentName}.zip"`);
        res.setHeader('X-Agent-Name', agentName);
        res.setHeader('X-Remaining-Attempts', validation.remainingAttempts - 1);

        // Stream content from IPFS
        const streamResult = await ipfsProxyService.streamIPFSContent(ipfsHash, res);

        // Update download attempt as successful
        await downloadTokenService.recordDownloadAttempt(token, ipAddress, true);

        logger.info('Download completed successfully', {
            token: token.substring(0, 10) + '...',
            agentId: tokenRecord.agent_id,
            buyer: tokenRecord.buyer_wallet,
            size: streamResult.size,
            duration: streamResult.duration
        });

    } catch (error) {
        logger.logError(error, {
            context: 'download_failed',
            token: token.substring(0, 10) + '...',
            ipfsHash: ipfsHash
        });

        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: {
                    message: 'Failed to download content',
                    code: 'DOWNLOAD_FAILED'
                }
            });
        }

        throw error;
    }
}));

// GET /api/downloads/token/:token/info - Get token information
router.get('/token/:token/info', asyncHandler(async (req, res) => {
    const { token } = req.params;

    const tokenInfo = await downloadTokenService.getTokenInfo(token);

    res.json({
        success: true,
        tokenInfo: tokenInfo
    });
}));

// GET /api/downloads/history - Get user's download history
router.get('/history', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const buyerWallet = req.user.walletAddress;
    const {
        limit = 50,
        offset = 0
    } = req.query;

    const history = await downloadTokenService.getUserDownloadHistory(buyerWallet, {
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0
    });

    res.json({
        success: true,
        ...history
    });
}));

// GET /api/downloads/my-tokens - Get user's active download tokens
router.get('/my-tokens', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const buyerWallet = req.user.walletAddress;
    const {
        limit = 50,
        offset = 0,
        includeExpired = false
    } = req.query;

    const result = await downloadTokenModel.getUserTokens(buyerWallet, {
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
        includeExpired: includeExpired === 'true'
    });

    res.json({
        success: true,
        ...result
    });
}));

// POST /api/downloads/revoke/:token - Revoke a download token
router.post('/revoke/:token', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { token } = req.params;
    const buyerWallet = req.user.walletAddress;

    // Get token to verify ownership
    const tokenRecord = await downloadTokenModel.findByToken(token);
    if (!tokenRecord) {
        throw new NotFoundError('Download token not found');
    }

    if (tokenRecord.buyer_wallet !== buyerWallet) {
        throw new AuthorizationError('You can only revoke your own download tokens');
    }

    // Revoke the token
    await downloadTokenModel.revokeToken(token);

    logger.info('Download token revoked', {
        token: token.substring(0, 10) + '...',
        buyer: buyerWallet
    });

    res.json({
        success: true,
        message: 'Download token revoked successfully'
    });
}));

// GET /api/downloads/stats - Get download statistics
router.get('/stats', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const {
        agentId,
        timeframe = '30d'
    } = req.query;

    const userWallet = req.user.walletAddress;

    // Check if user owns the agent if agentId is provided
    if (agentId) {
        const agent = await aiAgentModel.findById(agentId);
        if (!agent) {
            throw new NotFoundError('Agent not found');
        }

        if (agent.wallet_address !== userWallet) {
            throw new AuthorizationError('You can only view statistics for your own agents');
        }
    }

    const stats = await downloadTokenService.getDownloadStats(agentId, timeframe);

    res.json({
        success: true,
        stats: stats
    });
}));

// GET /api/downloads/most-downloaded - Get most downloaded agents
router.get('/most-downloaded', asyncHandler(async (req, res) => {
    const {
        limit = 10,
        timeframe = '30d'
    } = req.query;

    const agents = await downloadTokenModel.getMostDownloadedAgents(
        Math.min(parseInt(limit) || 10, 50),
        timeframe
    );

    res.json({
        success: true,
        agents: agents
    });
}));

// POST /api/downloads/cleanup - Clean up expired tokens (admin only)
router.post('/cleanup', asyncHandler(async (req, res) => {
    // In production, this would require admin authentication
    // For MVP, we'll allow it for testing

    const deletedCount = await downloadTokenService.cleanupExpiredTokens();

    logger.info('Expired download tokens cleaned up', {
        count: deletedCount
    });

    res.json({
        success: true,
        deletedCount: deletedCount,
        message: `Cleaned up ${deletedCount} expired download tokens`
    });
}));

module.exports = router;