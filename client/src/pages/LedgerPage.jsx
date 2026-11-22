import React, { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/localDb';
import api from '../services/api';
import { queueSync } from '../services/syncService';
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
  const [search, setSearch] = useState('');

  // Date Range Share state
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [shareText, setShareText] = useState('');
  const [shareStatus, setShareStatus] = useState('');

  // Modal / Form state for Add / Edit
  const [showModal, setShowModal] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [form, setForm] = useState({
    title: '',
    amount: '',
    category: 'General',
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

  // Real-time search matches & calculation
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;

    const matches = allExpenses.filter((t) => {
      const titleMatch = (t.note || '').toLowerCase().includes(q);
      const catMatch = (t.category || '').toLowerCase().includes(q);
      const dateMatch = new Date(t.date).toISOString().split('T')[0].includes(q);
      return titleMatch || catMatch || dateMatch;
    });

    const sum = matches.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    return {
      query: search.trim(),
      count: matches.length,
      total: sum,
    };
  }, [allExpenses, search]);

  // Group expenses by Date
  const groupedByDate = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = {};

    allExpenses.forEach((tx) => {
      const dateKey = new Date(tx.date).toISOString().split('T')[0];

      if (q) {
        const titleMatch = (tx.note || '').toLowerCase().includes(q);
        const catMatch = (tx.category || '').toLowerCase().includes(q);
        const dateMatch = dateKey.includes(q);
        if (!titleMatch && !catMatch && !dateMatch) return;
      }

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

    // Sort dates newest to oldest
    return Object.values(groups).sort((a, b) => b.date.localeCompare(a.date));
  }, [allExpenses, search]);

  // Reset visibleCount when search changes so first matches show up immediately
  useEffect(() => {
    setVisibleCount(INITIAL_BATCH_SIZE);
  }, [search]);

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

  const handleOpenAddForDate = (dateKey) => {
    setEditTx(null);
    setForm({
      title: '',
      amount: '',
      category: 'General',
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
    const record = {
      localId,
      type: 'expense',
      amount: num,
      category: form.category || 'General',
      account: 'Cash in Hand',
      date: new Date(form.date),
      note: form.title.trim(),
      synced: false,
      isDeleted: 0,
      clientUpdatedAt: new Date(),
    };

    await db.transactions.put(record);
    await queueSync('transactions', localId);

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

  const formatHeaderDate = (dateStr) => {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
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

      {/* 2. Expense History & Quick Search */}
      <div className="panel">
        <div className="expense-history-header-row">
          <div>
            <h2 className="panel-title">Expense history</h2>
            <p className="panel-sub">Browse previous days and their itemized expenses.</p>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => handleOpenAddForDate('')}
          >
            + Add Expense
          </button>
        </div>

        {/* Search Bar */}
        <div className="search-bar-wrap">
          <input
            id="historySearch"
            type="text"
            className="field"
            placeholder="Search title, category or date…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearch('')}
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* Real-Time Search Summary Badge */}
        {searchResults && (
          <div className="search-summary-box">
            <div className="search-summary-label">
              Total spent on "{searchResults.query}"
            </div>
            <div className="search-summary-amount">
              {fmt(searchResults.total)}
            </div>
            <div className="search-summary-sub">
              {searchResults.count} matching expense {searchResults.count === 1 ? 'entry' : 'entries'} · Itemized expenses only
            </div>
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

      {/* 4. Grouped Itemized Accordion by Day */}
      <div className="history-grouped-list">
        {loading ? (
          <div className="panel text-center py-8">
            <div className="spinner-lg mx-auto mb-3" />
            <p className="panel-sub">Loading expense history...</p>
          </div>
        ) : groupedByDate.length === 0 ? (
          <div className="panel text-center py-8">
            <p className="panel-sub">
              {search ? `No expenses matching "${search}"` : 'No recorded expenses yet.'}
            </p>
          </div>
        ) : (
          <>
            {displayedGroups.map((group) => {
              const isOpen = openDates[group.date] ?? (search ? true : false);

              return (
                <div key={group.date} className="panel history-date-card">
                  {/* Clickable Date Summary Header */}
                  <div
                    className="history-date-header"
                    onClick={() => toggleDate(group.date)}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <div className="history-date-title">
                        {formatHeaderDate(group.date)}
                      </div>
                      <div className="history-date-meta">
                        {group.items.length} itemized {group.items.length === 1 ? 'entry' : 'entries'}
                      </div>
                    </div>

                    <div className="history-date-right">
                      <span className="history-date-amount">{fmt(group.total)}</span>
                      <span className={`accordion-chevron ${isOpen ? 'open' : ''}`}>
                        ⌄
                      </span>
                    </div>
                  </div>

                  {/* Collapsible itemized entries body */}
                  {isOpen && (
                    <div className="history-date-body">
                      <div className="history-date-actions-top">
                        <button
                          type="button"
                          className="primary text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenAddForDate(group.date);
                          }}
                        >
                          + Add expense to this day
                        </button>
                      </div>

                      <div className="entries-list">
                        {group.items.map((item) => (
                          <div key={item.localId} className="entry-row">
                            <div className="entry-info">
                              <div className="entry-title">{item.note || 'Expense'}</div>
                              <div className="entry-category">{item.category || 'General'}</div>
                            </div>
                            <div className="entry-right">
                              <span className="entry-amount">{fmt(item.amount)}</span>
                              <div className="entry-actions">
                                <button
                                  type="button"
                                  className="btn-link"
                                  onClick={() => handleOpenEdit(item)}
                                  title="Edit"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn-link text-danger"
                                  onClick={() => handleDelete(item)}
                                  title="Delete"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Infinite Scroll trigger / Load more button */}
            {visibleCount < groupedByDate.length && (
              <div
                ref={loadMoreRef}
                style={{
                  textAlign: 'center',
                  padding: '18px 0',
                }}
              >
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setVisibleCount((prev) => Math.min(prev + 15, groupedByDate.length))}
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
                <label className="form-label" htmlFor="modal-category">Category</label>
                <select
                  id="modal-category"
                  className="field"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  <option value="General">General</option>
                  <option value="Food">Food & Snacks</option>
                  <option value="Transport">Transport / Fare</option>
                  <option value="Utilities">Utilities & Bills</option>
                  <option value="Shopping">Shopping & Clothes</option>
                  <option value="Medical">Medical & Health</option>
                  <option value="Housing">Housing & Rent</option>
                  <option value="Other">Other</option>
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
