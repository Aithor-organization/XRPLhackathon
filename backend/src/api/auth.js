const express = require('express');
const router = express.Router();
const walletAuthService = require('../services/auth/walletAuth');
const logger = require('../services/logger');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

// POST /api/auth/wallet - Authenticate wallet
router.post('/wallet', asyncHandler(async (req, res) => {
    const { walletAddress, signature, challenge } = req.body;
    const ipAddress = req.ip;

    // Validate input
    if (!walletAddress) {
        throw new ValidationError('Wallet address is required');
    }

    if (!signature) {
        throw new ValidationError('Signature is required');
    }

    if (!challenge) {
        throw new ValidationError('Challenge is required');
    }

    logger.logAuth('auth_attempt', walletAddress, {
        ip: ipAddress,
        hasSignature: !!signature,
        hasChallenge: !!challenge
    });

    // Authenticate wallet
    const result = await walletAuthService.authenticateWallet(
        walletAddress,
        signature,
        challenge
    );

    // Log successful authentication
    logger.logAuth('auth_success', walletAddress, {
        ip: ipAddress,
        userType: result.user.userType
    });

    // Send response
    res.json({
        success: true,
        token: result.token,
        user: result.user
    });
}));

// GET /api/auth/challenge - Generate authentication challenge
router.get('/challenge/:walletAddress', asyncHandler(async (req, res) => {
    const { walletAddress } = req.params;

    if (!walletAddress) {
        throw new ValidationError('Wallet address is required');
    }

    // Generate challenge for wallet signature
    const challenge = walletAuthService.generateChallenge(walletAddress);

    logger.logAuth('challenge_generated', walletAddress);

    res.json({
        success: true,
        challenge: challenge.challenge,
        hash: challenge.hash
    });
}));

// GET /api/auth/verify - Verify token validity
router.get('/verify', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    // If middleware passes, token is valid
    const user = await walletAuthService.getUserProfile(req.user.walletAddress);

    res.json({
        success: true,
        valid: true,
        user: user
    });
}));

// POST /api/auth/refresh - Refresh authentication token
router.post('/refresh', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const walletAddress = req.user.walletAddress;

    // Get fresh user data
    const user = await walletAuthService.getUserProfile(walletAddress);

    // Generate new token
    const newToken = walletAuthService.generateToken(user);

    logger.logAuth('token_refreshed', walletAddress);

    res.json({
        success: true,
        token: newToken,
        user: user
    });
}));

module.exports = router;