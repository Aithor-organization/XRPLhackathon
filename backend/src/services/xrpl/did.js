const xrpl = require('xrpl');
const logger = require('../logger');

class DIDService {
  constructor() {
    this.client = null;
  }

  async initialize(client) {
    this.client = client;
    logger.info('DID Service initialized');
  }

  async createDIDDocument(agentId, ipfsHash, metadata) {
    try {
      const didDocument = {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: `did:xrpl:${agentId}`,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        verificationMethod: [{
          id: `did:xrpl:${agentId}#key-1`,
          type: 'EcdsaSecp256k1VerificationKey2019',
          controller: `did:xrpl:${agentId}`,
          publicKeyMultibase: metadata.publicKey || ''
        }],
        service: [{
          id: `did:xrpl:${agentId}#agent-service`,
          type: 'AIAgentService',
          serviceEndpoint: {
            ipfsHash: ipfsHash,
            metadata: {
              name: metadata.name,
              description: metadata.description,
              category: metadata.category,
              version: metadata.version || '1.0.0',
              license: metadata.license || 'commercial'
            }
          }
        }]
      };

      return didDocument;
    } catch (error) {
      logger.error('Failed to create DID document:', error);
      throw error;
    }
  }

  async updateDIDDocument(agentId, updates) {
    try {
      // In a real implementation, this would update the DID document on XRPL
      // For now, we'll return the updated document structure
      const timestamp = new Date().toISOString();

      return {
        ...updates,
        updated: timestamp
      };
    } catch (error) {
      logger.error('Failed to update DID document:', error);
      throw error;
    }
  }

  async resolveDID(didId) {
    try {
      // In a real implementation, this would resolve the DID from XRPL
      // For now, we'll return a basic structure
      logger.info(`Resolving DID: ${didId}`);

      return {
        didDocument: {
          id: didId,
          resolved: true,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Failed to resolve DID:', error);
      throw error;
    }
  }

  async verifyDIDDocument(didDocument) {
    try {
      // Basic validation of DID document structure
      if (!didDocument || !didDocument.id) {
        throw new Error('Invalid DID document: missing id');
      }

      if (!didDocument['@context']) {
        throw new Error('Invalid DID document: missing @context');
      }

      logger.info(`DID document verified: ${didDocument.id}`);
      return true;
    } catch (error) {
      logger.error('DID document verification failed:', error);
      throw error;
    }
  }
}

const didService = new DIDService();
module.exports = didService;