const express = require('express');
const router = express.Router();
const { createInvite, getUsers, deactivateUser, exportBackup, importBackup, resetUserPassword } = require('../controllers/adminController');
const { protect, isAdmin } = require('../middleware/auth');

// Backup routes — available to all authenticated users (for their own data)
router.get('/backup/export', protect, exportBackup);
router.post('/backup/import', protect, importBackup);

// Admin-only routes
router.post('/invite', protect, isAdmin, createInvite);
router.get('/users', protect, isAdmin, getUsers);
router.patch('/users/:id/deactivate', protect, isAdmin, deactivateUser);
router.post('/users/:id/reset-password', protect, isAdmin, resetUserPassword);

module.exports = router;
