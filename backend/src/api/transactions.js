const express = require('express');
const router = express.Router();
const walletAuthService = require('../services/auth/walletAuth');
const transactionService = require('../services/xrpl/transactions');
const logger = require('../services/logger');
const {
    asyncHandler,
    ValidationError,
    NotFoundError
} = require('../middleware/errorHandler');

// GET /api/transactions - Get user transactions
router.get('/', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const walletAddress = req.user.walletAddress;
    const {
        limit = 50,
        offset = 0,
        type,
        status,
        sortBy = 'created_at',
        sortOrder = 'desc'
    } = req.query;

    const filters = {
        walletAddress: walletAddress,
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
        sortBy: sortBy,
        sortOrder: sortOrder
    };

    if (type) filters.type = type;
    if (status) filters.status = status;

    const result = await transactionService.getUserTransactions(walletAddress, filters);

    res.json({
        success: true,
        ...result
    });
}));

// GET /api/transactions/batch/:batchHash - Get batch transaction details
router.get('/batch/:batchHash', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { batchHash } = req.params;

    const batchDetails = await transactionService.getBatchStatus(batchHash);

    res.json({
        success: true,
        ...batchDetails
    });
}));

// GET /api/transactions/:id - Get transaction details
router.get('/:id', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userWallet = req.user.walletAddress;

    const transaction = await transactionService.getTransactionById(id);
    if (!transaction) {
        throw new NotFoundError('Transaction not found');
    }

    // Verify user is part of the transaction
    if (transaction.from_wallet !== userWallet && transaction.to_wallet !== userWallet) {
        throw new ValidationError('You do not have permission to view this transaction');
    }

    res.json({
        success: true,
        transaction: transaction
    });
}));

// POST /api/transactions/verify/:hash - Verify transaction on XRPL
router.post('/verify/:hash', asyncHandler(async (req, res) => {
    const { hash } = req.params;

    try {
        const verified = await transactionService.verifyTransaction(hash);

        res.json({
            success: true,
            verified: verified.validated,
            transaction: {
                hash: verified.hash,
                ledgerIndex: verified.ledger_index,
                type: verified.TransactionType,
                account: verified.Account,
                destination: verified.Destination,
                amount: verified.Amount,
                fee: verified.Fee,
                result: verified.meta?.TransactionResult
            }
        });
    } catch (error) {
        logger.error('Transaction verification failed', {
            hash: hash,
            error: error.message
        });

        res.json({
            success: false,
            error: {
                message: 'Transaction not found or not yet validated',
                code: 'TX_NOT_FOUND'
            }
        });
    }
}));

// GET /api/transactions/stats - Get transaction statistics
router.get('/stats', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const userWallet = req.user.walletAddress;
    const { timeframe = '30d' } = req.query;

    const result = await transactionService.getUserTransactions(userWallet, {
        limit: 1000
    });

    // Calculate stats from transactions
    const stats = {
        total: result.pagination.total,
        totalVolume: result.transactions.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0),
        byType: {},
        byStatus: {}
    };

    result.transactions.forEach(tx => {
        stats.byType[tx.transaction_type] = (stats.byType[tx.transaction_type] || 0) + 1;
        stats.byStatus[tx.status] = (stats.byStatus[tx.status] || 0) + 1;
    });

    res.json({
        success: true,
        stats: stats
    });
}));

// GET /api/transactions/pending - Get pending transactions
router.get('/pending', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const userWallet = req.user.walletAddress;

    const result = await transactionService.getUserTransactions(userWallet, {
        status: 'pending',
        sortBy: 'created_at',
        sortOrder: 'desc',
        limit: 100
    });

    res.json({
        success: true,
        transactions: result.transactions,
        count: result.pagination.total
    });
}));

// POST /api/transactions/:id/retry - Retry a failed transaction
router.post('/:id/retry', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userWallet = req.user.walletAddress;

    const transaction = await transactionService.getTransactionById(id);
    if (!transaction) {
        throw new NotFoundError('Transaction not found');
    }

    // Verify user is the sender
    if (transaction.from_wallet !== userWallet) {
        throw new ValidationError('You can only retry your own transactions');
    }

    if (transaction.status !== 'failed') {
        throw new ValidationError('Only failed transactions can be retried');
    }

    // Retry the transaction
    const result = await transactionService.retryTransaction(id);

    logger.info('Transaction retry initiated', {
        transactionId: id,
        wallet: userWallet,
        newBatchHash: result.batchHash
    });

    res.json({
        success: true,
        message: 'Transaction retry initiated',
        batchHash: result.batchHash,
        transactionId: result.transactionId
    });
}));

// GET /api/transactions/export - Export transaction history
router.get('/export', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const userWallet = req.user.walletAddress;
    const { format = 'json', startDate, endDate } = req.query;

    const filters = {
        walletAddress: userWallet,
        limit: 1000
    };

    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    const result = await transactionService.getUserTransactions(userWallet, filters);

    if (format === 'csv') {
        // Convert to CSV format
        const csv = transactionService.convertToCSV(result.transactions);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="transactions_${Date.now()}.csv"`);
        res.send(csv);
    } else {
        res.json({
            success: true,
            exported: new Date().toISOString(),
            wallet: userWallet,
            transactions: result.transactions
        });
    }
}));

module.exports = router;