const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const config = require('../config');

class Logger {
    constructor() {
        this.logLevel = config.logging.level;
        this.logFile = config.logging.file;
        this.logLevels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };

        this.initializeLogFile();
        console.log(`Logger initialized with level: ${this.logLevel}`);
    }

    initializeLogFile() {
        try {
            const logDir = path.dirname(this.logFile);

            // Create logs directory if it doesn't exist
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
                console.log(`Created log directory: ${logDir}`);
            }

            // Create log file if it doesn't exist
            if (!fs.existsSync(this.logFile)) {
                fs.writeFileSync(this.logFile, '');
                console.log(`Created log file: ${this.logFile}`);
            }

        } catch (error) {
            console.error('Failed to initialize log file:', error.message);
        }
    }

    shouldLog(level) {
        const currentLevelValue = this.logLevels[this.logLevel] || 2;
        const messageLevelValue = this.logLevels[level] || 2;
        return messageLevelValue <= currentLevelValue;
    }

    formatMessage(level, message, metadata = {}) {
        const timestamp = new Date().toISOString();
        const pid = process.pid;

        let logEntry = `[${timestamp}] [${level.toUpperCase()}] [PID:${pid}] ${message}`;

        // Add metadata if provided
        if (Object.keys(metadata).length > 0) {
            logEntry += ` | ${JSON.stringify(metadata)}`;
        }

        return logEntry;
    }

    writeToFile(message) {
        try {
            fs.appendFileSync(this.logFile, message + '\n');
        } catch (error) {
            console.error('Failed to write to log file:', error.message);
        }
    }

    log(level, message, metadata = {}) {
        if (!this.shouldLog(level)) {
            return;
        }

        const formattedMessage = this.formatMessage(level, message, metadata);

        // Always write to file
        this.writeToFile(formattedMessage);

        // Write to console based on level
        switch (level) {
            case 'error':
                console.error(formattedMessage);
                break;
            case 'warn':
                console.warn(formattedMessage);
                break;
            case 'info':
                console.info(formattedMessage);
                break;
            case 'debug':
                console.debug(formattedMessage);
                break;
            default:
                console.log(formattedMessage);
        }
    }

    error(message, metadata = {}) {
        this.log('error', message, metadata);
    }

    warn(message, metadata = {}) {
        this.log('warn', message, metadata);
    }

    info(message, metadata = {}) {
        this.log('info', message, metadata);
    }

    debug(message, metadata = {}) {
        this.log('debug', message, metadata);
    }

    // HTTP Request logging with Morgan
    getHttpLogger() {
        // Custom token for response time
        morgan.token('response-time-ms', (req, res) => {
            const responseTime = res.get('X-Response-Time');
            return responseTime ? `${responseTime}ms` : '-';
        });

        // Custom format
        const format = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" - :response-time ms';

        return morgan(format, {
            stream: {
                write: (message) => {
                    // Remove newline and log as info
                    this.info(`HTTP: ${message.trim()}`);
                }
            }
        });
    }

    // Log HTTP request details
    logRequest(req, additionalInfo = {}) {
        const requestInfo = {
            method: req.method,
            url: req.url,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            ...additionalInfo
        };

        this.info('Incoming request', requestInfo);
    }

    // Log HTTP response details
    logResponse(req, res, additionalInfo = {}) {
        const responseInfo = {
            method: req.method,
            url: req.url,
            status: res.statusCode,
            responseTime: res.get('X-Response-Time'),
            ...additionalInfo
        };

        const level = res.statusCode >= 400 ? 'warn' : 'info';
        this.log(level, 'Response sent', responseInfo);
    }

    // Log XRPL transactions
    logTransaction(type, transactionData) {
        this.info(`XRPL Transaction: ${type}`, {
            type,
            ...transactionData
        });
    }

    // Log database operations
    logDatabase(operation, table, additionalInfo = {}) {
        this.debug(`Database operation: ${operation}`, {
            operation,
            table,
            ...additionalInfo
        });
    }

    // Log authentication events
    logAuth(event, walletAddress, additionalInfo = {}) {
        this.info(`Auth event: ${event}`, {
            event,
            wallet: walletAddress,
            ...additionalInfo
        });
    }

    // Log errors with stack trace
    logError(error, context = {}) {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            ...context
        };

        this.error('Application error', errorInfo);
    }

    // Performance logging
    logPerformance(operation, duration, additionalInfo = {}) {
        this.info(`Performance: ${operation}`, {
            operation,
            duration: `${duration}ms`,
            ...additionalInfo
        });
    }

    // Security logging
    logSecurity(event, details = {}) {
        this.warn(`Security event: ${event}`, {
            event,
            timestamp: new Date().toISOString(),
            ...details
        });
    }

    // Clean up old log files (optional)
    async rotateLog(maxSizeBytes = 10 * 1024 * 1024) { // 10MB default
        try {
            const stats = fs.statSync(this.logFile);

            if (stats.size > maxSizeBytes) {
                const backupFile = `${this.logFile}.${Date.now()}.backup`;
                fs.renameSync(this.logFile, backupFile);
                fs.writeFileSync(this.logFile, '');

                this.info('Log file rotated', {
                    oldFile: backupFile,
                    newFile: this.logFile,
                    size: stats.size
                });
            }
        } catch (error) {
            console.error('Failed to rotate log file:', error.message);
        }
    }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;