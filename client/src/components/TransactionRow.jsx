import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { CategoryIcon, ICON_STROKE } from './AppIcons';

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
 * Shared bKash-style expense transaction row with Lucide icons.
 */
export default function TransactionRow({ item, fmt, onEdit, onDelete }) {
  const txTime = getTransactionTime(item);

  return (
    <div className="bkash-tx-row">
      <div className="bkash-tx-left">
        <CategoryIcon category={item.category} size={20} />
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
            aria-label={`Edit ${item.note || 'expense'}`}
          >
            <Pencil size={13} strokeWidth={ICON_STROKE} aria-hidden="true" style={{ marginRight: '4px' }} />
            <span>Edit</span>
          </button>
          <button
            type="button"
            className="bkash-action-btn danger"
            onClick={() => onDelete(item)}
            title="Delete expense"
            aria-label={`Delete ${item.note || 'expense'}`}
          >
            <Trash2 size={13} strokeWidth={ICON_STROKE} aria-hidden="true" style={{ marginRight: '4px' }} />
            <span>Delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}
