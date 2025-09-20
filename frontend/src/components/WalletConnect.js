import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Paper,
  Grid,
} from '@mui/material';
import { Wallet as WalletIcon, AccountBalanceWallet } from '@mui/icons-material';
import xrplService from '../services/xrplService';
import apiService from '../services/apiService';

const WalletConnect = ({ open, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [seed, setSeed] = useState('');
  const [balance, setBalance] = useState(0);
  const [step, setStep] = useState('connect'); // 'connect', 'test', 'authenticate'

  // Shared authentication function
  const performAuthentication = async (address) => {
    try {
      // Generate challenge
      const challenge = xrplService.generateAuthChallenge(address);

      // Sign challenge
      const signature = await xrplService.signAuthChallenge(challenge);

      // Authenticate with backend
      const authResult = await apiService.authenticateWallet(
        address,
        signature,
        challenge.message
      );

      if (authResult.success) {
        setSuccess('인증이 완료되었습니다!');
        setTimeout(() => {
          onSuccess(authResult);
          onClose();
        }, 1000);
      } else {
        throw new Error('인증에 실패했습니다');
      }
    } catch (error) {
      setError('인증에 실패했습니다: ' + error.message);
      throw error;
    }
  };

  const handleCreateTestWallet = async () => {
    setLoading(true);
    setError('');

    try {
      const walletInfo = await xrplService.connectTestWallet();
      setWalletAddress(walletInfo.address);
      setSeed(walletInfo.seed);

      // Get balance
      const balance = await xrplService.getBalance(walletInfo.address);
      setBalance(balance);

      setSuccess('테스트 지갑이 생성되었습니다! 자동으로 로그인 중...');

      // Auto-authenticate after wallet creation
      await performAuthentication(walletInfo.address);
    } catch (error) {
      setError('지갑 생성에 실패했습니다: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectExistingWallet = async () => {
    if (!seed) {
      setError('시드를 입력해주세요');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const walletInfo = await xrplService.connectTestWallet(seed);
      setWalletAddress(walletInfo.address);

      // Get balance
      const balance = await xrplService.getBalance(walletInfo.address);
      setBalance(balance);

      setSuccess('지갑이 연결되었습니다! 자동으로 로그인 중...');

      // Auto-authenticate after wallet connection
      await performAuthentication(walletInfo.address);
    } catch (error) {
      setError('지갑 연결에 실패했습니다: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAuthenticate = async () => {
    setLoading(true);
    setError('');

    try {
      await performAuthentication(walletAddress);
    } catch (error) {
      // Error already handled in performAuthentication
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep('connect');
    setError('');
    setSuccess('');
    setWalletAddress('');
    setSeed('');
    setBalance(0);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))'
        }
      }}
    >
      <DialogTitle sx={{ textAlign: 'center', pt: 3 }}>
        <WalletIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
        <Typography variant="h4" component="div">
          XRPL 지갑 연결
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          AgentTrust 마켓플레이스에 접속하기 위해 지갑을 연결하세요
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ px: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}

        {step === 'connect' && (
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Paper
                  elevation={2}
                  sx={{
                    p: 3,
                    textAlign: 'center',
                    bgcolor: 'background.default',
                    border: '1px solid rgba(255,255,255,0.1)'
                  }}
                >
                  <AccountBalanceWallet sx={{ fontSize: 32, color: 'primary.main', mb: 1 }} />
                  <Typography variant="h6" gutterBottom>
                    새 테스트 지갑 생성
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    개발용 테스트 지갑을 생성하고 1000 XRP를 받습니다
                  </Typography>
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={handleCreateTestWallet}
                    disabled={loading}
                    size="large"
                  >
                    새 지갑 생성
                  </Button>
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper
                  elevation={2}
                  sx={{
                    p: 3,
                    bgcolor: 'background.default',
                    border: '1px solid rgba(255,255,255,0.1)'
                  }}
                >
                  <Typography variant="h6" gutterBottom>
                    기존 지갑 연결
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    이전에 생성한 지갑의 시드를 입력하세요
                  </Typography>
                  <TextField
                    fullWidth
                    label="지갑 시드 (Seed)"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    variant="outlined"
                    sx={{ mb: 2 }}
                    placeholder="sXXXXXXXXXXXXXXXXXX..."
                  />
                  <Button
                    variant="outlined"
                    fullWidth
                    onClick={handleConnectExistingWallet}
                    disabled={loading || !seed}
                    size="large"
                  >
                    지갑 연결
                  </Button>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}

        {step === 'test' && (
          <Box sx={{ mt: 2 }}>
            <Paper
              elevation={2}
              sx={{
                p: 3,
                bgcolor: 'background.default',
                border: '1px solid rgba(255,255,255,0.1)'
              }}
            >
              <Typography variant="h6" gutterBottom color="primary">
                지갑 정보
              </Typography>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  주소:
                </Typography>
                <Typography variant="body1" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {walletAddress}
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  잔액:
                </Typography>
                <Typography variant="h6" color="primary">
                  {balance.toFixed(2)} XRP
                </Typography>
              </Box>

              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  시드 (안전하게 보관하세요):
                </Typography>
                <TextField
                  fullWidth
                  value={seed}
                  InputProps={{ readOnly: true }}
                  variant="outlined"
                  size="small"
                  sx={{
                    mt: 1,
                    '& .MuiInputBase-input': {
                      fontFamily: 'monospace',
                      fontSize: '0.875rem'
                    }
                  }}
                />
              </Box>

              {/* Login button removed - authentication happens automatically */}
            </Paper>
          </Box>
        )}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <CircularProgress />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleClose} color="inherit">
          취소
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default WalletConnect;