import React, { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/localDb';
import api from '../services/api';
import { queueSync } from '../services/syncService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';

export default function AccountsPage() {
  const { isOnline, refreshPendingCount } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [accounts, setAccounts] = useState([]);
  const [bankTransactions, setBankTransactions] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals & Forms
  const [showTxModal, setShowTxModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null); // for edit balance modal
  const [editBalanceValue, setEditBalanceValue] = useState('');

  // Bank Transaction form state
  const [txAccount, setTxAccount] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().split('T')[0]);
  const [txType, setTxType] = useState('deposit');
  const [txAmount, setTxAmount] = useState('');
  const [txNote, setTxNote] = useState('');

  // Global search state
  const [globalSearch, setGlobalSearch] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    loadAllData();

    const handleRemoteUpdate = () => {
      loadAllData();
    };
    window.addEventListener('daily_ledger:data_updated', handleRemoteUpdate);
    return () => window.removeEventListener('daily_ledger:data_updated', handleRemoteUpdate);
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      // 1. Load accounts from db
      const localAcc = await db.accounts.where('isDeleted').equals(0).toArray();
      setAccounts(localAcc);

      // 2. Load all transactions
      const allTx = await db.transactions.where('isDeleted').equals(0).toArray();
      const bTx = allTx.filter((t) => t.category === 'Banking');
      const expTx = allTx.filter((t) => t.type === 'expense' && t.category !== 'Banking');
      const depTx = allTx.filter((t) => t.type === 'income' && t.category !== 'Banking');

      setBankTransactions(bTx);
      setExpenses(expTx);
      setDeposits(depTx);

      if (isOnline) {
        api
          .get('/accounts')
          .then(async ({ data }) => {
            if (data?.accounts) {
              await db.accounts.bulkPut(
                data.accounts.map((a) => ({
                  ...a,
                  synced: true,
                  isDeleted: a.isDeleted ? 1 : 0,
                }))
              );
              const freshAcc = await db.accounts.where('isDeleted').equals(0).toArray();
              setAccounts(freshAcc);
            }
          })
          .catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  };

  // Derive account names list
  const accountList = useMemo(() => {
    const map = new Map();
    accounts.forEach((a) => map.set(a.name, a));
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts]);

  // Compute total balance across all accounts
  const totalBankBalance = useMemo(() => {
    return accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  }, [accounts]);

  // Total accounts count
  const totalAccountsCount = useMemo(() => {
    return accounts.length;
  }, [accounts]);

  // Current month's expenses
  const thisMonthExpenses = useMemo(() => {
    const curMonth = new Date().toISOString().slice(0, 7);
    return expenses
      .filter((e) => e.date && new Date(e.date).toISOString().slice(0, 7) === curMonth)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [expenses]);

  // Get transaction count for account
  const getEntriesCountForAccount = (accName) => {
    return bankTransactions.filter((t) => t.account === accName).length;
  };

  // Edit balance handler
  const handleOpenEditBalance = (acc) => {
    setEditingAccount(acc);
    setEditBalanceValue(acc.balance !== undefined ? String(acc.balance) : '0');
  };

  const handleSaveBalance = async (e) => {
    e.preventDefault();
    if (!editingAccount) return;
    const newBal = parseFloat(editBalanceValue);
    if (isNaN(newBal)) {
      toast.warning('Please enter a valid amount.');
      return;
    }

    try {
      const updated = {
        ...editingAccount,
        balance: newBal,
        synced: false,
        clientUpdatedAt: new Date(),
      };
      await db.accounts.put(updated);
      await queueSync('accounts', updated.localId, 'update', updated);
      refreshPendingCount();

      setAccounts((prev) =>
        prev.map((a) => (a.localId === updated.localId ? updated : a))
      );
      toast.success(
        `Updated ${editingAccount.name} balance to ৳${newBal.toLocaleString('en-US')}`
      );
      setEditingAccount(null);
    } catch (err) {
      console.error(err);
      toast.error('Failed to update balance');
    }
  };

  const handleDeleteAccount = async (acc) => {
    const ok = await confirm({
      title: 'Delete Account',
      message: `Are you sure you want to delete the account "${acc.name}"? It will be removed from your accounts list.`,
      confirmText: 'Delete Account',
      danger: true,
    });
    if (!ok) return;

    try {
      const updated = { ...acc, isDeleted: 1, synced: false, clientUpdatedAt: new Date() };
      await db.accounts.put(updated);
      await queueSync('accounts', acc.localId, 'delete', { localId: acc.localId });
      refreshPendingCount();

      setAccounts((prev) => prev.filter((a) => a.localId !== acc.localId));
      setEditingAccount(null);
      toast.info(`Account "${acc.name}" deleted.`);
    } catch (err) {
      toast.error('Failed to delete account');
    }
  };

  // Record Bank Transaction (Deposit / Withdrawal)
  const handleSaveBankTx = async (e) => {
    e.preventDefault();
    const num = parseFloat(txAmount);
    if (isNaN(num) || num <= 0) {
      toast.warning('Please enter a valid amount.');
      return;
    }
    const accName = txAccount.trim();
    if (!accName) {
      toast.warning('Please enter or select an account name.');
      return;
    }

    try {
      const newTx = {
        localId: uuidv4(),
        type: txType === 'deposit' ? 'income' : 'expense',
        amount: num,
        category: 'Banking',
        account: accName,
        date: new Date(txDate),
        note: txNote.trim(),
        synced: false,
        isDeleted: 0,
        clientUpdatedAt: new Date(),
      };
      await db.transactions.add(newTx);
      await queueSync('transactions', newTx.localId, 'create', newTx);

      const existingAcc = accounts.find(
        (a) => a.name.toLowerCase() === accName.toLowerCase()
      );
      const delta = txType === 'deposit' ? num : -num;
      if (existingAcc) {
        const updatedAcc = {
          ...existingAcc,
          balance: (Number(existingAcc.balance) || 0) + delta,
          synced: false,
          clientUpdatedAt: new Date(),
        };
        await db.accounts.put(updatedAcc);
        await queueSync('accounts', updatedAcc.localId, 'update', updatedAcc);
        setAccounts((prev) =>
          prev.map((a) => (a.localId === updatedAcc.localId ? updatedAcc : a))
        );
      } else {
        const newAcc = {
          localId: uuidv4(),
          name: accName,
          type: 'bank',
          balance: delta,
          synced: false,
          isDeleted: 0,
          clientUpdatedAt: new Date(),
        };
        await db.accounts.add(newAcc);
        await queueSync('accounts', newAcc.localId, 'create', newAcc);
        setAccounts((prev) => [...prev, newAcc]);
      }

      refreshPendingCount();
      setBankTransactions((prev) => [newTx, ...prev]);
      toast.success(
        `${txType === 'deposit' ? 'Deposit' : 'Withdrawal'} of ৳${num.toLocaleString('en-US')} recorded for ${accName}`
      );

      setTxAmount('');
      setTxNote('');
      setShowTxModal(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save bank transaction');
    }
  };

  // Global search filtering
  const globalSearchResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];

    const rows = [];
    expenses.forEach((e) => {
      const match =
        (e.note || '').toLowerCase().includes(q) ||
        (e.category || '').toLowerCase().includes(q) ||
        (new Date(e.date).toISOString().split('T')[0] || '').includes(q);
      if (match) {
        rows.push({
          id: e.localId,
          title: e.note || 'Expense',
          date: new Date(e.date).toISOString().split('T')[0],
          kind: 'Expense',
          amount: Number(e.amount) || 0,
          sign: '−',
          isExpense: true,
        });
      }
    });

    deposits.forEach((d) => {
      const match =
        (d.note || '').toLowerCase().includes(q) ||
        (new Date(d.date).toISOString().split('T')[0] || '').includes(q);
      if (match) {
        rows.push({
          id: d.localId,
          title: d.note || 'Deposit',
          date: new Date(d.date).toISOString().split('T')[0],
          kind: 'Tk in',
          amount: Number(d.amount) || 0,
          sign: '+',
          isExpense: false,
        });
      }
    });

    bankTransactions.forEach((t) => {
      const match =
        (t.account || '').toLowerCase().includes(q) ||
        (t.note || '').toLowerCase().includes(q) ||
        (new Date(t.date).toISOString().split('T')[0] || '').includes(q);
      if (match) {
        rows.push({
          id: t.localId,
          title: `${t.account} · ${t.note || (t.type === 'expense' ? 'Withdrawal' : 'Deposit')}`,
          date: new Date(t.date).toISOString().split('T')[0],
          kind: 'Account',
          amount: Number(t.amount) || 0,
          sign: t.type === 'expense' ? '−' : '+',
          isExpense: t.type === 'expense',
        });
      }
    });

    return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  }, [globalSearch, expenses, deposits, bankTransactions]);

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;

  return (
    <div className="bank-page-container">
      {/* 1. Neon Glowing Circle Card matching Expenses and Today tab */}
      <div className="panel p-4 expense-total-panel">
        <div className="finance-summary-heading">
          <span className="finance-summary-icon">🏦</span>
          <h2>BANK BALANCE OVERVIEW</h2>
        </div>

        <div className="finance-summary-wrap">
          <div className="balance-ring">
            <div className="balance-inner">
              <div className="balance-label">TOTAL BANK BALANCE</div>
              <div id="bankCircleTotal" className="balance-amount">
                {fmt(totalBankBalance)}
              </div>
              <div className="balance-subtitle">
                Across {totalAccountsCount} active {totalAccountsCount === 1 ? 'account' : 'accounts'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Section Header: All Accounts Dashboard */}
      <div className="bank-section-heading-block">
        <span className="deposit-badge-label">OVERVIEW</span>
        <h2 className="bank-section-title">All Accounts Dashboard</h2>
        <p className="bank-section-sub">
          Bank, mobile wallet and cash balances tracked from transactions you enter. Old static notes are not treated as new money.
        </p>
      </div>

      {/* 3. Three Metrics Cards Grid */}
      <div className="bank-metrics-grid">
        <div className="bank-metric-card">
          <div className="bank-metric-tag">Tracked account total</div>
          <div className="bank-metric-val">{fmt(totalBankBalance)}</div>
          <p className="bank-metric-sub">Net balance across listed accounts</p>
        </div>

        <div className="bank-metric-card">
          <div className="bank-metric-tag">Accounts</div>
          <div className="bank-metric-val">{totalAccountsCount}</div>
          <p className="bank-metric-sub">Accounts with transactions</p>
        </div>

        <div className="bank-metric-card">
          <div className="bank-metric-tag">This month's expenses</div>
          <div className="bank-metric-val">{fmt(thisMonthExpenses)}</div>
          <p className="bank-metric-sub">Itemized expenses only</p>
        </div>
      </div>

      {/* 4. Account-wise balance List Card */}
      <div className="bank-accounts-panel">
        <div className="bank-panel-header">
          <div>
            <h3 className="bank-panel-title">Account-wise balance</h3>
            <p className="bank-panel-subtitle">Balances updated from entries & transfers</p>
          </div>
          <button
            className="bank-add-action-btn"
            type="button"
            onClick={() => {
              setTxAccount(accountList[0]?.name || '');
              setShowTxModal(true);
            }}
          >
            <span>+</span> Add account or transfer
          </button>
        </div>

        <div className="bank-accounts-list">
          {accountList.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              No accounts tracked yet. Add an account or record an opening balance.
            </p>
          ) : (
            accountList.map((acc) => (
              <div key={acc.localId} className="bank-account-card">
                <div className="bank-account-card-main">
                  <div className="bank-account-info">
                    <span className="bank-account-name">{acc.name}</span>
                    <span className="bank-account-meta">
                      {getEntriesCountForAccount(acc.name)} entries
                    </span>
                  </div>

                  <div className="bank-account-right">
                    <span className="bank-account-amount">
                      {fmt(acc.balance)}
                    </span>
                  </div>
                </div>

                <div className="bank-account-action-row">
                  <button
                    type="button"
                    onClick={() => handleOpenEditBalance(acc)}
                    className="bank-edit-balance-pill"
                  >
                    Edit balance
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="bank-note-box">
          <span className="bank-note-icon">ℹ</span>
          <p className="bank-note-text">
            Important: enter a starting balance as an opening-balance transaction if you want the dashboard to show the current real-world balance. Do not enter it as income.
          </p>
        </div>
      </div>

      {/* 5. Global Search Panel */}
      <div className="bank-search-panel">
        <div className="bank-panel-header">
          <div>
            <h3 className="bank-panel-title">Global search</h3>
            <p className="bank-panel-subtitle">
              Search expenses, money-in entries, and account transactions together.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setHasSearched(true);
          }}
          className="bank-search-form"
        >
          <div className="bank-search-input-wrap">
            <span className="bank-search-icon">🔍</span>
            <input
              id="globalSearch"
              value={globalSearch}
              onChange={(e) => {
                setGlobalSearch(e.target.value);
                setHasSearched(true);
              }}
              className="bank-search-input"
              placeholder="e.g. bKash, dinner, 2026-10-04"
            />
          </div>
          <button className="bank-search-btn" type="submit">
            Search
          </button>
        </form>

        {hasSearched && globalSearch.trim() && (
          <div className="bank-search-results">
            {globalSearchResults.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">No matching records found.</p>
            ) : (
              globalSearchResults.map((r) => (
                <div
                  key={`${r.kind}_${r.id}`}
                  className="bank-search-row"
                >
                  <div className="min-w-0 flex-1">
                    <div className="bank-search-row-title">{r.title}</div>
                    <div className="bank-search-row-meta">
                      {r.date || 'Date not specified'} · {r.kind}
                    </div>
                  </div>
                  <strong
                    className={`bank-search-row-amt ${
                      r.isExpense ? 'is-expense' : 'is-income'
                    }`}
                  >
                    {r.sign}
                    {fmt(r.amount)}
                  </strong>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal: Edit Account Balance */}
      {editingAccount && (
        <div className="modal-backdrop" onClick={() => setEditingAccount(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-slate-100">
                Edit {editingAccount.name} Balance
              </h3>
              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBalance} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1.5 text-slate-300">
                  Current Balance (৳)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editBalanceValue}
                  onChange={(e) => setEditBalanceValue(e.target.value)}
                  className="field w-full"
                  required
                  autoFocus
                />
              </div>

              <div className="flex justify-between items-center pt-3">
                <button
                  type="button"
                  onClick={() => handleDeleteAccount(editingAccount)}
                  style={{
                    color: '#f87171',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🗑️ Delete Account
                </button>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingAccount(null)}
                    className="secondary px-4 py-2 text-sm rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="deposit-submit-btn px-6"
                    style={{ height: '42px', minWidth: '130px' }}
                  >
                    Save Balance
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Account or Transaction */}
      {showTxModal && (
        <div className="modal-backdrop" onClick={() => setShowTxModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-slate-100">Record Bank Transaction</h3>
              <button
                type="button"
                onClick={() => setShowTxModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBankTx} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1.5 text-slate-300">
                  Bank / Account Name
                </label>
                <input
                  type="text"
                  list="accountSuggestions"
                  value={txAccount}
                  onChange={(e) => setTxAccount(e.target.value)}
                  placeholder="e.g. bKash, Prime Bank, Islamic Bank"
                  className="field w-full"
                  required
                />
                <datalist id="accountSuggestions">
                  {accountList.map((a) => (
                    <option key={a.localId} value={a.name} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1.5 text-slate-300">Date</label>
                  <input
                    type="date"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="field w-full"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1.5 text-slate-300">Type</label>
                  <select
                    value={txType}
                    onChange={(e) => setTxType(e.target.value)}
                    className="field w-full"
                  >
                    <option value="deposit">Deposit (+)</option>
                    <option value="withdrawal">Withdrawal (−)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1.5 text-slate-300">
                  Amount (৳)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="5000"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  className="field w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1.5 text-slate-300">
                  Note (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Salary, ATM withdrawal"
                  value={txNote}
                  onChange={(e) => setTxNote(e.target.value)}
                  className="field w-full"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowTxModal(false)}
                  className="secondary px-4 py-2 text-sm rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="deposit-submit-btn px-6"
                  style={{ height: '42px', minWidth: '160px' }}
                >
                  + Save Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
