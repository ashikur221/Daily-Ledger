import React, { useState, useEffect, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ListOrdered, Receipt, Search, Tag, X } from 'lucide-react';
import { ICON_STROKE } from '../components/AppIcons';
import DateFilterBar from '../components/DateFilterBar';
import db from '../db/localDb';
import api from '../services/api';
import { queueSync } from '../services/syncService';
import { adjustAccountBalance, getAllAccounts } from '../services/accountService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import TransactionRow, { formatDateGroupHeading } from '../components/TransactionRow';

const EXPENSE_CATEGORIES = [
  { value: 'Food & drinks', label: 'Food & Drinks' },
  { value: 'Transport', label: 'Transport / Fare' },
  { value: 'Phone & communication', label: 'Phone & Internet' },
  { value: 'Health', label: 'Health & Medicine' },
  { value: 'Personal care', label: 'Personal Care' },
  { value: 'Clothing', label: 'Clothing' },
  { value: 'Study & supplies', label: 'Study & Supplies' },
  { value: 'Housing', label: 'Housing & Rent' },
  { value: 'Laundry & household', label: 'Household & Utilities' },
  { value: 'General', label: 'General / Other' },
];

export default function TransactionsPage() {
  const { isOnline, refreshPendingCount } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [availableAccounts, setAvailableAccounts] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Edit modal state
  const [showModal, setShowModal] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [form, setForm] = useState({
    title: '',
    amount: '',
    category: 'Food & drinks',
    account: 'Cash in Hand',
    date: new Date().toISOString().split('T')[0],
  });

  // Infinite Scroll / batching
  const INITIAL_BATCH_SIZE = 15;
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH_SIZE);
  const loadMoreRef = useRef(null);

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
      const local = await db.transactions
        .where('isDeleted')
        .equals(0)
        .reverse()
        .sortBy('date');
      setTransactions(local);

      getAllAccounts().then((accs) => {
        setAvailableAccounts(accs);
      });

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

  const allExpenses = useMemo(() => {
    return transactions.filter((t) => t.type === 'expense' && t.category !== 'Banking');
  }, [transactions]);

  const categoryOptions = useMemo(() => {
    const map = new Map();
    EXPENSE_CATEGORIES.forEach((c) => map.set(c.value.toLowerCase(), c));
    allExpenses.forEach((tx) => {
      const cat = (tx.category || '').trim();
      if (cat && !map.has(cat.toLowerCase())) {
        map.set(cat.toLowerCase(), { value: cat, label: cat });
      }
    });
    return Array.from(map.values());
  }, [allExpenses]);

  const categoryLabelMap = useMemo(() => {
    const map = new Map();
    categoryOptions.forEach((c) => map.set(c.value.toLowerCase(), c.label));
    return map;
  }, [categoryOptions]);

  const filteredExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allExpenses.filter((tx) => {
      if (selectedDate) {
        const dateKey = new Date(tx.date).toISOString().split('T')[0];
        if (dateKey !== selectedDate) return false;
      }
      const txCat = (tx.category || 'General').trim();
      if (selectedCategory !== 'all' && txCat.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }
      if (q) {
        const note = (tx.note || '').toLowerCase();
        const account = (tx.account || '').toLowerCase();
        const cat = txCat.toLowerCase();
        const catLabel = (categoryLabelMap.get(cat) || cat).toLowerCase();
        if (!note.includes(q) && !cat.includes(q) && !catLabel.includes(q) && !account.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [allExpenses, selectedDate, selectedCategory, searchQuery, categoryLabelMap]);

  const filteredTotal = useMemo(() => {
    return filteredExpenses.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  }, [filteredExpenses]);

  const hasActiveFilters = Boolean(selectedDate || selectedCategory !== 'all' || searchQuery.trim());

  const clearAllFilters = () => {
    setSelectedDate('');
    setSelectedCategory('all');
    setSearchQuery('');
  };

  useEffect(() => {
    setVisibleCount(INITIAL_BATCH_SIZE);
  }, [selectedDate, selectedCategory, searchQuery]);

  const groupedByDate = useMemo(() => {
    const groups = {};
    filteredExpenses.forEach((tx) => {
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

    Object.values(groups).forEach((group) => {
      group.items.sort((a, b) => {
        const timeA = new Date(a.clientUpdatedAt || a.createdAt || a.date).getTime() || 0;
        const timeB = new Date(b.clientUpdatedAt || b.createdAt || b.date).getTime() || 0;
        return timeB - timeA;
      });
    });

    return Object.values(groups).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredExpenses]);

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

    if (editTx) {
      await adjustAccountBalance(editTx.account || 'Cash in Hand', Number(editTx.amount));
    }
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

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-IN')}`;

  return (
    <div className="pitch-dashboard">
      {/* Page Header & Modern Quick-Date + Calendar Filter Bar */}
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ListOrdered size={20} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
              <span>Transaction List</span>
            </h2>
            <p className="panel-sub">
              {hasActiveFilters
                ? `Showing ${filteredExpenses.length} matching ${filteredExpenses.length === 1 ? 'entry' : 'entries'} · Total: ${fmt(filteredTotal)}`
                : `Chronological expense history grouped by date (${allExpenses.length} entries).`}
            </p>
          </div>
        </div>

        <DateFilterBar selectedDate={selectedDate} onChangeDate={setSelectedDate} />

        <div className="tx-search-filter-row">
          <div className="tx-search-input-wrap">
            <Search size={16} strokeWidth={ICON_STROKE} className="tx-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="tx-search-input"
              placeholder="Search by title, category, or account..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search expenses by title, category, or account"
            />
            {searchQuery && (
              <button
                type="button"
                className="tx-search-clear-icon"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="tx-category-select-wrap">
            <Tag size={15} strokeWidth={ICON_STROKE} className="tx-category-icon" aria-hidden="true" />
            <select
              className="tx-category-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="Filter expenses by category"
            >
              <option value="all">All Categories</option>
              {categoryOptions.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {(selectedCategory !== 'all' || searchQuery.trim()) && (
            <button
              type="button"
              className="tx-filter-clear-btn"
              onClick={clearAllFilters}
            >
              <X size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Date-Grouped Banking Transaction History */}
      <div className="tx-history-stream">
        {loading ? (
          <div className="panel text-center py-8">
            <div className="spinner-lg mx-auto mb-3" />
            <p className="panel-sub">Loading transaction list...</p>
          </div>
        ) : groupedByDate.length === 0 ? (
          <div className="panel text-center py-8">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px', color: '#64748b' }}>
              <Receipt size={32} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </div>
            <p className="panel-sub" style={{ marginBottom: hasActiveFilters ? '14px' : '0' }}>
              {hasActiveFilters
                ? 'No expenses match your current filters.'
                : 'No recorded expenses yet.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                className="secondary"
                onClick={clearAllFilters}
                style={{ padding: '7px 16px', fontSize: '0.82rem', fontWeight: 600 }}
              >
                Show All Expenses
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
                  {group.items.map((item) => (
                    <TransactionRow
                      key={item.localId}
                      item={item}
                      fmt={fmt}
                      onEdit={handleOpenEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            ))}

            {visibleCount < groupedByDate.length && (
              <div ref={loadMoreRef} style={{ textAlign: 'center', padding: '14px 0' }}>
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

      {/* Edit Expense Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">
              {editTx ? 'Edit Expense' : 'Add Expense'}
            </h2>
            <form onSubmit={handleSaveModal} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="tx-modal-date">Date</label>
                <input
                  id="tx-modal-date"
                  type="date"
                  className="field"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="tx-modal-title">Expense Title</label>
                <input
                  id="tx-modal-title"
                  type="text"
                  className="field"
                  placeholder="e.g. Cha, Rickshaw, Dinner"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="tx-modal-amount">Amount (৳)</label>
                <input
                  id="tx-modal-amount"
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
                <label className="form-label" htmlFor="tx-modal-account">
                  Paid From Account (Liquid Cash)
                </label>
                <select
                  id="tx-modal-account"
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
                <label className="form-label" htmlFor="tx-modal-category">Category</label>
                <select
                  id="tx-modal-category"
                  className="field"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
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
