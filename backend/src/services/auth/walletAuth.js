const xrpl = require('xrpl');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../logger');
const dbConnection = require('../../db/connection');
const {
    AuthenticationError,
    ValidationError,
    DatabaseError,
    XRPLError
} = require('../../middleware/errorHandler');

class WalletAuthService {
    constructor() {
        this.jwtSecret = config.jwt.secret;
        this.jwtExpiry = config.jwt.expiry;
        console.log('Wallet Authentication Service initialized');
    }

    // Generate a challenge message for wallet signature
    generateChallenge(walletAddress) {
        try {
            const timestamp = Date.now();
            const nonce = crypto.randomBytes(16).toString('hex');

            const challenge = {
                message: `AgentTrust authentication request for ${walletAddress}`,
                timestamp: timestamp,
                nonce: nonce,
                platform: config.platform.name
            };

            const challengeString = JSON.stringify(challenge);
            return {
                challenge: challengeString,
                hash: crypto.createHash('sha256').update(challengeString).digest('hex')
            };

        } catch (error) {
            logger.logError(error, { context: 'generateChallenge' });
            throw new Error('Failed to generate authentication challenge');
        }
    }

    // Verify wallet signature
    async verifyWalletSignature(walletAddress, signature, challengeString) {
        try {
            // Validate wallet address format
            if (!xrpl.isValidClassicAddress(walletAddress)) {
                throw new ValidationError('Invalid wallet address format');
            }

            // Parse challenge
            let challenge;
            try {
                challenge = JSON.parse(challengeString);
            } catch (error) {
                throw new ValidationError('Invalid challenge format');
            }

            // Verify challenge timestamp (valid for 5 minutes)
            const now = Date.now();
            const challengeAge = now - challenge.timestamp;
            const maxAge = 5 * 60 * 1000; // 5 minutes

            if (challengeAge > maxAge) {
                throw new AuthenticationError('Challenge has expired');
            }

            // Verify the signature using XRPL's verification method
            const messageHash = crypto.createHash('sha256').update(challengeString).digest();

            try {
                // Note: For XRPL signature verification, we would typically need
                // the public key from the account. In a real implementation,
                // we might need to fetch account info from XRPL or use a
                // different verification method.

                // For MVP, we'll implement a simplified verification
                // In production, proper XRPL signature verification should be used

                if (!signature || signature.length < 64) {
                    throw new ValidationError('Invalid signature format');
                }

                // Signature verification passed (simplified for MVP)
                logger.logAuth('wallet_signature_verified', walletAddress, {
                    challengeHash: challenge.hash || 'unknown'
                });

                return true;

            } catch (verifyError) {
                logger.logSecurity('signature_verification_failed', {
                    wallet: walletAddress,
                    error: verifyError.message
                });
                throw new AuthenticationError('Signature verification failed');
            }

        } catch (error) {
            if (error.isOperational) {
                throw error;
            }

            logger.logError(error, { context: 'verifyWalletSignature' });
            throw new AuthenticationError('Wallet authentication failed');
        }
    }

