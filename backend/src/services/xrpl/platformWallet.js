const xrpl = require('xrpl');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const xrplClient = require('./client');

class PlatformWalletService {
    constructor() {
        this.wallet = null;
        this.isInitialized = false;
        console.log('Platform Wallet Service initialized');
    }

    async initialize() {
        try {
            if (this.isInitialized) {
                console.log('Platform wallet is already initialized');
                return this.wallet;
            }

            // Check if we have a platform wallet seed in config
            if (config.xrpl.platformWalletSeed) {
                console.log('Loading platform wallet from seed...');
                this.wallet = xrpl.Wallet.fromSeed(config.xrpl.platformWalletSeed);
            } else {
                console.log('No platform wallet seed found, generating new wallet...');
                this.wallet = xrpl.Wallet.generate();

                // Save the seed to .env file for future use
                await this.saveSeedToEnv(this.wallet.seed);

                console.log('🔑 New platform wallet generated');
                console.log(`Address: ${this.wallet.address}`);
                console.log(`⚠️  Seed saved to .env file. Keep it secure!`);
            }

            // Ensure XRPL client is connected
            await xrplClient.connect();

            // Check wallet balance and fund if necessary
            await this.ensureWalletFunded();

            this.isInitialized = true;
            console.log('✅ Platform wallet initialized successfully');
            console.log(`Platform wallet address: ${this.wallet.address}`);

            return this.wallet;

        } catch (error) {
            console.error('Failed to initialize platform wallet:', error.message);
            throw error;
        }
    }

    async ensureWalletFunded() {
        try {
            console.log('Checking platform wallet balance...');

            const response = await xrplClient.getAccountInfo(this.wallet.address);
            const balance = xrpl.dropsToXrp(response.result.account_data.Balance);

            console.log(`Current balance: ${balance} XRP`);

            // If balance is less than 100 XRP, fund from faucet
            if (parseFloat(balance) < 100) {
                console.log('Balance is low, requesting funds from faucet...');
                await this.fundFromFaucet();
            } else {
                console.log('✅ Platform wallet has sufficient funds');
            }

        } catch (error) {
            if (error.data && error.data.error === 'actNotFound') {
                console.log('Account not found, requesting initial funding from faucet...');
                await this.fundFromFaucet();
            } else {
                console.error('Error checking wallet balance:', error.message);
                throw error;
            }
        }
    }

    async fundFromFaucet() {
        try {
            console.log('Requesting funds from XRPL testnet faucet...');

            // Use fetch to call the faucet API directly
            const faucetUrl = 'https://faucet.devnet.rippletest.net/accounts';
            const response = await fetch(faucetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    destination: this.wallet.address
                })
            });

            if (!response.ok) {
                throw new Error(`Faucet request failed: ${response.statusText}`);
            }

            const result = await response.json();

            console.log('✅ Wallet funded successfully');
            console.log(`Account: ${result.account}`);
            console.log(`Amount: ${result.amount} XRP`);

            // Wait for the transaction to be confirmed
            await new Promise(resolve => setTimeout(resolve, 3000));

            return result;

        } catch (error) {
            console.error('Failed to fund wallet from faucet:', error.message);
            throw error;
        }
    }

    async saveSeedToEnv(seed) {
        try {
            const envPath = path.join(process.cwd(), '.env');
            let envContent = '';

            // Read existing .env file if it exists
            if (fs.existsSync(envPath)) {
                envContent = fs.readFileSync(envPath, 'utf8');
            }

            // Check if PLATFORM_WALLET_SEED already exists
            if (envContent.includes('PLATFORM_WALLET_SEED=')) {
                // Update existing line
                envContent = envContent.replace(
                    /PLATFORM_WALLET_SEED=.*/,
                    `PLATFORM_WALLET_SEED=${seed}`
                );
            } else {
                // Add new line
                envContent += `\nPLATFORM_WALLET_SEED=${seed}\n`;
            }

            fs.writeFileSync(envPath, envContent);
            console.log('💾 Platform wallet seed saved to .env file');

        } catch (error) {
            console.error('Failed to save seed to .env file:', error.message);
            // Don't throw here - this is not critical for operation
        }
    }

    getWallet() {
        if (!this.isInitialized || !this.wallet) {
            throw new Error('Platform wallet is not initialized. Call initialize() first.');
        }
        return this.wallet;
    }

    getAddress() {
        return this.getWallet().address;
    }

    async getBalance() {
        try {
            const response = await xrplClient.getAccountInfo(this.getAddress());
            return xrpl.dropsToXrp(response.result.account_data.Balance);
        } catch (error) {
            console.error('Failed to get platform wallet balance:', error.message);
            throw error;
        }
    }

    async signTransaction(transaction) {
        try {
            const wallet = this.getWallet();
            const signed = wallet.sign(transaction);

            console.log('Transaction signed by platform wallet');
            return signed;

        } catch (error) {
            console.error('Failed to sign transaction:', error.message);
            throw error;
        }
    }

    // Create a payment transaction from platform wallet
    async createPaymentTransaction(destinationAddress, amountXRP, memo = null) {
        try {
            const wallet = this.getWallet();

            const payment = {
                TransactionType: 'Payment',
                Account: wallet.address,
                Destination: destinationAddress,
                Amount: xrpl.xrpToDrops(amountXRP.toString())
            };

            // Add memo if provided
            if (memo) {
                payment.Memos = [{
                    Memo: {
                        MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase()
                    }
                }];
            }

            // Auto-fill the transaction
            const client = xrplClient.getClient();
            const prepared = await client.autofill(payment);

            return prepared;

        } catch (error) {
            console.error('Failed to create payment transaction:', error.message);
            throw error;
        }
    }

    // Submit and wait for a transaction
    async submitTransaction(transaction) {
        try {
            const signed = await this.signTransaction(transaction);
            const response = await xrplClient.submitAndWait(signed.tx_blob);

            return response;

        } catch (error) {
            console.error('Failed to submit transaction:', error.message);
            throw error;
        }
    }
}

// Create singleton instance
const platformWalletService = new PlatformWalletService();

module.exports = platformWalletService;