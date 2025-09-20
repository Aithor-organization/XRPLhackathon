import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Chip,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Link,
} from '@mui/material';
import {
  Receipt,
  CheckCircle,
  Error,
  Pending,
  Launch,
  AccessTime,
  AccountBalance,
  Security,
} from '@mui/icons-material';

import purchaseService from '../services/purchaseService';

const TransactionModal = ({ open, onClose, transaction }) => {
  const [transactionStatus, setTransactionStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && transaction?.hash) {
      monitorTransaction();
    }
  }, [open, transaction]);

  const monitorTransaction = async () => {
    if (!transaction?.hash) return;

    setLoading(true);
    setError('');

    try {
      const status = await purchaseService.monitorTransaction(transaction.hash);
      setTransactionStatus(status);

      // Poll for updates if transaction is not yet validated
      if (!status.validated) {
        const interval = setInterval(async () => {
          try {
            const updatedStatus = await purchaseService.monitorTransaction(transaction.hash);
            setTransactionStatus(updatedStatus);

            if (updatedStatus.validated) {
              clearInterval(interval);
            }
          } catch (error) {
            console.error('Error monitoring transaction:', error);
            clearInterval(interval);
          }
        }, 3000); // Check every 3 seconds

        // Clean up interval after 5 minutes
        setTimeout(() => {
          clearInterval(interval);
        }, 5 * 60 * 1000);
      }
    } catch (error) {
      setError('트랜잭션 정보를 가져오는데 실패했습니다: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getTransactionTypeInfo = () => {
    if (!transaction?.type) return { title: '트랜잭션', icon: <Receipt /> };

    switch (transaction.type) {
      case 'escrow_create':
        return {
          title: 'Escrow 생성',
          icon: <AccountBalance />,
          description: '안전한 거래를 위해 자금을 에스크로에 예치합니다.'
        };
      case 'credential_create':
        return {
          title: 'Credential 발행',
          icon: <Security />,
          description: 'AI 에이전트 라이센스 Credential을 발행합니다.'
        };
      case 'credential_accept':
        return {
          title: 'Credential 수락',
          icon: <CheckCircle />,
          description: 'Credential을 수락하여 라이센스를 활성화합니다.'
        };
      case 'escrow_finish':
        return {
          title: 'Escrow 완료',
          icon: <AccountBalance />,
          description: '거래를 완료하고 자금을 판매자에게 전송합니다.'
        };
      default:
        return {
          title: '트랜잭션',
          icon: <Receipt />,
          description: '블록체인 트랜잭션을 처리합니다.'
        };
    }
  };

  const getStatusIcon = () => {
    if (loading || !transactionStatus) {
      return <CircularProgress size={24} />;
    }

    if (transactionStatus.result === 'tesSUCCESS') {
      return <CheckCircle color="success" />;
    } else if (transactionStatus.result) {
      return <Error color="error" />;
    } else {
      return <Pending color="warning" />;
    }
  };

  const getStatusChip = () => {
    if (loading || !transactionStatus) {
      return <Chip label="처리 중" color="warning" size="small" />;
    }

    if (transactionStatus.validated && transactionStatus.result === 'tesSUCCESS') {
      return <Chip label="성공" color="success" size="small" />;
    } else if (transactionStatus.result && transactionStatus.result !== 'tesSUCCESS') {
      return <Chip label="실패" color="error" size="small" />;
    } else if (transactionStatus.validated) {
      return <Chip label="검증됨" color="info" size="small" />;
    } else {
      return <Chip label="대기 중" color="warning" size="small" />;
    }
  };

  const typeInfo = getTransactionTypeInfo();

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date((timestamp + 946684800) * 1000); // Convert from Ripple epoch
    return date.toLocaleString('ko-KR');
  };

  const getExplorerUrl = (hash) => {
    return `https://devnet.xrpl.org/transactions/${hash}`;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
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
          {typeInfo.icon}
          <Box>
            <Typography variant="h6">{typeInfo.title}</Typography>
            <Typography variant="body2" color="text.secondary">
              {typeInfo.description}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Paper elevation={2} sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="subtitle1" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {getStatusIcon()}
              트랜잭션 상태
            </Typography>
            {getStatusChip()}
          </Box>

          <List dense>
            <ListItem>
              <ListItemIcon>
                <Receipt />
              </ListItemIcon>
              <ListItemText
                primary="트랜잭션 해시"
                secondary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        wordBreak: 'break-all'
                      }}
                    >
                      {transaction?.hash || 'N/A'}
                    </Typography>
                    {transaction?.hash && (
                      <Link
                        href={getExplorerUrl(transaction.hash)}
                        target="_blank"
                        rel="noopener"
                        sx={{ display: 'flex', alignItems: 'center' }}
                      >
                        <Launch fontSize="small" />
                      </Link>
                    )}
                  </Box>
                }
              />
            </ListItem>

            <Divider />

            {transactionStatus && (
              <>
                <ListItem>
                  <ListItemIcon>
                    <CheckCircle />
                  </ListItemIcon>
                  <ListItemText
                    primary="실행 결과"
                    secondary={transactionStatus.result || 'Pending'}
                  />
                </ListItem>

                <ListItem>
                  <ListItemIcon>
                    <AccessTime />
                  </ListItemIcon>
                  <ListItemText
                    primary="처리 시간"
                    secondary={formatDate(transactionStatus.date)}
                  />
                </ListItem>

                <ListItem>
                  <ListItemIcon>
                    <Receipt />
                  </ListItemIcon>
                  <ListItemText
                    primary="렛저 인덱스"
                    secondary={transactionStatus.ledgerIndex || 'N/A'}
                  />
                </ListItem>

                <ListItem>
                  <ListItemIcon>
                    <Security />
                  </ListItemIcon>
                  <ListItemText
                    primary="검증 상태"
                    secondary={transactionStatus.validated ? '검증됨' : '미검증'}
                  />
                </ListItem>
              </>
            )}
          </List>
        </Paper>

        {transaction?.description && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {transaction.description}
          </Alert>
        )}

        {transactionStatus?.result === 'tesSUCCESS' && (
          <Alert severity="success" sx={{ mt: 2 }}>
            트랜잭션이 성공적으로 처리되었습니다!
          </Alert>
        )}

        {transactionStatus?.result && transactionStatus.result !== 'tesSUCCESS' && (
          <Alert severity="error" sx={{ mt: 2 }}>
            트랜잭션 처리에 실패했습니다: {transactionStatus.result}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 3 }}>
        <Button onClick={onClose} color="inherit">
          닫기
        </Button>
        {transaction?.hash && (
          <Button
            variant="outlined"
            startIcon={<Launch />}
            href={getExplorerUrl(transaction.hash)}
            target="_blank"
            rel="noopener"
          >
            Explorer에서 보기
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default TransactionModal;