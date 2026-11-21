import React, { useState, useEffect, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/localDb';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { queueSync } from '../services/syncService';
import { useToast } from '../context/ToastContext';

export default function ToolsPage() {
  const { isOnline, refreshPendingCount } = useAuth();
  const toast = useToast();

  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [person, setPerson] = useState('');
  const [debtType, setDebtType] = useState('owe'); // 'owe': They owe me (receive), 'owed': I owe them (pay)
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [editingDebt, setEditingDebt] = useState(null);

  // Repayment form states
  const [repayDebtId, setRepayDebtId] = useState('');
  const [repayAmount, setRepayAmount] = useState('');
  const [repayDate, setRepayDate] = useState(new Date().toISOString().split('T')[0]);
  const [repayNote, setRepayNote] = useState('');

  const formRef = useRef(null);
  const repayFormRef = useRef(null);

  useEffect(() => {
    loadToolsData();
  }, []);

  const loadToolsData = async () => {
    setLoading(true);
    try {
      const local = await db.tools.where('isDeleted').equals(0).toArray();
      setTools(local);

      if (isOnline) {
        api
          .get('/tools')
          .then(async ({ data }) => {
            if (data && data.tools) {
              await db.tools.bulkPut(
                data.tools.map((t) => ({
                  ...t,
                  synced: true,
                  isDeleted: t.isDeleted ? 1 : 0,
                }))
              );
              const fresh = await db.tools.where('isDeleted').equals(0).toArray();
              setTools(fresh);
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error('Failed loading tools:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter debts and repayments
  const debtsList = useMemo(() => {
    return tools
      .filter((t) => t.toolType === 'debt')
      .map((t) => ({
        localId: t.localId,
        id: t.localId,
        person: t.data?.person || 'Unknown',
        type: t.data?.type || 'owe',
        amount: Number(t.data?.amount) || 0,
        repaid: Number(t.data?.repaid) || 0,
        remaining:
          t.data?.remaining !== undefined
            ? Number(t.data.remaining)
            : Math.max(0, (Number(t.data?.amount) || 0) - (Number(t.data?.repaid) || 0)),
        date: t.data?.date || '',
        note: t.data?.note || '',
        raw: t,
      }));
  }, [tools]);

  const repaymentsList = useMemo(() => {
    return tools
      .filter((t) => t.toolType === 'repayment')
      .map((t) => ({
        localId: t.localId,
        debtId: t.data?.debtId || '',
        person: t.data?.person || 'Unknown',
        type: t.data?.type || 'owe',
        amount: Number(t.data?.amount) || 0,
        date: t.data?.date || '',
        note: t.data?.note || '',
        raw: t,
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [tools]);

  // Calculations for overview circles & metrics
  const moneyToReceive = useMemo(() => {
    return debtsList
      .filter((d) => d.type === 'owe')
      .reduce((sum, d) => sum + Math.max(0, d.remaining), 0);
  }, [debtsList]);

  const moneyToPay = useMemo(() => {
    return debtsList
      .filter((d) => d.type === 'owed')
      .reduce((sum, d) => sum + Math.max(0, d.remaining), 0);
  }, [debtsList]);

  const netPosition = useMemo(() => {
    return moneyToReceive - moneyToPay;
  }, [moneyToReceive, moneyToPay]);

  const receiveDebts = useMemo(() => {
    return debtsList.filter((d) => d.type === 'owe');
  }, [debtsList]);

  const payDebts = useMemo(() => {
    return debtsList.filter((d) => d.type === 'owed');
  }, [debtsList]);

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-IN')}`;

  const formatDateLabel = (dStr) => {
    if (!dStr) return 'No date';
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Add / Edit Debt
  const handleSaveDebt = async (e) => {
    e.preventDefault();
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      toast.warning('Please enter a valid amount.');
      return;
    }
    if (!person.trim()) {
      toast.warning('Please enter a person name.');
      return;
    }

    try {
      if (editingDebt) {
        const diffRepaid = Number(editingDebt.repaid) || 0;
        const newRemaining = Math.max(0, num - diffRepaid);
        const updatedRecord = {
          ...editingDebt.raw,
          data: {
            ...editingDebt.raw.data,
            person: person.trim(),
            type: debtType,
            amount: num,
            date,
            note: note.trim(),
            remaining: newRemaining,
          },
          synced: false,
          clientUpdatedAt: new Date(),
        };

        await db.tools.put(updatedRecord);
        await queueSync('tools', updatedRecord.localId, 'update', updatedRecord);
        refreshPendingCount();

        setTools((prev) =>
          prev.map((t) => (t.localId === updatedRecord.localId ? updatedRecord : t))
        );
        toast.success(`Updated record for ${person.trim()}`);
        setEditingDebt(null);
      } else {
        const localId = uuidv4();
        const newRecord = {
          localId,
          toolType: 'debt',
          data: {
            person: person.trim(),
            type: debtType,
            amount: num,
            repaid: 0,
            remaining: num,
            date,
            note: note.trim(),
          },
          synced: false,
          isDeleted: 0,
          clientUpdatedAt: new Date(),
        };

        await db.tools.put(newRecord);
        await queueSync('tools', localId, 'create', newRecord);
        refreshPendingCount();

        setTools((prev) => [newRecord, ...prev]);
        toast.success(
          debtType === 'owe'
            ? `Money to receive recorded for ${person.trim()}`
            : `Money to pay recorded for ${person.trim()}`
        );
      }

      setPerson('');
      setAmount('');
      setNote('');
      setDate(new Date().toISOString().split('T')[0]);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save record');
    }
  };

  const handleStartEditDebt = (d) => {
    setEditingDebt(d);
    setPerson(d.person);
    setDebtType(d.type);
    setAmount(d.amount);
    setNote(d.note || '');
    setDate(d.date || new Date().toISOString().split('T')[0]);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCancelEdit = () => {
    setEditingDebt(null);
    setPerson('');
    setAmount('');
    setNote('');
    setDate(new Date().toISOString().split('T')[0]);
  };

  const handleDeleteDebt = async (debtId) => {
    if (!window.confirm('Delete this debt record?')) return;
    try {
      const record = tools.find((t) => t.localId === debtId);
      if (!record) return;

      const updated = { ...record, isDeleted: 1, synced: false, clientUpdatedAt: new Date() };
      await db.tools.put(updated);
      await queueSync('tools', debtId, 'delete', { localId: debtId });
      refreshPendingCount();

      setTools((prev) => prev.filter((t) => t.localId !== debtId));
      if (editingDebt?.localId === debtId) {
        handleCancelEdit();
      }
      toast.info('Record deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete record');
    }
  };

  // Record Repayment
  const handleSaveRepayment = async (e) => {
    e.preventDefault();
    if (!repayDebtId) {
      toast.warning('Please select a record to repay.');
      return;
    }
    const num = parseFloat(repayAmount);
    if (isNaN(num) || num <= 0) {
      toast.warning('Please enter a valid repayment amount.');
      return;
    }

    const targetDebt = debtsList.find((d) => d.localId === repayDebtId);
    if (!targetDebt) {
      toast.error('Selected record not found.');
      return;
    }

    try {
      const repayLocalId = uuidv4();
      const repayRecord = {
        localId: repayLocalId,
        toolType: 'repayment',
        data: {
          debtId: targetDebt.localId,
          person: targetDebt.person,
          type: targetDebt.type,
          amount: num,
          date: repayDate,
          note: repayNote.trim(),
        },
        synced: false,
        isDeleted: 0,
        clientUpdatedAt: new Date(),
      };
      await db.tools.put(repayRecord);
      await queueSync('tools', repayLocalId, 'create', repayRecord);

      const newRepaid = (Number(targetDebt.repaid) || 0) + num;
      const newRemaining = Math.max(0, (Number(targetDebt.amount) || 0) - newRepaid);
      const updatedDebt = {
        ...targetDebt.raw,
        data: {
          ...targetDebt.raw.data,
          repaid: newRepaid,
          remaining: newRemaining,
        },
        synced: false,
        clientUpdatedAt: new Date(),
      };
      await db.tools.put(updatedDebt);
      await queueSync('tools', targetDebt.localId, 'update', updatedDebt);
      refreshPendingCount();

      setTools((prev) => [
        repayRecord,
        ...prev.map((t) => (t.localId === targetDebt.localId ? updatedDebt : t)),
      ]);

      toast.success(
        `Repayment of ৳${num.toLocaleString('en-US')} recorded for ${targetDebt.person}`
      );
      setRepayAmount('');
      setRepayNote('');
      setRepayDebtId('');
    } catch (err) {
      console.error(err);
      toast.error('Failed to record repayment');
    }
  };

  const handleDeleteRepayment = async (repayment) => {
    if (!window.confirm('Delete this repayment record? The debt balance will be updated.'))
      return;
    try {
      const updatedRepay = {
        ...repayment.raw,
        isDeleted: 1,
        synced: false,
        clientUpdatedAt: new Date(),
      };
      await db.tools.put(updatedRepay);
      await queueSync('tools', repayment.localId, 'delete', { localId: repayment.localId });

      if (repayment.debtId) {
        const targetDebt = debtsList.find((d) => d.localId === repayment.debtId);
        if (targetDebt) {
          const newRepaid = Math.max(
            0,
            (Number(targetDebt.repaid) || 0) - repayment.amount
          );
          const newRemaining = Math.max(
            0,
            (Number(targetDebt.amount) || 0) - newRepaid
          );
          const updatedDebt = {
            ...targetDebt.raw,
            data: {
              ...targetDebt.raw.data,
              repaid: newRepaid,
              remaining: newRemaining,
            },
            synced: false,
            clientUpdatedAt: new Date(),
          };
          await db.tools.put(updatedDebt);
          await queueSync('tools', targetDebt.localId, 'update', updatedDebt);
          setTools((prev) =>
            prev
              .filter((t) => t.localId !== repayment.localId)
              .map((t) => (t.localId === targetDebt.localId ? updatedDebt : t))
          );
        } else {
          setTools((prev) => prev.filter((t) => t.localId !== repayment.localId));
        }
      } else {
        setTools((prev) => prev.filter((t) => t.localId !== repayment.localId));
      }

      refreshPendingCount();
      toast.info('Repayment deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete repayment');
    }
  };

  const scrollToDebtForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollToRepayForm = () => {
    repayFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="pitch-dashboard">
      {/* 1. EXACT HERO CIRCLE AS TODAY TAB */}
      <div className="balance-screen">
        <div className="balance-ring">
          <div className="balance-inner">
            <div className="balance-label">NET LOAN POSITION</div>
            <div
              id="debtHeroTotal"
              className="balance-amount"
              style={{
                color: netPosition >= 0 ? '#10b981' : '#fb7185',
                textShadow:
                  netPosition >= 0
                    ? '0 0 18px rgba(16,185,129,0.45)'
                    : '0 0 18px rgba(251,113,133,0.45)',
              }}
            >
              {netPosition >= 0 ? `+${fmt(netPosition)}` : `-${fmt(Math.abs(netPosition))}`}
            </div>
            <div className="balance-subtitle">
              Receive {fmt(moneyToReceive)} · Pay {fmt(moneyToPay)}
            </div>
          </div>
        </div>

        {/* Action Buttons matching Today tab */}
        <div className="balance-actions">
          <button type="button" onClick={scrollToDebtForm} className="balance-action">
            Add Debt or Loan <span>›</span>
          </button>
          <button type="button" onClick={scrollToRepayForm} className="balance-action">
            Record Repayment <span>›</span>
          </button>
        </div>

        <div className="balance-note">
          Debts & loans tracked separately · Does not alter daily available cash
        </div>
      </div>

      {/* 2. 4-Metrics Grid matching Today tab */}
      <div className="metrics-grid">
        <div className="panel p-4">
          <div className="tiny-label">Money to receive</div>
          <div className="metric-value text-emerald-400">{fmt(moneyToReceive)}</div>
          <div className="metric-sub">{receiveDebts.length} people owe you</div>
        </div>

        <div className="panel p-4">
          <div className="tiny-label">Money to pay</div>
          <div className="metric-value text-rose-400">{fmt(moneyToPay)}</div>
          <div className="metric-sub">{payDebts.length} payments due</div>
        </div>

        <div className="panel p-4">
          <div className="tiny-label">Active Records</div>
          <div className="metric-value">{debtsList.length}</div>
          <div className="metric-sub">Lending & borrowing entries</div>
        </div>

        <div className="panel p-4">
          <div className="tiny-label">Repayments logged</div>
          <div className="metric-value">{repaymentsList.length}</div>
          <div className="metric-sub">Partial & full settlements</div>
        </div>
      </div>

      {/* 3. Add / Edit Record Form Panel - Clean, Spacious, 2-Column Responsive Layout */}
      <div className="debt-form-card" ref={formRef}>
        <div className="panel-header-block">
          <div>
            <h2 className="panel-title" style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
              {editingDebt ? 'Edit debt / loan' : 'Add a debt or loan'}
            </h2>
            <p className="panel-sub" style={{ color: '#94a3b8', marginTop: '6px', fontSize: '0.85rem' }}>
              Record money you lent to someone or borrowed from someone.
            </p>
          </div>
          {editingDebt && (
            <button
              type="button"
              onClick={handleCancelEdit}
              className="text-xs text-rose-400 hover:text-rose-300 font-semibold px-3 py-1.5 rounded-full border border-rose-800/50 bg-rose-950/30"
            >
              ✕ Cancel edit
            </button>
          )}
        </div>

        <form onSubmit={handleSaveDebt}>
          {/* Row 1: Type of Record & Person/Contact in 2 Columns */}
          <div className="debt-form-grid">
            <div className="debt-input-group">
              <label className="debt-input-label" htmlFor="debtType">
                Type of record
              </label>
              <select
                id="debtType"
                value={debtType}
                onChange={(e) => setDebtType(e.target.value)}
                className="debt-text-input"
              >
                <option value="owe">They owe me (Money I will receive)</option>
                <option value="owed">I owe them (Money I need to pay)</option>
              </select>
            </div>

            <div className="debt-input-group">
              <label className="debt-input-label" htmlFor="debtPerson">
                Person / Contact name
              </label>
              <input
                id="debtPerson"
                type="text"
                placeholder="e.g. Rahim, Office colleague, Cousin"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="debt-text-input"
                required
              />
            </div>
          </div>

          {/* Row 2: Amount & Date in 2 Columns */}
          <div className="debt-form-grid">
            <div className="debt-input-group">
              <label className="debt-input-label" htmlFor="debtAmount">
                Amount (৳)
              </label>
              <div className="debt-amount-wrap">
                <span className="currency-sign">
                  ৳
                </span>
                <input
                  id="debtAmount"
                  type="number"
                  min="0.01"
                  step="any"
                  placeholder="5000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="debt-text-input"
                  required
                />
              </div>
            </div>

            <div className="debt-input-group">
              <label className="debt-input-label" htmlFor="debtDate">
                Date
              </label>
              <input
                id="debtDate"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="debt-text-input"
                required
              />
            </div>
          </div>

          {/* Row 3: Optional Note (Full width) */}
          <div className="debt-input-group">
            <label className="debt-input-label" htmlFor="debtNote">
              Note (optional)
            </label>
            <input
              id="debtNote"
              type="text"
              placeholder="e.g. For medical emergency, rent share"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="debt-text-input"
            />
          </div>

          {/* Action Row */}
          <div style={{ marginTop: '14px', display: 'flex', gap: '16px' }}>
            <button className="debt-submit-action" type="submit">
              {editingDebt ? '✓ Update Record' : '+ Add Record'}
            </button>
            {editingDebt && (
              <>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="secondary"
                  style={{ height: '48px', padding: '0 20px', borderRadius: '12px', marginTop: '6px' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteDebt(editingDebt.localId)}
                  className="px-6 h-12 bg-rose-950/40 text-rose-400 border border-rose-800/40 rounded-xl text-sm font-semibold hover:bg-rose-900/60 transition-colors"
                  style={{ marginTop: '6px' }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </form>
      </div>

      {/* 4. Lists Grid: Receivables & Payables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Money I will receive */}
        <div className="panel p-6">
          <div className="panel-header-block flex justify-between items-start pb-4 border-b border-slate-800/80 mb-4">
            <div>
              <h3 className="panel-title-md text-emerald-400 font-bold text-lg">Money I will receive</h3>
              <p className="panel-sub text-slate-400 text-xs mt-1">People who owe you money</p>
            </div>
            <strong className="text-xl text-emerald-400 font-bold">{fmt(moneyToReceive)}</strong>
          </div>

          <div className="space-y-3">
            {receiveDebts.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No money to receive yet.</p>
            ) : (
              receiveDebts.map((d) => (
                <div
                  key={d.localId}
                  className="entry-row flex justify-between items-center py-3 px-2 border-b border-slate-800/60 last:border-b-0"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="font-semibold text-slate-100 text-sm truncate">{d.person}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Original: {fmt(d.amount)} · Repaid: {fmt(d.repaid)} · {formatDateLabel(d.date)}
                      {d.note ? ` · ${d.note}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <strong className="text-emerald-400 font-semibold text-base">
                      {fmt(d.remaining)}
                    </strong>
                    <button
                      type="button"
                      onClick={() => handleStartEditDebt(d)}
                      className="text-xs font-semibold px-3 py-1.5 border border-slate-700 bg-slate-900/80 hover:bg-slate-800 rounded-lg text-slate-200 transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Money I need to pay */}
        <div className="panel p-6">
          <div className="panel-header-block flex justify-between items-start pb-4 border-b border-slate-800/80 mb-4">
            <div>
              <h3 className="panel-title-md text-rose-400 font-bold text-lg">Money I need to pay</h3>
              <p className="panel-sub text-slate-400 text-xs mt-1">People you need to repay</p>
            </div>
            <strong className="text-xl text-rose-400 font-bold">{fmt(moneyToPay)}</strong>
          </div>

          <div className="space-y-3">
            {payDebts.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No payments due yet.</p>
            ) : (
              payDebts.map((d) => (
                <div
                  key={d.localId}
                  className="entry-row flex justify-between items-center py-3 px-2 border-b border-slate-800/60 last:border-b-0"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="font-semibold text-slate-100 text-sm truncate">{d.person}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Original: {fmt(d.amount)} · Repaid: {fmt(d.repaid)} · {formatDateLabel(d.date)}
                      {d.note ? ` · ${d.note}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <strong className="text-rose-400 font-semibold text-base">
                      {fmt(d.remaining)}
                    </strong>
                    <button
                      type="button"
                      onClick={() => handleStartEditDebt(d)}
                      className="text-xs font-semibold px-3 py-1.5 border border-slate-700 bg-slate-900/80 hover:bg-slate-800 rounded-lg text-slate-200 transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 5. Record a Repayment Panel - Spacious 2-Column Responsive Layout */}
      <div className="debt-form-card" ref={repayFormRef}>
        <div className="panel-header-block">
          <div>
            <h3 className="panel-title" style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
              Record a repayment
            </h3>
            <p className="panel-sub" style={{ color: '#94a3b8', marginTop: '6px', fontSize: '0.85rem' }}>
              Each repayment updates the remaining balance and is saved to history.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveRepayment}>
          {/* Row 1: Select Debt & Amount in 2 Columns */}
          <div className="debt-form-grid">
            <div className="debt-input-group">
              <label className="debt-input-label" htmlFor="repayDebt">
                Select debt / loan
              </label>
              <select
                id="repayDebt"
                value={repayDebtId}
                onChange={(e) => setRepayDebtId(e.target.value)}
                className="debt-text-input"
                required
              >
                <option value="">-- Choose debt / loan --</option>
                {debtsList.map((d) => (
                  <option key={d.localId} value={d.localId}>
                    {d.person} — {d.type === 'owe' ? 'They owe me' : 'I owe them'} ({fmt(d.remaining)}{' '}
                    remaining)
                  </option>
                ))}
              </select>
            </div>

            <div className="debt-input-group">
              <label className="debt-input-label" htmlFor="repayAmount">
                Repayment amount (৳)
              </label>
              <div className="debt-amount-wrap">
                <span className="currency-sign">
                  ৳
                </span>
                <input
                  id="repayAmount"
                  type="number"
                  min="0.01"
                  step="any"
                  placeholder="1000"
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  className="debt-text-input"
                  required
                />
              </div>
            </div>
          </div>

          {/* Row 2: Date & Payment Method in 2 Columns */}
          <div className="debt-form-grid">
            <div className="debt-input-group">
              <label className="debt-input-label" htmlFor="repayDate">
                Date
              </label>
              <input
                id="repayDate"
                type="date"
                value={repayDate}
                onChange={(e) => setRepayDate(e.target.value)}
                className="debt-text-input"
                required
              />
            </div>

            <div className="debt-input-group">
              <label className="debt-input-label" htmlFor="repayNote">
                Payment method / note (optional)
              </label>
              <input
                id="repayNote"
                type="text"
                placeholder="e.g. bKash, Cash in hand"
                value={repayNote}
                onChange={(e) => setRepayNote(e.target.value)}
                className="debt-text-input"
              />
            </div>
          </div>

          <div style={{ marginTop: '14px' }}>
            <button className="debt-submit-action" type="submit">
              Record repayment
            </button>
          </div>
        </form>

        {/* Repayment History */}
        <div className="mt-8 pt-6 border-t border-slate-800/80">
          <h4 className="font-bold text-slate-200 text-base mb-4">Repayment History</h4>

          {repaymentsList.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No repayments recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {repaymentsList.map((r) => (
                <div
                  key={r.localId}
                  className="entry-row flex justify-between items-center py-2.5 px-2 border-b border-slate-800/40 text-sm"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="font-semibold text-slate-100">
                      {r.person} {r.note ? `· ${r.note}` : ''}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {formatDateLabel(r.date)} · Repaid {r.type === 'owe' ? 'to you' : 'by you'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <strong className="text-emerald-400 font-semibold text-base">
                      +{fmt(r.amount)}
                    </strong>
                    <button
                      type="button"
                      onClick={() => handleDeleteRepayment(r)}
                      className="text-xs text-rose-400 hover:text-rose-300 underline font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
