const express = require('express');
const router = express.Router();
const walletAuthService = require('../services/auth/walletAuth');
const transactionService = require('../services/xrpl/transactions');
const downloadTokenService = require('../services/download/tokenService');
const aiAgentModel = require('../models/AIAgent');
const licenseModel = require('../models/License');
const userModel = require('../models/User');
const logger = require('../services/logger');
const {
    asyncHandler,
    ValidationError,
    NotFoundError,
    ConflictError,
    AuthorizationError
} = require('../middleware/errorHandler');

// POST /api/agents/:id/purchase - Purchase AI agent license
router.post('/:id/purchase', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { id: agentId } = req.params;
    const buyerWallet = req.user.walletAddress;
    const ipAddress = req.ip;

    logger.info('Purchase attempt initiated', {
        agentId: agentId,
        buyer: buyerWallet,
        ip: ipAddress
    });

    // Get agent details
    const agent = await aiAgentModel.findById(agentId);
    if (!agent) {
        throw new NotFoundError('Agent not found');
    }

    if (agent.status !== 'active') {
        throw new ValidationError('Agent is not available for purchase');
    }

    // Check if buyer already has an active license for this agent
    const existingLicense = await licenseModel.findAll({
        agentId: agentId,
        buyerWallet: buyerWallet,
        status: 'active',
        limit: 1
    });

    if (existingLicense.licenses.length > 0) {
        throw new ConflictError('You already have an active license for this agent');
    }

    // Cannot purchase own agent
    if (agent.wallet_address === buyerWallet) {
        throw new ValidationError('You cannot purchase your own agent');
    }

    // Prepare license data
    const licenseData = {
        licenseId: `license_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        agentId: agentId,
        buyerWallet: buyerWallet,
        sellerWallet: agent.wallet_address
    };

    // Execute batch transaction
    const transactionResult = await transactionService.executeBatchTransaction(
        buyerWallet,
        agent.wallet_address,
        agent,
        licenseData
    );

    logger.info('Batch transaction prepared', {
        batchHash: transactionResult.batchHash,
        agentId: agentId,
        buyer: buyerWallet,
        seller: agent.wallet_address,
        price: agent.price_xrp
    });

    // Prepare response with transaction details for client-side signing
    res.json({
        success: true,
        batchHash: transactionResult.batchHash,
        transactions: transactionResult.transactions,
        agent: {
            agentId: agent.agent_id,
            name: agent.name,
            price: agent.price_xrp
        },
        message: 'Purchase initiated. Please sign and submit the transactions.',
        nextStep: 'POST /api/purchase/confirm with signed transactions'
    });
}));

// POST /api/purchase/confirm - Confirm purchase after transaction submission
router.post('/confirm', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const {
        batchHash,
        transactionHashes,
        credentialId,
        agentId
    } = req.body;

    const buyerWallet = req.user.walletAddress;
    const ipAddress = req.ip;

    logger.info('Purchase confirmation attempt', {
        batchHash: batchHash,
        buyer: buyerWallet,
        agentId: agentId
    });

    // Validate required fields
    if (!batchHash || !transactionHashes || !credentialId || !agentId) {
        throw new ValidationError('Missing required confirmation data');
    }

    // Get agent details
    const agent = await aiAgentModel.findById(agentId);
    if (!agent) {
        throw new NotFoundError('Agent not found');
    }

    // Get batch status
    const batchStatus = await transactionService.getBatchStatus(batchHash);

    // Verify all transactions are marked as completed
    const paymentTxHash = transactionHashes.payment || transactionHashes[0];

    // Create license record
    const licenseData = {
        credential_id: credentialId,
        agent_id: agentId,
        buyer_wallet: buyerWallet,
        seller_wallet: agent.wallet_address,
        transaction_hash: paymentTxHash,
        price_paid: agent.price_xrp,
        status: 'active'
    };

    const createdLicense = await licenseModel.create(licenseData);

    // Update user statistics
    await userModel.incrementPurchases(buyerWallet);
    await userModel.incrementSales(agent.wallet_address);

    // Update agent sales count
    await aiAgentModel.incrementSales(agentId);

    // Generate download token
    const downloadToken = await downloadTokenService.createDownloadToken(
        createdLicense.license_id,
        buyerWallet,
        ipAddress
    );

    // Update transaction records as completed
    for (const [type, hash] of Object.entries(transactionHashes)) {
        await transactionService.updateTransactionStatus(
            batchStatus.transactions.find(t => t.transaction_type === type)?.transaction_id,
            'completed',
            hash
        );
    }

    logger.info('Purchase completed successfully', {
        licenseId: createdLicense.license_id,
        agentId: agentId,
        buyer: buyerWallet,
        downloadToken: downloadToken.token.substring(0, 10) + '...'
    });

    res.json({
        success: true,
        license: {
            licenseId: createdLicense.license_id,
            credentialId: createdLicense.credential_id,
            agentId: createdLicense.agent_id,
            purchasedAt: createdLicense.purchased_at,
            expiresAt: createdLicense.expires_at,
            status: createdLicense.status
        },
        transactions: transactionHashes,
        downloadToken: downloadToken.token,
        downloadUrl: `/api/downloads/${downloadToken.token}`,
        expiresAt: downloadToken.expiresAt,
        message: 'Purchase completed successfully'
    });
}));

// POST /api/purchase/simulate - Simulate purchase without executing
router.post('/:id/simulate', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { id: agentId } = req.params;
    const buyerWallet = req.user.walletAddress;

    // Get agent details
    const agent = await aiAgentModel.findById(agentId);
    if (!agent) {
        throw new NotFoundError('Agent not found');
    }

    // Check if can purchase
    if (agent.wallet_address === buyerWallet) {
        throw new ValidationError('You cannot purchase your own agent');
    }

    // Check existing license
    const existingLicense = await licenseModel.findAll({
        agentId: agentId,
        buyerWallet: buyerWallet,
        status: 'active',
        limit: 1
    });

    if (existingLicense.licenses.length > 0) {
        throw new ConflictError('You already have an active license for this agent');
    }

    // Prepare simulation data
    const licenseData = {
        licenseId: 'simulated_license',
        agentId: agentId,
        buyerWallet: buyerWallet,
        sellerWallet: agent.wallet_address
    };

    // Simulate batch transaction
    const simulation = await transactionService.simulateBatchExecution(
        buyerWallet,
        agent.wallet_address,
        agent,
        licenseData
    );

    res.json({
        success: true,
        simulation: simulation,
        agent: {
            agentId: agent.agent_id,
            name: agent.name,
            price: agent.price_xrp
        },
        canPurchase: simulation.success,
        message: 'Purchase simulation completed'
    });
}));

// GET /api/purchase/status/:batchHash - Get purchase status by batch hash
router.get('/status/:batchHash', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { batchHash } = req.params;

    const batchStatus = await transactionService.getBatchStatus(batchHash);

    res.json({
        success: true,
        ...batchStatus
    });
}));

module.exports = router;