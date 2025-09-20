const express = require('express');
const router = express.Router();
const aiAgentModel = require('../models/AIAgent');
const walletAuthService = require('../services/auth/walletAuth');
const nftMintingService = require('../services/xrpl/nftMint');
const didService = require('../services/xrpl/did');
const transactionModel = require('../models/Transaction');
const config = require('../config');
const logger = require('../services/logger');
const {
    asyncHandler,
    ValidationError,
    NotFoundError,
    ConflictError,
    XRPLError
} = require('../middleware/errorHandler');

// GET /api/agents - List all AI agents
router.get('/', asyncHandler(async (req, res) => {
    const {
        category,
        limit = 20,
        offset = 0,
        sortBy = 'created_at',
        sortOrder = 'desc',
        status = 'active'
    } = req.query;

    logger.info('Fetching agents list', {
        category,
        limit,
        offset,
        sortBy,
        sortOrder,
        status
    });

    // Validate and convert query params
    const options = {
        limit: Math.min(parseInt(limit) || 20, 100),
        offset: parseInt(offset) || 0,
        sortBy: sortBy,
        sortOrder: sortOrder,
        status: status
    };

    // Add category filter if provided
    if (category) {
        options.category = category;
    }

    // Fetch agents based on category or general listing
    let result;

    if (category === 'popular') {
        // Get popular agents
        const agents = await aiAgentModel.getPopular(options.limit);
        result = {
            agents: agents,
            pagination: {
                total: agents.length,
                limit: options.limit,
                offset: 0,
                hasMore: false
            }
        };
    } else if (category === 'new') {
        // Get recent agents
        const agents = await aiAgentModel.getRecent(options.limit);
        result = {
            agents: agents,
            pagination: {
                total: agents.length,
                limit: options.limit,
                offset: 0,
                hasMore: false
            }
        };
    } else {
        // Get filtered list
        result = await aiAgentModel.findAll(options);
    }

    res.json({
        success: true,
        ...result
    });
}));

// POST /api/agents - Register new AI agent
router.post('/', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const {
        name,
        description,
        category,
        priceXRP,
        ipfsHash,
        imageUrl
    } = req.body;

    const ownerWallet = req.user.walletAddress;

    logger.info('Agent registration attempt', {
        owner: ownerWallet,
        name: name,
        category: category,
        price: priceXRP,
        ipfsHash: ipfsHash
    });

    // Validate required fields
    if (!name || !description || !category || !priceXRP || !ipfsHash) {
        throw new ValidationError('Missing required fields');
    }

    // Prepare agent data for NFT minting
    const agentData = {
        name,
        description,
        category,
        priceXRP,
        ipfsHash,
        ownerWallet,
        imageUrl: imageUrl || null
    };

    // Mint NFT for the agent
    const mintResult = await nftMintingService.mintAgentNFT(agentData);

    // Create DID for the agent (온체인 메타데이터 저장)
    let didResult = null;
    try {
        didResult = await didService.createAgentDID({
            agent_id: mintResult.agentId,
            name: name,
            description: description,
            category: category,
            version: '1.0.0',
            ipfs_hash: ipfsHash,
            nft_token_id: mintResult.mintTransaction.NFTokenID || 'pending_mint',
            price_xrp: priceXRP
        }, ownerWallet);

        logger.info('DID created for agent', {
            agentId: mintResult.agentId,
            didId: didResult.didId,
            owner: ownerWallet
        });
    } catch (didError) {
        logger.logError(didError, { context: 'DID creation failed during agent registration' });
        // DID 실패해도 Agent는 등록됨 (옵셔널 기능)
    }

    // Create agent in database for indexing/caching
    // credential_type will be derived from agent_id in NFT metadata during purchase
    const agentToCreate = {
        nft_id: mintResult.mintTransaction.NFTokenID || 'pending_mint', // Will be updated after transaction confirmation
        wallet_address: ownerWallet,
        name: name,
        description: description,
        category: category,
        price_xrp: priceXRP,
        image_url: imageUrl || null,
        ipfs_hash: ipfsHash,
        credential_type: `AI_LICENSE_${mintResult.agentId.substring(0, 8)}`, // Store credential type
        did_id: didResult ? didResult.didId : null, // Store DID ID (reference only)
        did_document: null, // Don't cache - always read from blockchain
        status: 'active' // Set as active immediately (will be verified during sync)
    };

    const createdAgent = await aiAgentModel.create(agentToCreate);

    logger.info('Agent registered successfully', {
        agentId: mintResult.agentId,
        owner: ownerWallet
    });

    res.status(201).json({
        success: true,
        agent: createdAgent,
        mintTransaction: mintResult.mintTransaction,
        didTransaction: didResult ? didResult.transaction : null,
        didId: didResult ? didResult.didId : null,
        message: 'Agent registered. Submit the mint and DID transactions to XRPL to complete the process.'
    });
}));

