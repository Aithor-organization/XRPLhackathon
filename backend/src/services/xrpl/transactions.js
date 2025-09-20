const xrpl = require('xrpl');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../logger');
const xrplClient = require('./client');
const platformWallet = require('./platformWallet');
const dbConnection = require('../../db/connection');
const {
    ValidationError,
    XRPLError,
    DatabaseError,
    AppError
} = require('../../middleware/errorHandler');

class TransactionService {
    constructor() {
        console.log('Transaction Service initialized');
    }

    // Generate batch hash for grouping related transactions
    generateBatchHash() {
        return crypto.randomBytes(16).toString('hex');
    }

    // Calculate fee distribution
    calculateFeeDistribution(priceXRP) {
        const fees = config.calculateFees(priceXRP);
        return {
            total: fees.total,
            platformFee: fees.platformFee,
            sellerRevenue: fees.sellerRevenue
        };
    }

    // Create payment transaction
    async createPaymentTransaction(fromWallet, toWallet, amountXRP, memo = null) {
        try {
            if (!xrpl.isValidClassicAddress(fromWallet) || !xrpl.isValidClassicAddress(toWallet)) {
                throw new ValidationError('Invalid wallet addresses');
            }

            if (amountXRP <= 0) {
                throw new ValidationError('Amount must be greater than 0');
            }

            const payment = {
                TransactionType: 'Payment',
                Account: fromWallet,
                Destination: toWallet,
                Amount: xrpl.xrpToDrops(amountXRP.toString())
            };

            // Add memo if provided
            if (memo) {
                payment.Memos = [{
                    Memo: {
                        MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase()
                    }
                }];
            }

            // Auto-fill the transaction
            const client = xrplClient.getClient();
            const prepared = await client.autofill(payment);

            logger.logTransaction('payment_created', {
                from: fromWallet,
                to: toWallet,
                amount: amountXRP,
                memo: memo
            });

            return prepared;

        } catch (error) {
            logger.logError(error, { context: 'createPaymentTransaction' });
            throw new XRPLError('Failed to create payment transaction', error);
        }
    }

    // Create credential issuance transaction
    async createCredentialTransaction(issuerWallet, holderWallet, credentialType, agentData) {
        try {
            // For XRPL, we'll use NFTokenMint to create a credential NFT
            const credentialData = {
                type: credentialType,
                holder: holderWallet,
                agent: agentData.agentId,
                issued_at: new Date().toISOString(),
                expires_at: null, // Permanent license
                platform: config.platform.name
            };

            // Encode credential data
            const credentialJson = JSON.stringify(credentialData);
            const credentialHex = Buffer.from(credentialJson, 'utf8').toString('hex').toUpperCase();

            const credentialNFT = {
                TransactionType: 'NFTokenMint',
                Account: issuerWallet,
                NFTokenTaxon: 1, // Use 1 for credentials
                TransferFee: 0, // No transfer fee for credentials
                Flags: 0x00000008, // Transferable credential
                URI: credentialHex
            };

            // Auto-fill the transaction
            const client = xrplClient.getClient();
            const prepared = await client.autofill(credentialNFT);

            logger.logTransaction('credential_created', {
                issuer: issuerWallet,
                holder: holderWallet,
                type: credentialType,
                agentId: agentData.agentId
            });

            return prepared;

        } catch (error) {
            logger.logError(error, { context: 'createCredentialTransaction' });
            throw new XRPLError('Failed to create credential transaction', error);
        }
    }

