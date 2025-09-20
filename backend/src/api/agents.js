const express = require('express');
const router = express.Router();
const aiAgentModel = require('../models/AIAgent');
const walletAuthService = require('../services/auth/walletAuth');
const nftMintingService = require('../services/xrpl/nftMint');
const logger = require('../services/logger');
const {
    asyncHandler,
    ValidationError,
    NotFoundError,
    ConflictError
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

    // Create agent in database with NFT and credential info
    const agentToCreate = {
        nft_id: mintResult.mintTransaction.NFTokenID || 'pending_mint', // Will be updated after transaction confirmation
        wallet_address: ownerWallet,
        name: name,
        description: description,
        category: category,
        price_xrp: priceXRP,
        image_url: imageUrl || null,
        ipfs_hash: ipfsHash,
        credential_type: mintResult.credentialType,
        did_document: JSON.stringify(mintResult.didDocument),
        status: 'pending' // Will be activated after NFT confirmation
    };

    const createdAgent = await aiAgentModel.create(agentToCreate);

    logger.info('Agent registered successfully', {
        agentId: createdAgent.agent_id,
        owner: ownerWallet,
        credentialType: mintResult.credentialType
    });

    res.status(201).json({
        success: true,
        agent: createdAgent,
        mintTransaction: mintResult.mintTransaction,
        message: 'Agent registered. Submit the mint transaction to XRPL to complete the process.'
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
    const { transactionHash, nftId } = req.body;
    const ownerWallet = req.user.walletAddress;

    if (!transactionHash || !nftId) {
        throw new ValidationError('Transaction hash and NFT ID are required');
    }

    // Get agent to verify ownership
    const agent = await aiAgentModel.findById(id);
    if (!agent) {
        throw new NotFoundError('Agent not found');
    }

    if (agent.wallet_address !== ownerWallet) {
        throw new ValidationError('You can only confirm minting for your own agents');
    }

    // Verify NFT from transaction (simplified for MVP)
    // In production, this would verify the actual XRPL transaction

    // Update agent with confirmed NFT ID and activate it
    const updatedAgent = await aiAgentModel.update(id, {
        nft_id: nftId,
        status: 'active'
    });

    logger.info('NFT minting confirmed', {
        agentId: id,
        nftId: nftId,
        transactionHash: transactionHash,
        owner: ownerWallet
    });

    res.json({
        success: true,
        agent: updatedAgent,
        message: 'NFT minting confirmed and agent activated'
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