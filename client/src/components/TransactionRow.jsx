import React from 'react';

export const getCategoryMeta = (category = '') => {
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

export const formatDateGroupHeading = (dateStr) => {
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

export const getTransactionTime = (tx) => {
  try {
    const raw = tx.clientUpdatedAt || tx.createdAt || tx.date;
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
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

/**
 * Shared bKash-style expense transaction row.
 */
export default function TransactionRow({ item, fmt, onEdit, onDelete }) {
  const catMeta = getCategoryMeta(item.category);
  const txTime = getTransactionTime(item);

  return (
    <div className="bkash-tx-row">
      <div className="bkash-tx-left">
        <div
          className="bkash-tx-icon"
          style={{ background: catMeta.bg }}
          aria-hidden="true"
        >
          {catMeta.icon}
        </div>
        <div className="bkash-tx-details">
          <div className="bkash-tx-title">{item.note || 'Expense'}</div>
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
        <div className="bkash-tx-amount">-{fmt(item.amount)}</div>
        <div className="bkash-tx-actions">
          <button
            type="button"
            className="bkash-action-btn"
            onClick={() => onEdit(item)}
            title="Edit expense"
          >
            Edit
          </button>
          <button
            type="button"
            className="bkash-action-btn danger"
            onClick={() => onDelete(item)}
            title="Delete expense"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
