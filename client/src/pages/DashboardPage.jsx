import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
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

    // If user has set up accounts, use the real liquid accounts total; otherwise fallback to deposits - expenses
    const trueLiquidBalance = liquidAccs.length > 0 ? accountsTotal : Math.max(0, totalDepositAmount - totalExpenseAmount);

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
      todayTotal,
      allExpenses: totalExpenseAmount,
      recordedDays: uniqueDays.size,
      remaining: trueLiquidBalance,
    });
    setDayEntries(selectedEntries);
    setDayTotal(selectedTotal);
  };

  const handleOpenAddExpense = (presetDate) => {
    setEditingTx(null);
    setExpenseForm({
      title: '',
      amount: '',
      account: availableAccounts[0]?.name || 'Cash in Hand',
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
      {/* 1. Neon Glowing Balance Left Hero */}
      <div className="balance-screen">
        <div className="balance-ring">
          <div className="balance-inner">
            <div className="balance-label">BALANCE LEFT</div>
            <div id="homeBalanceHero" className="balance-amount">
              {fmt(stats.balance)}
            </div>
            <div className="balance-subtitle">Current Available Balance</div>
          </div>
        </div>

        <div className="balance-actions">
          <button type="button" onClick={() => handleOpenAddExpense(todayStr)} className="balance-action">
            + Add Expense <span>›</span>
          </button>
          <button type="button" onClick={() => navigate('/accounts')} className="balance-action">
            Banks & Assets <span>›</span>
          </button>
        </div>

        <div className="balance-note">
          Liquid money across Cash, Bank & Mobile Wallets · Real-time synced
        </div>
      </div>

      {/* 2. 4-Box Summary Grid */}
      <div className="metrics-grid">
        <div className="panel p-4">
          <div className="tiny-label">Today's total</div>
          <div id="todayTotal" className="metric-value">{fmt(stats.todayTotal)}</div>
          <div id="todayDateLabel" className="metric-sub">{todayLabel}</div>
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

        <div className="panel p-4">
          <div className="tiny-label">Money remaining</div>
          <div id="homeRemaining" className="metric-value">{fmt(stats.remaining)}</div>
          <div className="metric-sub">Liquid capital across active accounts</div>
        </div>
      </div>

      {/* 3. Entries for Selected Day */}
      <div className="panel">
        <div
          className="entries-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h3 className="panel-title-md">Entries for selected day</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="field text-sm"
                style={{ padding: '4px 10px', height: '34px', width: 'auto' }}
              />
              <span className="panel-sub" style={{ margin: 0 }}>
                {dayEntries.length} {dayEntries.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span id="selectedDayTotal" className="selected-day-total">
              {fmt(dayTotal)}
            </span>
            <button
              type="button"
              onClick={() => handleOpenAddExpense(selectedDate)}
              className="primary"
              style={{ padding: '6px 14px', fontSize: '0.84rem' }}
            >
              + Add Expense
            </button>
          </div>
        </div>

        <div className="entries-body">
          {dayEntries.length === 0 ? (
            <div className="empty-day-text">No expenses for this date yet.</div>
          ) : (
            <div className="entries-list">
              {dayEntries.map((entry) => (
                <div key={entry.localId} className="entry-row">
                  <div className="entry-info">
                    <div className="entry-title">{entry.note || 'Expense'}</div>
                    <div className="entry-category">
                      <span>{entry.category || 'General'}</span>
                      <span style={{ margin: '0 5px', opacity: 0.35 }}>•</span>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          padding: '1px 6px',
                          borderRadius: '5px',
                          background: 'rgba(56, 189, 248, 0.08)',
                          color: '#38bdf8',
                          border: '1px solid rgba(56, 189, 248, 0.2)',
                        }}
                      >
                        💳 {entry.account || 'Cash in Hand'}
                      </span>
                    </div>
                  </div>
                  <div className="entry-right">
                    <div className="entry-amount">{fmt(entry.amount)}</div>
                    <div className="entry-actions">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => handleStartEdit(entry)}
                        title="Edit"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-link text-danger"
                        onClick={() => handleDeleteEntry(entry)}
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 4. Add / Edit Expense Modal */}
      {showExpenseModal && (
        <div className="modal-overlay" onClick={() => setShowExpenseModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editingTx ? '✏️ Edit Expense' : '💸 Add Expense'}
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
                <label className="form-label" htmlFor="dash-expense-account">Paid From Account</label>
                <input
                  id="dash-expense-account"
                  type="text"
                  list="dashModalAccountSuggestions"
                  className="field"
                  placeholder="e.g. Cash in Hand, bKash, City Bank"
                  value={expenseForm.account}
                  onChange={(e) => setExpenseForm({ ...expenseForm, account: e.target.value })}
                  required
                />
                <datalist id="dashModalAccountSuggestions">
                  {availableAccounts.map((a) => (
                    <option key={a.localId || a.name} value={a.name} />
                  ))}
                  <option value="Cash in Hand" />
                  <option value="bKash" />
                  <option value="Nagad" />
                  <option value="City Bank" />
                  <option value="Dutch-Bangla Bank" />
                </datalist>
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
