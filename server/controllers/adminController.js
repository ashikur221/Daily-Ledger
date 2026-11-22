const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const Tool = require('../models/Tool');

// POST /api/invite — Admin creates an invite for a new member
const createInvite = async (req, res) => {
  try {
    const { email, name, role = 'member' } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ message: 'A user with this email already exists' });

    const inviteToken = uuidv4();

    const user = new User({
      name: name || 'Pending',
      email: email.toLowerCase(),
      passwordHash: uuidv4(), // placeholder — will be replaced when invite is accepted
      role,
      inviteToken,
      inviteUsed: false,
    });
    await user.save();

    // In production, send this via email. For now, return the token to the admin.
    res.status(201).json({
      message: 'Invite created',
      inviteToken,
      inviteLink: `${process.env.CLIENT_ORIGIN}/register?token=${inviteToken}&email=${encodeURIComponent(email)}`,
      email,
    });
  } catch (err) {
    console.error('Create invite error:', err);
    res.status(500).json({ message: 'Error creating invite' });
  }
};

// GET /api/admin/users — List all users with aggregated ledger summary metrics
const getUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select('-refreshToken -inviteToken')
      .sort({ createdAt: -1 })
      .lean();

    // Aggregate ledger metrics for each user in parallel
    const usersWithLedger = await Promise.all(
      users.map(async (u) => {
        const [transactions, accounts, tools] = await Promise.all([
          Transaction.find({ userId: u._id, isDeleted: false }).lean(),
          Account.find({ userId: u._id, isDeleted: false }).lean(),
          Tool.find({ userId: u._id, isDeleted: false }).lean(),
        ]);

        // 1. Calculate Cash in Hand & Total Expenses / Deposits
        const deposits = transactions
          .filter((t) => t.type === 'income' && t.category !== 'Banking')
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

        const expenses = transactions
          .filter((t) => t.type === 'expense' && t.category !== 'Banking')
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

        const cashInHand = Math.max(0, deposits - expenses);

        // 2. Bank & MFS Balances
        const bankBalances = accounts
          .filter((a) => a.type === 'bank')
          .reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

        const mfsBalances = accounts
          .filter((a) => a.type === 'mfs')
          .reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

        const totalBankMfs = accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

        // 3. Debts & Loans Summary (Money to receive vs Money to pay)
        const debts = tools.filter((t) => t.toolType === 'debt');
        const repayments = tools.filter((t) => t.toolType === 'repayment');

        let moneyLentToReceive = 0; // People owe them
        let moneyBorrowedToPay = 0; // They owe people

        debts.forEach((d) => {
          const originalAmt = Number(d.data?.amount) || 0;
          const repaidAmt = repayments
            .filter((r) => r.data?.debtId === d.localId)
            .reduce((s, r) => s + (Number(r.data?.amount) || 0), 0);
          const remaining = Math.max(0, originalAmt - repaidAmt);

          if (d.data?.type === 'owe') {
            moneyLentToReceive += remaining;
          } else {
            moneyBorrowedToPay += remaining;
          }
        });

        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
          passwordStatus: 'Encrypted (bcrypt hash: ' + (u.passwordHash ? u.passwordHash.substring(0, 16) + '...' : 'None') + ')',
          summary: {
            cashInHand,
            bankBalances,
            mfsBalances,
            totalBankMfs,
            moneyLentToReceive,
            moneyBorrowedToPay,
            netWorth: cashInHand + totalBankMfs + moneyLentToReceive - moneyBorrowedToPay,
            transactionCount: transactions.length,
            accountCount: accounts.length,
            debtCount: debts.length,
          },
        };
      })
    );

    res.json({ users: usersWithLedger });
  } catch (err) {
    console.error('Error fetching admin users:', err);
    res.status(500).json({ message: 'Error fetching users' });
  }
};

// POST /api/admin/users/:id/reset-password — Admin resets password for a user
const resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.passwordHash = newPassword; // Pre-save hook will bcrypt hash it automatically
    await user.save();

    res.json({ message: `Password reset successfully for ${user.email}`, email: user.email });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ message: 'Error resetting password' });
  }
};

// PATCH /api/admin/users/:id/deactivate
const deactivateUser = async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot deactivate yourself' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });
    const user = await User.findByIdAndUpdate(req.params.id, { isActive: !target.isActive }, { new: true });
    res.json({ message: `User ${user.isActive ? 'activated' : 'deactivated'}`, user });
  } catch (err) {
    res.status(500).json({ message: 'Error updating user status' });
  }
};

// DELETE /api/admin/users/:id — Permanently delete user and their records
const deleteUser = async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete your own admin account' });
    }
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    // Permanently remove target user and all their transactions, accounts, and tools
    await Promise.all([
      Transaction.deleteMany({ userId: targetUser._id }),
      Account.deleteMany({ userId: targetUser._id }),
      Tool.deleteMany({ userId: targetUser._id }),
      User.findByIdAndDelete(targetUser._id),
    ]);

    res.json({ message: `User account ${targetUser.email} permanently deleted` });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ message: 'Error deleting user account' });
  }
};

