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
    const user = await User.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deactivated', user });
  } catch (err) {
    res.status(500).json({ message: 'Error deactivating user' });
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

// POST /api/backup/import — merge import for authenticated user
const importBackup = async (req, res) => {
  try {
    const { transactions = [], accounts = [], tools = [] } = req.body;

    // Validate structure
    if (!Array.isArray(transactions) || !Array.isArray(accounts) || !Array.isArray(tools)) {
      return res.status(400).json({ message: 'Invalid backup structure' });
    }

    const userId = req.user._id;

    // Upsert all records (merge, not replace)
    const [txResults, acResults, tlResults] = await Promise.all([
      Promise.allSettled(
        transactions.map(({ localId, type, amount, category, account, toAccount, date, note, clientUpdatedAt }) =>
          localId
            ? Transaction.findOneAndUpdate(
                { userId, localId },
                { $setOnInsert: { type, amount, category, account, toAccount, date, note, clientUpdatedAt } },
                { upsert: true, new: true }
              )
            : Promise.reject('missing localId')
        )
      ),
      Promise.allSettled(
        accounts.map(({ localId, name, type, balance }) =>
          localId
            ? Account.findOneAndUpdate(
                { userId, localId },
                { $setOnInsert: { name, type, balance } },
                { upsert: true, new: true }
              )
            : Promise.reject('missing localId')
        )
      ),
      Promise.allSettled(
        tools.map(({ localId, toolType, data }) =>
          localId
            ? Tool.findOneAndUpdate(
                { userId, localId },
                { $setOnInsert: { toolType, data } },
                { upsert: true, new: true }
              )
            : Promise.reject('missing localId')
        )
      ),
    ]);

    res.json({
      message: 'Import complete',
      imported: {
        transactions: txResults.filter((r) => r.status === 'fulfilled').length,
        accounts: acResults.filter((r) => r.status === 'fulfilled').length,
        tools: tlResults.filter((r) => r.status === 'fulfilled').length,
      },
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ message: 'Import error' });
  }
};

module.exports = { createInvite, getUsers, deactivateUser, exportBackup, importBackup, resetUserPassword };
