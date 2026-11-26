const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  chatWithAi,
  getConversations,
  getConversationById,
  deleteConversation,
  evaluateGoal,
  getFinancialReport,
} = require('../controllers/aiController');

// All AI endpoints are strictly protected by session authentication
router.use(protect);

router.post('/chat', chatWithAi);
router.get('/conversations', getConversations);
router.get('/conversations/:id', getConversationById);
router.delete('/conversations/:id', deleteConversation);
router.post('/goals', evaluateGoal);
router.get('/report', getFinancialReport);

module.exports = router;
