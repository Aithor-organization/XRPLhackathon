const xrpl = require('xrpl');
const logger = require('../logger');

class CredentialsService {
  constructor() {
    this.client = null;
    this.platformWallet = null;
  }

  async initialize(client, platformWallet) {
    this.client = client;
    this.platformWallet = platformWallet;
    logger.info('Credentials Service initialized');
  }

  async createCredential(licenseData) {
    try {
      const { agentId, buyerAddress, sellerAddress, licenseType } = licenseData;

      // Create unique credential type for this model
      const credentialType = `ML_${agentId.substring(0, 12)}`;

      const credentialTx = {
        TransactionType: 'CredentialCreate',
        Account: this.platformWallet.address,
        Subject: buyerAddress,
        CredentialType: credentialType,
        Credential: {
          agentId: agentId,
          licenseType: licenseType,
          seller: sellerAddress,
          issuedAt: Date.now(),
          validUntil: null, // Perpetual license
          permissions: ['download', 'use', 'modify']
        }
      };

      // Prepare transaction
      const prepared = await this.client.autofill(credentialTx);

      // Sign transaction
      const signed = this.platformWallet.sign(prepared);

      // Submit transaction
      const result = await this.client.submitAndWait(signed);

      if (result.result.meta.TransactionResult === 'tesSUCCESS') {
        logger.info(`Credential created successfully: ${result.result.hash}`);
        return {
          success: true,
          transactionHash: result.result.hash,
          credentialType: credentialType,
          credentialId: result.result.meta.AffectedNodes?.[0]?.CreatedNode?.NewFields?.CredentialID
        };
      } else {
        throw new Error(`Credential creation failed: ${result.result.meta.TransactionResult}`);
      }
    } catch (error) {
      logger.error('Failed to create credential:', error);
      throw error;
    }
  }

  // Create license credential (expected by purchase API)
  async createLicenseCredential(platformWallet, buyerAddress, licenseData) {
    try {
      const { agentId, agentName, purchaseDate, expiresAt, transactionHash } = licenseData;

      // Create unique credential type for this agent
      const credentialType = `ML_${agentId.substring(0, 12)}`;
      const credentialTypeHex = this.credentialTypeToHex(credentialType);

      // Prepare credential subject
      const credentialSubject = {
        agentId: agentId,
        agentName: agentName,
        purchaseDate: purchaseDate,
        licenseType: 'AI_AGENT_LICENSE',
        transactionHash: transactionHash
      };

      if (expiresAt) {
        credentialSubject.expiresAt = expiresAt;
      }

      // Create credential transaction
      const credentialTx = {
        TransactionType: 'CredentialCreate',
        Account: platformWallet,
        Subject: buyerAddress,
        CredentialType: credentialTypeHex,
        CredentialSubject: JSON.stringify(credentialSubject)
      };

      logger.info('Preparing credential creation transaction', {
        issuer: platformWallet,
        holder: buyerAddress,
        credentialType,
        agentId: agentId
      });

      return {
        credentialType,
        credentialTypeHex,
        transaction: credentialTx,
        credentialSubject
      };

    } catch (error) {
      logger.error('Error creating license credential:', error);
      throw error;
    }
  }

  // Check if user has credential for an agent (expected by purchase API)
  async checkCredential(buyerAddress, agentId) {
    try {
      const credentialType = `ML_${agentId.substring(0, 12)}`;
      const credentialTypeHex = this.credentialTypeToHex(credentialType);

      logger.info('Checking credential using account_objects', {
        buyerAddress,
        agentId,
        credentialType,
        credentialTypeHex
      });

      // Query for credentials using account_objects
      const response = await this.client.request({
        command: 'account_objects',
        account: buyerAddress,
        type: 'credential'
      });

      const credentials = response.result.account_objects || [];

      // Look for matching credential type
      const matchingCredential = credentials.find(cred => {
        return cred.CredentialType &&
               cred.CredentialType.toUpperCase() === credentialTypeHex;
      });

      if (matchingCredential) {
        logger.info('Matching credential found', {
          buyerAddress,
          agentId,
          credentialType,
          credentialIndex: matchingCredential.index
        });

        return {
          hasCredential: true,
          credential: matchingCredential,
          credentialType,
          credentialTypeHex,
          method: 'account_objects'
        };
      }

      logger.info('No matching credential found', {
        buyerAddress,
        agentId,
        credentialType,
        totalCredentials: credentials.length
      });

      return {
        hasCredential: false,
        reason: 'No matching credential found',
        method: 'account_objects'
      };

    } catch (error) {
      logger.error('Error checking credential:', error);
      return {
        hasCredential: false,
        reason: `Error checking credential: ${error.message}`,
        method: 'account_objects'
      };
    }
  }

