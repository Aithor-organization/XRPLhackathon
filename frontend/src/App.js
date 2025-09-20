import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Grid,
  Typography,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Chip,
  Paper,
} from '@mui/material';

import Navbar from './components/Navbar';
import AgentCard from './components/AgentCard';
import WalletConnect from './components/WalletConnect';
import PurchaseModal from './components/PurchaseModal';
import AgentRegistrationModal from './components/AgentRegistrationModal';

import apiService from './services/apiService';
import xrplService from './services/xrplService';


const App = () => {
  const [user, setUser] = useState(null);
  const [agents, setAgents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentDetailOpen, setAgentDetailOpen] = useState(false);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [registrationModalOpen, setRegistrationModalOpen] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      setLoading(true);

      const token = localStorage.getItem('authToken');
      if (token) {
        const userProfile = await apiService.getUserProfile();
        if (userProfile.success) {
          setUser(userProfile.user);
        }
      }

      const [agentsResponse, categoriesResponse] = await Promise.all([
        apiService.getAgents(),
        apiService.getCategories()
      ]);

      if (agentsResponse.success) {
        setAgents(agentsResponse.agents);
      }

      if (categoriesResponse.success) {
        setCategories(categoriesResponse.categories);
      }
    } catch (error) {
      console.error('Failed to initialize app:', error);
      setError('앱 초기화에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleWalletConnect = () => {
    setWalletDialogOpen(true);
  };

  const handleWalletSuccess = async (authResult) => {
    try {
      setUser(authResult.user);
      setWalletDialogOpen(false);

      await initializeApp();
    } catch (error) {
      console.error('Failed to handle wallet success:', error);
      setError('지갑 연결 후 처리에 실패했습니다.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    setUser(null);
    xrplService.disconnect();
  };

  const handleSearch = async (query) => {
    try {
      setSearchQuery(query);
      if (query.trim()) {
        const response = await apiService.searchAgents(query, selectedCategory !== 'all' ? selectedCategory : null);
        if (response.success) {
          setAgents(response.agents);
        }
      } else {
        const response = await apiService.getAgents();
        if (response.success) {
          setAgents(response.agents);
        }
      }
    } catch (error) {
      console.error('Search failed:', error);
      setError('검색에 실패했습니다.');
    }
  };

  const handleCategoryFilter = async (category) => {
    try {
      setSelectedCategory(category);
      const params = category !== 'all' ? { category } : {};
      const response = await apiService.getAgents(params);
      if (response.success) {
        setAgents(response.agents);
      }
    } catch (error) {
      console.error('Category filter failed:', error);
      setError('카테고리 필터링에 실패했습니다.');
    }
  };

  const handleAgentClick = (agent) => {
    setSelectedAgent(agent);
    setAgentDetailOpen(true);
  };

  const handleAgentPreview = (agent) => {
    setSelectedAgent(agent);
    setAgentDetailOpen(true);
  };

  const handleRegisterAgent = () => {
    if (!user) {
      setWalletDialogOpen(true);
      return;
    }
    setRegistrationModalOpen(true);
  };

  const handleRegistrationSuccess = () => {
    setRegistrationModalOpen(false);
    // Refresh agents list
    initializeApp();
  };

  const handlePurchaseAgent = (agent) => {
    if (!user) {
      setWalletDialogOpen(true);
      return;
    }
    setSelectedAgent(agent);
    setPurchaseModalOpen(true);
  };

  const handlePurchaseSuccess = () => {
    setPurchaseModalOpen(false);
    setSelectedAgent(null);
    // Refresh user data or show success message
  };

  const filteredAgents = agents.filter(agent => {
    if (searchQuery) {
      return agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
             agent.description.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress size={60} />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Navbar
          user={user}
          onSearch={handleSearch}
          onLogout={handleLogout}
          onConnect={handleWalletConnect}
          onRegisterAgent={handleRegisterAgent}
        />

        <Container maxWidth="xl" sx={{ pt: 4, pb: 4 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          {/* Hero Section */}
          <Box sx={{ mb: 6 }}>
            <Typography
              variant="h2"
              component="h1"
              sx={{
                fontWeight: 'bold',
                mb: 2,
                background: 'linear-gradient(45deg, #e50914, #ff6b6b)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                textAlign: 'center',
              }}
            >
              AgentTrust 마켓플레이스
            </Typography>
            <Typography
              variant="h5"
              color="text.secondary"
              sx={{ textAlign: 'center', mb: 4 }}
            >
              신뢰할 수 있는 AI 에이전트를 찾고 라이센스를 구매하세요
            </Typography>
          </Box>

          {/* Category Filter */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              카테고리
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                label="전체"
                onClick={() => handleCategoryFilter('all')}
                color={selectedCategory === 'all' ? 'primary' : 'default'}
                variant={selectedCategory === 'all' ? 'filled' : 'outlined'}
              />
              {categories.map((categoryObj) => (
                <Chip
                  key={categoryObj.category}
                  label={categoryObj.displayName || categoryObj.category}
                  onClick={() => handleCategoryFilter(categoryObj.category)}
                  color={selectedCategory === categoryObj.category ? 'primary' : 'default'}
                  variant={selectedCategory === categoryObj.category ? 'filled' : 'outlined'}
                />
              ))}
            </Box>
          </Box>

          {/* Agents Grid */}
          <Typography variant="h5" sx={{ mb: 3, fontWeight: 'bold' }}>
            추천 AI 에이전트
          </Typography>

          {filteredAgents.length === 0 ? (
            <Paper
              sx={{
                p: 6,
                textAlign: 'center',
                bgcolor: 'background.paper',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <Typography variant="h6" color="text.secondary">
                등록된 AI 에이전트가 없습니다.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                첫 번째 AI 에이전트를 등록해보세요!
              </Typography>
            </Paper>
          ) : (
            <Grid container spacing={3}>
              {filteredAgents.map((agent) => (
                <Grid item xs={12} sm={6} md={4} lg={3} key={agent.id}>
                  <AgentCard
                    agent={agent}
                    onClick={handleAgentClick}
                    onPreview={handleAgentPreview}
                    onPurchase={handlePurchaseAgent}
                  />
                </Grid>
              ))}
            </Grid>
          )}
        </Container>

        {/* Wallet Connect Dialog */}
        <WalletConnect
          open={walletDialogOpen}
          onClose={() => setWalletDialogOpen(false)}
          onSuccess={handleWalletSuccess}
        />

        {/* Agent Detail Dialog */}
        <Dialog
          open={agentDetailOpen}
          onClose={() => setAgentDetailOpen(false)}
          maxWidth="md"
          fullWidth
          PaperProps={{
            sx: {
              bgcolor: 'background.paper',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            },
          }}
        >
          {selectedAgent && (
            <>
              <DialogTitle>
                <Typography variant="h4" component="div">
                  {selectedAgent.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  by {selectedAgent.creator}
                </Typography>
              </DialogTitle>
              <DialogContent>
                <Box sx={{ mb: 3 }}>
                  <img
                    src={selectedAgent.image_url || 'https://via.placeholder.com/400x300?text=AI+Agent'}
                    alt={selectedAgent.name}
                    style={{
                      width: '100%',
                      height: '300px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                    }}
                  />
                </Box>

                <Typography variant="body1" sx={{ mb: 3, lineHeight: 1.6 }}>
                  {selectedAgent.description}
                </Typography>

                <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                  <Chip
                    label={selectedAgent.category}
                    color="primary"
                    variant="filled"
                  />
                  <Chip
                    label={`${selectedAgent.price_xrp} XRP`}
                    color="secondary"
                    variant="outlined"
                  />
                </Box>

                <Typography variant="h6" sx={{ mb: 2 }}>
                  상세 정보
                </Typography>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    평점: {selectedAgent.average_rating?.toFixed(1) || '0.0'} / 5.0
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    판매 수량: {selectedAgent.total_sales || 0}개
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    등록일: {new Date(selectedAgent.created_at).toLocaleDateString('ko-KR')}
                  </Typography>
                </Box>
              </DialogContent>
              <DialogActions sx={{ p: 3 }}>
                <Button
                  onClick={() => setAgentDetailOpen(false)}
                  color="inherit"
                >
                  닫기
                </Button>
                <Button
                  variant="contained"
                  color="primary"
                  disabled={!user}
                  onClick={() => {
                    setAgentDetailOpen(false);
                    handlePurchaseAgent(selectedAgent);
                  }}
                >
                  {user ? '라이센스 구매' : '지갑 연결 필요'}
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>

        {/* Purchase Modal */}
        <PurchaseModal
          open={purchaseModalOpen}
          onClose={() => setPurchaseModalOpen(false)}
          agent={selectedAgent}
          user={user}
          onSuccess={handlePurchaseSuccess}
        />

        {/* Agent Registration Modal */}
        <AgentRegistrationModal
          open={registrationModalOpen}
          onClose={() => setRegistrationModalOpen(false)}
          user={user}
          onSuccess={handleRegistrationSuccess}
        />
      </Box>
  );
};

export default App;