// GET /api/backup/export — full data export for authenticated user
const exportBackup = async (req, res) => {
  try {
    const [transactions, accounts, tools] = await Promise.all([
      Transaction.find({ userId: req.user._id, isDeleted: false }),
      Account.find({ userId: req.user._id, isDeleted: false }),
      Tool.find({ userId: req.user._id, isDeleted: false }),
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      userId: req.user._id,
      userEmail: req.user.email,
      version: '2.0',
      transactions,
      accounts,
      tools,
    };

    res.setHeader('Content-Disposition', `attachment; filename=daily-ledger-backup-${Date.now()}.json`);
    res.setHeader('Content-Type', 'application/json');
    res.json(backup);
  } catch (err) {
    res.status(500).json({ message: 'Export error' });
  }
};

// POST /api/backup/import — Full cloud restore and migration (supports merge or complete replace)
const importBackup = async (req, res) => {
  try {
    const { transactions = [], accounts = [], tools = [], mode = 'merge' } = req.body;

    const userId = req.user._id;

    // In 'replace' mode, safely archive or remove existing records before importing
    if (mode === 'replace') {
      await Promise.all([
        Transaction.deleteMany({ userId }),
        Account.deleteMany({ userId }),
        Tool.deleteMany({ userId }),
      ]);
    }

    // Helper to normalize transactions from either Mongo dumps or local browser JSON
    const txRecords = transactions.map((t) => ({
      userId,
      localId: t.localId || t.id || t._id?.toString() || new mongoose.Types.ObjectId().toString(),
      type: t.type || 'expense',
      amount: Number(t.amount) || 0,
      category: t.category || 'General',
      account: t.account || 'Cash in Hand',
      toAccount: t.toAccount || '',
      date: t.date ? new Date(t.date) : new Date(),
      note: t.note || t.title || '',
      receiptImage: t.receiptImage || null,
      isDeleted: t.isDeleted === 1 || t.isDeleted === true,
      clientUpdatedAt: t.clientUpdatedAt ? new Date(t.clientUpdatedAt) : new Date(),
    }));

    // Helper to normalize accounts
    const acRecords = accounts.map((a) => ({
      userId,
      localId: a.localId || a.id || a._id?.toString() || new mongoose.Types.ObjectId().toString(),
      name: a.name || 'Account',
      type: a.type || 'bank',
      balance: Number(a.balance) || 0,
      isDeleted: a.isDeleted === 1 || a.isDeleted === true,
      clientUpdatedAt: a.clientUpdatedAt ? new Date(a.clientUpdatedAt) : new Date(),
    }));

    // Helper to normalize tools (debts/repayments)
    const tlRecords = tools.map((tool) => ({
      userId,
      localId: tool.localId || tool.id || tool._id?.toString() || new mongoose.Types.ObjectId().toString(),
      toolType: tool.toolType || (tool.data?.type ? 'debt' : 'savings_goal'),
      data: tool.data || tool,
      isDeleted: tool.isDeleted === 1 || tool.isDeleted === true,
      clientUpdatedAt: tool.clientUpdatedAt ? new Date(tool.clientUpdatedAt) : new Date(),
    }));

    // Bulk upsert into MongoDB Atlas
    const [txResults, acResults, tlResults] = await Promise.all([
      Promise.allSettled(
        txRecords.map((t) =>
          Transaction.findOneAndUpdate(
            { userId, localId: t.localId },
            { $set: t },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          )
        )
      ),
      Promise.allSettled(
        acRecords.map((a) =>
          Account.findOneAndUpdate(
            { userId, localId: a.localId },
            { $set: a },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          )
        )
      ),
      Promise.allSettled(
        tlRecords.map((tool) =>
          Tool.findOneAndUpdate(
            { userId, localId: tool.localId },
            { $set: tool },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          )
        )
      ),
    ]);

    const txSuccess = txResults.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const acSuccess = acResults.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const tlSuccess = tlResults.filter((r) => r.status === 'fulfilled').map((r) => r.value);

    res.json({
      message: mode === 'replace' ? 'Full restore complete (replaced)' : 'Merge complete',
      imported: {
        transactions: txSuccess.length,
        accounts: acSuccess.length,
        tools: tlSuccess.length,
      },
      restoredRecords: {
        transactions: txSuccess,
        accounts: acSuccess,
        tools: tlSuccess,
      },
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ message: 'Import error: ' + err.message });
  }
};

module.exports = { createInvite, getUsers, deactivateUser, deleteUser, exportBackup, importBackup, resetUserPassword };
