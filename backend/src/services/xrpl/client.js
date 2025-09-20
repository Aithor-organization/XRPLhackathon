const xrpl = require('xrpl');

class XRPLClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 seconds
        this.serverUrl = process.env.XRPL_SERVER || 'wss://s.devnet.rippletest.net:51233';

        console.log(`XRPL Client initialized for ${this.serverUrl}`);
    }

    async connect() {
        try {
            if (this.isConnected) {
                console.log('XRPL client is already connected');
                return this.client;
            }

            console.log(`Connecting to XRPL server: ${this.serverUrl}`);
            this.client = new xrpl.Client(this.serverUrl);

            // Set up event listeners
            this.client.on('connected', () => {
                console.log('✅ Connected to XRPL');
                this.isConnected = true;
                this.reconnectAttempts = 0;
            });

            this.client.on('disconnected', (code) => {
                console.log(`❌ Disconnected from XRPL (code: ${code})`);
                this.isConnected = false;
                this.handleReconnection();
            });

            this.client.on('error', (error) => {
                console.error('XRPL client error:', error);
                this.isConnected = false;
            });

            await this.client.connect();
            return this.client;

        } catch (error) {
            console.error('Failed to connect to XRPL:', error.message);
            this.isConnected = false;
            throw error;
        }
    }

    async handleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
            return;
        }

        this.reconnectAttempts++;
        console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(async () => {
            try {
                await this.connect();
            } catch (error) {
                console.error('Reconnection failed:', error.message);
            }
        }, this.reconnectDelay);
    }

    async disconnect() {
        try {
            if (this.client && this.isConnected) {
                await this.client.disconnect();
                console.log('XRPL client disconnected');
            }
        } catch (error) {
            console.error('Error disconnecting XRPL client:', error.message);
        } finally {
            this.isConnected = false;
            this.client = null;
        }
    }

    getClient() {
        if (!this.isConnected || !this.client) {
            throw new Error('XRPL client is not connected. Call connect() first.');
        }
        return this.client;
    }

    isClientConnected() {
        return this.isConnected && this.client !== null;
    }

    async submitAndWait(transaction) {
        try {
            const client = this.getClient();
            console.log('Submitting transaction to XRPL...');

            const response = await client.submitAndWait(transaction);

            if (response.result.meta.TransactionResult !== 'tesSUCCESS') {
                throw new Error(`Transaction failed: ${response.result.meta.TransactionResult}`);
            }

            console.log('✅ Transaction submitted successfully');
            return response;

        } catch (error) {
            console.error('Transaction submission failed:', error.message);
            throw error;
        }
    }

    async getAccountInfo(address) {
        try {
            const client = this.getClient();
            return await client.request({
                command: 'account_info',
                account: address,
                ledger_index: 'validated'
            });
        } catch (error) {
            console.error(`Failed to get account info for ${address}:`, error.message);
            throw error;
        }
    }

    async getAccountObjects(address, type = null) {
        try {
            const client = this.getClient();
            const request = {
                command: 'account_objects',
                account: address,
                ledger_index: 'validated'
            };

            if (type) {
                request.type = type;
            }

            return await client.request(request);
        } catch (error) {
            console.error(`Failed to get account objects for ${address}:`, error.message);
            throw error;
        }
    }

    async getTransaction(hash) {
        try {
            const client = this.getClient();
            return await client.request({
                command: 'tx',
                transaction: hash
            });
        } catch (error) {
            console.error(`Failed to get transaction ${hash}:`, error.message);
            throw error;
        }
    }

    async getLedgerEntry(index) {
        try {
            const client = this.getClient();
            return await client.request({
                command: 'ledger_entry',
                index: index
            });
        } catch (error) {
            console.error(`Failed to get ledger entry ${index}:`, error.message);
            throw error;
        }
    }

    // Utility method to check if an address is valid
    isValidAddress(address) {
        try {
            return xrpl.isValidClassicAddress(address);
        } catch (error) {
            return false;
        }
    }

    // Utility method to convert XRP to drops
    xrpToDrops(xrp) {
        return xrpl.xrpToDrops(xrp);
    }

    // Utility method to convert drops to XRP
    dropsToXrp(drops) {
        return xrpl.dropsToXrp(drops);
    }
}

// Create singleton instance
const xrplClient = new XRPLClient();

module.exports = xrplClient;