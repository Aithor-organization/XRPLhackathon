import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  Stepper,
  Step,
  StepLabel,
  CircularProgress,
  Alert,
  Paper,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Chip,
} from '@mui/material';
import {
  Upload,
  Add,
  CheckCircle,
  Error,
  CloudUpload,
  SmartToy,
  Description,
  Category,
  AttachMoney,
  Link,
} from '@mui/icons-material';

import apiService from '../services/apiService';

const AgentRegistrationModal = ({ open, onClose, user, onSuccess }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: '',
    priceXrp: '',
    ipfsHash: '',
    version: '1.0.0',
    license: 'commercial',
    capabilities: [],
    newCapability: ''
  });

  const steps = [
    '기본 정보',
    'NFT 메타데이터',
    'IPFS 설정',
    '등록 완료'
  ];

  const categories = [
    'NLP',
    'Computer Vision',
    'Machine Learning',
    'Deep Learning',
    'Reinforcement Learning',
    'Data Analysis',
    'Automation',
    'Other'
  ];

  const handleInputChange = (field) => (event) => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.value
    }));
  };

  const addCapability = () => {
    if (formData.newCapability.trim() && !formData.capabilities.includes(formData.newCapability.trim())) {
      setFormData(prev => ({
        ...prev,
        capabilities: [...prev.capabilities, prev.newCapability.trim()],
        newCapability: ''
      }));
    }
  };

  const removeCapability = (capability) => {
    setFormData(prev => ({
      ...prev,
      capabilities: prev.capabilities.filter(cap => cap !== capability)
    }));
  };

  const validateStep = (step) => {
    switch (step) {
      case 0:
        return formData.name && formData.description && formData.category && formData.priceXrp;
      case 1:
        return formData.version && formData.license && formData.capabilities.length > 0;
      case 2:
        return formData.ipfsHash;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => prev + 1);
      setError('');
    } else {
      setError('모든 필수 필드를 입력해주세요.');
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
    setError('');
  };

  const handleSubmit = async () => {
    if (!user) {
      setError('지갑을 먼저 연결해주세요.');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const agentData = {
        name: formData.name,
        description: formData.description,
        category: formData.category,
        priceXRP: parseFloat(formData.priceXrp),
        ipfsHash: formData.ipfsHash,
        imageUrl: null, // Will be added later if needed
        metadata: {
          version: formData.version,
          license: formData.license,
          capabilities: formData.capabilities,
          created_at: new Date().toISOString(),
          creator: user.walletAddress
        }
      };

      const response = await apiService.registerAgent(agentData);

      if (response.success) {
        setCurrentStep(3);
        setTimeout(() => {
          onSuccess && onSuccess();
          handleClose();
        }, 2000);
      } else {
        throw new Error(response.error || '등록에 실패했습니다.');
      }
    } catch (error) {
      console.error('Agent registration failed:', error);
      setError('에이전트 등록에 실패했습니다: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCurrentStep(0);
    setError('');
    setFormData({
      name: '',
      description: '',
      category: '',
      priceXrp: '',
      ipfsHash: '',
      version: '1.0.0',
      license: 'commercial',
      capabilities: [],
      newCapability: ''
    });
    onClose();
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              <SmartToy sx={{ mr: 1, verticalAlign: 'middle' }} />
              AI 에이전트 기본 정보
            </Typography>

            <TextField
              fullWidth
              label="에이전트 이름"
              value={formData.name}
              onChange={handleInputChange('name')}
              margin="normal"
              required
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SmartToy />
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              fullWidth
              label="설명"
              value={formData.description}
              onChange={handleInputChange('description')}
              margin="normal"
              required
              multiline
              rows={4}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Description />
                  </InputAdornment>
                ),
              }}
            />

            <FormControl fullWidth margin="normal" required>
              <InputLabel>카테고리</InputLabel>
              <Select
                value={formData.category}
                onChange={handleInputChange('category')}
                startAdornment={
                  <InputAdornment position="start">
                    <Category />
                  </InputAdornment>
                }
              >
                {categories.map(category => (
                  <MenuItem key={category} value={category}>
                    {category}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              fullWidth
              label="가격 (XRP)"
              value={formData.priceXrp}
              onChange={handleInputChange('priceXrp')}
              margin="normal"
              required
              type="number"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <AttachMoney />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        );

      case 1:
        return (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              <Description sx={{ mr: 1, verticalAlign: 'middle' }} />
              NFT 메타데이터
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  label="버전"
                  value={formData.version}
                  onChange={handleInputChange('version')}
                  margin="normal"
                  required
                />
              </Grid>
              <Grid item xs={6}>
                <FormControl fullWidth margin="normal" required>
                  <InputLabel>라이센스</InputLabel>
                  <Select
                    value={formData.license}
                    onChange={handleInputChange('license')}
                  >
                    <MenuItem value="commercial">Commercial</MenuItem>
                    <MenuItem value="open-source">Open Source</MenuItem>
                    <MenuItem value="academic">Academic</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>

            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                에이전트 기능
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <TextField
                  fullWidth
                  label="새 기능 추가"
                  value={formData.newCapability}
                  onChange={handleInputChange('newCapability')}
                  size="small"
                  onKeyPress={(e) => e.key === 'Enter' && addCapability()}
                />
                <Button
                  variant="outlined"
                  onClick={addCapability}
                  startIcon={<Add />}
                  disabled={!formData.newCapability.trim()}
                >
                  추가
                </Button>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {formData.capabilities.map((capability, index) => (
                  <Chip
                    key={index}
                    label={capability}
                    onDelete={() => removeCapability(capability)}
                    color="primary"
                    variant="outlined"
                  />
                ))}
              </Box>
            </Box>
          </Box>
        );

      case 2:
        return (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" gutterBottom>
              <CloudUpload sx={{ mr: 1, verticalAlign: 'middle' }} />
              IPFS 설정
            </Typography>

            <Alert severity="info" sx={{ mb: 2 }}>
              AI 에이전트 파일을 IPFS에 업로드한 후 해시를 입력해주세요.
            </Alert>

            <TextField
              fullWidth
              label="IPFS 해시"
              value={formData.ipfsHash}
              onChange={handleInputChange('ipfsHash')}
              margin="normal"
              required
              placeholder="예: QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Link />
                  </InputAdornment>
                ),
              }}
              helperText="IPFS 해시는 'Qm'으로 시작하는 46자리 문자열입니다."
            />

            <Paper elevation={2} sx={{ p: 2, mt: 2, bgcolor: 'background.default' }}>
              <Typography variant="subtitle2" gutterBottom>
                미리보기
              </Typography>
              <Typography variant="body2" color="text.secondary">
                이름: {formData.name || '미입력'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                카테고리: {formData.category || '미입력'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                가격: {formData.priceXrp || '0'} XRP
              </Typography>
              <Typography variant="body2" color="text.secondary">
                IPFS: {formData.ipfsHash || '미입력'}
              </Typography>
            </Paper>
          </Box>
        );

      case 3:
        return (
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <CheckCircle color="success" sx={{ fontSize: 64, mb: 2 }} />
            <Typography variant="h5" gutterBottom>
              등록 완료!
            </Typography>
            <Typography variant="body1" color="text.secondary">
              AI 에이전트가 성공적으로 등록되었습니다.
            </Typography>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
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
          <Upload color="primary" />
          <Typography variant="h5">
            AI 에이전트 등록
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Stepper activeStep={currentStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {renderStepContent()}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <CircularProgress />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 3 }}>
        <Button onClick={handleClose} color="inherit">
          취소
        </Button>

        {currentStep > 0 && currentStep < 3 && (
          <Button onClick={handleBack} color="inherit">
            이전
          </Button>
        )}

        {currentStep < 2 && (
          <Button
            variant="contained"
            onClick={handleNext}
            disabled={!validateStep(currentStep)}
          >
            다음
          </Button>
        )}

        {currentStep === 2 && (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={loading || !validateStep(currentStep)}
            startIcon={loading ? <CircularProgress size={20} /> : <Upload />}
          >
            등록하기
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default AgentRegistrationModal;