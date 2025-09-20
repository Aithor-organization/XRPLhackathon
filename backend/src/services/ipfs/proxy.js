const https = require('https');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../logger');
const {
    ValidationError,
    NotFoundError,
    AppError
} = require('../../middleware/errorHandler');

class IPFSProxyService {
    constructor() {
        this.gatewayUrl = config.ipfs.gatewayUrl;
        this.backupGateway = config.ipfs.backupGateway;
        this.timeout = 30000; // 30 seconds
        this.maxRedirects = 5;
        this.cache = new Map(); // Simple in-memory cache
        this.maxCacheSize = 100;
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes

        console.log(`IPFS Proxy Service initialized with gateway: ${this.gatewayUrl}`);
    }

    // Validate IPFS hash format
    validateIPFSHash(hash) {
        if (!hash || typeof hash !== 'string') {
            throw new ValidationError('IPFS hash is required');
        }

        // Validate IPFS hash format (Qm followed by 44 characters)
        if (!config.validation.ipfsHashRegex.test(hash)) {
            throw new ValidationError('Invalid IPFS hash format');
        }

        return true;
    }

    // Generate cache key
    getCacheKey(hash, range = null) {
        const key = range ? `${hash}_${range}` : hash;
        return crypto.createHash('md5').update(key).digest('hex');
    }

    // Get from cache
    getFromCache(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;

        const now = Date.now();
        if (now - cached.timestamp > this.cacheTimeout) {
            this.cache.delete(key);
            return null;
        }

        return cached.data;
    }

