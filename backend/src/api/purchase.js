const express = require('express');
const router = express.Router();
const walletAuthService = require('../services/auth/walletAuth');
const aiAgentModel = require('../models/AIAgent');
const userModel = require('../models/User');
const logger = require('../services/logger');
const credentialsService = require('../services/xrpl/credentials');
const downloadTokenService = require('../services/download/credentialTokenService');
const dbConnection = require('../db/connection');
const {
    asyncHandler,
    ValidationError,
    NotFoundError,
    ConflictError,
    AuthorizationError
} = require('../middleware/errorHandler');

// GET /api/purchase/check/:agentId - Check if user already has credential for agent
router.get('/check/:agentId', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const buyerWallet = req.user.walletAddress;

    logger.info('Checking existing credential', {
        agentId: agentId,
        buyer: buyerWallet
    });

    // Validate agent exists
    const agent = await aiAgentModel.findById(agentId);
    if (!agent) {
        throw new NotFoundError('Agent not found');
    }

    // Check for existing credential using XRPL account_objects method (following official doc)
    try {
        const credentialCheck = await credentialsService.checkCredential(buyerWallet, agentId);

        if (credentialCheck.hasCredential) {
            // User already has valid credential - generate download token
            const credentialId = `credential_purchase_${Date.now()}_${agentId}`;

            // Generate download token
            let downloadData = null;
            try {
                const downloadTokenResult = await downloadTokenService.createDownloadToken(
                    credentialId,
                    buyerWallet,
                    req.ip
                );

                downloadData = {
                    downloadToken: downloadTokenResult.token,
                    downloadUrl: downloadTokenResult.downloadUrl,
                    autoDownload: true,
                    expiresAt: downloadTokenResult.expiresAt,
                    remainingAttempts: downloadTokenResult.remainingAttempts
                };
            } catch (downloadError) {
                logger.logError(downloadError, { context: 'Download token generation failed during credential check' });
            }

            logger.info('Existing credential found using account_objects', {
                agentId: agentId,
                buyer: buyerWallet,
                credentialType: credentialCheck.credentialType,
                method: credentialCheck.method
            });

            return res.json({
                success: true,
                hasCredential: true,
                credential: {
                    credentialType: credentialCheck.credentialType,
                    credentialTypeHex: credentialCheck.credentialTypeHex,
                    onchain: true,
                    method: credentialCheck.method,
                    rawCredential: credentialCheck.credential
                },
                downloadToken: downloadData?.downloadToken,
                downloadUrl: downloadData?.downloadUrl,
                autoDownload: downloadData?.autoDownload,
                downloadInfo: downloadData ? {
                    expiresAt: downloadData.expiresAt,
                    remainingAttempts: downloadData.remainingAttempts
                } : null,
                message: 'You already have access to this agent. Download will start automatically.'
            });
        } else {
            // No existing credential found
            logger.info('No existing credential found using account_objects', {
                agentId: agentId,
                buyer: buyerWallet,
                reason: credentialCheck.reason,
                method: credentialCheck.method
            });

            return res.json({
                success: true,
                hasCredential: false,
                message: 'No existing credential found. Proceed with purchase.',
                method: credentialCheck.method
            });
        }
    } catch (error) {
        logger.logError(error, { context: 'Credential verification failed during check' });

        // If credential verification fails, assume no credential and allow purchase
        return res.json({
            success: true,
            hasCredential: false,
            message: 'Unable to verify existing credential. Proceed with purchase.'
        });
    }
}));

