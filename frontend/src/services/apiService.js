import axios from 'axios';

class ApiService {
  constructor() {
    this.baseURL = process.env.NODE_ENV === 'production'
      ? 'https://your-backend-url.com'
      : 'http://localhost:3001';

    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.api.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('authToken');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Clear invalid token
          localStorage.removeItem('authToken');
          window.location.href = '/';
        }
        return Promise.reject(error);
      }
    );
  }

  // Authentication
  async authenticateWallet(walletAddress, signature, challengeString) {
    const response = await this.api.post('/api/auth/wallet', {
      walletAddress,
      signature,
      challenge: challengeString
    });

    if (response.data.success && response.data.token) {
      localStorage.setItem('authToken', response.data.token);
    }

    return response.data;
  }

  // Get all agents
  async getAgents(params = {}) {
    const response = await this.api.get('/api/agents', { params });
    return response.data;
  }

  // Get agent details
  async getAgent(agentId) {
    const response = await this.api.get(`/api/agents/${agentId}`);
    return response.data;
  }

  // Get categories
  async getCategories() {
    const response = await this.api.get('/api/agents/categories');
    return response.data;
  }

  // Search agents
  async searchAgents(query, category = null) {
    const params = { q: query };
    if (category) params.category = category;

    const response = await this.api.get('/api/agents/search', { params });
    return response.data;
  }

  // Register new agent
  async registerAgent(agentData) {
    const response = await this.api.post('/api/agents', agentData);
    return response.data;
  }

  // Confirm NFT minting
  async confirmMinting(agentId, signedTransaction) {
    const response = await this.api.post(`/api/agents/${agentId}/mint/confirm`, {
      signedTransaction
    });
    return response.data;
  }

  // Purchase agent license
  async purchaseAgent(agentId, transactionData) {
    const response = await this.api.post('/api/purchase', {
      agentId,
      ...transactionData
    });
    return response.data;
  }

  // Get user profile
  async getUserProfile() {
    const response = await this.api.get('/api/users/mypage');
    return response.data;
  }

  // Get user's agents
  async getUserAgents() {
    const response = await this.api.get('/api/agents/my');
    return response.data;
  }

  // Submit review
  async submitReview(reviewData) {
    const response = await this.api.post('/api/reviews', reviewData);
    return response.data;
  }

  // Request download
  async requestDownload(licenseId) {
    const response = await this.api.post('/api/downloads/request', {
      licenseId
    });
    return response.data;
  }

  // Download agent with token
  downloadAgent(token) {
    window.open(`${this.baseURL}/api/downloads/${token}`, '_blank');
  }

  // Check server health
  async checkHealth() {
    try {
      const response = await this.api.get('/health');
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Purchase flow methods
  async checkCredential(agentId, userAddress) {
    const response = await this.api.post('/api/purchase/check-credential', {
      agentId,
      userAddress
    });
    return response.data;
  }

  async recordEscrow(escrowData) {
    const response = await this.api.post('/api/purchase/record-escrow', escrowData);
    return response.data;
  }

  async issueCredential(credentialData) {
    const response = await this.api.post('/api/purchase/issue-credential', credentialData);
    return response.data;
  }

  async finishPurchase(purchaseData) {
    const response = await this.api.post('/api/purchase/finish', purchaseData);
    return response.data;
  }

  async requestDownloadAccess(agentId, userAddress) {
    const response = await this.api.post('/api/purchase/download-access', {
      agentId,
      userAddress
    });
    return response.data;
  }

  async getPurchaseStatus(purchaseId) {
    const response = await this.api.get(`/api/purchase/status/${purchaseId}`);
    return response.data;
  }
}

// Create singleton instance
const apiService = new ApiService();

export default apiService;