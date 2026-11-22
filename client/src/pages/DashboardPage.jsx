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
  const { user, isOnline, refreshPendingCount } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  // Selected date for daily entry & entries for selected day (defaults to today)
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // Form state
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseAccount, setExpenseAccount] = useState('Cash in Hand');
  const [availableAccounts, setAvailableAccounts] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Editing state for entries
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');

  const formRef = useRef(null);

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

  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!expenseTitle.trim() || !expenseAmount) return;

    setIsSubmitting(true);
    const numAmount = parseFloat(expenseAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error('Please enter a valid amount');
      setIsSubmitting(false);
      return;
    }

    const localId = uuidv4();
    const chosenAcc = (expenseAccount || 'Cash in Hand').trim();
    const newTx = {
      localId,
      type: 'expense',
      amount: numAmount,
      category: 'General',
      account: chosenAcc,
      date: new Date(selectedDate),
      note: expenseTitle.trim(),
      synced: false,
      isDeleted: 0,
      clientUpdatedAt: new Date(),
    };

    try {
      // Write locally immediately
      await db.transactions.put(newTx);
      await queueSync('transactions', localId);

      // Deduct from the selected account balance
      await adjustAccountBalance(chosenAcc, -numAmount);

      // If online, send to cloud
      if (isOnline) {
        try {
          await api.post('/transactions', newTx);
          await db.transactions.update(localId, { synced: true });
          await db.syncQueue.where({ entity: 'transactions', localId }).delete();
        } catch {
          // Will sync in background
        }
      }

      await refreshPendingCount();
      toast.success(`Added ৳${numAmount} for "${expenseTitle.trim()}"`);

      // Reset input form
      setExpenseTitle('');
      setExpenseAmount('');

      // Reload view
      await loadDashboardData();
    } catch (err) {
      toast.error('Failed to add expense');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (entry) => {
    setEditingId(entry.localId);
    setEditTitle(entry.note || '');
    setEditAmount(entry.amount);
  };

  const handleSaveEdit = async (entry) => {
    const num = parseFloat(editAmount);
    if (isNaN(num) || num <= 0 || !editTitle.trim()) {
      toast.error('Please provide valid title and amount');
      return;
    }

    // Dynamic Balance Adjustment
    await adjustAccountBalance(entry.account || 'Cash in Hand', Number(entry.amount));
    await adjustAccountBalance(entry.account || 'Cash in Hand', -num);

    await db.transactions.update(entry.localId, {
      note: editTitle.trim(),
      amount: num,
      synced: false,
      clientUpdatedAt: new Date(),
    });
    await queueSync('transactions', entry.localId);

    if (isOnline) {
      try {
        await api.put(`/transactions/${entry.localId}`, {
          note: editTitle.trim(),
          amount: num,
        });
        await db.transactions.update(entry.localId, { synced: true });
      } catch {}
    }

    setEditingId(null);
    toast.success('Entry updated');
    loadDashboardData();
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
      } catch {}
    }

    toast.info('Entry deleted');
    loadDashboardData();
  };

  const scrollToEntry = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
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
          <button type="button" onClick={scrollToEntry} className="balance-action">
            Add Expense <span>›</span>
          </button>
          <button type="button" onClick={() => navigate('/accounts')} className="balance-action">
            Bank Accounts <span>›</span>
          </button>
        </div>

        <div className="balance-note">
          Liquid money across Cash, Bank & Mobile Wallets · Real-time synced
        </div>
      </div>

      {/* 2. Daily Entry Form Panel */}
      <div className="panel" ref={formRef}>
        <div className="panel-header-block">
          <h2 className="panel-title">Daily entry</h2>
          <p className="panel-sub">Add an expense here. New entries appear at the top.</p>
        </div>

        <form onSubmit={handleAddExpense} className="daily-form">
          <div className="form-item">
            <label htmlFor="expenseDate" className="form-label">Date</label>
            <input
              id="expenseDate"
              type="date"
              className="field"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              required
            />
          </div>

          <div className="form-item">
            <label htmlFor="expenseTitle" className="form-label">Expense title</label>
            <input
              id="expenseTitle"
              type="text"
              className="field"
              placeholder="e.g. Cha, Rickshaw"
              value={expenseTitle}
              onChange={(e) => setExpenseTitle(e.target.value)}
              required
              maxLength={100}
            />
          </div>

          <div className="form-item">
            <label htmlFor="expenseAmount" className="form-label">Amount (৳)</label>
            <input
              id="expenseAmount"
              type="number"
              min="0.01"
              step="any"
              className="field"
              placeholder="35"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              required
            />
          </div>

          <div className="form-item">
            <label htmlFor="expenseAccount" className="form-label">Paid from account</label>
            <input
              id="expenseAccount"
              type="text"
              list="dashAccountSuggestions"
              className="field"
              placeholder="e.g. Cash in Hand, bKash, City Bank"
              value={expenseAccount}
              onChange={(e) => setExpenseAccount(e.target.value)}
              required
            />
            <datalist id="dashAccountSuggestions">
              {availableAccounts.map((a) => (
                <option key={a.localId || a.name} value={a.name} />
              ))}
              <option value="Cash in Hand" />
              <option value="bKash" />
              <option value="Nagad" />
            </datalist>
          </div>

          <button className="primary w-full" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : '+ Add expense'}
          </button>
        </form>
      </div>

      {/* 3. 4-Box Summary Grid */}
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
          <div className="metric-sub">Total Tk in minus recorded expenses · excludes bank accounts</div>
        </div>
      </div>

      {/* 4. Entries for Selected Day */}
      <div className="panel">
        <div className="entries-header">
          <div>
            <h3 className="panel-title-md">Entries for selected day</h3>
            <p className="panel-sub">Use Edit to change a previous entry.</p>
          </div>
          <span id="selectedDayTotal" className="selected-day-total">
            {fmt(dayTotal)}
          </span>
        </div>

        <div className="entries-body">
          {dayEntries.length === 0 ? (
            <div className="empty-day-text">No expenses for this date yet.</div>
          ) : (
            <div className="entries-list">
              {dayEntries.map((entry) => (
                <div key={entry.localId} className="entry-row">
                  {editingId === entry.localId ? (
                    <div className="entry-edit-box">
                      <input
                        type="text"
                        className="field"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                      <input
                        type="number"
                        className="field"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button className="primary" onClick={() => handleSaveEdit(entry)}>Save</button>
                        <button className="secondary" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