    // Execute batch transaction (sequential payments with rollback capability)
    async executeBatchTransaction(buyerWallet, sellerWallet, agentData, licenseData) {
        const batchHash = this.generateBatchHash();
        const transactions = [];

        try {
            // Calculate fee distribution
            const fees = this.calculateFeeDistribution(agentData.priceXRP);

            // Create transaction records in database first
            const dbTransactions = await this.createTransactionRecords(
                batchHash,
                licenseData.licenseId,
                buyerWallet,
                sellerWallet,
                fees
            );

            logger.logTransaction('batch_started', {
                batchHash,
                licenseId: licenseData.licenseId,
                totalAmount: fees.total,
                platformFee: fees.platformFee,
                sellerRevenue: fees.sellerRevenue
            });

            // 1. Payment to seller (70%)
            if (fees.sellerRevenue > 0) {
                const sellerPayment = await this.createPaymentTransaction(
                    buyerWallet,
                    sellerWallet,
                    fees.sellerRevenue,
                    `Agent purchase: ${agentData.name}`
                );

                transactions.push({
                    type: 'payment_to_seller',
                    transaction: sellerPayment,
                    dbId: dbTransactions.find(t => t.type === 'payment_to_seller').transactionId
                });
            }

            // 2. Platform fee (30%)
            if (fees.platformFee > 0) {
                const platformAddress = platformWallet.getAddress();
                const platformPayment = await this.createPaymentTransaction(
                    buyerWallet,
                    platformAddress,
                    fees.platformFee,
                    `Platform fee: ${agentData.name}`
                );

                transactions.push({
                    type: 'platform_fee',
                    transaction: platformPayment,
                    dbId: dbTransactions.find(t => t.type === 'platform_fee').transactionId
                });
            }

            // 3. Credential issuance
            const credentialTx = await this.createCredentialTransaction(
                platformWallet.getAddress(),
                buyerWallet,
                agentData.credentialType,
                agentData
            );

            transactions.push({
                type: 'credential_issuance',
                transaction: credentialTx,
                dbId: dbTransactions.find(t => t.type === 'credential_issuance').transactionId
            });

            logger.logTransaction('batch_prepared', {
                batchHash,
                transactionCount: transactions.length
            });

            // Return prepared transactions for client-side signing
            return {
                success: true,
                batchHash: batchHash,
                transactions: transactions.map(tx => ({
                    type: tx.type,
                    transaction: tx.transaction,
                    transactionId: tx.dbId
                })),
                message: 'Batch transactions prepared for signing and submission'
            };

        } catch (error) {
            logger.logError(error, { context: 'executeBatchTransaction', batchHash });

            // Mark all transactions as failed in database
            await this.markBatchFailed(batchHash, error.message);

            throw new XRPLError('Failed to execute batch transaction', error);
        }
    }

    // Create transaction records in database
    async createTransactionRecords(batchHash, licenseId, buyerWallet, sellerWallet, fees) {
        try {
            const transactions = [];

            // Seller payment transaction
            if (fees.sellerRevenue > 0) {
                const sellerTxId = `tx_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
                transactions.push({
                    transactionId: sellerTxId,
                    type: 'payment_to_seller',
                    fromWallet: buyerWallet,
                    toWallet: sellerWallet,
                    amountXRP: fees.sellerRevenue
                });
            }

            // Platform fee transaction
            if (fees.platformFee > 0) {
                const platformTxId = `tx_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
                transactions.push({
                    transactionId: platformTxId,
                    type: 'platform_fee',
                    fromWallet: buyerWallet,
                    toWallet: platformWallet.getAddress(),
                    amountXRP: fees.platformFee
                });
            }

            // Credential issuance transaction
            const credentialTxId = `tx_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
            transactions.push({
                transactionId: credentialTxId,
                type: 'credential_issuance',
                fromWallet: platformWallet.getAddress(),
                toWallet: buyerWallet,
                amountXRP: 0 // No XRP amount for credential
            });

            // Insert all transactions into database
            const insertOperations = transactions.map(tx => ({
                sql: `INSERT INTO transactions (
                    transaction_id, batch_hash, license_id, transaction_type,
                    from_wallet, to_wallet, amount_xrp, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
                params: [
                    tx.transactionId,
                    batchHash,
                    licenseId,
                    tx.type,
                    tx.fromWallet,
                    tx.toWallet,
                    tx.amountXRP
                ]
            }));

            await dbConnection.transaction(insertOperations);

            logger.logDatabase('batch_insert', 'transactions', {
                batchHash,
                count: transactions.length
            });

