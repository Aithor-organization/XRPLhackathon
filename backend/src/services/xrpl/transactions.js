const xrpl = require('xrpl');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../logger');
const xrplClient = require('./client');
const platformWallet = require('./platformWallet');
const dbConnection = require('../../db/connection');
const credentialsService = require('./credentials');
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

    // Execute escrow-based purchase with automatic fee collection
    async executeBatchTransaction(buyerWallet, sellerWallet, agentData) {
        const batchHash = this.generateBatchHash();

        try {
            // Calculate fee distribution
            const priceXRP = agentData.price_xrp || agentData.priceXRP;
            const fees = this.calculateFeeDistribution(priceXRP);

            logger.logTransaction('escrow_purchase_started', {
                batchHash,
                totalAmount: fees.total,
                platformFee: fees.platformFee,
                sellerRevenue: fees.sellerRevenue,
                useEscrow: true
            });

            // Create escrow transaction for full amount to platform
            const escrowTransaction = await this.createEscrowTransaction(
                buyerWallet,
                sellerWallet,
                agentData,
                fees,
                batchHash
            );

            // Create simple tracking record for escrow
            await this.createEscrowRecord(batchHash, buyerWallet, sellerWallet, fees, agentData);

            logger.logTransaction('escrow_prepared', {
                batchHash,
                escrowAmount: fees.total,
                destinationPlatform: platformWallet.getAddress()
            });

            // Return single escrow transaction for client signing
            return {
                success: true,
                batchHash: batchHash,
                escrowTransaction: escrowTransaction,
                fees: fees,
                message: 'Escrow purchase prepared - buyer deposits full amount, platform distributes automatically'
            };

        } catch (error) {
            logger.logError(error, { context: 'executeEscrowTransaction', batchHash });
            throw new XRPLError('Failed to execute escrow transaction', error);
        }
    }

    // Create escrow transaction for purchase with automatic fee collection
    async createEscrowTransaction(buyerWallet, sellerWallet, agentData, fees, batchHash) {
        try {
            const platformAddress = platformWallet.getAddress();

            // Create escrow with full amount going to platform
            const escrowTx = {
                TransactionType: 'EscrowCreate',
                Account: buyerWallet,
                Destination: platformAddress, // Platform receives the escrow
                Amount: xrpl.xrpToDrops(fees.total.toString()),
                FinishAfter: Math.floor(Date.now() / 1000) - 946684800 + 1800, // 30 minutes from now (XRPL epoch)
                Memos: [{
                    Memo: {
                        MemoData: Buffer.from(JSON.stringify({
                            type: 'agent_purchase_escrow',
                            batchHash: batchHash,
                            agentId: agentData.agent_id,
                            agentName: agentData.name,
                            sellerWallet: sellerWallet,
                            sellerAmount: fees.sellerRevenue,
                            platformAmount: fees.platformFee,
                            buyerWallet: buyerWallet
                        }), 'utf8').toString('hex').toUpperCase(),
                        MemoType: Buffer.from('purchase_escrow', 'utf8').toString('hex').toUpperCase()
                    }
                }]
            };

            // Auto-fill the escrow transaction
            const client = xrplClient.getClient();
            const prepared = await client.autofill(escrowTx);

            logger.logTransaction('escrow_created', {
                buyer: buyerWallet,
                platform: platformAddress,
                totalAmount: fees.total,
                agentId: agentData.agent_id,
                batchHash: batchHash
            });

            return prepared;

        } catch (error) {
            logger.logError(error, { context: 'createEscrowTransaction' });
            throw new XRPLError('Failed to create escrow transaction', error);
        }
    }

    // Create escrow record in database for tracking
    async createEscrowRecord(batchHash, buyerWallet, sellerWallet, fees, agentData) {
        try {
            const escrowId = `escrow_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

            const escrowRecord = {
                sql: `INSERT INTO transactions (
                    transaction_id, batch_hash, transaction_type,
                    from_wallet, to_wallet, amount_xrp, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
                params: [
                    escrowId,
                    batchHash,
                    'escrow_purchase',
                    buyerWallet,
                    platformWallet.getAddress(),
                    fees.total
                ]
            };

            await dbConnection.run(escrowRecord.sql, escrowRecord.params);

            logger.logDatabase('escrow_record_created', 'transactions', {
                escrowId,
                batchHash,
                totalAmount: fees.total
            });

            return escrowId;

        } catch (error) {
            logger.logError(error, { context: 'createEscrowRecord' });
            throw new DatabaseError('Failed to create escrow record', error);
        }
    }

    // Complete escrow purchase - distribute funds and issue credential
    async completeEscrowPurchase(escrowDetails, agentData) {
        try {
            const { batchHash, buyerWallet, sellerWallet, escrowSequence } = escrowDetails;
            const fees = this.calculateFeeDistribution(agentData.price_xrp);

            logger.logTransaction('escrow_completion_started', {
                batchHash,
                escrowSequence,
                buyer: buyerWallet,
                seller: sellerWallet
            });

            // 1. Finish the escrow (releases funds to platform)
            const escrowFinishTx = {
                TransactionType: 'EscrowFinish',
                Account: platformWallet.getAddress(), // Platform finishes the escrow
                Owner: buyerWallet,
                OfferSequence: escrowSequence
            };

            const client = xrplClient.getClient();
            const preparedFinish = await client.autofill(escrowFinishTx);

            // Platform automatically signs and submits escrow finish
            const finishResult = await platformWallet.submitTransaction(preparedFinish);

            if (finishResult.result.meta.TransactionResult !== 'tesSUCCESS') {
                throw new Error(`Escrow finish failed: ${finishResult.result.meta.TransactionResult}`);
            }

            logger.logTransaction('escrow_finished', {
                transactionHash: finishResult.result.hash,
                platformReceived: fees.total
            });

            // 2. Distribute seller portion (platform sends 70% to seller)
            if (fees.sellerRevenue > 0) {
                const sellerPayment = await platformWallet.createPaymentTransaction(
                    sellerWallet,
                    fees.sellerRevenue,
                    `Seller payment for AI Agent: ${agentData.name}`
                );

                const sellerResult = await platformWallet.submitTransaction(sellerPayment);

                if (sellerResult.result.meta.TransactionResult !== 'tesSUCCESS') {
                    throw new Error(`Seller payment failed: ${sellerResult.result.meta.TransactionResult}`);
                }

                logger.logTransaction('seller_paid', {
                    transactionHash: sellerResult.result.hash,
                    seller: sellerWallet,
                    amount: fees.sellerRevenue
                });
            }

            // 3. Issue XRPL Credential to buyer
            const credential = await credentialsService.createLicenseCredential(
                platformWallet.getAddress(),
                buyerWallet,
                {
                    agentId: agentData.agent_id,
                    agentName: agentData.name,
                    purchaseDate: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
                    transactionHash: finishResult.result.hash
                }
            );

            // Platform issues the credential
            const credentialResult = await platformWallet.submitTransaction(credential.transaction);

            if (credentialResult.result.meta.TransactionResult !== 'tesSUCCESS') {
                throw new Error(`Credential issuance failed: ${credentialResult.result.meta.TransactionResult}`);
            }

            logger.logTransaction('credential_issued', {
                transactionHash: credentialResult.result.hash,
                credentialId: credential.credentialId,
                buyer: buyerWallet
            });

            // 4. Update database records
            await this.updateTransactionStatus(
                escrowDetails.transactionId,
                'completed',
                finishResult.result.hash
            );

            return {
                success: true,
                escrowFinishHash: finishResult.result.hash,
                sellerPaymentHash: sellerResult?.result?.hash,
                credentialIssuanceHash: credentialResult.result.hash,
                credentialId: credential.credentialId,
                fees: fees
            };

        } catch (error) {
            logger.logError(error, { context: 'completeEscrowPurchase' });
            throw new XRPLError('Failed to complete escrow purchase', error);
        }
    }

    // Create transaction records in database
    async createTransactionRecords(batchHash, buyerWallet, sellerWallet, fees) {
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
                    transaction_id, batch_hash, transaction_type,
                    from_wallet, to_wallet, amount_xrp, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
                params: [
                    tx.transactionId,
                    batchHash,
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
    async simulateBatchExecution(buyerWallet, sellerWallet, agentData) {
        try {
            const priceXRP = agentData.price_xrp || agentData.priceXRP;
            const fees = this.calculateFeeDistribution(priceXRP);

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