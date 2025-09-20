const app = require('./app');
const config = require('./config');
const logger = require('./services/logger');
const dbConnection = require('./db/connection');
const xrplClient = require('./services/xrpl/client');
const platformWallet = require('./services/xrpl/platformWallet');

async function startServer() {
    try {
        // Validate configuration
        config.validateConfig();

        // Initialize database connection
        logger.info('Initializing database connection...');
        await dbConnection.connect();

        // Initialize XRPL client
        logger.info('Connecting to XRPL...');
        await xrplClient.connect();

        // Initialize platform wallet
        logger.info('Initializing platform wallet...');
        await platformWallet.initialize();

        // Start HTTP server
        const port = config.port;
        const server = app.listen(port, () => {
            logger.info('🚀 AgentTrust Backend Started', {
                port: port,
                environment: config.nodeEnv,
                platform: config.platform.name,
                version: config.platform.version,
                xrplServer: config.xrpl.server,
                platformWallet: platformWallet.getAddress()
            });

            console.log(`
╔══════════════════════════════════════════════════════════════╗
║                      AgentTrust Backend                      ║
║                                                              ║
║  🌐 Server: http://localhost:${port}                        ║
║  📊 Health: http://localhost:${port}/health                 ║
║  🔗 XRPL: ${config.xrpl.server}                            ║
║  💼 Platform Wallet: ${platformWallet.getAddress()}        ║
║  🏗️  Environment: ${config.nodeEnv}                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
            `);
        });

        // Graceful shutdown handling
        const gracefulShutdown = async (signal) => {
            logger.info(`Received ${signal}, shutting down gracefully...`);

            server.close(async () => {
                try {
                    // Close database connection
                    await dbConnection.close();
                    logger.info('Database connection closed');

                    // Close XRPL connection
                    await xrplClient.disconnect();
                    logger.info('XRPL connection closed');

                    logger.info('✅ Server shutdown complete');
                    process.exit(0);

                } catch (error) {
                    logger.logError(error, { context: 'graceful_shutdown' });
                    process.exit(1);
                }
            });

            // Force exit after 30 seconds
            setTimeout(() => {
                logger.error('Force shutting down after timeout');
                process.exit(1);
            }, 30000);
        };

        // Listen for shutdown signals
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        return server;

    } catch (error) {
        logger.logError(error, { context: 'server_startup' });
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

// Start the server if this file is run directly
if (require.main === module) {
    startServer();
}

module.exports = { startServer };