            return transactions;

        } catch (error) {
            logger.logError(error, { context: 'createTransactionRecords' });
            throw new DatabaseError('Failed to create transaction records', error);
        }
    }

    // Update transaction status
    async updateTransactionStatus(transactionId, status, xrplHash = null, errorMessage = null) {
        try {
            let sql = 'UPDATE transactions SET status = ?';
            let params = [status];

            if (status === 'completed' && xrplHash) {
                sql += ', completed_at = CURRENT_TIMESTAMP';
            }

            if (errorMessage) {
                sql += ', error_message = ?';
                params.push(errorMessage);
            }

            sql += ' WHERE transaction_id = ?';
            params.push(transactionId);

            await dbConnection.run(sql, params);

            logger.logDatabase('update', 'transactions', {
                transactionId,
                status,
                xrplHash
            });

        } catch (error) {
            logger.logError(error, { context: 'updateTransactionStatus' });
            throw new DatabaseError('Failed to update transaction status', error);
        }
    }

    // Mark entire batch as failed
    async markBatchFailed(batchHash, errorMessage) {
        try {
            await dbConnection.run(
                'UPDATE transactions SET status = ?, error_message = ? WHERE batch_hash = ?',
                ['failed', errorMessage, batchHash]
            );

            logger.logDatabase('batch_update', 'transactions', {
                batchHash,
                status: 'failed',
                error: errorMessage
            });

        } catch (error) {
            logger.logError(error, { context: 'markBatchFailed' });
        }
    }

    // Get transaction status
    async getTransactionStatus(transactionId) {
        try {
            const transaction = await dbConnection.get(
                'SELECT * FROM transactions WHERE transaction_id = ?',
                [transactionId]
            );

            if (!transaction) {
                throw new NotFoundError('Transaction not found');
            }

            return transaction;

        } catch (error) {
            logger.logError(error, { context: 'getTransactionStatus' });
            throw error;
        }
    }

    // Get batch status
    async getBatchStatus(batchHash) {
        try {
            const transactions = await dbConnection.query(
                'SELECT * FROM transactions WHERE batch_hash = ? ORDER BY created_at',
                [batchHash]
            );

            if (transactions.length === 0) {
                throw new NotFoundError('Batch not found');
            }

            const statuses = transactions.map(tx => tx.status);
            const allCompleted = statuses.every(status => status === 'completed');
            const anyFailed = statuses.some(status => status === 'failed');

            let batchStatus = 'pending';
            if (allCompleted) {
                batchStatus = 'completed';
            } else if (anyFailed) {
                batchStatus = 'failed';
            }

            return {
                batchHash: batchHash,
                status: batchStatus,
                transactions: transactions,
                totalTransactions: transactions.length,
                completedTransactions: statuses.filter(s => s === 'completed').length,
                failedTransactions: statuses.filter(s => s === 'failed').length
            };

        } catch (error) {
            logger.logError(error, { context: 'getBatchStatus' });
            throw error;
        }
    }

    // Simulate batch transaction execution (for testing)
    async simulateBatchExecution(buyerWallet, sellerWallet, agentData, licenseData) {
        try {
            const fees = this.calculateFeeDistribution(agentData.priceXRP);

            // Check buyer has sufficient balance (simulation)
            const requiredAmount = fees.total;

            // In a real implementation, we would check the actual XRPL balance
            // For simulation, we'll assume the buyer has sufficient funds

            const simulation = {
                success: true,
                fees: fees,
                requiredBalance: requiredAmount,
                estimatedTime: '10-15 seconds',
                transactionCount: fees.sellerRevenue > 0 ? 3 : 2, // Seller payment + platform fee + credential
                gasEstimate: '0.00001 XRP per transaction'
            };

            logger.logTransaction('batch_simulated', {
                buyer: buyerWallet,
                seller: sellerWallet,
                agentId: agentData.agentId,
                simulation: simulation
            });

            return simulation;

        } catch (error) {
            logger.logError(error, { context: 'simulateBatchExecution' });
            throw error;
        }
    }

    // Get user transaction history
    async getUserTransactions(walletAddress, options = {}) {
        try {
            const limit = options.limit || 50;
            const offset = options.offset || 0;
            const status = options.status;

            let sql = `
                SELECT t.*, l.agent_id, a.name as agent_name
                FROM transactions t
                LEFT JOIN licenses l ON t.license_id = l.license_id
                LEFT JOIN ai_agents a ON l.agent_id = a.agent_id
                WHERE t.from_wallet = ? OR t.to_wallet = ?
            `;
            let params = [walletAddress, walletAddress];

            if (status) {
                sql += ' AND t.status = ?';
                params.push(status);
            }

            sql += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const transactions = await dbConnection.query(sql, params);

            return {
                transactions: transactions,
                total: transactions.length,
                limit: limit,
                offset: offset
            };

        } catch (error) {
            logger.logError(error, { context: 'getUserTransactions' });
            throw new DatabaseError('Failed to get user transactions', error);
        }
    }
}

// Create singleton instance
const transactionService = new TransactionService();

module.exports = transactionService;