const express = require('express');
const router = express.Router();
const { getTransactions, createTransaction, updateTransaction, deleteTransaction, syncTransactions } = require('../controllers/transactionController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getTransactions);
router.post('/', createTransaction);
router.post('/sync', syncTransactions);
router.put('/:localId', updateTransaction);
router.delete('/:localId', deleteTransaction);

module.exports = router;