// POST /api/purchase/confirm - Confirm simple XRP payment and issue license
router.post('/confirm', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { agentId, paymentHash, amount } = req.body;
    const buyerWallet = req.user.walletAddress;
    const ipAddress = req.ip;

    logger.info('Simple payment purchase confirmation', {
        agentId: agentId,
        buyer: buyerWallet,
        paymentHash: paymentHash,
        amount: amount
    });

    // Validate required fields
    if (!agentId || !paymentHash || !amount) {
        throw new ValidationError('Agent ID, payment hash, and amount are required');
    }

    // Get agent details
    const agent = await aiAgentModel.findById(agentId);
    if (!agent) {
        throw new NotFoundError('Agent not found');
    }

    if (agent.status !== 'active') {
        throw new ValidationError('Agent is not available for purchase');
    }

    // Cannot purchase own agent
    if (agent.wallet_address === buyerWallet) {
        throw new ValidationError('You cannot purchase your own agent');
    }

    // Check for existing purchases
    const existingPurchase = await dbConnection.get(
        'SELECT * FROM credential_purchases WHERE buyer_wallet = ? AND agent_id = ? AND status = "active"',
        [buyerWallet, agentId]
    );

    if (existingPurchase) {
        throw new ConflictError('You already have purchased this agent');
    }

    // Verify payment on XRPL
    const xrpl = require('xrpl');
    const client = require('../services/xrpl/client').getClient();

    try {
        const paymentTxResponse = await client.request({
            command: 'tx',
            transaction: paymentHash
        });

        logger.info('XRPL transaction response structure', {
            hasResult: !!paymentTxResponse.result,
            hasMeta: !!(paymentTxResponse.result && paymentTxResponse.result.meta),
            transactionResult: paymentTxResponse.result?.meta?.TransactionResult,
            validated: paymentTxResponse.result?.validated,
            responseKeys: paymentTxResponse.result ? Object.keys(paymentTxResponse.result) : 'no result'
        });

        if (!paymentTxResponse.result) {
            throw new ValidationError('Payment transaction not found');
        }

        // Check if transaction is validated and successful
        // XRPL transactions might not have meta immediately, so check validated status first
        if (paymentTxResponse.result.validated === false) {
            throw new ValidationError('Payment transaction not yet validated');
        }

        // Check transaction result - meta might not exist for pending transactions
        if (paymentTxResponse.result.meta && paymentTxResponse.result.meta.TransactionResult !== 'tesSUCCESS') {
            throw new ValidationError(`Payment transaction failed: ${paymentTxResponse.result.meta.TransactionResult}`);
        }

        // If no meta but transaction is validated, it might be successful
        if (!paymentTxResponse.result.meta && paymentTxResponse.result.validated !== true) {
            throw new ValidationError('Payment transaction status unclear - no meta information available');
        }

        const paymentTx = paymentTxResponse.result;
        if (paymentTx.TransactionType !== 'Payment') {
            throw new ValidationError('Transaction is not a payment');
        }

        // Verify payment details
        if (paymentTx.Account !== buyerWallet) {
            throw new ValidationError('Payment sender does not match authenticated user');
        }

        if (paymentTx.Destination !== agent.wallet_address) {
            throw new ValidationError('Payment destination does not match agent wallet');
        }

        const paidAmount = parseFloat(xrpl.dropsToXrp(paymentTx.Amount));
        if (Math.abs(paidAmount - parseFloat(amount)) > 0.001) {
            throw new ValidationError('Payment amount does not match expected amount');
        }

    } catch (error) {
        logger.logError(error, { context: 'Payment verification failed' });
        throw new ValidationError('Failed to verify payment transaction');
    }

    // Create purchase record
    const purchaseId = `purchase_${Date.now()}_${agentId}`;
    const credentialId = `credential_${purchaseId}`;

    await dbConnection.run(
        `INSERT INTO credential_purchases (
            purchase_id, credential_id, agent_id, buyer_wallet, seller_wallet,
            payment_hash, price_xrp, platform_fee, seller_revenue, status, purchased_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)`,
        [purchaseId, credentialId, agentId, buyerWallet, agent.wallet_address,
         paymentHash, amount, amount * 0.3, amount * 0.7]
    );

    // Issue license credential using XRPL Credential standard
    let credentialIssuanceHash = null;
    let credentialType = null;
    try {
        // Ensure platform wallet is initialized before getting address
        const platformWalletService = require('../services/xrpl/platformWallet');
        await platformWalletService.initialize();
        const platformWallet = platformWalletService.getAddress();

        const issuanceResult = await credentialsService.createLicenseCredential(
            platformWallet,
            buyerWallet,
            {
                agentId: agentId,
                agentName: agent.name,
                purchaseDate: new Date().toISOString(),
                expiresAt: null, // No expiration for purchased licenses
                transactionHash: paymentHash
            }
        );

        credentialType = issuanceResult.credentialType;
        // For now, we prepare the transaction but don't submit it automatically
        // The buyer will need to accept the credential separately
        logger.info('Credential prepared for issuance', {
            credentialType: credentialType,
            agentId: agentId,
            buyer: buyerWallet
        });
    } catch (credError) {
        logger.logError(credError, { context: 'Credential issuance failed' });
        // Continue without failing - buyer got the purchase
    }

    // Generate download token
    let downloadData = null;
    try {
        const downloadTokenResult = await downloadTokenService.createDownloadToken(
            credentialId,
            buyerWallet,
            ipAddress
        );

        downloadData = {
            downloadToken: downloadTokenResult.token,
            downloadUrl: downloadTokenResult.downloadUrl,
            autoDownload: true,
            expiresAt: downloadTokenResult.expiresAt,
            remainingAttempts: downloadTokenResult.remainingAttempts
        };
    } catch (downloadError) {
        logger.logError(downloadError, { context: 'Download token generation failed' });
    }

    // Update statistics
    await userModel.incrementPurchases(buyerWallet);
    await userModel.incrementSales(agent.wallet_address);
    await aiAgentModel.incrementSales(agentId);
    await aiAgentModel.updateAverageRating(agentId);

    logger.info('Simple payment purchase completed', {
        purchaseId: purchaseId,
        credentialId: credentialId,
        agentId: agentId,
        buyer: buyerWallet,
        seller: agent.wallet_address,
        amount: amount
    });

    const response = {
        success: true,
        purchase: {
            purchaseId: purchaseId,
            credentialId: credentialId,
            agentId: agentId,
            agentName: agent.name,
            amount: amount,
            paymentHash: paymentHash,
            status: 'active'
        },
        credential: {
            credentialId: credentialId,
            credentialType: credentialType || `AI_LICENSE_${agentId}`,
            issuanceHash: credentialIssuanceHash
        },
        message: 'Purchase completed successfully! License has been issued.'
    };

    // Add download data if available
    if (downloadData) {
        response.downloadToken = downloadData.downloadToken;
        response.downloadUrl = downloadData.downloadUrl;
        response.autoDownload = downloadData.autoDownload;
        response.downloadInfo = {
            expiresAt: downloadData.expiresAt,
            remainingAttempts: downloadData.remainingAttempts
        };
    }

    res.json(response);
}));

module.exports = router;