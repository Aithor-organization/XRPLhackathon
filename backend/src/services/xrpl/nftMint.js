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

    // Generate credential type for the agent
    generateCredentialType(agentId) {
        // Format: ML_{first_12_chars_of_agent_id}
        const shortId = agentId.substring(0, 12);
        return `ML_${shortId}`;
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
            const metadata = {
                name: agentData.name,
                description: agentData.description,
                category: agentData.category,
                agent_id: agentData.agentId,
                credential_type: agentData.credentialType,
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
            // Generate transfer fee (0.1% = 100 in basis points, max 50% = 50000)
            const transferFee = 100; // 0.1% transfer fee

            // Create flags for NFT
            const flags = {
                tfBurnable: false,      // NFT cannot be burned
                tfOnlyXRP: true,        // Only XRP payments
                tfTransferable: false   // NFT cannot be transferred (non-transferable)
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
    async submitNFTMintTransaction(ownerWallet, transaction) {
        try {
            // Create wallet instance for signing (in real app, this would be done client-side)
            // For now, we'll prepare the transaction and return it for client-side signing

            const client = xrplClient.getClient();

            // Note: In a real implementation, the transaction would be signed
            // client-side by the user's wallet, not server-side

            logger.logTransaction('nft_mint_submitted', {
                owner: ownerWallet,
                transactionType: transaction.TransactionType
            });

            // Return prepared transaction for client-side signing
            return {
                success: true,
                transaction: transaction,
                message: 'Transaction prepared for client-side signing'
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
            const credentialType = this.generateCredentialType(agentId);

            // Prepare agent data
            const completeAgentData = {
                ...agentData,
                agentId: agentId,
                credentialType: credentialType
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
                owner: agentData.ownerWallet,
                credentialType: credentialType
            });

            return {
                success: true,
                agentId: agentId,
                credentialType: credentialType,
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
}

// Create singleton instance
const nftMintingService = new NFTMintingService();

module.exports = nftMintingService;