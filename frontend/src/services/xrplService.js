import { Client, Wallet } from 'xrpl';

class XRPLService {
  constructor() {
    this.client = null;
    this.wallet = null;
    this.connected = false;
    this.serverUrl = 'wss://s.devnet.rippletest.net:51233';
  }

  async connect() {
    try {
      if (!this.client) {
        this.client = new Client(this.serverUrl);
      }

      if (!this.connected) {
        await this.client.connect();
        this.connected = true;
        console.log('Connected to XRPL Devnet');
      }

      return this.client;
    } catch (error) {
      console.error('Failed to connect to XRPL:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client && this.connected) {
      await this.client.disconnect();
      this.connected = false;
    }
  }

  // Connect wallet (for testing - in production use actual wallet like Crossmark)
  async connectTestWallet(seed = null) {
    try {
      await this.connect();

      if (seed) {
        this.wallet = Wallet.fromSeed(seed);
      } else {
        // Generate new test wallet
        this.wallet = Wallet.generate();
        console.log('Generated test wallet:', this.wallet.address);
        console.log('Seed (save this):', this.wallet.seed);

        // Fund the test wallet
        await this.fundTestWallet();
      }

      return {
        address: this.wallet.address,
        seed: this.wallet.seed
      };
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    }
  }

  async fundTestWallet() {
    try {
      if (!this.wallet) {
        throw new Error('No wallet connected');
      }

      console.log('Funding test wallet...');
      await this.client.fundWallet(this.wallet);
      console.log('Test wallet funded successfully');
    } catch (error) {
      console.error('Failed to fund test wallet:', error);
      throw error;
    }
  }

  // Sign transaction
  async signTransaction(transaction) {
    try {
      if (!this.wallet) {
        throw new Error('No wallet connected');
      }

      const signed = this.wallet.sign(transaction);
      return signed;
    } catch (error) {
      console.error('Failed to sign transaction:', error);
      throw error;
    }
  }

  // Submit signed transaction
  async submitTransaction(signedTransaction) {
    try {
      if (!this.client) {
        throw new Error('XRPL client not connected');
      }

      const result = await this.client.submitAndWait(signedTransaction);
      return result;
    } catch (error) {
      console.error('Failed to submit transaction:', error);
      throw error;
    }
  }

  // Get account balance
  async getBalance(address) {
    try {
      if (!this.client) {
        await this.connect();
      }

      const response = await this.client.request({
        command: 'account_info',
        account: address,
        ledger_index: 'validated'
      });

      const drops = response.result.account_data.Balance;
      return parseFloat(drops) / 1000000; // Convert drops to XRP
    } catch (error) {
      console.error('Failed to get balance:', error);
      return 0;
    }
  }

  // Generate authentication challenge
  generateAuthChallenge(walletAddress) {
    const timestamp = Date.now();
    const challengeMessage = `AgentTrust Authentication: ${timestamp}`;
    return {
      message: challengeMessage,
      timestamp
    };
  }

  // Sign authentication challenge
  async signAuthChallenge(challenge) {
    try {
      if (!this.wallet) {
        throw new Error('No wallet connected');
      }

      // For XRPL authentication, we'll use a simple approach without custom transaction types
      // Create a hash of the challenge message combined with wallet info for authentication
      const encoder = new TextEncoder();
      const messageBytes = encoder.encode(challenge.message);
      const messageHex = Array.from(messageBytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();

      // Create a simple signature by combining wallet address, public key, and message
      // In a production environment, you would use proper cryptographic signing
      const authData = {
        address: this.wallet.address,
        publicKey: this.wallet.publicKey,
        message: challenge.message,
        timestamp: challenge.timestamp
      };

      // Create a signature-like string for authentication
      const authString = JSON.stringify(authData);
      const authBytes = encoder.encode(authString);
      const signature = Array.from(authBytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();

      return signature;
    } catch (error) {
      console.error('Failed to sign challenge:', error);
      throw error;
    }
  }

  getWalletAddress() {
    return this.wallet?.address || null;
  }

  isConnected() {
    return this.connected && this.wallet !== null;
  }
}

// Create singleton instance
const xrplService = new XRPLService();

export default xrplService;