  // Convert credential type to hex for XRPL
  credentialTypeToHex(credentialType) {
    return Buffer.from(credentialType, 'utf8').toString('hex').toUpperCase();
  }

  async verifyCredential(buyerAddress, agentId) {
    try {
      const credentialType = `ML_${agentId.substring(0, 12)}`;

      // Query for credentials
      const response = await this.client.request({
        command: 'account_objects',
        account: buyerAddress,
        type: 'credential',
        credential_type: credentialType
      });

      const credentials = response.result.account_objects || [];

      // Check if valid credential exists
      const validCredential = credentials.find(cred => {
        const credential = cred.Credential;
        return credential &&
               credential.agentId === agentId &&
               (credential.validUntil === null || credential.validUntil > Date.now());
      });

      if (validCredential) {
        logger.info(`Valid credential found for agent ${agentId} and buyer ${buyerAddress}`);
        return {
          valid: true,
          credential: validCredential,
          permissions: validCredential.Credential.permissions
        };
      } else {
        logger.info(`No valid credential found for agent ${agentId} and buyer ${buyerAddress}`);
        return {
          valid: false,
          credential: null,
          permissions: []
        };
      }
    } catch (error) {
      logger.error('Failed to verify credential:', error);
      return {
        valid: false,
        credential: null,
        permissions: [],
        error: error.message
      };
    }
  }

  async revokeCredential(credentialId, reason = 'revoked') {
    try {
      const revokeTx = {
        TransactionType: 'CredentialRevoke',
        Account: this.platformWallet.address,
        CredentialID: credentialId,
        Reason: reason
      };

      // Prepare transaction
      const prepared = await this.client.autofill(revokeTx);

      // Sign transaction
      const signed = this.platformWallet.sign(prepared);

      // Submit transaction
      const result = await this.client.submitAndWait(signed);

      if (result.result.meta.TransactionResult === 'tesSUCCESS') {
        logger.info(`Credential revoked successfully: ${result.result.hash}`);
        return {
          success: true,
          transactionHash: result.result.hash
        };
      } else {
        throw new Error(`Credential revocation failed: ${result.result.meta.TransactionResult}`);
      }
    } catch (error) {
      logger.error('Failed to revoke credential:', error);
      throw error;
    }
  }

  async listCredentials(address) {
    try {
      const response = await this.client.request({
        command: 'account_objects',
        account: address,
        type: 'credential'
      });

      const credentials = response.result.account_objects || [];

      return credentials.map(cred => ({
        credentialId: cred.CredentialID,
        credentialType: cred.CredentialType,
        subject: cred.Subject,
        credential: cred.Credential,
        isValid: cred.Credential.validUntil === null || cred.Credential.validUntil > Date.now()
      }));
    } catch (error) {
      logger.error('Failed to list credentials:', error);
      throw error;
    }
  }

  generateCredentialProof(credential, challenge) {
    try {
      // Generate a proof that the credential is valid for the given challenge
      const proof = {
        credentialId: credential.credentialId,
        challenge: challenge,
        timestamp: Date.now(),
        signature: this.platformWallet.sign({
          credentialId: credential.credentialId,
          challenge: challenge,
          timestamp: Date.now()
        }).tx_blob
      };

      return proof;
    } catch (error) {
      logger.error('Failed to generate credential proof:', error);
      throw error;
    }
  }

  verifyCredentialProof(proof, credential) {
    try {
      // Verify that the proof is valid for the given credential
      // In a real implementation, this would verify the cryptographic signature

      const isValidTimestamp = (Date.now() - proof.timestamp) < 300000; // 5 minutes
      const isValidCredential = proof.credentialId === credential.credentialId;

      return isValidTimestamp && isValidCredential;
    } catch (error) {
      logger.error('Failed to verify credential proof:', error);
      return false;
    }
  }
}

const credentialsService = new CredentialsService();
module.exports = credentialsService;