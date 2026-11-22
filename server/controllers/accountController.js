const Account = require('../models/Account');

const getAccounts = async (req, res) => {
  try {
    const accounts = await Account.find({ userId: req.user._id, isDeleted: false }).sort({ name: 1 });
    res.json({ accounts });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching accounts' });
  }
};

const createAccount = async (req, res) => {
  try {
    const { localId, name, type, balance, institution, accountNumber, maturityDate, notes, clientUpdatedAt } = req.body;
    if (!localId || !name) return res.status(400).json({ message: 'localId and name are required' });

    const account = await Account.findOneAndUpdate(
      { userId: req.user._id, localId },
      {
        $set: {
          name,
          type: type || 'bank',
          balance: Number(balance) || 0,
          institution: institution || '',
          accountNumber: accountNumber || '',
          maturityDate: maturityDate || null,
          notes: notes || '',
          clientUpdatedAt,
          isDeleted: false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ account });
  } catch (err) {
    res.status(500).json({ message: 'Error creating account' });
  }
};

const updateAccount = async (req, res) => {
  try {
    const { localId } = req.params;
    const updates = req.body;
    delete updates.userId;

    const account = await Account.findOneAndUpdate(
      { userId: req.user._id, localId },
      { $set: { ...updates, clientUpdatedAt: new Date() } },
      { new: true }
    );
    if (!account) return res.status(404).json({ message: 'Account not found' });
    res.json({ account });
  } catch (err) {
    res.status(500).json({ message: 'Error updating account' });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const { localId } = req.params;
    const account = await Account.findOneAndUpdate(
      { userId: req.user._id, localId },
      { $set: { isDeleted: true } },
      { new: true }
    );
    if (!account) return res.status(404).json({ message: 'Account not found' });
    res.json({ message: 'Account deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting account' });
  }
};

const syncAccounts = async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ message: 'records array required' });

    const results = await Promise.allSettled(
      records.map(
        ({ localId, name, type, balance, institution, accountNumber, maturityDate, notes, clientUpdatedAt, isDeleted }) =>
          Account.findOneAndUpdate(
            { userId: req.user._id, localId },
            {
              $set: {
                name,
                type: type || 'bank',
                balance: Number(balance) || 0,
                institution: institution || '',
                accountNumber: accountNumber || '',
                maturityDate: maturityDate || null,
                notes: notes || '',
                clientUpdatedAt,
                isDeleted: isDeleted || false,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          )
      )
    );

    const synced = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.localId);
    res.json({ synced, failed: results.filter((r) => r.status === 'rejected').length });
  } catch (err) {
    res.status(500).json({ message: 'Sync error' });
  }
};

module.exports = { getAccounts, createAccount, updateAccount, deleteAccount, syncAccounts };
