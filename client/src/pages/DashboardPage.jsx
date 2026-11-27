import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Plus, Wallet, Pencil, Receipt, ChevronRight } from 'lucide-react';
import { ICON_STROKE } from '../components/AppIcons';
import db from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { queueSync } from '../services/syncService';
import { adjustAccountBalance, getAllAccounts } from '../services/accountService';
import api from '../services/api';

export default function DashboardPage() {
  const { isOnline, refreshPendingCount } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  // Selected date for daily entry & entries for selected day (defaults to today)
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // Accounts state
  const [availableAccounts, setAvailableAccounts] = useState([]);

  // Modal & Form State for Expense Add/Edit
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    title: '',
    amount: '',
    account: 'Cash in Hand',
    category: 'Food & drinks',
    date: todayStr,
  });

  // Data states
  const [stats, setStats] = useState({
    balance: 0,
    cashInHand: 0,
    todayTotal: 0,
    allExpenses: 0,
    recordedDays: 0,
    remaining: 0,
  });
  const [dayEntries, setDayEntries] = useState([]);
  const [dayTotal, setDayTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();

    // Listen for delta sync updates
    const handleRemoteUpdate = () => {
      loadDashboardData();
    };
    window.addEventListener('daily_ledger:data_updated', handleRemoteUpdate);
    return () => window.removeEventListener('daily_ledger:data_updated', handleRemoteUpdate);
  }, [selectedDate]);

  const loadDashboardData = async () => {
    try {
      // 1. Load active transactions and accounts
      const [allTx, allAccounts] = await Promise.all([
        db.transactions.where('isDeleted').equals(0).toArray(),
        getAllAccounts(),
      ]);

      setAvailableAccounts(allAccounts);
      calculateMetrics(allTx, selectedDate, allAccounts);

      // Background sync from server if online
      if (isOnline) {
        api.get('/transactions?limit=2000').then(async (res) => {
          if (res.data?.transactions) {
            await db.transactions.bulkPut(
              res.data.transactions.map((t) => ({
                ...t,
                localId: t.localId,
                synced: true,
                isDeleted: t.isDeleted ? 1 : 0,
              }))
            );
            const [refreshedTx, refreshedAcc] = await Promise.all([
              db.transactions.where('isDeleted').equals(0).toArray(),
              getAllAccounts(),
            ]);
            setAvailableAccounts(refreshedAcc);
            calculateMetrics(refreshedTx, selectedDate, refreshedAcc);
          }
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const calculateMetrics = (txs, targetDate, accountsList = []) => {
    // Everyday Tk in (deposits / allowances) vs Everyday expenses (excluding bank transfers/bank balance)
    const everydayExpenses = txs.filter((t) => t.type === 'expense' && t.category !== 'Banking');
    const everydayDeposits = txs.filter((t) => t.type === 'income' && t.category !== 'Banking');

    const totalExpenseAmount = everydayExpenses.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const totalDepositAmount = everydayDeposits.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    // Liquid balance from registered accounts (Bank, MFS, Cash)
    const liquidAccs = accountsList.filter((a) => a.type !== 'fdr' && a.type !== 'asset');
    const accountsTotal = liquidAccs.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

    // Cash in Hand: accounts of type 'cash' or name containing 'cash'
    const cashAccs = accountsList.filter((a) => a.type === 'cash' || /cash/i.test(a.name));
    const cashTotal = cashAccs.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

    // If user has set up accounts, use the real liquid accounts total; otherwise fallback to deposits - expenses
    const trueLiquidBalance = liquidAccs.length > 0 ? accountsTotal : Math.max(0, totalDepositAmount - totalExpenseAmount);
    const cashInHand = cashAccs.length > 0 ? cashTotal : (accountsList.length === 0 ? trueLiquidBalance : 0);

    // Days with expense records count
    const uniqueDays = new Set(
      everydayExpenses.map((t) => {
        const d = new Date(t.date);
        return isNaN(d) ? '' : d.toISOString().split('T')[0];
      }).filter(Boolean)
    );

    // Today's expenses
    const todayFormatted = new Date().toISOString().split('T')[0];
    const todayExpenses = everydayExpenses.filter((t) => {
      const d = new Date(t.date).toISOString().split('T')[0];
      return d === todayFormatted;
    });
    const todayTotal = todayExpenses.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    // Entries for selected date
    const selectedEntries = everydayExpenses.filter((t) => {
      const d = new Date(t.date).toISOString().split('T')[0];
      return d === targetDate;
    });
    const selectedTotal = selectedEntries.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    setStats({
      balance: trueLiquidBalance,
      cashInHand,
      todayTotal,
      allExpenses: totalExpenseAmount,
      recordedDays: uniqueDays.size,
      remaining: trueLiquidBalance,
    });
    setDayEntries(selectedEntries);
    setDayTotal(selectedTotal);
  };

  const liquidAccounts = React.useMemo(() => {
    // Only liquid capital accounts (cash, mfs, bank, other) — exclude fixed deposits (fdr) and physical assets (asset)
    const registered = (availableAccounts || []).filter(
      (a) => a.type !== 'fdr' && a.type !== 'asset'
    );

    const map = new Map();
    registered.forEach((a) => map.set(a.name.toLowerCase(), a));

    // Common default liquid wallets if user hasn't explicitly registered them
    const defaults = [
      { name: 'Cash in Hand', type: 'cash' },
      { name: 'bKash', type: 'mfs' },
      { name: 'Nagad', type: 'mfs' },
    ];
    defaults.forEach((d) => {
      if (!map.has(d.name.toLowerCase())) {
        map.set(d.name.toLowerCase(), d);
      }
    });

    // If currently editing/selected account is not yet in map, preserve it
    if (expenseForm.account && !map.has(expenseForm.account.toLowerCase())) {
      map.set(expenseForm.account.toLowerCase(), {
        name: expenseForm.account,
        type: 'other',
      });
    }

    const all = Array.from(map.values());
    return {
      cash: all.filter((a) => a.type === 'cash'),
      mfs: all.filter((a) => a.type === 'mfs'),
      bank: all.filter((a) => a.type === 'bank'),
      other: all.filter((a) => a.type !== 'cash' && a.type !== 'mfs' && a.type !== 'bank'),
    };
  }, [availableAccounts, expenseForm.account]);

  const handleOpenAddExpense = (presetDate) => {
    setEditingTx(null);
    const defaultAcc =
      availableAccounts.find((a) => a.type !== 'fdr' && a.type !== 'asset')?.name ||
      'Cash in Hand';
    setExpenseForm({
      title: '',
      amount: '',
      account: defaultAcc,
      category: 'Food & drinks',
      date: presetDate || selectedDate || todayStr,
    });
    setShowExpenseModal(true);
  };

  const handleStartEdit = (entry) => {
    setEditingTx(entry);
    setExpenseForm({
      title: entry.note || '',
      amount: entry.amount,
      account: entry.account || 'Cash in Hand',
      category: entry.category || 'General',
      date: entry.date ? new Date(entry.date).toISOString().split('T')[0] : todayStr,
    });
    setShowExpenseModal(true);
  };

  const handleSaveExpenseModal = async (e) => {
    e.preventDefault();
    if (!expenseForm.title.trim() || !expenseForm.amount) return;

    setIsSubmitting(true);
    const numAmount = parseFloat(expenseForm.amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error('Please enter a valid amount');
      setIsSubmitting(false);
      return;
    }

    const localId = editingTx?.localId || uuidv4();
    const chosenAcc = (expenseForm.account || 'Cash in Hand').trim();
    const newTx = {
      localId,
      type: 'expense',
      amount: numAmount,
      category: expenseForm.category || 'General',
      account: chosenAcc,
      date: new Date(expenseForm.date),
      note: expenseForm.title.trim(),
      synced: false,
      isDeleted: 0,
      clientUpdatedAt: new Date(),
    };

    try {
      await db.transactions.put(newTx);
      await queueSync('transactions', localId);

      // Reconcile balance
      if (editingTx) {
        await adjustAccountBalance(editingTx.account || 'Cash in Hand', Number(editingTx.amount));
      }
      await adjustAccountBalance(chosenAcc, -numAmount);

      if (isOnline) {
        try {
          if (editingTx) {
            await api.put(`/transactions/${localId}`, newTx);
          } else {
            await api.post('/transactions', newTx);
          }
          await db.transactions.update(localId, { synced: true });
          await db.syncQueue.where({ entity: 'transactions', localId }).delete();
        } catch {}
      }

      await refreshPendingCount();
      toast.success(editingTx ? 'Expense updated successfully!' : `Added ৳${numAmount} for "${expenseForm.title.trim()}"`);
      setShowExpenseModal(false);
      setEditingTx(null);
      await loadDashboardData();
    } catch (err) {
      toast.error('Failed to save expense');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEntry = async (entry) => {
    const ok = await confirm({
      title: 'Delete Expense',
      message: `Are you sure you want to delete "${entry.note || 'expense'}" for ৳${entry.amount}?`,
      confirmText: 'Delete Expense',
      danger: true,
    });
    if (!ok) return;

    await db.transactions.update(entry.localId, { isDeleted: 1, synced: false });
    await queueSync('transactions', entry.localId);

    // Revert account deduction so money returns to account balance
    await adjustAccountBalance(entry.account || 'Cash in Hand', Number(entry.amount));

    if (isOnline) {
      try {
        await api.delete(`/transactions/${entry.localId}`);
        await db.transactions.update(entry.localId, { synced: true });
        await db.syncQueue.where({ entity: 'transactions', localId: entry.localId }).delete();
      } catch {}
    }

    toast.info('Entry deleted');
    loadDashboardData();
  };

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-IN')}`;

  const todayLabel = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="pitch-dashboard">
      {/* 1. Neon Glowing Cash in Hand Hero — matching Expense Summary Circle */}
      <div className="panel p-4 expense-total-panel">
        <div className="finance-summary-heading">
          <Wallet size={18} strokeWidth={ICON_STROKE} className="finance-summary-icon" aria-hidden="true" />
          <h2>CASH SUMMARY</h2>
        </div>

        <div className="balance-screen" style={{ paddingTop: '8px', paddingBottom: '6px' }}>
          <div className="balance-ring">
            <div className="balance-inner">
              <div className="balance-label">CASH IN HAND</div>
              <div id="homeBalanceHero" className="balance-amount">
                {fmt(stats.cashInHand)}
              </div>
              <div className="balance-subtitle">
                Physical cash in hand · Real-time synced
              </div>
            </div>
          </div>

          <div className="balance-actions">
            <button
              type="button"
              onClick={() => handleOpenAddExpense(todayStr)}
              className="balance-action"
              style={{ gap: '8px' }}
            >
              <Plus size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
              Add Expense
              <ChevronRight size={17} strokeWidth={ICON_STROKE} className="balance-action-chevron" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/accounts')}
              className="balance-action"
              style={{ gap: '8px' }}
            >
              <Wallet size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
              Banks & Assets
              <ChevronRight size={17} strokeWidth={ICON_STROKE} className="balance-action-chevron" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. 4-Box Summary Grid */}
      <div className="metrics-grid">
        <div className="panel p-4">
          <div className="tiny-label">Today's total</div>
          <div id="todayTotal" className="metric-value">{fmt(stats.todayTotal)}</div>
          <div id="todayDateLabel" className="metric-sub">{todayLabel}</div>
        </div>

        <div
          className="panel p-4"
          onClick={() => navigate('/accounts')}
          style={{ cursor: 'pointer' }}
          title="Click to view all bank and wallet accounts"
        >
          <div className="tiny-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Wallet size={14} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
            <span>Total liquid balance</span>
          </div>
          <div id="homeTotalLiquid" className="metric-value" style={{ color: '#38bdf8' }}>
            {fmt(stats.balance)}
          </div>
          <div className="metric-sub">Across Banks, Wallets & Cash</div>
        </div>

        <div className="panel p-4">
          <div className="tiny-label">All recorded expenses</div>
          <div id="allTotal" className="metric-value">{fmt(stats.allExpenses)}</div>
          <div className="metric-sub">Calculated from itemized entries</div>
        </div>

        <div className="panel p-4">
          <div className="tiny-label">Recorded days</div>
          <div id="dayCount" className="metric-value">{stats.recordedDays}</div>
          <div className="metric-sub">Days with expense records</div>
        </div>
      </div>

      {/* 4. Add / Edit Expense Modal */}
      {showExpenseModal && (
        <div className="modal-overlay" onClick={() => setShowExpenseModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {editingTx ? (
                  <>
                    <Pencil size={18} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
                    <span>Edit Expense</span>
                  </>
                ) : (
                  <>
                    <Receipt size={18} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
                    <span>Add Expense</span>
                  </>
                )}
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowExpenseModal(false)}
                title="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveExpenseModal} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="dash-expense-date">Date</label>
                <input
                  id="dash-expense-date"
                  type="date"
                  className="field"
                  value={expenseForm.date}
                  onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="dash-expense-title">Expense Title</label>
                <input
                  id="dash-expense-title"
                  type="text"
                  className="field"
                  placeholder="e.g. Cha, Rickshaw, Lunch, Groceries"
                  value={expenseForm.title}
                  onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })}
                  required
                  autoFocus
                />
              </div>

              <div className="expense-modal-amount-category-grid">
                <div className="form-item">
                  <label className="form-label" htmlFor="dash-expense-amount">Amount (৳)</label>
                  <input
                    id="dash-expense-amount"
                    type="number"
                    min="0.01"
                    step="any"
                    className="field"
                    placeholder="35"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                    required
                  />
                </div>

                <div className="form-item">
                  <label className="form-label" htmlFor="dash-expense-category">Category</label>
                  <select
                    id="dash-expense-category"
                    className="field"
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                  >
                    <option value="Food & drinks">Food & Drinks</option>
                    <option value="Transport">Transport / Fare</option>
                    <option value="Phone & communication">Phone & Internet</option>
                    <option value="Health">Health & Medicine</option>
                    <option value="Personal care">Personal Care</option>
                    <option value="Clothing">Clothing</option>
                    <option value="Study & supplies">Study & Supplies</option>
                    <option value="Housing">Housing & Rent</option>
                    <option value="Laundry & household">Household & Utilities</option>
                    <option value="General">General / Other</option>
                  </select>
                </div>
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="dash-expense-account">
                  Paid From Account (Liquid Cash)
                </label>
                <select
                  id="dash-expense-account"
                  className="field"
                  value={expenseForm.account}
                  onChange={(e) => setExpenseForm({ ...expenseForm, account: e.target.value })}
                  required
                >
                  {liquidAccounts.cash.length > 0 && (
                    <optgroup label="💵 Cash in Hand">
                      {liquidAccounts.cash.map((a) => (
                        <option key={a.localId || a.name} value={a.name}>
                          {a.name} {a.balance !== undefined ? `(৳${Number(a.balance || 0).toLocaleString('en-US')})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {liquidAccounts.mfs.length > 0 && (
                    <optgroup label="📱 Mobile Wallets (bKash / Nagad / Rocket)">
                      {liquidAccounts.mfs.map((a) => (
                        <option key={a.localId || a.name} value={a.name}>
                          {a.name} {a.balance !== undefined ? `(৳${Number(a.balance || 0).toLocaleString('en-US')})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {liquidAccounts.bank.length > 0 && (
                    <optgroup label="🏦 Bank Accounts">
                      {liquidAccounts.bank.map((a) => (
                        <option key={a.localId || a.name} value={a.name}>
                          {a.name} {a.balance !== undefined ? `(৳${Number(a.balance || 0).toLocaleString('en-US')})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {liquidAccounts.other.length > 0 && (
                    <optgroup label="💳 Other Liquid Accounts">
                      {liquidAccounts.other.map((a) => (
                        <option key={a.localId || a.name} value={a.name}>
                          {a.name} {a.balance !== undefined ? `(৳${Number(a.balance || 0).toLocaleString('en-US')})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="modal-actions" style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="secondary"
                  style={{ height: '42px', padding: '0 20px', borderRadius: '10px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="primary"
                  style={{ height: '42px', padding: '0 24px', borderRadius: '10px', fontWeight: 700 }}
                >
                  {isSubmitting ? 'Saving...' : editingTx ? 'Save Changes' : '+ Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
