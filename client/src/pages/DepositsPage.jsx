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

  // Form state for new / edit deposit
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('Cash in Hand');
  const [availableAccounts, setAvailableAccounts] = useState([]);
  const [editingTx, setEditingTx] = useState(null);

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

  // Total Tk In
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

  // Handle Add or Update Deposit
  const handleSubmit = async (e) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.warning('Please enter a valid amount.');
      return;
    }
    if (!source.trim()) {
      toast.warning('Please enter where the money came from.');
      return;
    }

    try {
      const chosenAcc = (account || 'Cash in Hand').trim();

      if (editingTx) {
        // Update existing deposit
        const updated = {
          ...editingTx,
          amount: numAmount,
          account: chosenAcc,
          note: source.trim(),
          date: new Date(date),
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
        toast.success(`Deposit updated: ৳${numAmount.toLocaleString('en-US')}`);
        setEditingTx(null);
      } else {
        // Add new deposit
        const newRecord = {
          localId: uuidv4(),
          type: 'income',
          amount: numAmount,
          category: 'Deposit / Allowance',
          account: chosenAcc,
          date: new Date(date),
          note: source.trim(),
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
        toast.success(`Recorded deposit: ৳${numAmount.toLocaleString('en-US')}`);
      }

      // Reset form
      setSource('');
      setAmount('');
      setAccount('Cash in Hand');
      setDate(new Date().toISOString().split('T')[0]);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save deposit.');
    }
  };

  const handleStartEdit = (tx) => {
    setEditingTx(tx);
    setSource(tx.note ? tx.note.replace(/^From\s+/i, '') : '');
    setAmount(tx.amount);
    setAccount(tx.account || 'Cash in Hand');
    const dStr = tx.date ? new Date(tx.date).toISOString().split('T')[0] : '';
    setDate(dStr || new Date().toISOString().split('T')[0]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingTx(null);
    setSource('');
    setAmount('');
    setAccount('Cash in Hand');
    setDate(new Date().toISOString().split('T')[0]);
  };

  const handleDelete = async (tx) => {
    const ok = await confirm({
      title: 'Delete Deposit',
      message: `Are you sure you want to delete the deposit of ৳${tx.amount} (${tx.note || 'Deposit'})?`,
      confirmText: 'Delete Deposit',
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
      if (editingTx?.localId === tx.localId) {
        handleCancelEdit();
      }
      toast.info('Deposit deleted.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete deposit.');
    }
  };

  return (
    <div className="deposit-page-wrapper">
      {/* 2-Column Grid Layout matching screenshot */}
      <div className="deposits-grid">
        {/* Left Column: Record money in form */}
        <div className="deposit-form-panel">
          <div className="deposit-form-header">
            <div>
              <span className="deposit-badge-label">
                {editingTx ? 'EDITING RECORD' : 'NEW INCOME'}
              </span>
              <h2 className="deposit-form-title">
                {editingTx ? 'Edit money in' : 'Record money in'}
              </h2>
              <p className="deposit-form-sub">
                Deposits, allowances, or money received.
              </p>
            </div>
            {editingTx && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="cancel-edit-pill"
              >
                ✕ Cancel
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="deposit-form-body">
            <div className="deposit-field-group">
              <label className="deposit-label" htmlFor="depositDate">
                Date
              </label>
              <div className="deposit-input-wrap">
                <input
                  id="depositDate"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="deposit-input"
                  required
                />
              </div>
            </div>

            <div className="deposit-field-group">
              <label className="deposit-label" htmlFor="depositSource">
                From / note
              </label>
              <div className="deposit-input-wrap">
                <input
                  id="depositSource"
                  type="text"
                  placeholder="e.g. Abbu, DA, Freelance"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="deposit-input"
                  maxLength={100}
                  required
                />
              </div>
            </div>

            <div className="deposit-field-group">
              <label className="deposit-label" htmlFor="depositAmount">
                Amount (৳)
              </label>
              <div className="deposit-input-wrap amount-prefix-wrap">
                <span className="currency-prefix">৳</span>
                <input
                  id="depositAmount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="1,000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="deposit-input amount-input"
                  required
                />
              </div>
            </div>

            <div className="deposit-field-group">
              <label className="deposit-label" htmlFor="depositAccount">
                Deposit into / Account
              </label>
              <div className="deposit-input-wrap">
                <input
                  id="depositAccount"
                  type="text"
                  list="depositAccountSuggestions"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="e.g. Cash in Hand, bKash, City Bank"
                  className="deposit-input"
                  required
                />
                <datalist id="depositAccountSuggestions">
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
            </div>

            <div className="deposit-actions-row">
              <button
                type="submit"
                className="deposit-submit-btn"
              >
                <span>{editingTx ? '✓ Update deposit' : '+ Add deposit'}</span>
              </button>
              {editingTx && (
                <button
                  type="button"
                  onClick={() => handleDelete(editingTx)}
                  className="deposit-delete-btn"
                  title="Delete deposit"
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Right Column: Tk in Header & List */}
        <div className="deposit-list-panel">
          <div className="deposit-list-header">
            <div>
              <span className="deposit-badge-label">TOTAL ACCUMULATED</span>
              <h2 className="deposit-list-title">Tk in</h2>
              <p className="deposit-list-sub">Imported records are preserved.</p>
            </div>
            <div className="deposit-total-badge">
              <span className="deposit-total-currency">৳</span>
              <span className="deposit-total-number">
                {totalDepositsAmount.toLocaleString('en-US')}
              </span>
            </div>
          </div>

          <div className="deposit-entries-list">
            {loading && depositsList.length === 0 ? (
              <div className="deposit-empty-state">
                <div className="spinner-sm" />
                <p>Loading deposits...</p>
              </div>
            ) : depositsList.length === 0 ? (
              <div className="deposit-empty-state">
                <p>No deposit records yet.</p>
                <span className="text-xs text-slate-500">Record your incoming money on the left.</span>
              </div>
            ) : (
              depositsList.map((d) => {
                const isSelected = editingTx?.localId === d.localId;
                const displaySource = d.note ? d.note.replace(/^From\s+/i, '') : 'Deposit';
                return (
                  <div
                    key={d.localId || d._id}
                    className={`deposit-row-card ${isSelected ? 'is-active' : ''}`}
                  >
                    <div className="deposit-row-left">
                      <div className="deposit-source-name">
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
                      <div className="deposit-amount-pill">
                        ৳{Number(d.amount).toLocaleString('en-US')}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleStartEdit(d)}
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
      </div>
    </div>
  );
}
