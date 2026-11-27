import React, { useRef } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { ICON_STROKE } from './AppIcons';
import { formatDateGroupHeading } from './TransactionRow';

/**
 * Reusable Quick-Date + Calendar Pill Filter Bar.
 */
export default function DateFilterBar({ selectedDate, onChangeDate }) {
  const dateInputRef = useRef(null);
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  })();

  const isCustomDate = Boolean(
    selectedDate && selectedDate !== todayStr && selectedDate !== yesterdayStr
  );

  const openNativeDatePicker = () => {
    const el = dateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
      } catch {
        el.focus();
      }
    } else {
      el.focus();
      el.click();
    }
  };

  return (
    <div className="tx-filter-bar" role="group" aria-label="Filter records by date">
      <button
        type="button"
        className={`tx-filter-pill ${selectedDate === '' ? 'active' : ''}`}
        onClick={() => onChangeDate('')}
      >
        All Dates
      </button>

      <button
        type="button"
        className={`tx-filter-pill ${selectedDate === todayStr ? 'active' : ''}`}
        onClick={() => onChangeDate(todayStr)}
      >
        Today
      </button>

      <button
        type="button"
        className={`tx-filter-pill ${selectedDate === yesterdayStr ? 'active' : ''}`}
        onClick={() => onChangeDate(yesterdayStr)}
      >
        Yesterday
      </button>

      <div className="tx-date-picker-wrap">
        <button
          type="button"
          className={`tx-filter-pill ${isCustomDate ? 'active' : ''}`}
          onClick={openNativeDatePicker}
          aria-label="Pick a specific date from calendar"
        >
          <CalendarDays size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>{isCustomDate ? formatDateGroupHeading(selectedDate) : 'Pick Date'}</span>
        </button>
        <input
          ref={dateInputRef}
          type="date"
          value={selectedDate}
          onChange={(e) => onChangeDate(e.target.value)}
          className="tx-date-hidden-input"
          aria-label="Choose date from calendar"
        />
      </div>

      {selectedDate && (
        <button
          type="button"
          className="tx-filter-clear-btn"
          onClick={() => onChangeDate('')}
          aria-label="Clear date filter"
        >
          <X size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>Reset</span>
        </button>
      )}
    </div>
  );
}
