const express = require('express');
const router = express.Router();
const { getTransactions, createTransaction, updateTransaction, deleteTransaction, syncTransactions, purgeSeedData } = require('../controllers/transactionController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getTransactions);
router.post('/', createTransaction);
router.post('/sync', syncTransactions);
router.post('/purge-seed', purgeSeedData);
router.put('/:localId', updateTransaction);
router.delete('/:localId', deleteTransaction);

module.exports = router;
