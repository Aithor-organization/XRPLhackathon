const xrpl = require('xrpl');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../logger');
const xrplClient = require('./client');
const {
    ValidationError,
    XRPLError,
    AppError
} = require('../../middleware/errorHandler');

class NFTMintingService {
    constructor() {
        console.log('NFT Minting Service initialized');
    }

    // Generate unique agent ID
    generateAgentId() {
        return `agent_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    // Extract credential type from NFT metadata (used during purchase)
    extractCredentialTypeFromNFT(nftMetadata) {
        // Format: ML_{first_12_chars_of_agent_id}
        if (nftMetadata && nftMetadata.agent_id) {
            const shortId = nftMetadata.agent_id.substring(0, 12);
            return `ML_${shortId}`;
        }
        throw new ValidationError('Cannot extract credential type: invalid NFT metadata');
    }

    // Create DID document for the AI agent
    createDIDDocument(agentData) {
        const did = `did:xrpl:${agentData.agentId}`;

        const didDocument = {
            "@context": [
                "https://www.w3.org/ns/did/v1",
                "https://w3id.org/security/v2"
            ],
            "id": did,
            "controller": agentData.ownerWallet,
            "created": new Date().toISOString(),
            "updated": new Date().toISOString(),
            "subject": {
                "id": agentData.agentId,
                "type": "AIAgent",
                "name": agentData.name,
                "description": agentData.description,
                "category": agentData.category,
                "version": "1.0.0",
                "capabilities": []
            },
            "credentialType": agentData.credentialType,
            "verification": {
                "nftId": null, // Will be filled after minting
                "blockchain": "XRPL",
                "network": config.xrpl.network
            },
            "metadata": {
                "platform": config.platform.name,
                "mintedAt": new Date().toISOString(),
                "licenseModel": "credential-based"
            }
        };

        return didDocument;
    }

    // Encode metadata for NFT
    encodeNFTMetadata(agentData) {
        try {
            // Create metadata that does NOT include IPFS hash for security
            // credential_type will be generated from agent_id during purchase
            const metadata = {
                name: agentData.name,
                description: agentData.description,
                category: agentData.category,
                agent_id: agentData.agentId,
                platform: config.platform.name,
                version: "1.0.0",
                created_at: new Date().toISOString()
            };

            // Convert to hex for XRPL
            const jsonString = JSON.stringify(metadata);
            const hexMetadata = Buffer.from(jsonString, 'utf8').toString('hex').toUpperCase();

            // Ensure it's not too long for XRPL (max ~1KB)
            if (hexMetadata.length > 2000) {
                throw new ValidationError('Metadata too large for NFT minting');
            }

            return hexMetadata;

        } catch (error) {
            logger.logError(error, { context: 'encodeNFTMetadata' });
            throw new ValidationError('Failed to encode NFT metadata');
        }
    }

    // Create NFTokenMint transaction
    async createNFTMintTransaction(ownerWallet, agentData) {
        try {
            // 30% platform fee as requested (30000 basis points = 30%)
            const transferFee = 30000; // 30% transfer fee

            // Create flags for NFT
            const flags = {
                tfBurnable: false,      // NFT cannot be burned
                tfOnlyXRP: true,        // Only XRP payments
                tfTransferable: false   // NFT cannot be transferred (ownership retained)
            };

            // Calculate numeric flags value
            let flagsValue = 0;
            if (flags.tfBurnable) flagsValue |= 0x00000001;
            if (flags.tfOnlyXRP) flagsValue |= 0x00000002;
            if (flags.tfTransferable) flagsValue |= 0x00000008;

            // Encode metadata
            const metadata = this.encodeNFTMetadata(agentData);

            // Create NFTokenMint transaction
            const nftMintTx = {
                TransactionType: 'NFTokenMint',
                Account: ownerWallet,
                NFTokenTaxon: 0, // Used for grouping, 0 for general use
                TransferFee: transferFee,
                Flags: flagsValue,
                URI: metadata // Metadata encoded as hex
            };

            // Auto-fill transaction details
            const client = xrplClient.getClient();
            const prepared = await client.autofill(nftMintTx);

            logger.logTransaction('nft_mint_prepared', {
                owner: ownerWallet,
                agentId: agentData.agentId,
                credentialType: agentData.credentialType
            });

            return prepared;

        } catch (error) {
            logger.logError(error, { context: 'createNFTMintTransaction' });
            throw new XRPLError('Failed to create NFT minting transaction', error);
        }
    }

    // Submit NFT minting transaction
    async submitNFTMintTransaction(signedTransaction) {
        try {
            const client = xrplClient.getClient();

            // Submit the signed transaction to XRPL
            const result = await client.submitAndWait(signedTransaction);

            // Check if successful
            if (result.result.meta.TransactionResult !== 'tesSUCCESS') {
                throw new XRPLError(`NFT minting failed: ${result.result.meta.TransactionResult}`);
            }

            // Extract NFToken ID from transaction metadata
            const meta = result.result.meta;
            let tokenId = null;

            // Find the minted NFToken ID
            if (meta && typeof meta === 'object') {
                const affectedNodes = meta.AffectedNodes || [];
                for (const node of affectedNodes) {
                    if (node.CreatedNode && node.CreatedNode.LedgerEntryType === 'NFTokenPage') {
                        const nftokens = node.CreatedNode.NewFields?.NFTokens ||
                                       node.ModifiedNode?.FinalFields?.NFTokens || [];
                        if (nftokens.length > 0) {
                            tokenId = nftokens[nftokens.length - 1].NFToken.NFTokenID;
                            break;
                        }
                    } else if (node.ModifiedNode && node.ModifiedNode.LedgerEntryType === 'NFTokenPage') {
                        const prevTokens = node.ModifiedNode.PreviousFields?.NFTokens || [];
                        const finalTokens = node.ModifiedNode.FinalFields?.NFTokens || [];
                        if (finalTokens.length > prevTokens.length) {
                            tokenId = finalTokens[finalTokens.length - 1].NFToken.NFTokenID;
                            break;
                        }
                    }
                }
            }

            logger.logTransaction('nft_mint_submitted', {
                transactionHash: result.result.hash,
                tokenId: tokenId,
                result: result.result.meta.TransactionResult
            });

            return {
                success: true,
                transactionHash: result.result.hash,
                tokenId: tokenId || result.result.hash,
                ledgerIndex: result.result.ledger_index
            };

        } catch (error) {
            logger.logError(error, { context: 'submitNFTMintTransaction' });
            throw new XRPLError('Failed to submit NFT minting transaction', error);
        }
    }

    // Get NFT information from transaction result
    async getNFTFromTransaction(transactionHash) {
        try {
            const client = xrplClient.getClient();
            const txResponse = await client.request({
                command: 'tx',
                transaction: transactionHash
            });

            if (txResponse.result.meta.TransactionResult !== 'tesSUCCESS') {
                throw new XRPLError(`NFT minting failed: ${txResponse.result.meta.TransactionResult}`);
            }

            // Extract NFT ID from transaction metadata
            const createdNodes = txResponse.result.meta.CreatedNodes || [];
            let nftId = null;

            for (const node of createdNodes) {
                if (node.CreatedNode && node.CreatedNode.LedgerEntryType === 'NFToken') {
                    // Extract NFT ID from the created node
                    const nftObject = node.CreatedNode.NewFields || node.CreatedNode.FinalFields;
                    if (nftObject && nftObject.NFToken) {
                        nftId = nftObject.NFToken;
                        break;
                    }
                }
            }

            if (!nftId) {
                throw new XRPLError('NFT ID not found in transaction result');
            }

            logger.logTransaction('nft_extracted', {
                transactionHash,
                nftId
            });

            return {
                nftId: nftId,
                transactionHash: transactionHash,
                ledgerIndex: txResponse.result.ledger_index
            };

        } catch (error) {
            logger.logError(error, { context: 'getNFTFromTransaction' });
            throw new XRPLError('Failed to extract NFT information', error);
        }
    }

    // Complete NFT minting process for AI agent
    async mintAgentNFT(agentData) {
        try {
            // Validate input data
            this.validateAgentData(agentData);

            // Generate unique IDs
            const agentId = this.generateAgentId();
            // credential_type will be derived from agent_id during purchase

            // Prepare agent data
            const completeAgentData = {
                ...agentData,
                agentId: agentId
            };

            // Create DID document
            const didDocument = this.createDIDDocument(completeAgentData);

            // Create NFT minting transaction
            const mintTransaction = await this.createNFTMintTransaction(
                agentData.ownerWallet,
                completeAgentData
            );

            logger.logTransaction('agent_nft_mint_initiated', {
                agentId: agentId,
                owner: agentData.ownerWallet
            });

            return {
                success: true,
                agentId: agentId,
                didDocument: didDocument,
                mintTransaction: mintTransaction,
                message: 'NFT minting transaction prepared. Submit via XRPL client.'
            };

        } catch (error) {
            logger.logError(error, { context: 'mintAgentNFT' });
            throw error;
        }
    }

    // Validate agent data before minting
    validateAgentData(agentData) {
        const required = ['name', 'description', 'category', 'priceXRP', 'ipfsHash', 'ownerWallet'];

        for (const field of required) {
            if (!agentData[field]) {
                throw new ValidationError(`Missing required field: ${field}`);
            }
        }

        // Validate wallet address
        if (!xrpl.isValidClassicAddress(agentData.ownerWallet)) {
            throw new ValidationError('Invalid owner wallet address');
        }

        // Validate IPFS hash format
        if (!config.validation.ipfsHashRegex.test(agentData.ipfsHash)) {
            throw new ValidationError('Invalid IPFS hash format');
        }

        // Validate category
        if (!config.validation.allowedCategories.includes(agentData.category)) {
            throw new ValidationError(`Invalid category. Allowed: ${config.validation.allowedCategories.join(', ')}`);
        }

        // Validate price
        const price = parseFloat(agentData.priceXRP);
        if (isNaN(price) || price < config.validation.minPriceXRP || price > config.validation.maxPriceXRP) {
            throw new ValidationError(
                `Price must be between ${config.validation.minPriceXRP} and ${config.validation.maxPriceXRP} XRP`
            );
        }

        // Validate text lengths
        if (agentData.name.length > config.validation.maxNameLength) {
            throw new ValidationError(`Name exceeds maximum length of ${config.validation.maxNameLength} characters`);
        }

        if (agentData.description.length > config.validation.maxDescriptionLength) {
            throw new ValidationError(`Description exceeds maximum length of ${config.validation.maxDescriptionLength} characters`);
        }
    }

    // Verify NFT ownership
    async verifyNFTOwnership(nftId, ownerWallet) {
        try {
            const client = xrplClient.getClient();
            const response = await client.request({
                command: 'account_objects',
                account: ownerWallet,
                type: 'NFToken'
            });

            const nfts = response.result.account_objects || [];
            const ownedNFT = nfts.find(nft => nft.NFTokenID === nftId);

            return ownedNFT !== undefined;

        } catch (error) {
            logger.logError(error, { context: 'verifyNFTOwnership' });
            throw new XRPLError('Failed to verify NFT ownership', error);
        }
    }

    // Get NFT metadata
    async getNFTMetadata(nftId) {
        try {
            const client = xrplClient.getClient();
            const response = await client.request({
                command: 'ledger_entry',
                nft_id: nftId
            });

            if (response.result && response.result.node && response.result.node.URI) {
                const hexMetadata = response.result.node.URI;
                const jsonString = Buffer.from(hexMetadata, 'hex').toString('utf8');
                return JSON.parse(jsonString);
            }

            return null;

        } catch (error) {
            logger.logError(error, { context: 'getNFTMetadata' });
            throw new XRPLError('Failed to get NFT metadata', error);
        }
    }

    // ============ REP TOKEN FUNCTIONALITY ============

    // Create REP Token Mint Transaction
    async createREPTokenMintTransaction(userWallet, repAmount, reviewData) {
        try {
            // REP tokens are minted as NFTs with metadata containing reputation value AND review content
            const repMetadata = {
                type: 'REP_TOKEN',
                amount: repAmount,
                issuer: config.platform.walletAddress,
                recipient: userWallet,
                reason: reviewData.type, // 'helpful_vote' only
                relatedAgent: reviewData.agentId,
                // 리뷰 정보 포함
                review: {
                    reviewId: reviewData.reviewId,
                    content: reviewData.reviewContent,
                    rating: reviewData.rating,
                    reviewer: reviewData.reviewerWallet,
                    createdAt: reviewData.reviewCreatedAt
                },
                timestamp: new Date().toISOString(),
                platform: config.platform.name
            };

            // Convert to hex
            const jsonString = JSON.stringify(repMetadata);
            const hexMetadata = Buffer.from(jsonString, 'utf8').toString('hex').toUpperCase();

            // Create REP token as NFT
            const repTokenTx = {
                TransactionType: 'NFTokenMint',
                Account: config.platform.walletAddress, // Platform mints REP tokens
                NFTokenTaxon: 1, // Taxon 1 for REP tokens (0 is for agent NFTs)
                TransferFee: 0, // No transfer fee for REP tokens
                Flags: 0x00000008, // Transferable - users can trade REP tokens
                URI: hexMetadata
            };

            // Auto-fill transaction
            const client = xrplClient.getClient();
            const prepared = await client.autofill(repTokenTx);

            logger.logTransaction('rep_token_mint_prepared', {
                recipient: userWallet,
                amount: repAmount,
                reason: reviewData.type
            });

            return prepared;

        } catch (error) {
            logger.logError(error, { context: 'createREPTokenMintTransaction' });
            throw new XRPLError('Failed to create REP token minting transaction', error);
        }
    }

    // Submit REP Token Minting
    async submitREPTokenMint(signedTransaction) {
        try {
            const client = xrplClient.getClient();

            // Submit the signed REP token transaction
            const result = await client.submitAndWait(signedTransaction);

            if (result.result.meta.TransactionResult !== 'tesSUCCESS') {
                throw new XRPLError(`REP token minting failed: ${result.result.meta.TransactionResult}`);
            }

            // Extract REP token ID
            const meta = result.result.meta;
            let repTokenId = null;

            if (meta && typeof meta === 'object') {
                const affectedNodes = meta.AffectedNodes || [];
                for (const node of affectedNodes) {
                    if (node.CreatedNode && node.CreatedNode.LedgerEntryType === 'NFTokenPage') {
                        const nftokens = node.CreatedNode.NewFields?.NFTokens || [];
                        if (nftokens.length > 0) {
                            repTokenId = nftokens[nftokens.length - 1].NFToken.NFTokenID;
                            break;
                        }
                    }
                }
            }

            logger.logTransaction('rep_token_minted', {
                transactionHash: result.result.hash,
                repTokenId: repTokenId
            });

            return {
                success: true,
                repTokenId: repTokenId,
                transactionHash: result.result.hash
            };

        } catch (error) {
            logger.logError(error, { context: 'submitREPTokenMint' });
            throw new XRPLError('Failed to submit REP token minting', error);
        }
    }

    // Mint REP tokens for user actions
    async mintREPTokensForUser(userWallet, action, actionData) {
        try {
            let repAmount = 0;
            let reviewData = {
                type: action,
                agentId: actionData.agentId || null,
                // 리뷰 정보 추가 (투표 시에만)
                reviewId: actionData.reviewId || null,
                reviewContent: actionData.reviewContent || null,
                rating: actionData.rating || null,
                reviewerWallet: actionData.reviewerWallet || null,
                reviewCreatedAt: actionData.reviewCreatedAt || null
            };

            // Determine REP amount based on action
            switch(action) {
                case 'helpful_vote':
                    repAmount = 1; // 1 REP for voting helpful on a review
                    // 리뷰 정보가 필수
                    if (!actionData.reviewId || !actionData.reviewContent) {
                        throw new ValidationError('Review data required for helpful vote');
                    }
                    break;
                // 리뷰 작성은 토큰 발행 안 함
                // case 'review_submitted':
                //     repAmount = 0; // No REP for just submitting a review
                //     break;
                default:
                    throw new ValidationError(`Unknown REP action: ${action}`);
            }

            // Create REP token mint transaction
            const repTx = await this.createREPTokenMintTransaction(
                userWallet,
                repAmount,
                reviewData
            );

            logger.info('REP token minting initiated', {
                user: userWallet,
                action: action,
                amount: repAmount
            });

            return {
                success: true,
                transaction: repTx,
                repAmount: repAmount,
                action: action,
                message: 'REP token transaction prepared for signing'
            };

        } catch (error) {
            logger.logError(error, { context: 'mintREPTokensForUser' });
            throw error;
        }
    }

    // Get user's REP token balance
    async getUserREPBalance(userWallet) {
        try {
            const client = xrplClient.getClient();

            // Get all NFTs owned by the user
            const response = await client.request({
                command: 'account_nfts',
                account: userWallet
            });

            const nfts = response.result.account_nfts || [];
            let totalREP = 0;

            // Filter and sum REP tokens
            for (const nft of nfts) {
                if (nft.NFTokenTaxon === 1) { // REP tokens have taxon 1
                    try {
                        // Decode metadata to get REP amount
                        const hexURI = nft.URI;
                        if (hexURI) {
                            const jsonString = Buffer.from(hexURI, 'hex').toString('utf8');
                            const metadata = JSON.parse(jsonString);
                            if (metadata.type === 'REP_TOKEN') {
                                totalREP += metadata.amount || 0;
                            }
                        }
                    } catch (e) {
                        // Skip invalid metadata
                        continue;
                    }
                }
            }

            return {
                success: true,
                balance: totalREP,
                wallet: userWallet
            };

        } catch (error) {
            logger.logError(error, { context: 'getUserREPBalance' });
            throw new XRPLError('Failed to get REP balance', error);
        }
    }
}

// Create singleton instance
const nftMintingService = new NFTMintingService();

module.exports = nftMintingService;