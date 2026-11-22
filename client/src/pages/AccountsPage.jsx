import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/localDb';
import api from '../services/api';
import { queueSync } from '../services/syncService';
import { recordInterAccountTransfer } from '../services/accountService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';

export default function AccountsPage() {
  const { isOnline, refreshPendingCount } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Active Category Tab: 'all' | 'liquid' | 'fdr' | 'asset'
  const [activeTab, setActiveTab] = useState('all');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [selectedStatementAccount, setSelectedStatementAccount] = useState(null);
  const [editingAccount, setEditingAccount] = useState(null);

  // Statement Drawer Search
  const [statementSearch, setStatementSearch] = useState('');

  // Transfer Form State
  const [transferForm, setTransferForm] = useState({
    fromAccount: '',
    toAccount: '',
    amount: '',
    fee: '',
    date: new Date().toISOString().split('T')[0],
    note: '',
  });

  // Account Add/Edit Form State
  const [accountForm, setAccountForm] = useState({
    name: '',
    type: 'bank', // 'bank' | 'mfs' | 'cash' | 'fdr' | 'asset'
    balance: '',
    institution: '',
    accountNumber: '',
    maturityDate: '',
    notes: '',
  });

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
      const txs = await db.transactions.where('isDeleted').equals(0).toArray();
      setAllTransactions(txs);

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

  // Group accounts by classification
  const liquidAccounts = useMemo(() => {
    return accounts.filter((a) => a.type === 'bank' || a.type === 'mfs' || a.type === 'cash' || !a.type);
  }, [accounts]);

  const fdrAccounts = useMemo(() => {
    return accounts.filter((a) => a.type === 'fdr');
  }, [accounts]);

  const assetAccounts = useMemo(() => {
    return accounts.filter((a) => a.type === 'asset');
  }, [accounts]);

  // Aggregate Balances
  const totalLiquidBalance = useMemo(() => {
    return liquidAccounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  }, [liquidAccounts]);

  const totalFdrBalance = useMemo(() => {
    return fdrAccounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  }, [fdrAccounts]);

  const totalAssetBalance = useMemo(() => {
    return assetAccounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  }, [assetAccounts]);

  const totalNetWorth = useMemo(() => {
    return totalLiquidBalance + totalFdrBalance + totalAssetBalance;
  }, [totalLiquidBalance, totalFdrBalance, totalAssetBalance]);

  // Filtered accounts list based on active tab
  const displayedAccounts = useMemo(() => {
    let list = accounts;
    if (activeTab === 'liquid') list = liquidAccounts;
    else if (activeTab === 'fdr') list = fdrAccounts;
    else if (activeTab === 'asset') list = assetAccounts;
    return [...list].sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0));
  }, [accounts, activeTab, liquidAccounts, fdrAccounts, assetAccounts]);

  // Get transaction count for account
  const getEntriesCountForAccount = (accName) => {
    if (!accName) return 0;
    return allTransactions.filter(
      (t) => t.account === accName || t.toAccount === accName
    ).length;
  };

  // Type metadata helper
  const getTypeMeta = (type) => {
    switch (type) {
      case 'mfs':
        return { label: 'MOBILE WALLET', icon: '📱', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.12)' };
      case 'cash':
        return { label: 'CASH', icon: '💵', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' };
      case 'fdr':
        return { label: 'FIXED DEPOSIT / DPS', icon: '📜', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.12)' };
      case 'asset':
        return { label: 'PHYSICAL ASSET', icon: '🏆', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' };
      case 'bank':
      default:
        return { label: 'BANK ACCOUNT', icon: '🏦', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)' };
    }
  };

  // Open Add Account Modal
  const handleOpenAddAccount = () => {
    setEditingAccount(null);
    setAccountForm({
      name: '',
      type: activeTab === 'fdr' ? 'fdr' : activeTab === 'asset' ? 'asset' : 'bank',
      balance: '',
      institution: '',
      accountNumber: '',
      maturityDate: '',
      notes: '',
    });
    setShowAddModal(true);
  };

  // Open Edit Account Modal
  const handleOpenEditAccount = (acc) => {
    setEditingAccount(acc);
    setAccountForm({
      name: acc.name || '',
      type: acc.type || 'bank',
      balance: acc.balance !== undefined ? String(acc.balance) : '0',
      institution: acc.institution || '',
      accountNumber: acc.accountNumber || '',
      maturityDate: acc.maturityDate ? new Date(acc.maturityDate).toISOString().split('T')[0] : '',
      notes: acc.notes || '',
    });
    setShowAddModal(true);
  };

  // Save Add/Edit Account
  const handleSaveAccount = async (e) => {
    e.preventDefault();
    const cleanName = accountForm.name.trim();
    if (!cleanName) {
      toast.warning('Please enter an account name.');
      return;
    }
    const numBal = parseFloat(accountForm.balance) || 0;

    try {
      const now = new Date();
      if (editingAccount) {
        const updated = {
          ...editingAccount,
          name: cleanName,
          type: accountForm.type,
          balance: numBal,
          institution: accountForm.institution.trim(),
          accountNumber: accountForm.accountNumber.trim(),
          maturityDate: accountForm.maturityDate ? new Date(accountForm.maturityDate) : null,
          notes: accountForm.notes.trim(),
          synced: false,
          clientUpdatedAt: now,
        };
        await db.accounts.put(updated);
        await queueSync('accounts', updated.localId, 'update', updated);
        refreshPendingCount();

        setAccounts((prev) =>
          prev.map((a) => (a.localId === updated.localId ? updated : a))
        );
        toast.success(`Account "${cleanName}" updated.`);
      } else {
        const newAcc = {
          localId: uuidv4(),
          name: cleanName,
          type: accountForm.type,
          balance: numBal,
          institution: accountForm.institution.trim(),
          accountNumber: accountForm.accountNumber.trim(),
          maturityDate: accountForm.maturityDate ? new Date(accountForm.maturityDate) : null,
          notes: accountForm.notes.trim(),
          synced: false,
          isDeleted: 0,
          clientUpdatedAt: now,
        };
        await db.accounts.add(newAcc);
        await queueSync('accounts', newAcc.localId, 'create', newAcc);
        refreshPendingCount();

        setAccounts((prev) => [...prev, newAcc]);
        toast.success(`Account "${cleanName}" added successfully.`);
      }

      setShowAddModal(false);
      setEditingAccount(null);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save account');
    }
  };

  // Delete Account
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
      setShowAddModal(false);
      setEditingAccount(null);
      if (selectedStatementAccount?.localId === acc.localId) {
        setSelectedStatementAccount(null);
      }
      toast.info(`Account "${acc.name}" deleted.`);
    } catch (err) {
      toast.error('Failed to delete account');
    }
  };

  // Open Transfer Modal
  const handleOpenTransfer = () => {
    const defaultFrom = liquidAccounts[0]?.name || '';
    const defaultTo = liquidAccounts.find((a) => a.name !== defaultFrom)?.name || '';
    setTransferForm({
      fromAccount: defaultFrom,
      toAccount: defaultTo,
      amount: '',
      fee: '',
      date: new Date().toISOString().split('T')[0],
      note: '',
    });
    setShowTransferModal(true);
  };

  // Execute Transfer
  const handleExecuteTransfer = async (e) => {
    e.preventDefault();
    try {
      await recordInterAccountTransfer({
        fromAccount: transferForm.fromAccount,
        toAccount: transferForm.toAccount,
        amount: transferForm.amount,
        fee: transferForm.fee,
        date: transferForm.date,
        note: transferForm.note,
      });

      refreshPendingCount();
      toast.success(
        `Transferred ৳${Number(transferForm.amount).toLocaleString('en-US')} from ${transferForm.fromAccount} to ${transferForm.toAccount}!`
      );
      setShowTransferModal(false);
      await loadAllData();
    } catch (err) {
      toast.error(err.message || 'Transfer failed');
    }
  };

  // Statement entries for the selected account drawer
  const statementEntries = useMemo(() => {
    if (!selectedStatementAccount) return [];
    const accName = selectedStatementAccount.name.toLowerCase();
    const q = statementSearch.trim().toLowerCase();

    const related = allTransactions.filter((t) => {
      const fromMatch = (t.account || '').toLowerCase() === accName;
      const toMatch = (t.toAccount || '').toLowerCase() === accName;
      return fromMatch || toMatch;
    });

    const mapped = related.map((t) => {
      const isTransfer = t.type === 'transfer';
      const isTransferOut = isTransfer && (t.account || '').toLowerCase() === accName;
      const isTransferIn = isTransfer && (t.toAccount || '').toLowerCase() === accName;
      const isExpense = t.type === 'expense' || isTransferOut;
      const isIncome = t.type === 'income' || isTransferIn;

      let label = t.note || (isExpense ? 'Expense' : 'Deposit');
      if (isTransferOut) {
        label = `Transfer to ${t.toAccount}${t.note ? ` (${t.note})` : ''}`;
      } else if (isTransferIn) {
        label = `Transfer from ${t.account}${t.note ? ` (${t.note})` : ''}`;
      }

      return {
        ...t,
        displayLabel: label,
        isExpense,
        isIncome,
        displaySign: isExpense ? '−' : '+',
        formattedDate: new Date(t.date).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      };
    });

    if (!q) return mapped.sort((a, b) => new Date(b.date) - new Date(a.date));

    return mapped
      .filter((item) => {
        return (
          item.displayLabel.toLowerCase().includes(q) ||
          (item.category || '').toLowerCase().includes(q) ||
          item.formattedDate.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [selectedStatementAccount, allTransactions, statementSearch]);

  const statementTotals = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    statementEntries.forEach((e) => {
      if (e.isExpense) outflow += Number(e.amount) || 0;
      else inflow += Number(e.amount) || 0;
    });
    return { inflow, outflow };
  }, [statementEntries]);

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;

  return (
    <div className="bank-page-container">
      {/* 1. Neon Glowing Hero: Total Liquid vs Net Worth */}
      <div className="panel p-4 expense-total-panel">
        <div className="finance-summary-heading">
          <span className="finance-summary-icon">🏦</span>
          <h2>CAPITAL & ASSETS COMMAND CENTER</h2>
        </div>

        <div className="finance-summary-wrap">
          <div className="balance-ring">
            <div className="balance-inner">
              <div className="balance-label">TOTAL LIQUID BALANCE</div>
              <div id="bankCircleTotal" className="balance-amount">
                {fmt(totalLiquidBalance)}
              </div>
              <div className="balance-subtitle">
                Available to spend today across {liquidAccounts.length} liquid{' '}
                {liquidAccounts.length === 1 ? 'account' : 'accounts'}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions Bar */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '18px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleOpenTransfer}
            className="bank-add-action-btn"
            style={{
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              boxShadow: '0 4px 18px rgba(245, 158, 11, 0.35)',
            }}
          >
            <span>⇄</span> Inter-Account Transfer
          </button>
          <button
            type="button"
            onClick={handleOpenAddAccount}
            className="bank-add-action-btn"
          >
            <span>+</span> Add Account or Asset
          </button>
        </div>
      </div>

      {/* 2. Headline Metrics Grid: Liquid, FDR, Physical Assets, Net Worth */}
      <div className="bank-metrics-grid">
        <div className="bank-metric-card">
          <div className="bank-metric-tag" style={{ color: '#38bdf8' }}>
            💳 Liquid Capital
          </div>
          <div className="bank-metric-val">{fmt(totalLiquidBalance)}</div>
          <p className="bank-metric-sub">
            Cash, bKash & Bank checking ({liquidAccounts.length} accounts)
          </p>
        </div>

        <div className="bank-metric-card">
          <div className="bank-metric-tag" style={{ color: '#a855f7' }}>
            📜 Fixed Deposits & DPS
          </div>
          <div className="bank-metric-val">{fmt(totalFdrBalance)}</div>
          <p className="bank-metric-sub">
            Locked term deposits ({fdrAccounts.length} schemes)
          </p>
        </div>

        <div className="bank-metric-card">
          <div className="bank-metric-tag" style={{ color: '#f59e0b' }}>
            🏆 Physical Assets
          </div>
          <div className="bank-metric-val">{fmt(totalAssetBalance)}</div>
          <p className="bank-metric-sub">
            Gold, land & property ({assetAccounts.length} assets)
          </p>
        </div>

        <div className="bank-metric-card" style={{ border: '1px solid rgba(56, 189, 248, 0.35)', background: '#0a101d' }}>
          <div className="bank-metric-tag" style={{ color: '#34d399' }}>
            💎 Total Net Worth
          </div>
          <div className="bank-metric-val" style={{ color: '#34d399' }}>{fmt(totalNetWorth)}</div>
          <p className="bank-metric-sub">
            Combined total of liquid capital and stored wealth
          </p>
        </div>
      </div>

      {/* 3. Account-wise Directory with Filter Tabs */}
      <div className="bank-accounts-panel">
        <div className="bank-panel-header">
          <div>
            <h3 className="bank-panel-title">Accounts & Assets Directory</h3>
            <p className="bank-panel-subtitle">
              Tap any card to view its full transaction statement and history.
            </p>
          </div>

          {/* Classification Filter Tabs */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 650,
                cursor: 'pointer',
                background: activeTab === 'all' ? '#38bdf8' : '#141a27',
                color: activeTab === 'all' ? '#000' : '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                transition: 'all 0.15s ease',
              }}
            >
              All ({accounts.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('liquid')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 650,
                cursor: 'pointer',
                background: activeTab === 'liquid' ? '#38bdf8' : '#141a27',
                color: activeTab === 'liquid' ? '#000' : '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                transition: 'all 0.15s ease',
              }}
            >
              💳 Liquid ({liquidAccounts.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('fdr')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 650,
                cursor: 'pointer',
                background: activeTab === 'fdr' ? '#a855f7' : '#141a27',
                color: activeTab === 'fdr' ? '#fff' : '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                transition: 'all 0.15s ease',
              }}
            >
              📜 Fixed Deposits ({fdrAccounts.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('asset')}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 650,
                cursor: 'pointer',
                background: activeTab === 'asset' ? '#f59e0b' : '#141a27',
                color: activeTab === 'asset' ? '#000' : '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                transition: 'all 0.15s ease',
              }}
            >
              🏆 Assets ({assetAccounts.length})
            </button>
          </div>
        </div>

        {/* Accounts List */}
        <div className="bank-accounts-list">
          {displayedAccounts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 0', color: '#64748b' }}>
              <p style={{ fontSize: '0.95rem', fontWeight: 600 }}>No accounts in this category yet.</p>
              <button
                type="button"
                onClick={handleOpenAddAccount}
                style={{
                  marginTop: '10px',
                  background: 'transparent',
                  color: '#38bdf8',
                  border: '1px dashed #38bdf8',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  cursor: 'pointer',
                }}
              >
                + Add your first {activeTab === 'fdr' ? 'Fixed Deposit' : activeTab === 'asset' ? 'Physical Asset' : 'Account'}
              </button>
            </div>
          ) : (
            displayedAccounts.map((acc) => {
              const meta = getTypeMeta(acc.type);
              const entriesCount = getEntriesCountForAccount(acc.name);

              return (
                <div
                  key={acc.localId}
                  className="bank-account-card"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedStatementAccount(acc)}
                  title="Click to view statement and transaction history"
                >
                  <div className="bank-account-card-main">
                    <div className="bank-account-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.2rem' }}>{meta.icon}</span>
                        <span className="bank-account-name">{acc.name}</span>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 750,
                            letterSpacing: '0.04em',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            color: meta.color,
                            background: meta.bg,
                            border: `1px solid ${meta.color}40`,
                          }}
                        >
                          {meta.label}
                        </span>
                      </div>

                      <div className="bank-account-meta" style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                        {acc.institution && <span>🏛️ {acc.institution}</span>}
                        {acc.accountNumber && <span>🔢 {acc.accountNumber}</span>}
                        {acc.maturityDate && (
                          <span style={{ color: '#a855f7' }}>
                            ⏳ Matures: {new Date(acc.maturityDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                          </span>
                        )}
                        <span>📊 {entriesCount} entries</span>
                      </div>
                    </div>

                    <div className="bank-account-right" style={{ textAlign: 'right' }}>
                      <span className="bank-account-amount" style={{ fontSize: '1.35rem', fontWeight: 800 }}>
                        {fmt(acc.balance)}
                      </span>
                    </div>
                  </div>

                  <div className="bank-account-action-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #141a27', paddingTop: '10px', marginTop: '6px' }}>
                    <span style={{ fontSize: '0.78rem', color: '#38bdf8', fontWeight: 600 }}>
                      📋 Click to view statement & history ›
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditAccount(acc);
                      }}
                      className="bank-edit-balance-pill"
                    >
                      ✏️ Edit / Adjust
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 4. Modal: Inter-Account Transfer */}
      {showTransferModal && (
        <div className="modal-overlay" onClick={() => setShowTransferModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 className="modal-title">
                ⇄ Inter-Account Transfer
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowTransferModal(false)}
                title="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteTransfer} className="modal-form">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-item">
                  <label className="form-label" htmlFor="tf-from">
                    From Account
                  </label>
                  <select
                    id="tf-from"
                    value={transferForm.fromAccount}
                    onChange={(e) => setTransferForm({ ...transferForm, fromAccount: e.target.value })}
                    className="field"
                    required
                  >
                    <option value="">-- Select Source --</option>
                    {liquidAccounts.map((a) => (
                      <option key={a.localId} value={a.name}>
                        {a.name} ({fmt(a.balance)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-item">
                  <label className="form-label" htmlFor="tf-to">
                    To Destination
                  </label>
                  <select
                    id="tf-to"
                    value={transferForm.toAccount}
                    onChange={(e) => setTransferForm({ ...transferForm, toAccount: e.target.value })}
                    className="field"
                    required
                  >
                    <option value="">-- Select Destination --</option>
                    {liquidAccounts
                      .filter((a) => a.name !== transferForm.fromAccount)
                      .map((a) => (
                        <option key={a.localId} value={a.name}>
                          {a.name} ({fmt(a.balance)})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-item">
                  <label className="form-label" htmlFor="tf-amt">
                    Amount (৳)
                  </label>
                  <input
                    id="tf-amt"
                    type="number"
                    min="0.01"
                    step="any"
                    placeholder="5000"
                    value={transferForm.amount}
                    onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                    className="field"
                    required
                  />
                </div>

                <div className="form-item">
                  <label className="form-label" htmlFor="tf-fee">
                    Transfer Fee (৳)
                  </label>
                  <input
                    id="tf-fee"
                    type="number"
                    min="0"
                    step="any"
                    placeholder="e.g. 75 for bKash"
                    value={transferForm.fee}
                    onChange={(e) => setTransferForm({ ...transferForm, fee: e.target.value })}
                    className="field"
                  />
                </div>
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="tf-date">
                  Transfer Date
                </label>
                <input
                  id="tf-date"
                  type="date"
                  value={transferForm.date}
                  onChange={(e) => setTransferForm({ ...transferForm, date: e.target.value })}
                  className="field"
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="tf-note">
                  Note (optional)
                </label>
                <input
                  id="tf-note"
                  type="text"
                  placeholder="e.g. ATM cash withdrawal, bKash Add Money"
                  value={transferForm.note}
                  onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })}
                  className="field"
                />
              </div>

              <div className="modal-actions" style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="secondary"
                  style={{ height: '42px', padding: '0 20px', borderRadius: '10px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary"
                  style={{
                    height: '42px',
                    padding: '0 24px',
                    borderRadius: '10px',
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    borderColor: '#f59e0b',
                  }}
                >
                  ⇄ Complete Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Modal: Add / Edit Account or Asset */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editingAccount ? `✏️ Edit "${editingAccount.name}"` : '➕ Add Account or Asset'}
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowAddModal(false)}
                title="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAccount} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="acc-name">
                  Account / Asset Name
                </label>
                <input
                  id="acc-name"
                  type="text"
                  placeholder="e.g. City Bank, bKash Personal, Gold 2 Bhori, BRAC DPS"
                  value={accountForm.name}
                  onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                  className="field"
                  required
                  autoFocus
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-item">
                  <label className="form-label" htmlFor="acc-type">
                    Classification / Type
                  </label>
                  <select
                    id="acc-type"
                    value={accountForm.type}
                    onChange={(e) => setAccountForm({ ...accountForm, type: e.target.value })}
                    className="field"
                  >
                    <option value="bank">🏦 Bank Account</option>
                    <option value="mfs">📱 Mobile Wallet (MFS)</option>
                    <option value="cash">💵 Cash in Hand</option>
                    <option value="fdr">📜 Fixed Deposit / DPS</option>
                    <option value="asset">🏆 Physical Asset (Gold/Land)</option>
                  </select>
                </div>

                <div className="form-item">
                  <label className="form-label" htmlFor="acc-balance">
                    Balance / Value (৳)
                  </label>
                  <input
                    id="acc-balance"
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={accountForm.balance}
                    onChange={(e) => setAccountForm({ ...accountForm, balance: e.target.value })}
                    className="field"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-item">
                  <label className="form-label" htmlFor="acc-inst">
                    Institution (optional)
                  </label>
                  <input
                    id="acc-inst"
                    type="text"
                    placeholder="e.g. City Bank, bKash"
                    value={accountForm.institution}
                    onChange={(e) => setAccountForm({ ...accountForm, institution: e.target.value })}
                    className="field"
                  />
                </div>

                <div className="form-item">
                  <label className="form-label" htmlFor="acc-number">
                    Account / Card Number
                  </label>
                  <input
                    id="acc-number"
                    type="text"
                    placeholder="e.g. ••4821 or 017•••••"
                    value={accountForm.accountNumber}
                    onChange={(e) => setAccountForm({ ...accountForm, accountNumber: e.target.value })}
                    className="field"
                  />
                </div>
              </div>

              {accountForm.type === 'fdr' && (
                <div className="form-item">
                  <label className="form-label" htmlFor="acc-maturity">
                    Maturity Date (for Fixed Deposit / DPS)
                  </label>
                  <input
                    id="acc-maturity"
                    type="date"
                    value={accountForm.maturityDate}
                    onChange={(e) => setAccountForm({ ...accountForm, maturityDate: e.target.value })}
                    className="field"
                  />
                </div>
              )}

              <div className="form-item">
                <label className="form-label" htmlFor="acc-notes">
                  Notes / Details (optional)
                </label>
                <input
                  id="acc-notes"
                  type="text"
                  placeholder="e.g. Interest rate 9.5%, located in safe locker"
                  value={accountForm.notes}
                  onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })}
                  className="field"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', gap: '10px' }}>
                {editingAccount ? (
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
                ) : <div />}

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="secondary"
                    style={{ height: '42px', padding: '0 20px', borderRadius: '10px' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary"
                    style={{ height: '42px', padding: '0 24px', borderRadius: '10px', fontWeight: 700 }}
                  >
                    {editingAccount ? 'Save Changes' : '+ Add Account'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Statement & History Drawer Modal */}
      {selectedStatementAccount && (
        <div className="modal-overlay" onClick={() => setSelectedStatementAccount(null)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '680px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
          >
            {/* Drawer Header */}
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.5rem' }}>{getTypeMeta(selectedStatementAccount.type).icon}</span>
                <div>
                  <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {selectedStatementAccount.name}
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '1px 7px',
                        borderRadius: '5px',
                        color: getTypeMeta(selectedStatementAccount.type).color,
                        background: getTypeMeta(selectedStatementAccount.type).bg,
                      }}
                    >
                      {getTypeMeta(selectedStatementAccount.type).label}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Current Balance: <strong style={{ color: '#38bdf8' }}>{fmt(selectedStatementAccount.balance)}</strong>
                    {selectedStatementAccount.accountNumber && ` • ${selectedStatementAccount.accountNumber}`}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/productivity?tab=vault&search=${encodeURIComponent(
                        selectedStatementAccount.name
                      )}`
                    )
                  }
                  style={{
                    background: 'rgba(168, 85, 247, 0.12)',
                    color: '#c084fc',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '0.74rem',
                    fontWeight: 650,
                    cursor: 'pointer',
                  }}
                  title="View encrypted PIN / password in Vault"
                >
                  🔐 Vault PINs
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStatementAccount(null)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Inflow vs Outflow Mini-Summary */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                padding: '12px 0',
                borderBottom: '1px solid #141a27',
              }}
            >
              <div style={{ background: '#090d15', padding: '10px 14px', borderRadius: '10px', border: '1px solid #1a2233' }}>
                <span style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 700, textTransform: 'uppercase' }}>
                  Total Inflow (+)
                </span>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#34d399', marginTop: '3px' }}>
                  +{fmt(statementTotals.inflow)}
                </div>
              </div>

              <div style={{ background: '#090d15', padding: '10px 14px', borderRadius: '10px', border: '1px solid #1a2233' }}>
                <span style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 700, textTransform: 'uppercase' }}>
                  Total Outflow (−)
                </span>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f87171', marginTop: '3px' }}>
                  −{fmt(statementTotals.outflow)}
                </div>
              </div>
            </div>

            {/* Filter Search inside Statement */}
            <div style={{ padding: '12px 0 8px' }}>
              <input
                type="text"
                placeholder="Search transactions inside this account..."
                value={statementSearch}
                onChange={(e) => setStatementSearch(e.target.value)}
                className="field w-full text-sm"
              />
            </div>

            {/* Statement Entries List */}
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
              {statementEntries.length === 0 ? (
                <p className="text-sm text-slate-500 py-10 text-center">
                  No transaction records found for this account.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {statementEntries.map((item) => (
                    <div
                      key={item.localId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: '#090d15',
                        border: '1px solid #1a2233',
                        borderRadius: '10px',
                        padding: '10px 14px',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.92rem', fontWeight: 650, color: '#f8fafc' }}>
                          {item.displayLabel}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '3px' }}>
                          {item.formattedDate} · {item.category || item.type}
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: '1rem',
                          fontWeight: 750,
                          color: item.isExpense ? '#f87171' : '#34d399',
                        }}
                      >
                        {item.displaySign}
                        {fmt(item.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Drawer Footer Actions */}
            <div className="flex justify-between items-center pt-3 border-t border-slate-800 mt-3">
              <span className="text-xs text-slate-500">
                Showing {statementEntries.length} transaction entries
              </span>
              <button
                type="button"
                onClick={() => setSelectedStatementAccount(null)}
                className="secondary px-4 py-1.5 text-xs rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
