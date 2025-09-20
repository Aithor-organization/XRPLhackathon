require('dotenv').config();

const config = {
    // Server Configuration
    port: process.env.PORT || 3001,
    nodeEnv: process.env.NODE_ENV || 'development',

    // XRPL Configuration
    xrpl: {
        server: process.env.XRPL_SERVER || 'wss://s.devnet.rippletest.net:51233',
        platformWalletSeed: process.env.PLATFORM_WALLET_SEED || null,
        network: 'devnet',
        // Disable XRPL Credentials on devnet (not available)
        credentialsEnabled: process.env.XRPL_CREDENTIALS_ENABLED === 'true' || false
    },

    // JWT Configuration
    jwt: {
        secret: process.env.JWT_SECRET || 'agentrust-default-secret-change-in-production',
        expiry: process.env.JWT_EXPIRY || '24h'
    },

    // Database Configuration
    database: {
        path: process.env.DATABASE_PATH || './data/marketplace.db'
    },

    // IPFS Configuration
    ipfs: {
        gatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs/',
        backupGateway: process.env.IPFS_BACKUP_GATEWAY || 'https://ipfs.io/ipfs/'
    },

    // Platform Configuration
    platform: {
        feePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT) || 0.30,
        sellerRevenuePercent: parseFloat(process.env.SELLER_REVENUE_PERCENT) || 0.70,
        name: 'AgentTrust',
        version: '1.0.0'
    },

    // Download Token Configuration
    download: {
        tokenExpiry: process.env.DOWNLOAD_TOKEN_EXPIRY || '24h',
        maxAttempts: parseInt(process.env.MAX_DOWNLOAD_ATTEMPTS) || 3
    },

    // API Rate Limiting
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
    },

    // Logging Configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        file: process.env.LOG_FILE || './logs/app.log'
    },

    // Security Configuration
    security: {
        corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
        trustProxy: process.env.TRUST_PROXY === 'true'
    },

    // Validation Rules
    validation: {
        minPriceXRP: 0.1,
        maxPriceXRP: 10000,
        maxNameLength: 100,
        maxDescriptionLength: 1000,
        maxCommentLength: 500,
        allowedCategories: ['NLP', 'Computer Vision', 'RL', 'Other'],
        ipfsHashRegex: /^Qm[a-zA-Z0-9]{44}$/
    }
};

// Validation functions
function validateConfig() {
    const errors = [];

    // Validate required environment variables in production
    if (config.nodeEnv === 'production') {
        if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'agentrust-default-secret-change-in-production') {
            errors.push('JWT_SECRET must be set in production');
        }

        if (!process.env.PLATFORM_WALLET_SEED) {
            errors.push('PLATFORM_WALLET_SEED must be set in production');
        }
    }

    // Validate fee percentages
    if (config.platform.feePercent + config.platform.sellerRevenuePercent !== 1.0) {
        errors.push('Platform fee and seller revenue percentages must sum to 1.0');
    }

    // Validate positive values
    if (config.platform.feePercent < 0 || config.platform.feePercent > 1) {
        errors.push('Platform fee percentage must be between 0 and 1');
    }

    if (errors.length > 0) {
        console.error('❌ Configuration validation failed:');
        errors.forEach(error => console.error(`  - ${error}`));
        throw new Error('Invalid configuration');
    }

    console.log('✅ Configuration validation passed');
}

// Helper functions
function isDevelopment() {
    return config.nodeEnv === 'development';
}

function isProduction() {
    return config.nodeEnv === 'production';
}

function getFullIPFSUrl(hash) {
    return `${config.ipfs.gatewayUrl}${hash}`;
}

function getBackupIPFSUrl(hash) {
    return `${config.ipfs.backupGateway}${hash}`;
}

// Calculate fees
function calculateFees(priceXRP) {
    const platformFee = priceXRP * config.platform.feePercent;
    const sellerRevenue = priceXRP * config.platform.sellerRevenuePercent;

    return {
        total: priceXRP,
        platformFee: Math.round(platformFee * 100) / 100, // Round to 2 decimal places
        sellerRevenue: Math.round(sellerRevenue * 100) / 100
    };
}

// Export configuration and utilities
module.exports = {
    ...config,
    validateConfig,
    isDevelopment,
    isProduction,
    getFullIPFSUrl,
    getBackupIPFSUrl,
    calculateFees
};