import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  Avatar,
  Menu,
  MenuItem,
  Chip,
  IconButton,
  InputBase,
  alpha,
} from '@mui/material';
import {
  Search as SearchIcon,
  AccountCircle,
  ExitToApp,
  Dashboard,
  Add,
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';

const Search = styled('div')(({ theme }) => ({
  position: 'relative',
  borderRadius: theme.shape.borderRadius,
  backgroundColor: alpha(theme.palette.common.white, 0.15),
  '&:hover': {
    backgroundColor: alpha(theme.palette.common.white, 0.25),
  },
  marginRight: theme.spacing(2),
  marginLeft: 0,
  width: '100%',
  [theme.breakpoints.up('sm')]: {
    marginLeft: theme.spacing(3),
    width: 'auto',
  },
}));

const SearchIconWrapper = styled('div')(({ theme }) => ({
  padding: theme.spacing(0, 2),
  height: '100%',
  position: 'absolute',
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
  color: 'inherit',
  '& .MuiInputBase-input': {
    padding: theme.spacing(1, 1, 1, 0),
    paddingLeft: `calc(1em + ${theme.spacing(4)})`,
    transition: theme.transitions.create('width'),
    width: '100%',
    [theme.breakpoints.up('md')]: {
      width: '20ch',
    },
  },
}));

const Navbar = ({ user, onSearch, onLogout, onConnect, onRegisterAgent }) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleMenu = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSearch = (event) => {
    if (event.key === 'Enter') {
      onSearch(searchQuery);
    }
  };

  const handleLogout = () => {
    handleClose();
    onLogout();
  };

  return (
    <AppBar
      position="sticky"
      sx={{
        bgcolor: 'rgba(20, 20, 20, 0.95)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <Toolbar>
        {/* Logo */}
        <Typography
          variant="h5"
          component="div"
          sx={{
            flexGrow: 0,
            fontWeight: 'bold',
            color: 'primary.main',
            cursor: 'pointer',
            mr: 4,
          }}
        >
          AgentTrust
        </Typography>

        {/* Search */}
        <Search>
          <SearchIconWrapper>
            <SearchIcon />
          </SearchIconWrapper>
          <StyledInputBase
            placeholder="AI 에이전트 검색..."
            inputProps={{ 'aria-label': 'search' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={handleSearch}
          />
        </Search>

        <Box sx={{ flexGrow: 1 }} />

        {user ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Balance */}
            <Chip
              label={`${user.balance?.toFixed(2) || '0.00'} XRP`}
              size="small"
              sx={{
                bgcolor: 'rgba(229, 9, 20, 0.2)',
                color: 'primary.main',
                fontWeight: 'bold',
              }}
            />

            {/* Register Agent Button */}
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={onRegisterAgent}
              size="small"
              sx={{
                bgcolor: 'primary.main',
                '&:hover': {
                  bgcolor: 'primary.dark',
                },
              }}
            >
              AI 등록
            </Button>

            {/* User Menu */}
            <IconButton
              size="large"
              aria-label="account of current user"
              aria-controls="menu-appbar"
              aria-haspopup="true"
              onClick={handleMenu}
              color="inherit"
            >
              <Avatar
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: 'primary.main',
                  fontSize: '1rem',
                }}
              >
                {user.walletAddress?.substring(0, 2).toUpperCase()}
              </Avatar>
            </IconButton>

            <Menu
              id="menu-appbar"
              anchorEl={anchorEl}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'right',
              }}
              keepMounted
              transformOrigin={{
                vertical: 'top',
                horizontal: 'right',
              }}
              open={Boolean(anchorEl)}
              onClose={handleClose}
              sx={{
                '& .MuiPaper-root': {
                  bgcolor: 'background.paper',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  minWidth: 200,
                },
              }}
            >
              <MenuItem onClick={handleClose}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    지갑 주소
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      color: 'primary.main',
                    }}
                  >
                    {user.walletAddress?.substring(0, 10)}...
                    {user.walletAddress?.substring(user.walletAddress.length - 6)}
                  </Typography>
                </Box>
              </MenuItem>

              <MenuItem onClick={handleClose}>
                <Dashboard sx={{ mr: 1 }} />
                대시보드
              </MenuItem>

              <MenuItem onClick={handleLogout}>
                <ExitToApp sx={{ mr: 1 }} />
                로그아웃
              </MenuItem>
            </Menu>
          </Box>
        ) : (
          <Button
            color="primary"
            variant="contained"
            startIcon={<AccountCircle />}
            onClick={onConnect}
          >
            지갑 연결
          </Button>
        )}
      </Toolbar>
    </AppBar>
  );
};

export default Navbar;