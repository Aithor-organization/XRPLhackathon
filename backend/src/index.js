const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const logger = require('./services/logger');
const { errorHandler } = require('./middleware/errorHandler');
const platformWallet = require('./services/xrpl/platformWallet');
const xrplClient = require('./services/xrpl/client');

// Import API routes
const authRoutes = require('./api/auth');
const agentsRoutes = require('./api/agents');
const licensesRoutes = require('./api/licenses');
const purchaseRoutes = require('./api/purchase');
const transactionsRoutes = require('./api/transactions');
const usersRoutes = require('./api/users');
const downloadsRoutes = require('./api/downloads');
const reviewsRoutes = require('./api/reviews');

// Load environment variables
require('dotenv').config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 900000), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
    message: 'Too many requests from this IP, please try again later.'
});

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? process.env.FRONTEND_URL
        : 'http://localhost:3000',
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/', limiter);

// Request logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent')
    });
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'AgentTrust Backend',
        version: '1.0.0'
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/licenses', licensesRoutes);
app.use('/api/purchase', purchaseRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/downloads', downloadsRoutes);
app.use('/api/reviews', reviewsRoutes);

// Static files for uploaded content (if needed)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 404 handler
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        error: {
            message: 'Endpoint not found',
            code: 'NOT_FOUND'
        }
    });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize services and start server
async function startServer() {
    try {
        logger.info('Starting AgentTrust backend server...');

        // Initialize XRPL client
        logger.info('Connecting to XRPL...');
        await xrplClient.connect();
        logger.info('✅ Connected to XRPL Devnet');

        // Initialize platform wallet
        logger.info('Initializing platform wallet...');
        const walletInfo = await platformWallet.initialize();
        logger.info('✅ Platform wallet initialized', {
            address: walletInfo.address,
            balance: walletInfo.balance
        });

        // Start Express server
        app.listen(PORT, () => {
            logger.info(`✅ AgentTrust backend server running on port ${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
            logger.info('='.repeat(50));
            logger.info('Backend services ready:');
            logger.info('  - XRPL: Connected');
            logger.info('  - Platform Wallet: Initialized');
            logger.info('  - API Endpoints: Active');
            logger.info('  - Database: SQLite');
            logger.info('  - Rate Limiting: Enabled');
            logger.info('='.repeat(50));
        });

    } catch (error) {
        logger.logError(error, { context: 'server_startup' });
        logger.error('Failed to start server. Shutting down...');
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    await xrplClient.disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received. Shutting down gracefully...');
    await xrplClient.disconnect();
    process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    logger.logError(error, { context: 'uncaught_exception' });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the server
startServer();

module.exports = app;