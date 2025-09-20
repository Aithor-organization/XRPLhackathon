const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./services/logger');
const {
    errorHandler,
    notFoundHandler,
    setupGlobalErrorHandlers
} = require('./middleware/errorHandler');

// Setup global error handlers
setupGlobalErrorHandlers();

const app = express();

// Trust proxy (for rate limiting and IP detection)
if (config.security.trustProxy) {
    app.set('trust proxy', 1);
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
    origin: config.security.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: {
        success: false,
        error: {
            message: 'Too many requests from this IP, please try again later',
            code: 'RATE_LIMIT_EXCEEDED'
        }
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health check
        return req.path === '/health';
    }
});

app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// HTTP request logging
app.use(logger.getHttpLogger());

// Request ID middleware
app.use((req, res, next) => {
    req.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    res.setHeader('X-Request-ID', req.id);
    next();
});

// Response time middleware
app.use((req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        res.setHeader('X-Response-Time', duration);

        logger.logPerformance(
            `${req.method} ${req.path}`,
            duration,
            {
                statusCode: res.statusCode,
                requestId: req.id
            }
        );
    });

    next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const dbConnection = require('./db/connection');
        const dbHealth = await dbConnection.healthCheck();

        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: dbHealth,
            platform: {
                name: config.platform.name,
                version: config.platform.version,
                nodeEnv: config.nodeEnv
            }
        };

        res.json(health);
    } catch (error) {
        logger.logError(error, { endpoint: '/health' });

        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// API routes placeholder
app.use('/api', (req, res, next) => {
    // Route mounting will happen here
    res.json({
        success: true,
        message: 'AgentTrust API is running',
        version: config.platform.version,
        endpoints: [
            'POST /api/auth/wallet',
            'GET /api/agents',
            'POST /api/agents',
            'GET /api/agents/:id',
            'POST /api/agents/:id/purchase',
            'POST /api/reviews',
            'GET /api/downloads/:token',
            'POST /api/downloads/request',
            'GET /api/users/mypage'
        ]
    });
});

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

module.exports = app;