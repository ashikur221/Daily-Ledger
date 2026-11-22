import React, { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
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

  // Total Income
  const totalDepositsAmount = useMemo(() => {
    return depositsList.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [depositsList]);

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

  const handleOpenAdd = () => {
    setEditingTx(null);
    setIncomeForm({
      date: todayStr,
      source: '',
      amount: '',
      account: availableAccounts[0]?.name || 'Cash in Hand',
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
            <h2 className="bank-panel-title" style={{ fontSize: '1.6rem', marginTop: '4px' }}>
              Income & Inflow
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
              }}
            >
              <span>+</span> Record Income
            </button>
          </div>
        </div>
      </div>

      {/* 2. Full-Width Income Ledger List */}
      <div className="deposit-list-panel">
        <div className="deposit-list-header">
          <div>
            <h3 className="bank-panel-title" style={{ fontSize: '1.15rem' }}>Income History</h3>
            <p className="deposit-list-sub">
              Showing {depositsList.length} recorded inflow {depositsList.length === 1 ? 'entry' : 'entries'}.
            </p>
          </div>
        </div>

        <div className="deposit-entries-list">
          {loading && depositsList.length === 0 ? (
            <div className="deposit-empty-state">
              <div className="spinner-sm" />
              <p>Loading income records...</p>
            </div>
          ) : depositsList.length === 0 ? (
            <div className="deposit-empty-state" style={{ padding: '48px 0' }}>
              <p style={{ fontSize: '1rem', fontWeight: 650 }}>No income records yet.</p>
              <span className="text-xs text-slate-500" style={{ display: 'block', marginTop: '4px' }}>
                Tap the button above to record your first salary or deposit.
              </span>
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
            </div>
          ) : (
            depositsList.map((d) => {
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
                          padding: '1px 6px',
                          borderRadius: '5px',
                          background: 'rgba(16, 185, 129, 0.1)',
                          color: '#34d399',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                        }}
                      >
                        📥 {d.account || 'Cash in Hand'}
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
                    >
                      Edit
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
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', borderBottom: '1px solid #1e293b', paddingBottom: '12px' }}>
              <h2 className="modal-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>💰</span> {editingTx ? 'Edit Income Record' : 'Record Income'}
              </h2>
              <button
                type="button"
                onClick={() => setShowIncomeModal(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  padding: '4px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveIncome} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="deposit-date">Date</label>
                <input
                  id="deposit-date"
                  type="date"
                  className="field"
                  value={incomeForm.date}
                  onChange={(e) => setIncomeForm({ ...incomeForm, date: e.target.value })}
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="deposit-source">From / Source Note</label>
                <input
                  id="deposit-source"
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
                <label className="form-label" htmlFor="deposit-amount">Amount (৳)</label>
                <input
                  id="deposit-amount"
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
                <label className="form-label" htmlFor="deposit-account">Deposit Into / Account</label>
                <input
                  id="deposit-account"
                  type="text"
                  list="depositModalAccountSuggestions"
                  value={incomeForm.account}
                  onChange={(e) => setIncomeForm({ ...incomeForm, account: e.target.value })}
                  placeholder="e.g. Cash in Hand, bKash, City Bank"
                  className="field"
                  required
                />
                <datalist id="depositModalAccountSuggestions">
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

              <div className="modal-actions" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: '18px' }}>
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
                    🗑️ Delete Record
                  </button>
                ) : <div />}

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setShowIncomeModal(false)}
                    className="secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="primary"
                    style={{
                      minWidth: '130px',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      border: 'none',
                    }}
                  >
                    {isSubmitting ? 'Saving...' : editingTx ? 'Save Changes' : '+ Add Income'}
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