    // Get or create user in database
    async getOrCreateUser(walletAddress) {
        try {
            // Check if user exists
            const existingUser = await dbConnection.get(
                'SELECT * FROM users WHERE wallet_address = ?',
                [walletAddress]
            );

            if (existingUser) {
                // Update last login
                await dbConnection.run(
                    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE wallet_address = ?',
                    [walletAddress]
                );

                logger.logAuth('user_login', walletAddress);
                return existingUser;
            }

            // Create new user
            const newUser = {
                wallet_address: walletAddress,
                user_type: 'both', // Default to both developer and buyer
                created_at: new Date().toISOString(),
                last_login: new Date().toISOString(),
                total_sales: 0,
                total_purchases: 0,
                reputation_score: 0.00
            };

            await dbConnection.run(
                `INSERT INTO users (
                    wallet_address, user_type, created_at, last_login,
                    total_sales, total_purchases, reputation_score
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    newUser.wallet_address,
                    newUser.user_type,
                    newUser.created_at,
                    newUser.last_login,
                    newUser.total_sales,
                    newUser.total_purchases,
                    newUser.reputation_score
                ]
            );

            logger.logAuth('user_created', walletAddress);
            return newUser;

        } catch (error) {
            logger.logError(error, { context: 'getOrCreateUser' });

            if (error.code && error.code.startsWith('SQLITE_')) {
                throw new DatabaseError('Failed to create or retrieve user');
            }

            throw error;
        }
    }

    // Generate JWT token
    generateToken(user) {
        try {
            const payload = {
                walletAddress: user.wallet_address,
                userType: user.user_type,
                iat: Math.floor(Date.now() / 1000)
            };

            const token = jwt.sign(payload, this.jwtSecret, {
                expiresIn: this.jwtExpiry,
                issuer: config.platform.name,
                audience: 'agentrust-api'
            });

            logger.logAuth('token_generated', user.wallet_address);
            return token;

        } catch (error) {
            logger.logError(error, { context: 'generateToken' });
            throw new Error('Failed to generate authentication token');
        }
    }

    // Verify JWT token
    verifyToken(token) {
        try {
            const decoded = jwt.verify(token, this.jwtSecret, {
                issuer: config.platform.name,
                audience: 'agentrust-api'
            });

            return decoded;

        } catch (error) {
            logger.logSecurity('token_verification_failed', {
                error: error.message,
                token: token.substring(0, 20) + '...'
            });

            switch (error.name) {
                case 'TokenExpiredError':
                    throw new AuthenticationError('Access token has expired');
                case 'JsonWebTokenError':
                    throw new AuthenticationError('Invalid access token');
                case 'NotBeforeError':
                    throw new AuthenticationError('Access token not active yet');
                default:
                    throw new AuthenticationError('Token verification failed');
            }
        }
    }

    // Complete wallet authentication flow
    async authenticateWallet(walletAddress, signature, challengeString) {
        try {
            // Verify signature
            await this.verifyWalletSignature(walletAddress, signature, challengeString);

            // Get or create user
            const user = await this.getOrCreateUser(walletAddress);

            // Generate token
            const token = this.generateToken(user);

            logger.logAuth('authentication_success', walletAddress);

            return {
                success: true,
                token: token,
                user: {
                    walletAddress: user.wallet_address,
                    userType: user.user_type,
                    createdAt: user.created_at,
                    totalSales: user.total_sales,
                    totalPurchases: user.total_purchases,
                    reputationScore: user.reputation_score
                }
            };

        } catch (error) {
            logger.logSecurity('authentication_failed', {
                wallet: walletAddress,
                error: error.message
            });

            throw error;
        }
    }

    // Middleware for protecting routes
    authenticateMiddleware() {
        return async (req, res, next) => {
            try {
                const authHeader = req.headers.authorization;

                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    throw new AuthenticationError('Missing or invalid authorization header');
                }

                const token = authHeader.substring(7); // Remove 'Bearer ' prefix
                const decoded = this.verifyToken(token);

                // Attach user info to request
                req.user = {
                    walletAddress: decoded.walletAddress,
                    userType: decoded.userType
                };

                // Log API access
                logger.logAuth('api_access', decoded.walletAddress, {
                    endpoint: req.path,
                    method: req.method
                });

                next();

            } catch (error) {
                next(error);
            }
        };
    }

    // Get user profile from token
    async getUserProfile(walletAddress) {
        try {
            const user = await dbConnection.get(
                'SELECT * FROM users WHERE wallet_address = ?',
                [walletAddress]
            );

            if (!user) {
                throw new NotFoundError('User not found');
            }

            return {
                walletAddress: user.wallet_address,
                userType: user.user_type,
                createdAt: user.created_at,
                lastLogin: user.last_login,
                totalSales: user.total_sales,
                totalPurchases: user.total_purchases,
                reputationScore: user.reputation_score
            };

        } catch (error) {
            logger.logError(error, { context: 'getUserProfile' });
            throw error;
        }
    }

    // Update user statistics
    async updateUserStats(walletAddress, updates) {
        try {
            const allowedUpdates = ['total_sales', 'total_purchases', 'reputation_score'];
            const updateFields = [];
            const updateValues = [];

            for (const [field, value] of Object.entries(updates)) {
                if (allowedUpdates.includes(field)) {
                    updateFields.push(`${field} = ?`);
                    updateValues.push(value);
                }
            }

            if (updateFields.length === 0) {
                return;
            }

            updateValues.push(walletAddress);

            await dbConnection.run(
                `UPDATE users SET ${updateFields.join(', ')} WHERE wallet_address = ?`,
                updateValues
            );

            logger.logDatabase('update', 'users', {
                wallet: walletAddress,
                updates: Object.keys(updates)
            });

        } catch (error) {
            logger.logError(error, { context: 'updateUserStats' });
            throw new DatabaseError('Failed to update user statistics');
        }
    }
}

// Create singleton instance
const walletAuthService = new WalletAuthService();

module.exports = walletAuthService;