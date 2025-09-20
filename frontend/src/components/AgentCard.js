import React from 'react';
import {
  Card,
  CardContent,
  CardMedia,
  Typography,
  Box,
  Chip,
  Rating,
  IconButton,
  Button,
} from '@mui/material';
import {
  Star,
  Download,
  Visibility,
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';

const StyledCard = styled(Card)(({ theme }) => ({
  position: 'relative',
  cursor: 'pointer',
  transition: 'all 0.3s ease',
  backgroundColor: 'rgba(33, 33, 33, 0.8)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  overflow: 'hidden',
  '&:hover': {
    transform: 'scale(1.05)',
    zIndex: 10,
    backgroundColor: 'rgba(33, 33, 33, 0.95)',
    '& .card-overlay': {
      opacity: 1,
    },
    '& .card-media': {
      transform: 'scale(1.1)',
    },
  },
}));

const CardOverlay = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.8))',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  padding: theme.spacing(2),
  opacity: 0,
  transition: 'opacity 0.3s ease',
  color: 'white',
}));

const PlayButton = styled(IconButton)(({ theme }) => ({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  backgroundColor: 'rgba(229, 9, 20, 0.9)',
  color: 'white',
  width: 60,
  height: 60,
  '&:hover': {
    backgroundColor: 'rgba(229, 9, 20, 1)',
    transform: 'translate(-50%, -50%) scale(1.1)',
  },
}));

const AgentCard = ({ agent, onClick, onPreview, onPurchase }) => {
  const handleCardClick = () => {
    onClick(agent);
  };

  const handlePreview = (e) => {
    e.stopPropagation();
    onPreview(agent);
  };

  const handlePurchase = (e) => {
    e.stopPropagation();
    onPurchase && onPurchase(agent);
  };

  const getCategoryColor = (category) => {
    const colors = {
      'NLP': '#2196F3',
      'Computer Vision': '#4CAF50',
      'RL': '#FF9800',
      'Other': '#9C27B0',
    };
    return colors[category] || '#757575';
  };

  return (
    <StyledCard onClick={handleCardClick}>
      <Box sx={{ position: 'relative', paddingTop: '56.25%' }}>
        <CardMedia
          component="img"
          className="card-media"
          image={agent.image_url || 'https://via.placeholder.com/300x200?text=AI+Agent'}
          alt={agent.name}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'transform 0.3s ease',
          }}
        />

        {/* Category Badge */}
        <Chip
          label={agent.category}
          size="small"
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            backgroundColor: getCategoryColor(agent.category),
            color: 'white',
            fontWeight: 'bold',
            fontSize: '0.75rem',
          }}
        />

        {/* Price Badge */}
        <Chip
          label={`${agent.price_xrp} XRP`}
          size="small"
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            backgroundColor: 'primary.main',
            color: 'white',
            fontWeight: 'bold',
          }}
        />

        {/* Play Button */}
        <PlayButton className="play-button" onClick={handlePreview}>
          <Visibility />
        </PlayButton>

        {/* Hover Overlay */}
        <CardOverlay className="card-overlay">
          <Box>
            <Typography variant="h6" gutterBottom>
              {agent.name}
            </Typography>
            <Typography variant="body2" sx={{ mb: 1, opacity: 0.9 }}>
              {agent.description?.substring(0, 100)}
              {agent.description?.length > 100 && '...'}
            </Typography>
          </Box>

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <Rating
                value={agent.average_rating || 0}
                precision={0.1}
                size="small"
                readOnly
                sx={{ mr: 1 }}
              />
              <Typography variant="body2">
                ({agent.total_sales || 0} 판매)
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<Download />}
                fullWidth
                onClick={handlePurchase}
                sx={{
                  bgcolor: 'primary.main',
                  '&:hover': { bgcolor: 'primary.dark' },
                }}
              >
                라이센스 구매
              </Button>
            </Box>
          </Box>
        </CardOverlay>
      </Box>

      <CardContent sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom noWrap>
          {agent.name}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Star sx={{ color: '#ffa726', fontSize: 16, mr: 0.5 }} />
            <Typography variant="body2" color="text.secondary">
              {agent.average_rating?.toFixed(1) || '0.0'}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {agent.total_sales || 0} 판매
          </Typography>
        </Box>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            lineHeight: 1.4,
            height: '2.8em',
          }}
        >
          {agent.description}
        </Typography>
      </CardContent>
    </StyledCard>
  );
};

export default AgentCard;