    // Store in cache
    storeInCache(key, data) {
        // Clean cache if it's getting too large
        if (this.cache.size >= this.maxCacheSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    // Build IPFS URL
    buildIPFSUrl(hash, gateway = null) {
        const baseUrl = gateway || this.gatewayUrl;
        return `${baseUrl}${hash}`;
    }

    // Make HTTP request with timeout and retry logic
    async makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const requestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname + parsedUrl.search,
                method: options.method || 'GET',
                headers: options.headers || {},
                timeout: this.timeout
            };

            const request = httpModule.request(requestOptions, (response) => {
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    if ((options.redirectCount || 0) >= this.maxRedirects) {
                        reject(new AppError('Too many redirects', 502));
                        return;
                    }

                    const redirectOptions = {
                        ...options,
                        redirectCount: (options.redirectCount || 0) + 1
                    };

                    this.makeRequest(response.headers.location, redirectOptions)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                // Collect response data
                const chunks = [];
                response.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                response.on('end', () => {
                    const data = Buffer.concat(chunks);
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        data: data
                    });
                });

                response.on('error', (error) => {
                    reject(error);
                });
            });

            request.on('timeout', () => {
                request.destroy();
                reject(new AppError('Request timeout', 504));
            });

            request.on('error', (error) => {
                reject(error);
            });

            // Write request body if provided
            if (options.body) {
                request.write(options.body);
            }

            request.end();
        });
    }

    // Fetch content from IPFS with fallback
    async fetchIPFSContent(hash, options = {}) {
        this.validateIPFSHash(hash);

        const cacheKey = this.getCacheKey(hash, options.range);

        // Check cache first
        const cached = this.getFromCache(cacheKey);
        if (cached && !options.noCache) {
            logger.logPerformance('ipfs_cache_hit', 0, { hash });
            return cached;
        }

        const startTime = Date.now();

        try {
            // Try primary gateway first
            const primaryUrl = this.buildIPFSUrl(hash);
            logger.debug('Fetching from primary IPFS gateway', { url: primaryUrl });

            const response = await this.makeRequest(primaryUrl, {
                headers: options.range ? { 'Range': options.range } : {}
            });

            if (response.statusCode === 200 || response.statusCode === 206) {
                const result = {
                    data: response.data,
                    contentType: response.headers['content-type'] || 'application/octet-stream',
                    contentLength: response.headers['content-length'],
                    statusCode: response.statusCode,
                    gateway: 'primary'
                };

                // Cache successful responses
                if (!options.noCache && response.statusCode === 200) {
                    this.storeInCache(cacheKey, result);
                }

                const duration = Date.now() - startTime;
                logger.logPerformance('ipfs_fetch_success', duration, {
                    hash,
                    gateway: 'primary',
                    size: response.data.length
                });

                return result;
            }

            throw new Error(`Primary gateway returned ${response.statusCode}`);

        } catch (primaryError) {
            logger.warn('Primary IPFS gateway failed, trying backup', {
                hash,
                error: primaryError.message
            });

            try {
                // Try backup gateway
                const backupUrl = this.buildIPFSUrl(hash, this.backupGateway);
                logger.debug('Fetching from backup IPFS gateway', { url: backupUrl });

                const response = await this.makeRequest(backupUrl, {
                    headers: options.range ? { 'Range': options.range } : {}
                });

                if (response.statusCode === 200 || response.statusCode === 206) {
                    const result = {
                        data: response.data,
                        contentType: response.headers['content-type'] || 'application/octet-stream',
                        contentLength: response.headers['content-length'],
                        statusCode: response.statusCode,
                        gateway: 'backup'
                    };

                    // Cache successful responses
                    if (!options.noCache && response.statusCode === 200) {
                        this.storeInCache(cacheKey, result);
                    }

                    const duration = Date.now() - startTime;
                    logger.logPerformance('ipfs_fetch_success', duration, {
                        hash,
                        gateway: 'backup',
                        size: response.data.length
                    });

                    return result;
                }

                throw new Error(`Backup gateway returned ${response.statusCode}`);

            } catch (backupError) {
                logger.logError(backupError, {
                    context: 'ipfs_fetch_failed',
                    hash,
                    primaryError: primaryError.message,
                    backupError: backupError.message
                });

                throw new NotFoundError('IPFS content not available from any gateway');
            }
        }
    }

    // Stream IPFS content for downloads
    async streamIPFSContent(hash, res, options = {}) {
        try {
            this.validateIPFSHash(hash);

            const startTime = Date.now();
            logger.info('Starting IPFS stream', { hash });

            // Set appropriate headers
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${hash}.bin"`);
            res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour cache

            // Try to get content length first for progress tracking
            try {
                const headResponse = await this.fetchIPFSContent(hash, { noCache: true });
                if (headResponse.contentLength) {
                    res.setHeader('Content-Length', headResponse.contentLength);
                }

                // Stream the actual data
                res.write(headResponse.data);
                res.end();

                const duration = Date.now() - startTime;
                logger.logPerformance('ipfs_stream_success', duration, {
                    hash,
                    size: headResponse.data.length
                });

                return {
                    success: true,
                    size: headResponse.data.length,
                    duration: duration
                };

            } catch (error) {
                logger.logError(error, { context: 'ipfs_stream_failed', hash });

                if (!res.headersSent) {
                    res.status(404).json({
                        success: false,
                        error: {
                            message: 'IPFS content not found',
                            code: 'IPFS_NOT_FOUND'
                        }
                    });
                }

                throw error;
            }

        } catch (error) {
            logger.logError(error, { context: 'streamIPFSContent', hash });
            throw error;
        }
    }

    // Get IPFS content metadata
    async getContentMetadata(hash) {
        try {
            this.validateIPFSHash(hash);

            // Make HEAD request to get metadata without downloading content
            const primaryUrl = this.buildIPFSUrl(hash);

            const response = await this.makeRequest(primaryUrl, { method: 'HEAD' });

            if (response.statusCode === 200) {
                return {
                    contentType: response.headers['content-type'] || 'application/octet-stream',
                    contentLength: parseInt(response.headers['content-length']) || null,
                    lastModified: response.headers['last-modified'],
                    etag: response.headers['etag'],
                    hash: hash
                };
            }

            throw new NotFoundError('IPFS content metadata not available');

        } catch (error) {
            logger.logError(error, { context: 'getContentMetadata', hash });
            throw error;
        }
    }

    // Verify IPFS hash exists and is accessible
    async verifyIPFSHash(hash) {
        try {
            this.validateIPFSHash(hash);

            const metadata = await this.getContentMetadata(hash);

            logger.info('IPFS hash verified', {
                hash,
                contentType: metadata.contentType,
                size: metadata.contentLength
            });

            return {
                valid: true,
                metadata: metadata
            };

        } catch (error) {
            logger.warn('IPFS hash verification failed', {
                hash,
                error: error.message
            });

            return {
                valid: false,
                error: error.message
            };
        }
    }

    // Clear cache
    clearCache() {
        this.cache.clear();
        logger.info('IPFS proxy cache cleared');
    }

    // Get cache statistics
    getCacheStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxCacheSize,
            timeout: this.cacheTimeout
        };
    }

    // Health check for IPFS gateways
    async healthCheck() {
        const healthResults = {
            primary: { status: 'unknown', responseTime: null, error: null },
            backup: { status: 'unknown', responseTime: null, error: null }
        };

        // Test primary gateway
        try {
            const startTime = Date.now();
            await this.makeRequest(`${this.gatewayUrl}QmTzQ1JRkWErjk39mryYw2WVaphAZNAREyMchXzYQ7c15n`);
            healthResults.primary = {
                status: 'healthy',
                responseTime: Date.now() - startTime,
                error: null
            };
        } catch (error) {
            healthResults.primary = {
                status: 'unhealthy',
                responseTime: null,
                error: error.message
            };
        }

        // Test backup gateway
        try {
            const startTime = Date.now();
            await this.makeRequest(`${this.backupGateway}QmTzQ1JRkWErjk39mryYw2WVaphAZNAREyMchXzYQ7c15n`);
            healthResults.backup = {
                status: 'healthy',
                responseTime: Date.now() - startTime,
                error: null
            };
        } catch (error) {
            healthResults.backup = {
                status: 'unhealthy',
                responseTime: null,
                error: error.message
            };
        }

        return {
            gateways: healthResults,
            cache: this.getCacheStats()
        };
    }
}

// Create singleton instance
const ipfsProxyService = new IPFSProxyService();

module.exports = ipfsProxyService;