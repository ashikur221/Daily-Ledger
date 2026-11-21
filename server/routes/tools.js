const express = require('express');
const router = express.Router();
const { getTools, createTool, updateTool, deleteTool, syncTools } = require('../controllers/toolController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getTools);
router.post('/', createTool);
router.post('/sync', syncTools);
router.put('/:localId', updateTool);
router.delete('/:localId', deleteTool);

module.exports = router;
