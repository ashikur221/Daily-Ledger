import React, { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/localDb';
import api from '../services/api';
import { queueSync } from '../services/syncService';
import { adjustAccountBalance, getAllAccounts } from '../services/accountService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';

export default function LedgerPage({ initialType = '' }) {
  const { isOnline, refreshPendingCount } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  // Date Range Share state
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [shareText, setShareText] = useState('');
  const [shareStatus, setShareStatus] = useState('');

  // Modal / Form state for Add / Edit
  const [availableAccounts, setAvailableAccounts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [form, setForm] = useState({
    title: '',
    amount: '',
    category: 'Food',
    account: 'Cash in Hand',
    date: new Date().toISOString().split('T')[0],
  });

  // Track which date accordions are open (default all or first 5 open)
  const [openDates, setOpenDates] = useState({});

  // Virtualization / Infinite Scroll: number of day groups to render
  const INITIAL_BATCH_SIZE = 15;
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH_SIZE);
  const loadMoreRef = React.useRef(null);

  useEffect(() => {
    loadTransactions();

    const handleRemoteUpdate = () => {
      loadTransactions();
    };
    window.addEventListener('daily_ledger:data_updated', handleRemoteUpdate);
    return () => window.removeEventListener('daily_ledger:data_updated', handleRemoteUpdate);
  }, []);

  const loadTransactions = async () => {
    setLoading(true);
    try {
      // Load all non-deleted transactions from IndexedDB
      const local = await db.transactions
        .where('isDeleted')
        .equals(0)
        .reverse()
        .sortBy('date');
      setTransactions(local);

      // Load available accounts for the payment selector
      getAllAccounts().then((accs) => {
        setAvailableAccounts(accs);
      });

      // Set default date range for export (earliest to latest date)
      const expensesOnly = local.filter((t) => t.type === 'expense');
      if (expensesOnly.length > 0) {
        const dates = expensesOnly
          .map((t) => new Date(t.date).toISOString().split('T')[0])
          .sort();
        setFromDate(dates[0]);
        setToDate(dates[dates.length - 1]);
      }

      if (isOnline) {
        api.get('/transactions?limit=2000').then(async ({ data }) => {
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
        }).catch(() => {});
      }
    } finally {
      setLoading(false);
    }
  };

  // Filter only expenses
  const allExpenses = useMemo(() => {
    return transactions.filter((t) => t.type === 'expense' && t.category !== 'Banking');
  }, [transactions]);

  // Overall metrics
  const totalExpenseAmount = useMemo(() => {
    return allExpenses.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [allExpenses]);

  const uniqueRecordedDays = useMemo(() => {
    const daySet = new Set(
      allExpenses.map((t) => new Date(t.date).toISOString().split('T')[0])
    );
    return daySet.size;
  }, [allExpenses]);

  // Submitted search matches & calculation
  const searchResults = useMemo(() => {
    const q = activeSearch.trim().toLowerCase();
    if (!q) return null;

    const matches = allExpenses.filter((t) =>
      (t.note || '').toLowerCase().includes(q)
    );

    const sum = matches.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    return {
      query: activeSearch.trim(),
      count: matches.length,
      total: sum,
    };
  }, [allExpenses, activeSearch]);

  // Group expenses by Date
  const groupedByDate = useMemo(() => {
    const q = activeSearch.trim().toLowerCase();
    const groups = {};

    allExpenses.forEach((tx) => {
      if (q) {
        const titleMatch = (tx.note || '').toLowerCase().includes(q);
        if (!titleMatch) return;
      }

      const dateKey = new Date(tx.date).toISOString().split('T')[0];

      if (!groups[dateKey]) {
        groups[dateKey] = {
          date: dateKey,
          items: [],
          total: 0,
        };
      }
      groups[dateKey].items.push(tx);
      groups[dateKey].total += Number(tx.amount) || 0;
    });

    // Sort items within each date group chronologically, newest first
    Object.values(groups).forEach((group) => {
      group.items.sort((a, b) => {
        const timeA = new Date(a.clientUpdatedAt || a.createdAt || a.date).getTime() || 0;
        const timeB = new Date(b.clientUpdatedAt || b.createdAt || b.date).getTime() || 0;
        return timeB - timeA;
      });
    });

    // Sort dates newest to oldest
    return Object.values(groups).sort((a, b) => b.date.localeCompare(a.date));
  }, [allExpenses, activeSearch]);

  // Reset visibleCount when search changes so first matches show up immediately
  useEffect(() => {
    setVisibleCount(INITIAL_BATCH_SIZE);
  }, [activeSearch]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setActiveSearch(searchInput.trim());
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setActiveSearch('');
  };

  // Infinite Scroll / Virtual batching via IntersectionObserver
  useEffect(() => {
    if (!loadMoreRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + 10, groupedByDate.length));
        }
      },
      { rootMargin: '250px' }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [groupedByDate.length]);

  const displayedGroups = useMemo(() => {
    return groupedByDate.slice(0, visibleCount);
  }, [groupedByDate, visibleCount]);

  const toggleDate = (dateKey) => {
    setOpenDates((prev) => ({
      ...prev,
      [dateKey]: !prev[dateKey],
    }));
  };

  const liquidAccounts = useMemo(() => {
    // Only liquid accounts (cash, mfs, bank, other) — exclude fixed deposits (fdr) and physical assets (asset)
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
    if (form.account && !map.has(form.account.toLowerCase())) {
      map.set(form.account.toLowerCase(), {
        name: form.account,
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
  }, [availableAccounts, form.account]);

  const handleOpenAddForDate = (dateKey) => {
    setEditTx(null);
    const defaultAcc =
      availableAccounts.find((a) => a.type !== 'fdr' && a.type !== 'asset')?.name ||
      'Cash in Hand';
    setForm({
      title: '',
      amount: '',
      category: 'Food & drinks',
      account: defaultAcc,
      date: dateKey || new Date().toISOString().split('T')[0],
    });
    setShowModal(true);
  };

  const handleOpenEdit = (tx) => {
    setEditTx(tx);
    setForm({
      title: tx.note || '',
      amount: tx.amount,
      category: tx.category || 'General',
      account: tx.account || 'Cash in Hand',
      date: new Date(tx.date).toISOString().split('T')[0],
    });
    setShowModal(true);
  };

  const handleSaveModal = async (e) => {
    e.preventDefault();
    const num = parseFloat(form.amount);
    if (isNaN(num) || num <= 0 || !form.title.trim()) {
      toast.error('Please enter a valid title and amount');
      return;
    }

    const localId = editTx?.localId || uuidv4();
    const chosenAccount = (form.account || 'Cash in Hand').trim();
    const record = {
      localId,
      type: 'expense',
      amount: num,
      category: form.category || 'General',
      account: chosenAccount,
      date: new Date(form.date),
      note: form.title.trim(),
      synced: false,
      isDeleted: 0,
      clientUpdatedAt: new Date(),
    };

    await db.transactions.put(record);
    await queueSync('transactions', localId);

    // Dynamic Balance Adjustment across Accounts
    if (editTx) {
      // Revert previous account deduction
      await adjustAccountBalance(editTx.account || 'Cash in Hand', Number(editTx.amount));
    }
    // Apply new expense deduction
    await adjustAccountBalance(chosenAccount, -num);

    if (isOnline) {
      try {
        if (editTx) {
          await api.put(`/transactions/${localId}`, record);
        } else {
          await api.post('/transactions', record);
        }
        await db.transactions.update(localId, { synced: true });
        await db.syncQueue.where({ entity: 'transactions', localId }).delete();
      } catch {}
    }

    await refreshPendingCount();
    toast.success(editTx ? 'Expense updated successfully!' : 'Expense added successfully!');
    setShowModal(false);
    setEditTx(null);
    loadTransactions();
  };

  const handleDelete = async (tx) => {
    const ok = await confirm({
      title: 'Delete Expense',
      message: `Are you sure you want to delete "${tx.note || 'expense'}" for ৳${tx.amount}?`,
      confirmText: 'Delete Expense',
      danger: true,
    });
    if (!ok) return;

    await db.transactions.update(tx.localId, { isDeleted: 1, synced: false });
    await queueSync('transactions', tx.localId);

    // Revert account deduction so money returns to account balance
    await adjustAccountBalance(tx.account || 'Cash in Hand', Number(tx.amount));

    if (isOnline) {
      try {
        await api.delete(`/transactions/${tx.localId}`);
        await db.transactions.update(tx.localId, { synced: true });
        await db.syncQueue.where({ entity: 'transactions', localId: tx.localId }).delete();
      } catch {}
    }

    await refreshPendingCount();
    toast.info('Expense deleted');
    loadTransactions();
  };

  // Date Range Share generator
  const handleGenerateShareText = () => {
    if (!fromDate || !toDate) {
      toast.warning('Please choose both From and To dates');
      return;
    }
    if (fromDate > toDate) {
      toast.warning('From date must be on or before To date');
      return;
    }

    const filtered = allExpenses
      .filter((t) => {
        const d = new Date(t.date).toISOString().split('T')[0];
        return d >= fromDate && d <= toDate;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (filtered.length === 0) {
      setShareText(`No expenses recorded between ${fromDate} and ${toDate}.`);
      return;
    }

    const total = filtered.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const lines = [
      '📒 DAILY LEDGER — EXPENSE SUMMARY',
      `Period: ${fromDate} to ${toDate}`,
      '────────────────────────────',
    ];

    let currentDate = '';
    filtered.forEach((t) => {
      const dStr = new Date(t.date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      if (dStr !== currentDate) {
        currentDate = dStr;
        lines.push(`\n📅 ${currentDate}:`);
      }
      lines.push(`  • ${t.note || 'Expense'}: ৳${Number(t.amount).toLocaleString('en-IN')}`);
    });

    lines.push('\n────────────────────────────');
    lines.push(`TOTAL EXPENSES: ৳${total.toLocaleString('en-IN')}`);
    lines.push(`Total Entries: ${filtered.length}`);
    lines.push('────────────────────────────');
    lines.push('Shared via Daily Ledger');

    const generated = lines.join('\n');
    setShareText(generated);
    setShareStatus('Ready to copy or share.');
    toast.success('Share text generated!');
  };

  const handleCopyShareText = async () => {
    if (!shareText.trim()) {
      handleGenerateShareText();
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setShareStatus('Copied! Paste it into WhatsApp, Messenger, or chat.');
      toast.success('Copied to clipboard!');
    } catch {
      setShareStatus('Please select and copy manually.');
    }
  };

  const handleNativeShare = async () => {
    if (!shareText.trim()) {
      handleGenerateShareText();
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Daily Ledger Expense Summary',
          text: shareText,
        });
        setShareStatus('Shared successfully!');
      } catch (err) {
        if (err.name !== 'AbortError') {
          handleCopyShareText();
        }
      }
    } else {
      handleCopyShareText();
    }
  };

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-IN')}`;

  const getCategoryMeta = (category = '') => {
    const cat = category.toLowerCase();
    if (cat.includes('food') || cat.includes('drink')) {
      return { icon: '🍽️', bg: 'rgba(245, 158, 11, 0.14)', label: 'Food & Drinks' };
    }
    if (cat.includes('transport') || cat.includes('fare') || cat.includes('rickshaw')) {
      return { icon: '🚗', bg: 'rgba(56, 189, 248, 0.14)', label: 'Transport' };
    }
    if (cat.includes('phone') || cat.includes('internet') || cat.includes('comm')) {
      return { icon: '📱', bg: 'rgba(129, 140, 248, 0.14)', label: 'Phone & Net' };
    }
    if (cat.includes('health') || cat.includes('med')) {
      return { icon: '💊', bg: 'rgba(239, 68, 68, 0.14)', label: 'Health' };
    }
    if (cat.includes('cloth') || cat.includes('wear')) {
      return { icon: '👕', bg: 'rgba(236, 72, 153, 0.14)', label: 'Clothing' };
    }
    if (cat.includes('study') || cat.includes('book') || cat.includes('suppl')) {
      return { icon: '📚', bg: 'rgba(168, 85, 247, 0.14)', label: 'Study & Supplies' };
    }
    if (cat.includes('house') || cat.includes('rent')) {
      return { icon: '🏠', bg: 'rgba(16, 185, 129, 0.14)', label: 'Housing' };
    }
    if (cat.includes('laundry') || cat.includes('util')) {
      return { icon: '🧺', bg: 'rgba(6, 182, 212, 0.14)', label: 'Household' };
    }
    if (cat.includes('personal') || cat.includes('care')) {
      return { icon: '✨', bg: 'rgba(244, 63, 94, 0.14)', label: 'Personal Care' };
    }
    if (cat.includes('shop')) {
      return { icon: '🛍️', bg: 'rgba(251, 146, 60, 0.14)', label: 'Shopping' };
    }
    return { icon: '💳', bg: 'rgba(148, 163, 184, 0.12)', label: category || 'General' };
  };

  const formatDateGroupHeading = (dateStr) => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      const yesterdayStr = yest.toISOString().split('T')[0];

      const d = new Date(dateStr + 'T00:00:00');
      const formattedDate = d
        .toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
        .toUpperCase();

      if (dateStr === todayStr) return `TODAY — ${formattedDate}`;
      if (dateStr === yesterdayStr) return `YESTERDAY — ${formattedDate}`;
      return formattedDate;
    } catch {
      return dateStr;
    }
  };

  const getTransactionTime = (tx) => {
    try {
      const raw = tx.clientUpdatedAt || tx.createdAt || tx.date;
      if (!raw) return null;
      const d = new Date(raw);
      if (isNaN(d.getTime())) return null;
      // Only show time if it isn't exact midnight UTC/local placeholder
      if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
        return null;
      }
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return null;
    }
  };

  return (
    <div className="pitch-dashboard">
      {/* 1. EXPENSE SUMMARY CARD with the EXACT SAME NEON CIRCLE DESIGN AS TODAY TAB */}
      <div className="panel p-4 expense-total-panel">
        <div className="finance-summary-heading">
          <span className="finance-summary-icon">▥</span>
          <h2>EXPENSE SUMMARY</h2>
        </div>

        <div className="finance-summary-wrap">
          {/* Exactly identical structure and typography as Today tab */}
          <div className="balance-ring">
            <div className="balance-inner">
              <div className="balance-label">TOTAL EXPENSE</div>
              <div id="expensePageTotal" className="balance-amount">
                {fmt(totalExpenseAmount)}
              </div>
              <div className="balance-subtitle">
                Calculated from {uniqueRecordedDays} recorded days
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Search by Title */}
      <div className="panel">
        <div>
          <h2 className="panel-title">Search by Title</h2>
          <p className="panel-sub">Find your expenses quickly using their title.</p>
        </div>

        <form onSubmit={handleSearchSubmit} className="expense-search-form">
          <div className="expense-search-input-wrap">
            <input
              id="historySearch"
              type="text"
              className="field"
              placeholder="Enter expense title..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {(searchInput || activeSearch) && (
              <button
                type="button"
                className="expense-search-clear-icon"
                onClick={handleClearSearch}
                title="Clear search"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="submit"
            className="primary expense-search-btn"
          >
            Search
          </button>
        </form>

        {/* Submitted Search Summary */}
        {searchResults && (
          <div className="expense-search-summary">
            <div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                Total spent on <strong style={{ color: '#f8fafc' }}>"{searchResults.query}"</strong>
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#38bdf8', marginTop: '2px' }}>
                {fmt(searchResults.total)}{' '}
                <span style={{ fontSize: '0.78rem', fontWeight: 500, color: '#94a3b8' }}>
                  ({searchResults.count} matching {searchResults.count === 1 ? 'entry' : 'entries'})
                </span>
              </div>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={handleClearSearch}
              style={{ padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600, borderRadius: '8px' }}
            >
              Clear Search
            </button>
          </div>
        )}
      </div>

      {/* 3. Date Range Share & Export Panel */}
      <div className="panel">
        <h3 className="panel-title-md">Share expense list</h3>
        <p className="panel-sub mb-3">
          Choose a date range, create a readable list with the total, then copy it to WhatsApp, Messenger, or any chat.
        </p>

        <div className="date-range-row">
          <div className="form-item flex-1">
            <label className="form-label" htmlFor="exportFrom">From date</label>
            <input
              id="exportFrom"
              type="date"
              className="field"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="form-item flex-1">
            <label className="form-label" htmlFor="exportTo">To date</label>
            <input
              id="exportTo"
              type="date"
              className="field"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <button
            id="shareExpenseBtn"
            type="button"
            className="primary self-end"
            onClick={handleGenerateShareText}
          >
            Create share text
          </button>
        </div>

        {shareText && (
          <div className="share-text-area-wrap">
            <textarea
              id="shareExpenseText"
              className="field w-full font-mono"
              rows={8}
              value={shareText}
              readOnly
            />
            <div className="share-actions-row">
              <button
                type="button"
                className="secondary"
                onClick={handleCopyShareText}
              >
                📋 Copy ready text
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleNativeShare}
              >
                ↗ Share…
              </button>
              {shareStatus && (
                <span className="share-status-msg">{shareStatus}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 4. Date-Grouped Banking Transaction History */}
      <div className="tx-history-stream">
        {loading ? (
          <div className="panel text-center py-8">
            <div className="spinner-lg mx-auto mb-3" />
            <p className="panel-sub">Loading expense history...</p>
          </div>
        ) : groupedByDate.length === 0 ? (
          <div className="panel text-center py-8">
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>
              {activeSearch ? '🔍' : '📒'}
            </div>
            <p className="panel-sub" style={{ marginBottom: activeSearch ? '14px' : '0' }}>
              {activeSearch
                ? `No expenses found matching "${activeSearch}".`
                : 'No recorded expenses yet.'}
            </p>
            {activeSearch && (
              <button
                type="button"
                className="secondary"
                onClick={handleClearSearch}
                style={{ padding: '7px 16px', fontSize: '0.82rem', fontWeight: 600 }}
              >
                Clear Search & Show All
              </button>
            )}
          </div>
        ) : (
          <>
            {displayedGroups.map((group) => (
              <div key={group.date} className="tx-date-group">
                <div className="tx-date-group-header">
                  <span className="tx-date-group-label">
                    {formatDateGroupHeading(group.date)}
                  </span>
                  <span className="tx-date-group-total">
                    Daily total: {fmt(group.total)}
                  </span>
                </div>

                <div className="tx-date-group-list">
                  {group.items.map((item) => {
                    const catMeta = getCategoryMeta(item.category);
                    const txTime = getTransactionTime(item);
                    return (
                      <div key={item.localId} className="bkash-tx-row">
                        <div className="bkash-tx-left">
                          <div
                            className="bkash-tx-icon"
                            style={{ background: catMeta.bg }}
                            aria-hidden="true"
                          >
                            {catMeta.icon}
                          </div>
                          <div className="bkash-tx-details">
                            <div className="bkash-tx-title">
                              {item.note || 'Expense'}
                            </div>
                            <div className="bkash-tx-meta">
                              <span>{item.category || 'General'}</span>
                              <span style={{ opacity: 0.45 }}>·</span>
                              <span style={{ color: '#7dd3fc' }}>
                                {item.account || 'Cash in Hand'}
                              </span>
                              {txTime && (
                                <>
                                  <span style={{ opacity: 0.45 }}>·</span>
                                  <span className="bkash-tx-time">{txTime}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="bkash-tx-right">
                          <div className="bkash-tx-amount">
                            -{fmt(item.amount)}
                          </div>
                          <div className="bkash-tx-actions">
                            <button
                              type="button"
                              className="bkash-action-btn"
                              onClick={() => handleOpenEdit(item)}
                              title="Edit expense"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="bkash-action-btn danger"
                              onClick={() => handleDelete(item)}
                              title="Delete expense"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Infinite Scroll trigger / Load more button */}
            {visibleCount < groupedByDate.length && (
              <div
                ref={loadMoreRef}
                style={{
                  textAlign: 'center',
                  padding: '14px 0',
                }}
              >
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setVisibleCount((prev) => Math.min(prev + 15, groupedByDate.length))
                  }
                  style={{
                    height: '40px',
                    padding: '0 20px',
                    borderRadius: '10px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                  }}
                >
                  Load older days ({groupedByDate.length - visibleCount} more)...
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 5. Add / Edit Expense Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">
              {editTx ? 'Edit Expense' : 'Add Expense'}
            </h2>
            <form onSubmit={handleSaveModal} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="modal-date">Date</label>
                <input
                  id="modal-date"
                  type="date"
                  className="field"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="modal-title">Expense Title</label>
                <input
                  id="modal-title"
                  type="text"
                  className="field"
                  placeholder="e.g. Cha, Rickshaw, Dinner"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="modal-amount">Amount (৳)</label>
                <input
                  id="modal-amount"
                  type="number"
                  step="any"
                  min="0.01"
                  className="field"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="modal-account">
                  Paid From Account (Liquid Cash)
                </label>
                <select
                  id="modal-account"
                  className="field"
                  value={form.account || 'Cash in Hand'}
                  onChange={(e) => setForm({ ...form, account: e.target.value })}
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

              <div className="form-item">
                <label className="form-label" htmlFor="modal-category">Category</label>
                <select
                  id="modal-category"
                  className="field"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
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

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary">
                  {editTx ? 'Save Changes' : 'Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
