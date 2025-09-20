const express = require('express');
const router = express.Router();
const logger = require('../services/logger');

// Sync endpoint for future blockchain synchronization
router.get('/status', async (req, res) => {
  try {
    logger.info('Sync status requested');

    res.json({
      success: true,
      status: 'ready',
      message: 'Sync service is ready'
    });
  } catch (error) {
    logger.error('Failed to get sync status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync status'
    });
  }
});

module.exports = router;