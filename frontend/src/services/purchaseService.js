import apiService from './apiService';
import xrplService from './xrplService';

class PurchaseService {
  constructor() {
    this.transactionListeners = new Map();
  }

  // Check if user already has valid credential for this agent
  async checkCredential(agentId, userAddress) {
    try {
      const credentialType = `ML_${agentId.substring(0, 12)}`;

      // Check via backend API
      const response = await apiService.checkCredential(agentId, userAddress);

      if (response.success && response.hasValidCredential) {
        return {
          hasCredential: true,
          credential: response.credential,
          permissions: response.permissions
        };
      }

      return {
        hasCredential: false,
        credential: null,
        permissions: []
      };
    } catch (error) {
      console.error('Failed to check credential:', error);
      return {
        hasCredential: false,
        credential: null,
        permissions: [],
        error: error.message
      };
    }
  }

  // Start purchase flow for users without credentials
  async startPurchaseFlow(agent, userWallet) {
    try {
      const purchaseId = `purchase_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Step 1: Create escrow transaction
      const escrowResult = await this.createEscrow(agent, userWallet, purchaseId);

      if (!escrowResult.success) {
        throw new Error('Failed to create escrow: ' + escrowResult.error);
      }

      // Step 2: Issue credential
      const credentialResult = await this.issueCredential(agent, userWallet.address, purchaseId);

      if (!credentialResult.success) {
        throw new Error('Failed to issue credential: ' + credentialResult.error);
      }

      return {
        success: true,
        purchaseId,
        escrowTxHash: escrowResult.transactionHash,
        credentialTxHash: credentialResult.transactionHash,
        credentialType: credentialResult.credentialType,
        nextStep: 'accept_credential'
      };
    } catch (error) {
      console.error('Purchase flow failed:', error);
      throw error;
    }
  }

  // Create escrow transaction
  async createEscrow(agent, userWallet, purchaseId) {
    try {
      await xrplService.connect();

      if (!xrplService.wallet || xrplService.wallet.address !== userWallet.address) {
        throw new Error('Wallet mismatch');
      }

      // Prepare escrow transaction
      const escrowTx = {
        TransactionType: 'EscrowCreate',
        Account: userWallet.address,
        Destination: agent.creator_address,
        Amount: String(Math.floor(parseFloat(agent.price_xrp) * 1000000)), // Convert XRP to drops
        FinishAfter: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours from now
        DestinationTag: parseInt(agent.id)
      };

      // Submit escrow transaction
      const signedTx = await xrplService.signTransaction(escrowTx);
      const result = await xrplService.submitTransaction(signedTx);

      if (result.result.meta.TransactionResult === 'tesSUCCESS') {
        // Store escrow info in backend
        await apiService.recordEscrow({
          purchaseId,
          agentId: agent.id,
          buyerAddress: userWallet.address,
          sellerAddress: agent.creator_address,
          amount: agent.price_xrp,
          escrowSequence: escrowTx.Sequence,
          transactionHash: result.result.hash
        });

        return {
          success: true,
          transactionHash: result.result.hash,
          escrowSequence: escrowTx.Sequence
        };
      } else {
        throw new Error(`Escrow transaction failed: ${result.result.meta.TransactionResult}`);
      }
    } catch (error) {
      console.error('Failed to create escrow:', error);
      throw error;
    }
  }

  // Issue credential to buyer
  async issueCredential(agent, buyerAddress, purchaseId) {
    try {
      const response = await apiService.issueCredential({
        agentId: agent.id,
        buyerAddress,
        purchaseId,
        credentialType: `ML_${agent.id.substring(0, 12)}`
      });

      return response;
    } catch (error) {
      console.error('Failed to issue credential:', error);
      throw error;
    }
  }

  // Accept credential (user action)
  async acceptCredential(credentialInfo, userWallet) {
    try {
      await xrplService.connect();

      const acceptTx = {
        TransactionType: 'CredentialAccept',
        Account: userWallet.address,
        Issuer: credentialInfo.issuer,
        CredentialType: credentialInfo.credentialType
      };

      const signedTx = await xrplService.signTransaction(acceptTx);
      const result = await xrplService.submitTransaction(signedTx);

      if (result.result.meta.TransactionResult === 'tesSUCCESS') {
        return {
          success: true,
          transactionHash: result.result.hash
        };
      } else {
        throw new Error(`Credential accept failed: ${result.result.meta.TransactionResult}`);
      }
    } catch (error) {
      console.error('Failed to accept credential:', error);
      throw error;
    }
  }

  // Finish escrow after credential acceptance
  async finishEscrow(escrowInfo, userWallet) {
    try {
      await xrplService.connect();

      const finishTx = {
        TransactionType: 'EscrowFinish',
        Account: userWallet.address,
        Owner: userWallet.address,
        OfferSequence: escrowInfo.escrowSequence
      };

      const signedTx = await xrplService.signTransaction(finishTx);
      const result = await xrplService.submitTransaction(signedTx);

      if (result.result.meta.TransactionResult === 'tesSUCCESS') {
        return {
          success: true,
          transactionHash: result.result.hash
        };
      } else {
        throw new Error(`Escrow finish failed: ${result.result.meta.TransactionResult}`);
      }
    } catch (error) {
      console.error('Failed to finish escrow:', error);
      throw error;
    }
  }

  // Request download access (for users with valid credentials)
  async requestDownloadAccess(agentId, userAddress) {
    try {
      const response = await apiService.requestDownloadAccess(agentId, userAddress);

      if (response.success) {
        return {
          success: true,
          downloadToken: response.downloadToken,
          ipfsHash: response.ipfsHash,
          expiresAt: response.expiresAt
        };
      } else {
        throw new Error('Failed to get download access: ' + response.error);
      }
    } catch (error) {
      console.error('Failed to request download access:', error);
      throw error;
    }
  }

  // Add transaction listener
  addTransactionListener(transactionHash, callback) {
    this.transactionListeners.set(transactionHash, callback);
  }

  // Remove transaction listener
  removeTransactionListener(transactionHash) {
    this.transactionListeners.delete(transactionHash);
  }

  // Monitor transaction status
  async monitorTransaction(transactionHash) {
    try {
      await xrplService.connect();

      const txInfo = await xrplService.client.request({
        command: 'tx',
        transaction: transactionHash
      });

      return {
        hash: txInfo.result.hash,
        result: txInfo.result.meta.TransactionResult,
        validated: txInfo.result.validated,
        ledgerIndex: txInfo.result.ledger_index,
        date: txInfo.result.date
      };
    } catch (error) {
      console.error('Failed to monitor transaction:', error);
      throw error;
    }
  }
}

const purchaseService = new PurchaseService();
export default purchaseService;