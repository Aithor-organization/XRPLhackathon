const logger = require('../services/logger');
const config = require('../config');

// Custom error classes
class AppError extends Error {
    constructor(message, statusCode, code = null) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(message, field = null) {
        super(message, 400, 'VALIDATION_ERROR');
        this.field = field;
    }
}

class AuthenticationError extends AppError {
    constructor(message = 'Authentication failed') {
        super(message, 401, 'AUTHENTICATION_ERROR');
    }
}

class AuthorizationError extends AppError {
    constructor(message = 'Access denied') {
        super(message, 403, 'AUTHORIZATION_ERROR');
    }
}

class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND_ERROR');
    }
}

class ConflictError extends AppError {
    constructor(message = 'Resource conflict') {
        super(message, 409, 'CONFLICT_ERROR');
    }
}

class XRPLError extends AppError {
    constructor(message, originalError = null) {
        super(`XRPL Error: ${message}`, 500, 'XRPL_ERROR');
        this.originalError = originalError;
    }
}

class DatabaseError extends AppError {
    constructor(message, originalError = null) {
        super(`Database Error: ${message}`, 500, 'DATABASE_ERROR');
        this.originalError = originalError;
    }
}

// Error handling functions
function handleXRPLError(error) {
    logger.logError(error, { type: 'XRPL_ERROR' });

    // Handle specific XRPL error types
    if (error.data) {
        const xrplData = error.data;

        switch (xrplData.error) {
            case 'actNotFound':
                return new NotFoundError('XRPL account not found');
            case 'tecINSUF_RESERVE_ACCOUNT':
                return new ValidationError('Insufficient XRP balance for account reserve');
            case 'tecINSUFFICIENT_RESERVE':
                return new ValidationError('Insufficient reserve for transaction');
            case 'tecNO_DST_INSUF_XRP':
                return new ValidationError('Destination account requires minimum XRP balance');
            case 'tecUNFUNDED_PAYMENT':
                return new ValidationError('Insufficient funds for payment');
            case 'tecNO_PERMISSION':
                return new AuthorizationError('XRPL operation not permitted');
            case 'temINVALID':
                return new ValidationError('Invalid XRPL transaction format');
            default:
                return new XRPLError(xrplData.error_message || 'Unknown XRPL error', error);
        }
    }

    // Handle network errors
    if (error.message.includes('connection') || error.message.includes('network')) {
        return new AppError('XRPL network connection error', 503, 'NETWORK_ERROR');
    }

    return new XRPLError(error.message, error);
}

function handleDatabaseError(error) {
    logger.logError(error, { type: 'DATABASE_ERROR' });

    // Handle SQLite specific errors
    if (error.code) {
        switch (error.code) {
            case 'SQLITE_CONSTRAINT_UNIQUE':
                return new ConflictError('Resource already exists');
            case 'SQLITE_CONSTRAINT_FOREIGNKEY':
                return new ValidationError('Referenced resource does not exist');
            case 'SQLITE_CONSTRAINT_NOTNULL':
                return new ValidationError('Required field is missing');
            case 'SQLITE_BUSY':
                return new AppError('Database is temporarily busy', 503, 'DATABASE_BUSY');
            case 'SQLITE_LOCKED':
                return new AppError('Database is locked', 503, 'DATABASE_LOCKED');
            default:
                return new DatabaseError(error.message, error);
        }
    }

    return new DatabaseError(error.message, error);
}

function handleJWTError(error) {
    logger.logSecurity('JWT_ERROR', { message: error.message });

    switch (error.name) {
        case 'TokenExpiredError':
            return new AuthenticationError('Access token has expired');
        case 'JsonWebTokenError':
            return new AuthenticationError('Invalid access token');
        case 'NotBeforeError':
            return new AuthenticationError('Access token not active yet');
        default:
            return new AuthenticationError('Token validation failed');
    }
}

function handleValidationError(error) {
    // Handle various validation library errors
    if (error.isJoi) {
        // Joi validation error
        const message = error.details.map(detail => detail.message).join(', ');
        return new ValidationError(message);
    }

    if (error.name === 'ValidationError') {
        return new ValidationError(error.message);
    }

    return new ValidationError('Validation failed');
}

// Main error handler middleware
function errorHandler(error, req, res, next) {
    let handledError = error;

    // Convert non-operational errors to operational ones
    if (!error.isOperational) {
        // Handle specific error types
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' || error.name === 'NotBeforeError') {
            handledError = handleJWTError(error);
        } else if (error.code && error.code.startsWith('SQLITE_')) {
            handledError = handleDatabaseError(error);
        } else if (error.data && error.data.error) {
            handledError = handleXRPLError(error);
        } else if (error.isJoi || error.name === 'ValidationError') {
            handledError = handleValidationError(error);
        } else {
            // Unknown error
            logger.logError(error, {
                type: 'UNKNOWN_ERROR',
                url: req.url,
                method: req.method,
                ip: req.ip
            });

            handledError = new AppError(
                config.isDevelopment() ? error.message : 'Internal server error',
                500,
                'INTERNAL_ERROR'
            );
        }
    }

    // Log the error
    logger.logError(handledError, {
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        statusCode: handledError.statusCode
    });

    // Prepare error response
    const errorResponse = {
        success: false,
        error: {
            message: handledError.message,
            code: handledError.code,
            statusCode: handledError.statusCode
        }
    };

    // Add additional details in development
    if (config.isDevelopment()) {
        errorResponse.error.stack = handledError.stack;

        if (handledError.originalError) {
            errorResponse.error.originalError = {
                message: handledError.originalError.message,
                stack: handledError.originalError.stack
            };
        }

        if (handledError.field) {
            errorResponse.error.field = handledError.field;
        }
    }

    // Send error response
    res.status(handledError.statusCode || 500).json(errorResponse);
}

// 404 handler for unmatched routes
function notFoundHandler(req, res, next) {
    const error = new NotFoundError(`Route ${req.method} ${req.url}`);
    next(error);
}

// Async error wrapper
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// Global uncaught exception handler
function setupGlobalErrorHandlers() {
    process.on('uncaughtException', (error) => {
        logger.logError(error, { type: 'UNCAUGHT_EXCEPTION' });
        console.error('Uncaught Exception:', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.logError(new Error(reason), {
            type: 'UNHANDLED_REJECTION',
            promise: promise.toString()
        });
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        process.exit(1);
    });
}

module.exports = {
    // Error classes
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    XRPLError,
    DatabaseError,

    // Middleware functions
    errorHandler,
    notFoundHandler,
    asyncHandler,

    // Utility functions
    handleXRPLError,
    handleDatabaseError,
    handleJWTError,
    handleValidationError,
    setupGlobalErrorHandlers
};