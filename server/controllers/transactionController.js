const Transaction = require('../models/Transaction');

// GET /api/transactions
// Query: ?page=1&limit=50&type=expense&account=bKash&startDate=&endDate=&search=
const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 100, type, account, startDate, endDate, search } = req.query;

    const filter = { userId: req.user._id, isDeleted: false };
    if (type) filter.type = type;
    if (account) filter.account = account;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }
    if (search) {
      filter.$or = [
        { note: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { account: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ transactions, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching transactions' });
  }
};

// POST /api/transactions
const createTransaction = async (req, res) => {
  try {
    const { localId, type, amount, category, account, toAccount, date, note, receiptImage, clientUpdatedAt } = req.body;

    if (!localId || !type || amount === undefined || !date) {
      return res.status(400).json({ message: 'localId, type, amount, and date are required' });
    }

    // Upsert by userId + localId (idempotent — safe to call multiple times on retry)
    const transaction = await Transaction.findOneAndUpdate(
      { userId: req.user._id, localId },
      { $set: { type, amount, category, account, toAccount, date, note, receiptImage, clientUpdatedAt, isDeleted: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ transaction });
  } catch (err) {
    console.error('Create transaction error:', err);
    res.status(500).json({ message: 'Error creating transaction' });
  }
};

// PUT /api/transactions/:localId
const updateTransaction = async (req, res) => {
  try {
    const { localId } = req.params;
    const updates = req.body;
    delete updates.userId; // never allow changing owner

    const transaction = await Transaction.findOneAndUpdate(
      { userId: req.user._id, localId },
      { $set: { ...updates, clientUpdatedAt: new Date() } },
      { new: true }
    );

    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    res.json({ transaction });
  } catch (err) {
    res.status(500).json({ message: 'Error updating transaction' });
  }
};

// DELETE /api/transactions/:localId
const deleteTransaction = async (req, res) => {
  try {
    const { localId } = req.params;

    const transaction = await Transaction.findOneAndUpdate(
      { userId: req.user._id, localId },
      { $set: { isDeleted: true } },
      { new: true }
    );

    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    res.json({ message: 'Transaction deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting transaction' });
  }
};

// POST /api/transactions/sync
// Accepts an array of local records; upserts each one — used for offline sync flush
const syncTransactions = async (req, res) => {
  try {
    const { records } = req.body; // array of transaction objects
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ message: 'records array is required' });
    }

    const results = await Promise.allSettled(
      records.map(async (r) => {
        const { localId, type, amount, category, account, toAccount, date, note, receiptImage, clientUpdatedAt, isDeleted } = r;
        return Transaction.findOneAndUpdate(
          { userId: req.user._id, localId },
          { $set: { type, amount, category, account, toAccount, date, note, receiptImage, clientUpdatedAt, isDeleted: isDeleted || false } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      })
    );

    const synced = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.localId);
    const failed = results.filter((r) => r.status === 'rejected').length;

    res.json({ synced, failed, total: records.length });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ message: 'Sync error' });
  }
};

module.exports = { getTransactions, createTransaction, updateTransaction, deleteTransaction, syncTransactions };
