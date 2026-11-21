const express = require('express');
const router = express.Router();
const { pullDeltas } = require('../controllers/syncController');
const { protect } = require('../middleware/auth');

router.use(protect);

// GET /api/sync/pull?since=<ISO_DATE>
router.get('/pull', pullDeltas);

module.exports = router;
