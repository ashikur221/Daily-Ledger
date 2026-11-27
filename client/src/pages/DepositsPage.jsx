import React, { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { TrendingUp, Plus, Wallet, Pencil } from 'lucide-react';
import { ICON_STROKE } from '../components/AppIcons';
import DateFilterBar from '../components/DateFilterBar';
import { formatDateGroupHeading } from '../components/TransactionRow';
import db from '../db/localDb';
import api from '../services/api';
import { queueSync } from '../services/syncService';
import { adjustAccountBalance, getAllAccounts } from '../services/accountService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';

export default function DepositsPage() {
  const { isOnline, refreshPendingCount } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [availableAccounts, setAvailableAccounts] = useState([]);

  // Modal State
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const todayStr = new Date().toISOString().split('T')[0];
  const [incomeForm, setIncomeForm] = useState({
    date: todayStr,
    source: '',
    amount: '',
    account: 'Cash in Hand',
  });

  useEffect(() => {
    loadDeposits();

    const handleRemoteUpdate = () => {
      loadDeposits();
    };
    window.addEventListener('daily_ledger:data_updated', handleRemoteUpdate);
    return () => window.removeEventListener('daily_ledger:data_updated', handleRemoteUpdate);
  }, []);

  const loadDeposits = async () => {
    setLoading(true);
    try {
      const local = await db.transactions
        .where('isDeleted')
        .equals(0)
        .reverse()
        .sortBy('date');
      setTransactions(local);

      // Load available accounts
      getAllAccounts().then((accs) => {
        setAvailableAccounts(accs);
      });

      if (isOnline) {
        api
          .get('/transactions?limit=2000')
          .then(async ({ data }) => {
            if (data && data.transactions) {
              await db.transactions.bulkPut(
                data.transactions.map((t) => ({
                  ...t,
                  synced: true,
                  isDeleted: t.isDeleted ? 1 : 0,
                }))
              );
              const updated = await db.transactions
                .where('isDeleted')
                .equals(0)
                .reverse()
                .sortBy('date');
              setTransactions(updated);
            }
          })
          .catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  };

  // Only income transactions (excluding banking transfers if any)
  const depositsList = useMemo(() => {
    return transactions
      .filter((t) => t.type === 'income' && t.category !== 'Banking')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions]);

  const [selectedDate, setSelectedDate] = useState('');

  const filteredDeposits = useMemo(() => {
    if (!selectedDate) return depositsList;
    return depositsList.filter(
      (t) => new Date(t.date).toISOString().split('T')[0] === selectedDate
    );
  }, [depositsList, selectedDate]);

  // Total Income (overall)
  const totalDepositsAmount = useMemo(() => {
    return depositsList.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [depositsList]);

  const filteredDepositsTotal = useMemo(() => {
    return filteredDeposits.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [filteredDeposits]);

  // Format date helper: "15 Oct 2026"
  const formatDateLabel = (dateString) => {
    if (!dateString) return 'Date not specified';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const liquidAccounts = useMemo(() => {
    const registered = (availableAccounts || []).filter(
      (a) => a.type !== 'fdr' && a.type !== 'asset'
    );

    const map = new Map();
    registered.forEach((a) => map.set(a.name.toLowerCase(), a));

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

    if (incomeForm.account && !map.has(incomeForm.account.toLowerCase())) {
      map.set(incomeForm.account.toLowerCase(), {
        name: incomeForm.account,
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
  }, [availableAccounts, incomeForm.account]);

  const handleOpenAdd = () => {
    setEditingTx(null);
    const defaultAcc =
      availableAccounts.find((a) => a.type !== 'fdr' && a.type !== 'asset')?.name ||
      'Cash in Hand';
    setIncomeForm({
      date: todayStr,
      source: '',
      amount: '',
      account: defaultAcc,
    });
    setShowIncomeModal(true);
  };

  const handleStartEdit = (tx) => {
    setEditingTx(tx);
    setIncomeForm({
      date: tx.date ? new Date(tx.date).toISOString().split('T')[0] : todayStr,
      source: tx.note ? tx.note.replace(/^From\s+/i, '') : '',
      amount: String(tx.amount || ''),
      account: tx.account || 'Cash in Hand',
    });
    setShowIncomeModal(true);
  };

  const handleSaveIncome = async (e) => {
    e.preventDefault();
    const numAmount = parseFloat(incomeForm.amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.warning('Please enter a valid amount.');
      return;
    }
    if (!incomeForm.source.trim()) {
      toast.warning('Please enter where the money came from.');
      return;
    }

    setIsSubmitting(true);
    try {
      const chosenAcc = (incomeForm.account || 'Cash in Hand').trim();

      if (editingTx) {
        // Update existing deposit
        const updated = {
          ...editingTx,
          amount: numAmount,
          account: chosenAcc,
          note: incomeForm.source.trim(),
          date: new Date(incomeForm.date),
          synced: false,
          clientUpdatedAt: new Date(),
        };

        await db.transactions.put(updated);
        await queueSync('transactions', updated.localId, 'update', updated);

        // Balance reconciliation
        await adjustAccountBalance(editingTx.account || 'Cash in Hand', -Number(editingTx.amount));
        await adjustAccountBalance(chosenAcc, numAmount);

        refreshPendingCount();

        setTransactions((prev) =>
          prev.map((t) => (t.localId === updated.localId ? updated : t))
        );
        toast.success(`Income updated: ৳${numAmount.toLocaleString('en-US')}`);
      } else {
        // Add new deposit
        const newRecord = {
          localId: uuidv4(),
          type: 'income',
          amount: numAmount,
          category: 'Income',
          account: chosenAcc,
          date: new Date(incomeForm.date),
          note: incomeForm.source.trim(),
          synced: false,
          isDeleted: 0,
          clientUpdatedAt: new Date(),
        };

        await db.transactions.add(newRecord);
        await queueSync('transactions', newRecord.localId, 'create', newRecord);

        // Credit to the chosen account balance
        await adjustAccountBalance(chosenAcc, numAmount);

        refreshPendingCount();

        setTransactions((prev) => [newRecord, ...prev]);
        toast.success(`Recorded income: ৳${numAmount.toLocaleString('en-US')}`);
      }

      setShowIncomeModal(false);
      setEditingTx(null);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save income record.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (tx) => {
    const ok = await confirm({
      title: 'Delete Income Record',
      message: `Are you sure you want to delete the income of ৳${tx.amount} (${tx.note || 'Income'})?`,
      confirmText: 'Delete Record',
      danger: true,
    });
    if (!ok) return;

    try {
      const updated = { ...tx, isDeleted: 1, synced: false, clientUpdatedAt: new Date() };
      await db.transactions.put(updated);
      await queueSync('transactions', tx.localId, 'delete', { localId: tx.localId });

      // Revert account addition
      await adjustAccountBalance(tx.account || 'Cash in Hand', -Number(tx.amount));

      refreshPendingCount();

      setTransactions((prev) => prev.filter((t) => t.localId !== tx.localId));
      setShowIncomeModal(false);
      setEditingTx(null);
      toast.info('Income record deleted.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete record.');
    }
  };

  return (
    <div className="deposit-page-wrapper">
      {/* 1. Header Banner & Quick Add Button */}
      <div className="bank-accounts-panel mb-6">
        <div className="bank-panel-header" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
          <div>
            <span className="deposit-badge-label">TOTAL ACCUMULATED</span>
            <h2 className="bank-panel-title" style={{ fontSize: '1.6rem', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={22} strokeWidth={ICON_STROKE} color="#34d399" aria-hidden="true" />
              <span>Income & Inflow</span>
            </h2>
            <p className="bank-panel-subtitle">
              Salary, allowances, business profit, freelance & money received.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <div className="deposit-total-badge" style={{ padding: '8px 18px' }}>
              <span className="deposit-total-currency">৳</span>
              <span className="deposit-total-number" style={{ fontSize: '1.45rem' }}>
                {totalDepositsAmount.toLocaleString('en-US')}
              </span>
            </div>

            <button
              type="button"
              onClick={handleOpenAdd}
              className="bank-add-action-btn"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                boxShadow: '0 4px 18px rgba(16, 185, 129, 0.35)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Plus size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <span>Record Income</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Full-Width Income Ledger List */}
      <div className="deposit-list-panel">
        <div className="deposit-list-header" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div>
            <h3 className="bank-panel-title" style={{ fontSize: '1.15rem' }}>Income History</h3>
            <p className="deposit-list-sub">
              {selectedDate
                ? `Showing ${filteredDeposits.length} ${filteredDeposits.length === 1 ? 'entry' : 'entries'} on ${formatDateGroupHeading(selectedDate)} · Total: ৳${filteredDepositsTotal.toLocaleString('en-US')}`
                : `Showing ${depositsList.length} recorded inflow ${depositsList.length === 1 ? 'entry' : 'entries'}.`}
            </p>
          </div>
          <DateFilterBar selectedDate={selectedDate} onChangeDate={setSelectedDate} />
        </div>

        <div className="deposit-entries-list">
          {loading && depositsList.length === 0 ? (
            <div className="deposit-empty-state">
              <div className="spinner-sm" />
              <p>Loading income records...</p>
            </div>
          ) : filteredDeposits.length === 0 ? (
            <div className="deposit-empty-state" style={{ padding: '48px 0' }}>
              <p style={{ fontSize: '1rem', fontWeight: 650 }}>
                {selectedDate
                  ? `No income recorded on ${formatDateGroupHeading(selectedDate)}.`
                  : 'No income records yet.'}
              </p>
              <span className="text-xs text-slate-500" style={{ display: 'block', marginTop: '4px' }}>
                {selectedDate
                  ? 'Try selecting another date or reset the filter.'
                  : 'Tap the button above to record your first salary or deposit.'}
              </span>
              {selectedDate ? (
                <button
                  type="button"
                  onClick={() => setSelectedDate('')}
                  className="secondary"
                  style={{ marginTop: '16px', padding: '8px 18px', borderRadius: '8px', fontWeight: 650, fontSize: '0.85rem' }}
                >
                  Show All Dates
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  style={{
                    marginTop: '16px',
                    background: 'transparent',
                    color: '#34d399',
                    border: '1px dashed #34d399',
                    borderRadius: '8px',
                    padding: '8px 18px',
                    cursor: 'pointer',
                    fontWeight: 650,
                    fontSize: '0.85rem',
                  }}
                >
                  + Record Income
                </button>
              )}
            </div>
          ) : (
            filteredDeposits.map((d) => {
              const displaySource = d.note ? d.note.replace(/^From\s+/i, '') : 'Income';
              return (
                <div
                  key={d.localId || d._id}
                  className="deposit-row-card"
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleStartEdit(d)}
                  title="Click to edit income entry"
                >
                  <div className="deposit-row-left">
                    <div className="deposit-source-name" style={{ fontSize: '1.02rem', fontWeight: 700 }}>
                      {displaySource}
                    </div>
                    <div className="deposit-date-tag">
                      <span>{formatDateLabel(d.date)}</span>
                      <span style={{ margin: '0 6px', opacity: 0.35 }}>•</span>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          padding: '1px 7px',
                          borderRadius: '5px',
                          background: 'rgba(16, 185, 129, 0.1)',
                          color: '#34d399',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <Wallet size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        <span>{d.account || 'Cash in Hand'}</span>
                      </span>
                    </div>
                  </div>

                  <div className="deposit-row-right">
                    <div className="deposit-amount-pill" style={{ color: '#34d399', fontWeight: 800 }}>
                      +৳{Number(d.amount).toLocaleString('en-US')}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(d);
                      }}
                      className="deposit-edit-btn"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      aria-label={`Edit ${displaySource}`}
                    >
                      <Pencil size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 3. Modal: Add / Edit Income */}
      {showIncomeModal && (
        <div className="modal-overlay" onClick={() => setShowIncomeModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editingTx ? '✏️ Edit Income Record' : '💰 Record Income'}
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowIncomeModal(false)}
                title="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveIncome} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="income-date">Date</label>
                <input
                  id="income-date"
                  type="date"
                  className="field"
                  value={incomeForm.date}
                  onChange={(e) => setIncomeForm({ ...incomeForm, date: e.target.value })}
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="income-source">
                  From / Source Note
                </label>
                <input
                  id="income-source"
                  type="text"
                  placeholder="e.g. Salary, DA, Freelance Client, Gift"
                  value={incomeForm.source}
                  onChange={(e) => setIncomeForm({ ...incomeForm, source: e.target.value })}
                  className="field"
                  required
                  autoFocus
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="income-amount">Amount (৳)</label>
                <input
                  id="income-amount"
                  type="number"
                  min="0.01"
                  step="any"
                  placeholder="1000"
                  value={incomeForm.amount}
                  onChange={(e) => setIncomeForm({ ...incomeForm, amount: e.target.value })}
                  className="field"
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="income-account">
                  Deposit Into Account (Liquid Cash)
                </label>
                <select
                  id="income-account"
                  className="field"
                  value={incomeForm.account}
                  onChange={(e) => setIncomeForm({ ...incomeForm, account: e.target.value })}
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

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', gap: '10px' }}>
                {editingTx ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(editingTx)}
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
                    🗑️ Delete
                  </button>
                ) : <div />}

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setShowIncomeModal(false)}
                    className="secondary"
                    style={{ height: '42px', padding: '0 18px', borderRadius: '10px' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="deposit-submit-btn"
                    style={{
                      height: '42px',
                      padding: '0 22px',
                      borderRadius: '10px',
                      fontWeight: 700,
                    }}
                  >
                    {isSubmitting ? 'Saving...' : editingTx ? 'Save Changes' : '+ Record Income'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
