const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const Tool = require('../models/Tool');

/**
 * GET /api/sync/pull?since=<ISO_TIMESTAMP>
 * Returns all records updated or created after `since` across transactions, accounts, and tools.
 * Includes soft-deleted items so clients can remove them locally.
 */
const pullDeltas = async (req, res) => {
  try {
    const userId = req.user._id;
    const { since } = req.query;

    const queryFilter = { userId };
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        queryFilter.updatedAt = { $gt: sinceDate };
      }
    }

    const [transactions, accounts, tools] = await Promise.all([
      Transaction.find(queryFilter).lean(),
      Account.find(queryFilter).lean(),
      Tool.find(queryFilter).lean(),
    ]);

    const serverTime = new Date().toISOString();

    res.json({
      serverTime,
      transactions: transactions.map((t) => ({
        localId: t.localId,
        type: t.type,
        amount: t.amount,
        category: t.category,
        account: t.account,
        toAccount: t.toAccount,
        date: t.date,
        note: t.note,
        receiptImage: t.receiptImage,
        isDeleted: t.isDeleted ? 1 : 0,
        synced: true,
        clientUpdatedAt: t.clientUpdatedAt || t.updatedAt,
      })),
      accounts: accounts.map((a) => ({
        localId: a.localId,
        name: a.name,
        type: a.type,
        balance: a.balance,
        institution: a.institution || '',
        accountNumber: a.accountNumber || '',
        maturityDate: a.maturityDate || null,
        notes: a.notes || '',
        documentUrl: a.documentUrl || null,
        documentName: a.documentName || '',
        documentType: a.documentType || '',
        isDeleted: a.isDeleted ? 1 : 0,
        synced: true,
        clientUpdatedAt: a.clientUpdatedAt || a.updatedAt,
      })),
      tools: tools.map((tool) => ({
        localId: tool.localId,
        toolType: tool.toolType,
        data: tool.data,
        isDeleted: tool.isDeleted ? 1 : 0,
        synced: true,
        clientUpdatedAt: tool.clientUpdatedAt || tool.updatedAt,
      })),
    });
  } catch (err) {
    console.error('Pull deltas error:', err);
    res.status(500).json({ message: 'Error pulling delta changes' });
  }
};

module.exports = { pullDeltas };
