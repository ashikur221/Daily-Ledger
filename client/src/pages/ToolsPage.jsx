import React, { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/localDb';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { queueSync } from '../services/syncService';
import { adjustAccountBalance, getAllAccounts } from '../services/accountService';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';

export default function ToolsPage() {
  const { isOnline, refreshPendingCount } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [availableAccounts, setAvailableAccounts] = useState([]);

  // Modals
  const [showDebtModal, setShowDebtModal] = useState(false);
  const [showRepayModal, setShowRepayModal] = useState(false);
  const [editingDebt, setEditingDebt] = useState(null);

  // Form states for Debt
  const todayStr = new Date().toISOString().split('T')[0];
  const [debtForm, setDebtForm] = useState({
    person: '',
    type: 'owe', // 'owe': They owe me (receive), 'owed': I owe them (pay)
    amount: '',
    date: todayStr,
    note: '',
  });

  // Repayment form states
  const [repayForm, setRepayForm] = useState({
    debtId: '',
    amount: '',
    account: 'Cash in Hand',
    date: todayStr,
    note: '',
  });

  useEffect(() => {
    loadToolsData();

    const handleRemoteUpdate = () => {
      loadToolsData();
    };
    window.addEventListener('daily_ledger:data_updated', handleRemoteUpdate);
    return () => window.removeEventListener('daily_ledger:data_updated', handleRemoteUpdate);
  }, []);

  const loadToolsData = async () => {
    setLoading(true);
    try {
      const local = await db.tools.where('isDeleted').equals(0).toArray();
      setTools(local);

      // Load accounts for repayment linkage
      getAllAccounts().then((accs) => {
        setAvailableAccounts(accs);
      });

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
        person: t.data?.person || 'Unknown',
        type: t.data?.type || 'owe',
        amount: Number(t.data?.amount) || 0,
        repaid: Number(t.data?.repaid) || 0,
        remaining:
          t.data?.remaining !== undefined
            ? Number(t.data?.remaining)
            : Number(t.data?.amount) || 0,
        date: t.data?.date || '',
        note: t.data?.note || '',
        raw: t,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
        account: t.data?.account || '',
        date: t.data?.date || '',
        note: t.data?.note || '',
        raw: t,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [tools]);

  // Aggregate metrics
  const moneyToReceive = useMemo(() => {
    return debtsList
      .filter((d) => d.type === 'owe')
      .reduce((sum, d) => sum + (Number(d.remaining) || 0), 0);
  }, [debtsList]);

  const moneyToPay = useMemo(() => {
    return debtsList
      .filter((d) => d.type === 'owed')
      .reduce((sum, d) => sum + (Number(d.remaining) || 0), 0);
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

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;

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

  // Open Add Debt Modal
  const handleOpenAddDebt = (defaultType = 'owe') => {
    setEditingDebt(null);
    setDebtForm({
      person: '',
      type: defaultType,
      amount: '',
      date: todayStr,
      note: '',
    });
    setShowDebtModal(true);
  };

  // Open Edit Debt Modal
  const handleStartEditDebt = (d) => {
    setEditingDebt(d);
    setDebtForm({
      person: d.person,
      type: d.type,
      amount: String(d.amount),
      date: d.date || todayStr,
      note: d.note || '',
    });
    setShowDebtModal(true);
  };

  // Save Debt Record
  const handleSaveDebt = async (e) => {
    e.preventDefault();
    const num = parseFloat(debtForm.amount);
    if (isNaN(num) || num <= 0) {
      toast.warning('Please enter a valid amount.');
      return;
    }
    if (!debtForm.person.trim()) {
      toast.warning('Please enter person or party name.');
      return;
    }

    try {
      if (editingDebt) {
        const repaidSoFar = Number(editingDebt.repaid) || 0;
        const newRemaining = Math.max(0, num - repaidSoFar);

        const updatedRecord = {
          ...editingDebt.raw,
          data: {
            ...editingDebt.raw.data,
            person: debtForm.person.trim(),
            type: debtForm.type,
            amount: num,
            remaining: newRemaining,
            date: debtForm.date,
            note: debtForm.note.trim(),
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
        toast.success(`Updated record for ${debtForm.person.trim()}`);
      } else {
        const localId = uuidv4();
        const newRecord = {
          localId,
          toolType: 'debt',
          data: {
            person: debtForm.person.trim(),
            type: debtForm.type,
            amount: num,
            repaid: 0,
            remaining: num,
            date: debtForm.date,
            note: debtForm.note.trim(),
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
          debtForm.type === 'owe'
            ? `Money to receive recorded for ${debtForm.person.trim()}`
            : `Money to pay recorded for ${debtForm.person.trim()}`
        );
      }

      setShowDebtModal(false);
      setEditingDebt(null);
    } catch (err) {
      console.error(err);
      toast.error('Failed to save record');
    }
  };

  const handleDeleteDebt = async (debtId) => {
    const record = tools.find((t) => t.localId === debtId);
    const personName = record?.data?.person || 'this record';
    const amountVal = record?.data?.amount ? ` (৳${record.data.amount})` : '';

    const ok = await confirm({
      title: 'Delete Debt Record',
      message: `Are you sure you want to delete the debt record for "${personName}"${amountVal}?`,
      confirmText: 'Delete Record',
      danger: true,
    });
    if (!ok) return;

    try {
      const updated = {
        ...record,
        isDeleted: 1,
        synced: false,
        clientUpdatedAt: new Date(),
      };
      await db.tools.put(updated);
      await queueSync('tools', record.localId, 'delete', { localId: record.localId });
      refreshPendingCount();

      setTools((prev) => prev.filter((t) => t.localId !== record.localId));
      setShowDebtModal(false);
      setEditingDebt(null);
      toast.info(`Record for ${personName} deleted.`);
    } catch (err) {
      toast.error('Failed to delete record');
    }
  };

  // Open Repayment Modal
  const handleOpenRepay = (targetDebtId = '') => {
    setRepayForm({
      debtId: targetDebtId || debtsList[0]?.localId || '',
      amount: '',
      account: availableAccounts[0]?.name || 'Cash in Hand',
      date: todayStr,
      note: '',
    });
    setShowRepayModal(true);
  };

  // Save Repayment
  const handleSaveRepayment = async (e) => {
    e.preventDefault();
    if (!repayForm.debtId) {
      toast.warning('Please select a debt or loan to repay.');
      return;
    }
    const num = parseFloat(repayForm.amount);
    if (isNaN(num) || num <= 0) {
      toast.warning('Please enter a valid repayment amount.');
      return;
    }

    const targetDebt = debtsList.find((d) => d.localId === repayForm.debtId);
    if (!targetDebt) {
      toast.error('Selected record not found.');
      return;
    }

    try {
      const repayLocalId = uuidv4();
      const chosenAcc = (repayForm.account || '').trim();
      const repayRecord = {
        localId: repayLocalId,
        toolType: 'repayment',
        data: {
          debtId: targetDebt.localId,
          person: targetDebt.person,
          type: targetDebt.type,
          amount: num,
          account: chosenAcc,
          date: repayForm.date,
          note: repayForm.note.trim(),
        },
        synced: false,
        isDeleted: 0,
        clientUpdatedAt: new Date(),
      };
      await db.tools.put(repayRecord);
      await queueSync('tools', repayLocalId, 'create', repayRecord);

      // Reconcile with account if chosen
      if (chosenAcc) {
        if (targetDebt.type === 'owe') {
          // They owe me, so I received cash!
          await adjustAccountBalance(chosenAcc, num);
        } else {
          // I owe them, so I paid cash!
          await adjustAccountBalance(chosenAcc, -num);
        }
      }

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
      setShowRepayModal(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to record repayment');
    }
  };

  const handleDeleteRepayment = async (repayment) => {
    const ok = await confirm({
      title: 'Delete Repayment Record',
      message: `Are you sure you want to delete this repayment of ৳${repayment.amount}? The associated debt balance will be recalculated.`,
      confirmText: 'Delete Repayment',
      danger: true,
    });
    if (!ok) return;

    try {
      const updatedRepay = {
        ...repayment.raw,
        isDeleted: 1,
        synced: false,
        clientUpdatedAt: new Date(),
      };
      await db.tools.put(updatedRepay);
      await queueSync('tools', repayment.localId, 'delete', { localId: repayment.localId });

      // Revert account adjustment if any
      const repAcc = repayment.account || repayment.raw?.data?.account;
      if (repAcc) {
        if (repayment.type === 'owe') {
          await adjustAccountBalance(repAcc, -Number(repayment.amount));
        } else {
          await adjustAccountBalance(repAcc, Number(repayment.amount));
        }
      }

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
        }
      }

      refreshPendingCount();
      setTools((prev) => prev.filter((t) => t.localId !== repayment.localId));
      toast.info('Repayment record deleted.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete repayment');
    }
  };

  return (
    <div className="pitch-dashboard">
      {/* 1. Hero Ring: Net Position */}
      <div className="balance-screen">
        <div className="balance-ring debt-neon-ring">
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

        {/* Hero Modal Action Buttons */}
        <div className="balance-actions">
          <button type="button" onClick={() => handleOpenAddDebt('owe')} className="balance-action">
            + New Debt / Loan <span>›</span>
          </button>
          <button type="button" onClick={() => handleOpenRepay()} className="balance-action">
            ৳ Record Repayment <span>›</span>
          </button>
        </div>

        <div className="balance-note">
          Debts & loans tracked separately · Does not alter daily available cash
        </div>
      </div>

      {/* 2. 4-Metrics Grid */}
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

      {/* 3. 2-Column Ledger: Money to Receive vs Money to Pay */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 my-6">
        {/* Left: People Who Owe Me */}
        <div className="panel p-5">
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
            <div>
              <h3 className="font-bold text-slate-100 text-base flex items-center gap-2">
                <span className="text-emerald-400">●</span> They Owe Me (To Receive)
              </h3>
              <p className="text-xs text-slate-400 mt-1">Money you lent to friends or family.</p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenAddDebt('owe')}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
            >
              + Add
            </button>
          </div>

          <div className="space-y-3">
            {receiveDebts.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">No money to receive.</p>
            ) : (
              receiveDebts.map((d) => (
                <div
                  key={d.localId}
                  className="entry-row flex justify-between items-center py-3 px-3 border border-slate-800/80 rounded-xl bg-slate-900/40"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="font-semibold text-slate-100 text-sm truncate">{d.person}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Total: {fmt(d.amount)} · Repaid: {fmt(d.repaid)} · {formatDateLabel(d.date)}
                      {d.note ? ` · ${d.note}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <strong className="text-emerald-400 font-semibold text-base">
                      {fmt(d.remaining)}
                    </strong>
                    <button
                      type="button"
                      onClick={() => handleOpenRepay(d.localId)}
                      className="text-xs font-semibold px-2.5 py-1 border border-emerald-800/50 bg-emerald-950/30 hover:bg-emerald-900/40 rounded-lg text-emerald-300"
                      title="Record repayment for this debt"
                    >
                      Repay
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartEditDebt(d)}
                      className="text-xs font-semibold px-2 py-1 border border-slate-700 bg-slate-900 hover:bg-slate-800 rounded-lg text-slate-300"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: People I Owe */}
        <div className="panel p-5">
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
            <div>
              <h3 className="font-bold text-slate-100 text-base flex items-center gap-2">
                <span className="text-rose-400">●</span> I Owe Them (To Pay)
              </h3>
              <p className="text-xs text-slate-400 mt-1">Money you borrowed or owe.</p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenAddDebt('owed')}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
            >
              + Add
            </button>
          </div>

          <div className="space-y-3">
            {payDebts.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">No money owed to others.</p>
            ) : (
              payDebts.map((d) => (
                <div
                  key={d.localId}
                  className="entry-row flex justify-between items-center py-3 px-3 border border-slate-800/80 rounded-xl bg-slate-900/40"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="font-semibold text-slate-100 text-sm truncate">{d.person}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Total: {fmt(d.amount)} · Repaid: {fmt(d.repaid)} · {formatDateLabel(d.date)}
                      {d.note ? ` · ${d.note}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <strong className="text-rose-400 font-semibold text-base">
                      {fmt(d.remaining)}
                    </strong>
                    <button
                      type="button"
                      onClick={() => handleOpenRepay(d.localId)}
                      className="text-xs font-semibold px-2.5 py-1 border border-rose-800/50 bg-rose-950/30 hover:bg-rose-900/40 rounded-lg text-rose-300"
                      title="Record repayment for this debt"
                    >
                      Repay
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartEditDebt(d)}
                      className="text-xs font-semibold px-2 py-1 border border-slate-700 bg-slate-900 hover:bg-slate-800 rounded-lg text-slate-300"
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

      {/* 4. Repayment History Section */}
      <div className="panel p-5 mb-8">
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
          <div>
            <h4 className="font-bold text-slate-200 text-base">Repayment Settlements History</h4>
            <p className="text-xs text-slate-400 mt-1">Audit log of all repayments received and paid.</p>
          </div>
          <button
            type="button"
            onClick={() => handleOpenRepay()}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            + Record Repayment
          </button>
        </div>

        {repaymentsList.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">No repayments recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {repaymentsList.map((r) => {
              const isReceive = r.type === 'owe';
              return (
                <div
                  key={r.localId}
                  className="flex justify-between items-center py-2.5 px-3 rounded-lg border border-slate-800/70 bg-slate-900/40 text-sm"
                >
                  <div>
                    <span className="font-semibold text-slate-200">{r.person}</span>
                    <span className="text-xs text-slate-400 ml-2">
                      {formatDateLabel(r.date)} {r.note ? `· ${r.note}` : ''}
                    </span>
                    {r.account && (
                      <span className="text-xs ml-2 text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/40">
                        {r.account}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-semibold ${isReceive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isReceive ? '+' : '−'}
                      {fmt(r.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteRepayment(r)}
                      className="text-slate-500 hover:text-rose-400 text-xs px-1.5 py-0.5"
                      title="Delete repayment"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal 1: Add / Edit Debt or Loan */}
      {showDebtModal && (
        <div className="modal-overlay" onClick={() => setShowDebtModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', borderBottom: '1px solid #1e293b', paddingBottom: '12px' }}>
              <h2 className="modal-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>৳</span> {editingDebt ? `Edit Record for "${editingDebt.person}"` : 'New Debt or Loan'}
              </h2>
              <button
                type="button"
                onClick={() => setShowDebtModal(false)}
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

            <form onSubmit={handleSaveDebt} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-300">
                  Type of Record
                </label>
                <select
                  value={debtForm.type}
                  onChange={(e) => setDebtForm({ ...debtForm, type: e.target.value })}
                  className="field w-full"
                >
                  <option value="owe">They owe me (Money to receive / I lent)</option>
                  <option value="owed">I owe them (Money to pay / I borrowed)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-300">
                  Person or Contact Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Rahim, Uncle, Friend"
                  value={debtForm.person}
                  onChange={(e) => setDebtForm({ ...debtForm, person: e.target.value })}
                  className="field w-full"
                  required
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1 text-slate-300">
                    Amount (৳)
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    placeholder="5000"
                    value={debtForm.amount}
                    onChange={(e) => setDebtForm({ ...debtForm, amount: e.target.value })}
                    className="field w-full"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1 text-slate-300">
                    Date
                  </label>
                  <input
                    type="date"
                    value={debtForm.date}
                    onChange={(e) => setDebtForm({ ...debtForm, date: e.target.value })}
                    className="field w-full"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-300">
                  Note / Reason (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Emergency medical, rent split"
                  value={debtForm.note}
                  onChange={(e) => setDebtForm({ ...debtForm, note: e.target.value })}
                  className="field w-full"
                />
              </div>

              <div className="flex justify-between items-center pt-3">
                {editingDebt ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteDebt(editingDebt.localId)}
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

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowDebtModal(false)}
                    className="secondary px-4 py-2 text-sm rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="deposit-submit-btn px-6"
                    style={{ height: '42px', minWidth: '130px' }}
                  >
                    {editingDebt ? 'Save Changes' : '+ Save Record'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Record Repayment */}
      {showRepayModal && (
        <div className="modal-overlay" onClick={() => setShowRepayModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', borderBottom: '1px solid #1e293b', paddingBottom: '12px' }}>
              <h2 className="modal-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>💳</span> Record a Repayment
              </h2>
              <button
                type="button"
                onClick={() => setShowRepayModal(false)}
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

            <form onSubmit={handleSaveRepayment} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-300">
                  Select Debt / Loan Record
                </label>
                <select
                  value={repayForm.debtId}
                  onChange={(e) => setRepayForm({ ...repayForm, debtId: e.target.value })}
                  className="field w-full"
                  required
                >
                  <option value="">-- Choose debt / loan --</option>
                  {debtsList.map((d) => (
                    <option key={d.localId} value={d.localId}>
                      {d.person} — {d.type === 'owe' ? 'They owe me' : 'I owe them'} ({fmt(d.remaining)} remaining)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1 text-slate-300">
                    Repayment Amount (৳)
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    placeholder="1000"
                    value={repayForm.amount}
                    onChange={(e) => setRepayForm({ ...repayForm, amount: e.target.value })}
                    className="field w-full"
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1 text-slate-300">
                    Repayment Date
                  </label>
                  <input
                    type="date"
                    value={repayForm.date}
                    onChange={(e) => setRepayForm({ ...repayForm, date: e.target.value })}
                    className="field w-full"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-300">
                  Deposit Into / Pay From Account
                </label>
                <input
                  type="text"
                  list="repayModalAccountSuggestions"
                  value={repayForm.account}
                  onChange={(e) => setRepayForm({ ...repayForm, account: e.target.value })}
                  placeholder="e.g. Cash in Hand, bKash, City Bank"
                  className="field w-full"
                />
                <datalist id="repayModalAccountSuggestions">
                  {availableAccounts.map((a) => (
                    <option key={a.localId || a.name} value={a.name} />
                  ))}
                  <option value="Cash in Hand" />
                  <option value="bKash" />
                  <option value="Nagad" />
                </datalist>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-300">
                  Note (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Partial repayment via bKash"
                  value={repayForm.note}
                  onChange={(e) => setRepayForm({ ...repayForm, note: e.target.value })}
                  className="field w-full"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowRepayModal(false)}
                  className="secondary px-4 py-2 text-sm rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="deposit-submit-btn px-6"
                  style={{
                    height: '42px',
                    minWidth: '150px',
                    background: 'linear-gradient(135deg, #22d3ee 0%, #06b6d4 100%)',
                  }}
                >
                  Record Repayment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
