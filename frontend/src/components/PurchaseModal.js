import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Stepper,
  Step,
  StepLabel,
  CircularProgress,
  Alert,
  Paper,
  Chip,
  LinearProgress,
} from '@mui/material';
import {
  CheckCircle,
  Error,
  Pending,
  Download,
  Security,
  Payment,
} from '@mui/icons-material';

import purchaseService from '../services/purchaseService';
import TransactionModal from './TransactionModal';

const PurchaseModal = ({ open, onClose, agent, user, onSuccess }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [purchaseData, setPurchaseData] = useState(null);
  const [hasCredential, setHasCredential] = useState(false);
  const [credentialInfo, setCredentialInfo] = useState(null);
  const [transactionModalOpen, setTransactionModalOpen] = useState(false);
  const [currentTransaction, setCurrentTransaction] = useState(null);
  const [downloadInfo, setDownloadInfo] = useState(null);

  const steps = [
    'Credential 확인',
    'Escrow 생성',
    'Credential 발행',
    'Credential 수락',
    '거래 완료'
  ];

  const stepsBypassForExistingUser = [
    'Credential 확인',
    '다운로드 준비'
  ];

  useEffect(() => {
    if (open && agent && user) {
      initializePurchase();
    }
  }, [open, agent, user]);

  const initializePurchase = async () => {
    setLoading(true);
    setError('');
    setCurrentStep(0);

    try {
      // Step 1: Check if user already has credential
      const credentialResult = await purchaseService.checkCredential(agent.id, user.walletAddress);

      if (credentialResult.hasCredential) {
        // User already has access, provide download directly
        setHasCredential(true);
        setCredentialInfo(credentialResult.credential);
        setCurrentStep(1);
        await requestDownloadAccess();
      } else {
        // User needs to purchase, start full flow
        setHasCredential(false);
        setCurrentStep(1);
        await startPurchaseFlow();
      }
    } catch (error) {
      setError('초기화에 실패했습니다: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const requestDownloadAccess = async () => {
    try {
      const downloadResult = await purchaseService.requestDownloadAccess(agent.id, user.walletAddress);
      setDownloadInfo(downloadResult);
      setCurrentStep(1); // Final step for existing users
    } catch (error) {
      setError('다운로드 액세스 요청에 실패했습니다: ' + error.message);
    }
  };

  const startPurchaseFlow = async () => {
    try {
      setCurrentStep(1); // Escrow creation

      const userWallet = {
        address: user.walletAddress,
        // We'll use the connected XRPL service wallet
      };

      const purchaseResult = await purchaseService.startPurchaseFlow(agent, userWallet);
      setPurchaseData(purchaseResult);

      // Show transaction modal for escrow creation
      setCurrentTransaction({
        hash: purchaseResult.escrowTxHash,
        type: 'escrow_create',
        description: 'Escrow 거래 생성 중...'
      });
      setTransactionModalOpen(true);

      setCurrentStep(2); // Credential issuing

      // Show transaction modal for credential creation
      setCurrentTransaction({
        hash: purchaseResult.credentialTxHash,
        type: 'credential_create',
        description: 'Credential 발행 중...'
      });

      setCurrentStep(3); // Wait for user to accept credential
    } catch (error) {
      setError('구매 플로우 시작에 실패했습니다: ' + error.message);
    }
  };

  const acceptCredential = async () => {
    if (!purchaseData) return;

    try {
      setLoading(true);
      setCurrentStep(3);

      const userWallet = {
        address: user.walletAddress,
      };

      const acceptResult = await purchaseService.acceptCredential({
        issuer: purchaseData.issuer || 'platform_address', // This should come from config
        credentialType: purchaseData.credentialType
      }, userWallet);

      setCurrentTransaction({
        hash: acceptResult.transactionHash,
        type: 'credential_accept',
        description: 'Credential 수락 중...'
      });
      setTransactionModalOpen(true);

      setCurrentStep(4); // Finish escrow
      await finishPurchase();
    } catch (error) {
      setError('Credential 수락에 실패했습니다: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const finishPurchase = async () => {
    try {
      const finishResult = await purchaseService.finishEscrow(purchaseData, {
        address: user.walletAddress
      });

      setCurrentTransaction({
        hash: finishResult.transactionHash,
        type: 'escrow_finish',
        description: '거래 완료 중...'
      });

      // Get download access
      await requestDownloadAccess();

      setCurrentStep(4); // Completed
      onSuccess && onSuccess();
    } catch (error) {
      setError('거래 완료에 실패했습니다: ' + error.message);
    }
  };

  const handleClose = () => {
    setCurrentStep(0);
    setError('');
    setPurchaseData(null);
    setHasCredential(false);
    setCredentialInfo(null);
    setDownloadInfo(null);
    setTransactionModalOpen(false);
    setCurrentTransaction(null);
    onClose();
  };

  const handleDownload = () => {
    if (downloadInfo?.downloadToken) {
      window.open(`/api/downloads/${downloadInfo.downloadToken}`, '_blank');
    }
  };

  const getStepIcon = (stepIndex) => {
    if (stepIndex < currentStep) {
      return <CheckCircle color="primary" />;
    } else if (stepIndex === currentStep && loading) {
      return <CircularProgress size={24} />;
    } else if (stepIndex === currentStep && error) {
      return <Error color="error" />;
    } else {
      return <Pending color="disabled" />;
    }
  };

  const currentSteps = hasCredential ? stepsBypassForExistingUser : steps;

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          },
        }}
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Payment color="primary" />
            <Typography variant="h5">
              {hasCredential ? 'AI 에이전트 다운로드' : 'AI 에이전트 구매'}
            </Typography>
          </Box>
          {agent && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {agent.name} - {agent.price_xrp} XRP
            </Typography>
          )}
        </DialogTitle>

        <DialogContent sx={{ pt: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          {hasCredential && (
            <Alert severity="success" sx={{ mb: 3 }}>
              이미 이 AI 에이전트에 대한 라이센스를 보유하고 있습니다!
            </Alert>
          )}

          <Paper elevation={2} sx={{ p: 3, mb: 3, bgcolor: 'background.default' }}>
            <Stepper activeStep={currentStep} orientation="vertical">
              {currentSteps.map((label, index) => (
                <Step key={label}>
                  <StepLabel icon={getStepIcon(index)}>
                    <Typography
                      variant={index === currentStep ? "subtitle1" : "body2"}
                      color={index <= currentStep ? "text.primary" : "text.secondary"}
                    >
                      {label}
                    </Typography>
                  </StepLabel>
                </Step>
              ))}
            </Stepper>
          </Paper>

          {loading && (
            <Box sx={{ width: '100%', mb: 2 }}>
              <LinearProgress />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
                처리 중입니다...
              </Typography>
            </Box>
          )}

          {downloadInfo && (
            <Paper elevation={2} sx={{ p: 3, bgcolor: 'success.dark', color: 'success.contrastText' }}>
              <Typography variant="h6" gutterBottom>
                다운로드 준비 완료!
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                IPFS Hash: {downloadInfo.ipfsHash}
              </Typography>
              <Chip
                label={`만료: ${new Date(downloadInfo.expiresAt).toLocaleString()}`}
                size="small"
                sx={{ mb: 2 }}
              />
            </Paper>
          )}

          {currentStep === 3 && !hasCredential && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Credential을 수락하여 거래를 완료하세요.
            </Alert>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 3 }}>
          <Button onClick={handleClose} color="inherit">
            닫기
          </Button>

          {downloadInfo && (
            <Button
              variant="contained"
              startIcon={<Download />}
              onClick={handleDownload}
              color="primary"
            >
              다운로드
            </Button>
          )}

          {currentStep === 3 && !hasCredential && (
            <Button
              variant="contained"
              startIcon={<Security />}
              onClick={acceptCredential}
              disabled={loading}
              color="primary"
            >
              Credential 수락
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <TransactionModal
        open={transactionModalOpen}
        onClose={() => setTransactionModalOpen(false)}
        transaction={currentTransaction}
      />
    </>
  );
};

export default PurchaseModal;