// GET /api/agents/categories - Get available categories with agent counts
router.get('/categories', asyncHandler(async (req, res) => {
    // Get category statistics
    const categories = await dbConnection.query(
        `SELECT category, COUNT(*) as agent_count
         FROM ai_agents
         WHERE status = 'active'
         GROUP BY category
         ORDER BY agent_count DESC`
    );

    // Add display names and descriptions
    const categoryMap = {
        'NLP': { displayName: 'NLP Models', description: 'Natural Language Processing models' },
        'Computer Vision': { displayName: 'Computer Vision', description: 'Image and video processing models' },
        'RL': { displayName: 'Reinforcement Learning', description: 'RL and decision-making models' },
        'Other': { displayName: 'Other', description: 'Other AI models and tools' }
    };

    const enrichedCategories = categories.map(cat => ({
        ...cat,
        ...categoryMap[cat.category] || {}
    }));

    // Add special categories
    const specialCategories = [
        {
            category: 'popular',
            displayName: 'Popular',
            description: 'Most purchased agents',
            agent_count: await dbConnection.get('SELECT COUNT(*) as count FROM ai_agents WHERE status = "active" AND total_sales > 0').then(r => r.count)
        },
        {
            category: 'new',
            displayName: 'New',
            description: 'Recently added agents',
            agent_count: await dbConnection.get('SELECT COUNT(*) as count FROM ai_agents WHERE status = "active"').then(r => r.count)
        }
    ];

    res.json({
        success: true,
        categories: [...specialCategories, ...enrichedCategories]
    });
}));

// GET /api/agents/search - Search agents
router.get('/search', asyncHandler(async (req, res) => {
    const {
        q,
        category,
        limit = 20,
        offset = 0
    } = req.query;

    if (!q || q.length < 2) {
        throw new ValidationError('Search query must be at least 2 characters');
    }

    const result = await aiAgentModel.search(q, {
        category,
        limit: Math.min(parseInt(limit) || 20, 100),
        offset: parseInt(offset) || 0
    });

    res.json({
        success: true,
        ...result
    });
}));

// GET /api/agents/my - Get user's own agents
router.get('/my', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const ownerWallet = req.user.walletAddress;
    const {
        limit = 50,
        offset = 0,
        status
    } = req.query;

    const result = await aiAgentModel.findAll({
        ownerId: ownerWallet,
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
        status: status || null // Show all statuses if not specified
    });

    res.json({
        success: true,
        ...result
    });
}));

// GET /api/agents/:id - Get AI agent details
router.get('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    const agentDetails = await aiAgentModel.getAgentDetails(id);

    if (!agentDetails) {
        throw new NotFoundError('Agent not found');
    }

    // DID 검증 및 메타데이터 조회 (블록체인에서 직접)
    let didInfo = null;
    if (agentDetails.did_id) {
        try {
            didInfo = await didService.getAgentDID(agentDetails.did_id);
            if (didInfo) {
                // 블록체인에서 검증된 메타데이터 추가
                agentDetails.verifiedMetadata = didService.extractAgentMetadata(didInfo.document);
                agentDetails.didVerified = true;
                agentDetails.didInfo = {
                    didId: didInfo.didId,
                    uri: didInfo.uri,
                    verified: didInfo.verified
                };

                logger.info('DID verified for agent', {
                    agentId: id,
                    didId: didInfo.didId,
                    verified: didInfo.verified
                });
            }
        } catch (didError) {
            logger.logError(didError, { context: 'DID verification failed during agent details' });
            agentDetails.didVerified = false;
            agentDetails.didError = 'DID verification failed';
        }
    } else {
        agentDetails.didVerified = false;
        agentDetails.didInfo = null;
    }

    res.json({
        success: true,
        agent: agentDetails
    });
}));

