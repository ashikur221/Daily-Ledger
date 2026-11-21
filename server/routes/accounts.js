const express = require('express');
const router = express.Router();
const { getAccounts, createAccount, updateAccount, deleteAccount, syncAccounts } = require('../controllers/accountController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getAccounts);
router.post('/', createAccount);
router.post('/sync', syncAccounts);
router.put('/:localId', updateAccount);
router.delete('/:localId', deleteAccount);

module.exports = router;