// PUT /api/agents/:id - Update agent details
router.put('/:id', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const ownerWallet = req.user.walletAddress;
    const updateData = req.body;

    // Get agent to verify ownership
    const agent = await aiAgentModel.findById(id);
    if (!agent) {
        throw new NotFoundError('Agent not found');
    }

    if (agent.wallet_address !== ownerWallet) {
        throw new ValidationError('You can only update your own agents');
    }

    // Only allow updating certain fields
    const allowedUpdates = {};
    const updateableFields = ['name', 'description', 'price_xrp', 'image_url', 'status'];

    for (const field of updateableFields) {
        if (updateData[field] !== undefined) {
            allowedUpdates[field] = updateData[field];
        }
    }

    if (Object.keys(allowedUpdates).length === 0) {
        throw new ValidationError('No valid fields to update');
    }

    const updatedAgent = await aiAgentModel.update(id, allowedUpdates);

    logger.info('Agent updated', {
        agentId: id,
        owner: ownerWallet,
        updatedFields: Object.keys(allowedUpdates)
    });

    res.json({
        success: true,
        agent: updatedAgent
    });
}));

// POST /api/agents/:id/mint/confirm - Confirm NFT minting
router.post('/:id/mint/confirm', walletAuthService.authenticateMiddleware(), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { signedTransaction } = req.body;
    const ownerWallet = req.user.walletAddress;

    if (!signedTransaction) {
        throw new ValidationError('Signed transaction is required');
    }

    // Get agent to verify ownership
    const agent = await aiAgentModel.findById(id);
    if (!agent) {
        throw new NotFoundError('Agent not found');
    }

    if (agent.wallet_address !== ownerWallet) {
        throw new ValidationError('You can only confirm minting for your own agents');
    }

    // Submit the signed NFT transaction to XRPL
    const mintResult = await nftMintingService.submitNFTMintTransaction(signedTransaction);

    if (!mintResult.success) {
        throw new XRPLError('NFT minting failed on XRPL');
    }

    // Update agent with confirmed NFT ID and activate it
    const updatedAgent = await aiAgentModel.update(id, {
        nft_id: mintResult.tokenId,
        status: 'active'
    });

    // Record transaction in database
    await transactionModel.create({
        hash: mintResult.transactionHash,
        type: 'nft_mint',
        from_wallet: ownerWallet,
        to_wallet: config.platform.walletAddress,
        amount_xrp: '0',
        status: 'completed',
        agent_id: id,
        metadata: JSON.stringify({
            nftId: mintResult.tokenId,
            agentName: agent.name
        })
    });

    logger.info('NFT minting confirmed', {
        agentId: id,
        nftId: mintResult.tokenId,
        transactionHash: mintResult.transactionHash,
        owner: ownerWallet
    });

    res.json({
        success: true,
        agent: updatedAgent,
        nftId: mintResult.tokenId,
        transactionHash: mintResult.transactionHash,
        message: 'NFT minted successfully on XRPL and agent activated'
    });
}));

// GET /api/agents/:id/stats - Get agent statistics
router.get('/:id/stats', asyncHandler(async (req, res) => {
    const { id } = req.params;

    const stats = await aiAgentModel.getAgentStats(id);

    res.json({
        success: true,
        stats: stats
    });
}));

// Need to import dbConnection for categories endpoint
const dbConnection = require('../db/connection');

module.exports = router;