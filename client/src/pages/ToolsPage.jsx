import React, { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Banknote, Pencil, Trash2, CreditCard } from 'lucide-react';
import { ICON_STROKE } from '../components/AppIcons';
import db from '../db/localDb';
import { useAuth } from '../context/AuthContext';
import { queueSync, syncTwoWay } from '../services/syncService';
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

      const accs = await getAllAccounts();
      setAvailableAccounts(accs);

      if (isOnline) {
        // Safe 2-way sync that respects local unpushed changes
        syncTwoWay()
          .then(async () => {
            const fresh = await db.tools.where('isDeleted').equals(0).toArray();
            setTools(fresh);
            const freshAccs = await getAllAccounts();
            setAvailableAccounts(freshAccs);
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error('Failed loading tools:', err);
    } finally {
      setLoading(false);
    }
  };

  // Re-calculate active debts with real-time dynamic repayment calculation
  const debtsList = useMemo(() => {
    const activeDebts = tools.filter((t) => t.toolType === 'debt');
    const activeRepayments = tools.filter((t) => t.toolType === 'repayment');

    return activeDebts
      .map((t) => {
        const origAmount = Number(t.data?.amount) || 0;
        const matchingRepayments = activeRepayments.filter(
          (r) => r.data?.debtId === t.localId
        );
        const computedRepaid = matchingRepayments.length > 0
          ? matchingRepayments.reduce((sum, r) => sum + (Number(r.data?.amount) || 0), 0)
          : Number(t.data?.repaid) || 0;

        const computedRemaining = Math.max(0, origAmount - computedRepaid);

        return {
          localId: t.localId,
          person: t.data?.person || 'Unknown',
          type: t.data?.type || 'owe',
          amount: origAmount,
          repaid: computedRepaid,
          remaining: computedRemaining,
          date: t.data?.date || '',
          note: t.data?.note || '',
          raw: t,
        };
      })
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

  // Categorized liquid accounts for repayment linkage
  const liquidAccounts = useMemo(() => {
    const registered = (availableAccounts || []).filter(
      (a) => a.type !== 'fdr' && a.type !== 'asset'
    );
    const map = new Map();
    registered.forEach((a) => map.set(a.name.toLowerCase(), a));

    const defaults = [
      { name: 'Cash in Hand', type: 'cash', balance: 0 },
      { name: 'bKash', type: 'mfs', balance: 0 },
      { name: 'Nagad', type: 'mfs', balance: 0 },
    ];
    defaults.forEach((d) => {
      if (!map.has(d.name.toLowerCase())) {
        map.set(d.name.toLowerCase(), d);
      }
    });

    if (repayForm.account && !map.has(repayForm.account.toLowerCase())) {
      map.set(repayForm.account.toLowerCase(), { name: repayForm.account, type: 'other', balance: 0 });
    }

    const all = Array.from(map.values());
    return {
      cash: all.filter((a) => a.type === 'cash'),
      mfs: all.filter((a) => a.type === 'mfs'),
      bank: all.filter((a) => a.type === 'bank'),
      other: all.filter((a) => a.type !== 'cash' && a.type !== 'mfs' && a.type !== 'bank'),
    };
  }, [availableAccounts, repayForm.account]);

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

  // Save Debt Record (Add or Update)
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
      const now = new Date();
      if (editingDebt) {
        // Calculate total repaid from actual active repayments for this debt
        const actualRepaid = repaymentsList
          .filter((r) => r.debtId === editingDebt.localId)
          .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

        const newRemaining = Math.max(0, num - actualRepaid);

        const updatedRecord = {
          ...editingDebt.raw,
          data: {
            ...editingDebt.raw.data,
            person: debtForm.person.trim(),
            type: debtForm.type,
            amount: num,
            repaid: actualRepaid,
            remaining: newRemaining,
            date: debtForm.date,
            note: debtForm.note.trim(),
          },
          synced: false,
          clientUpdatedAt: now,
        };

        await db.tools.put(updatedRecord);
        await queueSync('tools', updatedRecord.localId);

        // Also update person name and type on related repayments if changed
        const relatedRepayments = tools.filter(
          (t) => t.toolType === 'repayment' && t.data?.debtId === updatedRecord.localId
        );
        for (const rep of relatedRepayments) {
          const updatedRep = {
            ...rep,
            data: {
              ...rep.data,
              person: debtForm.person.trim(),
              type: debtForm.type,
            },
            synced: false,
            clientUpdatedAt: now,
          };
          await db.tools.put(updatedRep);
          await queueSync('tools', rep.localId);
        }

        refreshPendingCount();

        setTools((prev) =>
          prev.map((t) => {
            if (t.localId === updatedRecord.localId) return updatedRecord;
            if (t.toolType === 'repayment' && t.data?.debtId === updatedRecord.localId) {
              return {
                ...t,
                data: {
                  ...t.data,
                  person: debtForm.person.trim(),
                  type: debtForm.type,
                },
              };
            }
            return t;
          })
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
          clientUpdatedAt: now,
        };

        await db.tools.put(newRecord);
        await queueSync('tools', localId);
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

  // Delete Debt Record and clean up all associated repayments
  const handleDeleteDebt = async (debtId) => {
    const record = tools.find((t) => t.localId === debtId);
    if (!record) return;
    const personName = record?.data?.person || 'this record';
    const amountVal = record?.data?.amount
      ? ` (৳${Number(record.data.amount).toLocaleString('en-US')})`
      : '';

    const ok = await confirm({
      title: 'Delete Debt Record',
      message: `Are you sure you want to delete the debt record for "${personName}"${amountVal}? All associated repayment settlements will also be removed.`,
      confirmText: 'Delete Record',
      danger: true,
    });
    if (!ok) return;

    try {
      const now = new Date();
      const updatedDebt = {
        ...record,
        isDeleted: 1,
        synced: false,
        clientUpdatedAt: now,
      };
      await db.tools.put(updatedDebt);
      await queueSync('tools', record.localId);

      // Also clean up any associated repayment entries
      const relatedRepayments = tools.filter(
        (t) => t.toolType === 'repayment' && t.data?.debtId === debtId
      );
      for (const rep of relatedRepayments) {
        const updatedRep = {
          ...rep,
          isDeleted: 1,
          synced: false,
          clientUpdatedAt: now,
        };
        await db.tools.put(updatedRep);
        await queueSync('tools', rep.localId);
      }

      refreshPendingCount();

      setTools((prev) =>
        prev.filter((t) => t.localId !== debtId && t.data?.debtId !== debtId)
      );
      setShowDebtModal(false);
      setEditingDebt(null);
      toast.info(`Record for "${personName}" deleted.`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete record');
    }
  };

  // Open Repayment Modal
  const handleOpenRepay = (targetDebtId = '') => {
    const defaultAcc =
      availableAccounts.find((a) => a.type !== 'fdr' && a.type !== 'asset')?.name || 'Cash in Hand';
    setRepayForm({
      debtId: targetDebtId || debtsList[0]?.localId || '',
      amount: '',
      account: defaultAcc,
      date: todayStr,
      note: '',
    });
    setShowRepayModal(true);
  };

  // Save Repayment Record
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
      const now = new Date();
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
        clientUpdatedAt: now,
      };
      await db.tools.put(repayRecord);
      await queueSync('tools', repayLocalId);

      // Reconcile with account balance if an account is selected
      if (chosenAcc) {
        if (targetDebt.type === 'owe') {
          // They owe me, so I received money into my account
          await adjustAccountBalance(chosenAcc, num);
        } else {
          // I owe them, so I paid money from my account
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
        clientUpdatedAt: now,
      };
      await db.tools.put(updatedDebt);
      await queueSync('tools', targetDebt.localId);
      refreshPendingCount();

      setTools((prev) => [
        repayRecord,
        ...prev.map((t) => (t.localId === targetDebt.localId ? updatedDebt : t)),
      ]);

      const freshAccs = await getAllAccounts();
      setAvailableAccounts(freshAccs);

      toast.success(
        `Repayment of ৳${num.toLocaleString('en-US')} recorded for ${targetDebt.person}`
      );
      setShowRepayModal(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to record repayment');
    }
  };

  // Delete Repayment and dynamically re-calculate debt and account balances
  const handleDeleteRepayment = async (repayment) => {
    const ok = await confirm({
      title: 'Delete Repayment Record',
      message: `Are you sure you want to delete this repayment of ${fmt(repayment.amount)} from "${repayment.person}"? The associated debt balance and account balance will be automatically recalculated.`,
      confirmText: 'Delete Repayment',
      danger: true,
    });
    if (!ok) return;

    try {
      const now = new Date();
      const updatedRepay = {
        ...repayment.raw,
        isDeleted: 1,
        synced: false,
        clientUpdatedAt: now,
      };
      await db.tools.put(updatedRepay);
      await queueSync('tools', repayment.localId);

      // Revert account adjustment if any
      const repAcc = repayment.account || repayment.raw?.data?.account;
      if (repAcc) {
        if (repayment.type === 'owe') {
          // Revert previous receipt (-num)
          await adjustAccountBalance(repAcc, -Number(repayment.amount));
        } else {
          // Revert previous payment (+num)
          await adjustAccountBalance(repAcc, Number(repayment.amount));
        }
      }

      let updatedDebt = null;
      if (repayment.debtId) {
        const targetDebt = tools.find((t) => t.localId === repayment.debtId);
        if (targetDebt) {
          const remainingRepayments = repaymentsList.filter(
            (r) => r.localId !== repayment.localId && r.debtId === repayment.debtId
          );
          const newRepaid = remainingRepayments.reduce(
            (sum, r) => sum + (Number(r.amount) || 0),
            0
          );
          const origAmount = Number(targetDebt.data?.amount) || 0;
          const newRemaining = Math.max(0, origAmount - newRepaid);

          updatedDebt = {
            ...targetDebt,
            data: {
              ...targetDebt.data,
              repaid: newRepaid,
              remaining: newRemaining,
            },
            synced: false,
            clientUpdatedAt: now,
          };
          await db.tools.put(updatedDebt);
          await queueSync('tools', targetDebt.localId);
        }
      }

      refreshPendingCount();

      // Update both repayment removal and updated debt balance in React state
      setTools((prev) =>
        prev
          .filter((t) => t.localId !== repayment.localId)
          .map((t) => (updatedDebt && t.localId === updatedDebt.localId ? updatedDebt : t))
      );

      const freshAccs = await getAllAccounts();
      setAvailableAccounts(freshAccs);

      toast.info('Repayment deleted and balances recalculated.');
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
          Debts & loans tracked separately · Repayments settle balances and link to accounts
        </div>
      </div>

      {/* 2. 4-Metrics Grid */}
      <div className="metrics-grid">
        <div className="panel p-4">
          <div className="tiny-label" style={{ color: '#34d399', fontWeight: 700 }}>
            Money to receive
          </div>
          <div className="metric-value" style={{ color: '#34d399' }}>
            {fmt(moneyToReceive)}
          </div>
          <div className="metric-sub">{receiveDebts.length} people owe you</div>
        </div>

        <div className="panel p-4">
          <div className="tiny-label" style={{ color: '#fb7185', fontWeight: 700 }}>
            Money to pay
          </div>
          <div className="metric-value" style={{ color: '#fb7185' }}>
            {fmt(moneyToPay)}
          </div>
          <div className="metric-sub">{payDebts.length} payments due</div>
        </div>

        <div className="panel p-4">
          <div className="tiny-label" style={{ color: '#38bdf8', fontWeight: 700 }}>
            Active Records
          </div>
          <div className="metric-value" style={{ color: '#38bdf8' }}>
            {debtsList.length}
          </div>
          <div className="metric-sub">Lending & borrowing entries</div>
        </div>

        <div className="panel p-4">
          <div className="tiny-label" style={{ color: '#c084fc', fontWeight: 700 }}>
            Repayments logged
          </div>
          <div className="metric-value" style={{ color: '#c084fc' }}>
            {repaymentsList.length}
          </div>
          <div className="metric-sub">Settlements completed</div>
        </div>
      </div>

      {/* 3. 2-Column Responsive Layout: They Owe Me vs I Owe Them */}
      <div className="debt-columns-grid">
        {/* Left Column: People Who Owe Me (To Receive) */}
        <div className="debt-section-panel">
          <div className="debt-section-header">
            <div className="debt-section-title-wrap">
              <h3>
                <span style={{ color: '#34d399', fontSize: '1.2rem' }}>●</span> They Owe Me (To Receive)
              </h3>
              <p>Money you lent to friends, relatives, or associates.</p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenAddDebt('owe')}
              className="debt-add-btn-emerald"
            >
              <span>+</span> Add Lending
            </button>
          </div>

          <div style={{ flex: 1 }}>
            {receiveDebts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 16px', color: '#64748b' }}>
                <span style={{ fontSize: '2rem', display: 'block', marginBottom: '8px' }}>🤝</span>
                <p style={{ fontSize: '0.92rem', fontWeight: 600 }}>No money to receive.</p>
                <p style={{ fontSize: '0.78rem', marginTop: '4px' }}>All lent amounts have been settled.</p>
              </div>
            ) : (
              receiveDebts.map((d) => {
                const percent = d.amount > 0 ? Math.min(100, Math.round((d.repaid / d.amount) * 100)) : 0;
                const isSettled = d.remaining === 0;

                return (
                  <div key={d.localId} className="debt-record-card is-receive">
                    <div className="debt-card-header">
                      <div className="debt-user-meta">
                        <div className="debt-avatar-circle is-receive">
                          {d.person.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="debt-person-name">{d.person}</div>
                          <div className="debt-date-badge">
                            📅 {formatDateLabel(d.date)}
                            {d.note && <span> · 📝 {d.note}</span>}
                          </div>
                        </div>
                      </div>

                      <span
                        className="debt-status-pill"
                        style={{
                          background: isSettled
                            ? 'rgba(16, 185, 129, 0.15)'
                            : d.repaid > 0
                            ? 'rgba(56, 189, 248, 0.15)'
                            : 'rgba(148, 163, 184, 0.12)',
                          color: isSettled ? '#34d399' : d.repaid > 0 ? '#38bdf8' : '#cbd5e1',
                          border: `1px solid ${
                            isSettled
                              ? 'rgba(16, 185, 129, 0.35)'
                              : d.repaid > 0
                              ? 'rgba(56, 189, 248, 0.3)'
                              : 'rgba(148, 163, 184, 0.2)'
                          }`,
                        }}
                      >
                        {isSettled ? '✓ Settled' : d.repaid > 0 ? `Partial (${percent}%)` : 'Active'}
                      </span>
                    </div>

                    {/* Progress Track */}
                    <div className="debt-progress-bar-wrap">
                      <div className="debt-progress-track">
                        <div
                          className="debt-progress-fill is-receive"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Financial Summary */}
                    <div className="debt-financial-summary">
                      <div className="debt-meta-details">
                        <span className="debt-meta-sub">
                          Total Lent: <strong style={{ color: '#e2e8f0' }}>{fmt(d.amount)}</strong>
                        </span>
                        <span className="debt-meta-sub">
                          Repaid So Far: <strong style={{ color: '#34d399' }}>{fmt(d.repaid)}</strong>
                        </span>
                      </div>

                      <div className="debt-remaining-block">
                        <div className="debt-remaining-label">Remaining to Receive</div>
                        <div className="debt-remaining-amount" style={{ color: '#34d399' }}>
                          {fmt(d.remaining)}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="debt-card-actions">
                      {!isSettled && (
                        <button
                          type="button"
                          onClick={() => handleOpenRepay(d.localId)}
                          className="debt-action-btn btn-repay"
                          title="Record a repayment for this debt"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Banknote size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
                          <span>Repay</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleStartEditDebt(d)}
                        className="debt-action-btn btn-edit"
                        title="Edit debt amount, person, date or note"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Pencil size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDebt(d.localId)}
                        className="debt-action-btn btn-delete"
                        title="Delete this debt record"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Trash2 size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: People I Owe (To Pay) */}
        <div className="debt-section-panel">
          <div className="debt-section-header">
            <div className="debt-section-title-wrap">
              <h3>
                <span style={{ color: '#fb7185', fontSize: '1.2rem' }}>●</span> I Owe Them (To Pay)
              </h3>
              <p>Money you borrowed or have an obligation to repay.</p>
            </div>
            <button
              type="button"
              onClick={() => handleOpenAddDebt('owed')}
              className="debt-add-btn-rose"
            >
              <span>+</span> Add Borrowing
            </button>
          </div>

          <div style={{ flex: 1 }}>
            {payDebts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 16px', color: '#64748b' }}>
                <span style={{ fontSize: '2rem', display: 'block', marginBottom: '8px' }}>🎉</span>
                <p style={{ fontSize: '0.92rem', fontWeight: 600 }}>No money owed to others.</p>
                <p style={{ fontSize: '0.78rem', marginTop: '4px' }}>You have zero pending borrowed debts.</p>
              </div>
            ) : (
              payDebts.map((d) => {
                const percent = d.amount > 0 ? Math.min(100, Math.round((d.repaid / d.amount) * 100)) : 0;
                const isSettled = d.remaining === 0;

                return (
                  <div key={d.localId} className="debt-record-card is-pay">
                    <div className="debt-card-header">
                      <div className="debt-user-meta">
                        <div className="debt-avatar-circle is-pay">
                          {d.person.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="debt-person-name">{d.person}</div>
                          <div className="debt-date-badge">
                            📅 {formatDateLabel(d.date)}
                            {d.note && <span> · 📝 {d.note}</span>}
                          </div>
                        </div>
                      </div>

                      <span
                        className="debt-status-pill"
                        style={{
                          background: isSettled
                            ? 'rgba(16, 185, 129, 0.15)'
                            : d.repaid > 0
                            ? 'rgba(251, 113, 133, 0.15)'
                            : 'rgba(148, 163, 184, 0.12)',
                          color: isSettled ? '#34d399' : d.repaid > 0 ? '#fb7185' : '#cbd5e1',
                          border: `1px solid ${
                            isSettled
                              ? 'rgba(16, 185, 129, 0.35)'
                              : d.repaid > 0
                              ? 'rgba(251, 113, 133, 0.3)'
                              : 'rgba(148, 163, 184, 0.2)'
                          }`,
                        }}
                      >
                        {isSettled ? '✓ Settled' : d.repaid > 0 ? `Partial (${percent}%)` : 'Active'}
                      </span>
                    </div>

                    {/* Progress Track */}
                    <div className="debt-progress-bar-wrap">
                      <div className="debt-progress-track">
                        <div
                          className="debt-progress-fill is-pay"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Financial Summary */}
                    <div className="debt-financial-summary">
                      <div className="debt-meta-details">
                        <span className="debt-meta-sub">
                          Total Borrowed: <strong style={{ color: '#e2e8f0' }}>{fmt(d.amount)}</strong>
                        </span>
                        <span className="debt-meta-sub">
                          Repaid So Far: <strong style={{ color: '#fb7185' }}>{fmt(d.repaid)}</strong>
                        </span>
                      </div>

                      <div className="debt-remaining-block">
                        <div className="debt-remaining-label">Remaining to Pay</div>
                        <div className="debt-remaining-amount" style={{ color: '#fb7185' }}>
                          {fmt(d.remaining)}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="debt-card-actions">
                      {!isSettled && (
                        <button
                          type="button"
                          onClick={() => handleOpenRepay(d.localId)}
                          className="debt-action-btn btn-repay"
                          title="Record a repayment for this debt"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Banknote size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
                          <span>Repay</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleStartEditDebt(d)}
                        className="debt-action-btn btn-edit"
                        title="Edit debt amount, person, date or note"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Pencil size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDebt(d.localId)}
                        className="debt-action-btn btn-delete"
                        title="Delete this debt record"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Trash2 size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 4. Repayment Settlements History Section */}
      <div className="repayment-history-panel">
        <div className="debt-section-header">
          <div className="debt-section-title-wrap">
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CreditCard size={18} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
              <span>Repayment Settlements History</span>
            </h3>
            <p>Audit trail of all partial and full repayments received or paid.</p>
          </div>
          <button
            type="button"
            onClick={() => handleOpenRepay()}
            className="debt-action-btn btn-repay"
            style={{ padding: '8px 16px', fontSize: '0.82rem' }}
          >
            <span>+</span> Record Repayment
          </button>
        </div>

        {repaymentsList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b' }}>
            <span style={{ fontSize: '1.8rem', display: 'block', marginBottom: '6px' }}>📝</span>
            <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>No repayments recorded yet.</p>
            <p style={{ fontSize: '0.78rem', marginTop: '2px' }}>
              Whenever you receive or make a repayment, click "+ Record Repayment" above.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {repaymentsList.map((r) => {
              const isReceive = r.type === 'owe';
              return (
                <div key={r.localId} className="repayment-stream-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <div
                      style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1rem',
                        flexShrink: 0,
                        background: isReceive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                        border: `1px solid ${isReceive ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
                      }}
                    >
                      {isReceive ? '📥' : '📤'}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 750, color: '#f8fafc', fontSize: '0.92rem' }}>
                          {r.person}
                        </span>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '5px',
                            background: isReceive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)',
                            color: isReceive ? '#34d399' : '#fb7185',
                            border: `1px solid ${isReceive ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)'}`,
                          }}
                        >
                          {isReceive ? 'Received' : 'Paid'}
                        </span>
                        {r.account && (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              color: '#38bdf8',
                              background: 'rgba(56, 189, 248, 0.1)',
                              border: '1px solid rgba(56, 189, 248, 0.25)',
                              padding: '2px 7px',
                              borderRadius: '5px',
                            }}
                          >
                            💳 {r.account}
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '3px' }}>
                        📅 {formatDateLabel(r.date)}
                        {r.note && <span> · 📝 {r.note}</span>}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: '1.05rem',
                        fontWeight: 800,
                        color: isReceive ? '#34d399' : '#fb7185',
                      }}
                    >
                      {isReceive ? '+' : '−'}
                      {fmt(r.amount)}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleDeleteRepayment(r)}
                      className="debt-action-btn btn-delete"
                      style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                      title="Delete this repayment settlement"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal 1: Add or Edit Debt Record */}
      {showDebtModal && (
        <div className="modal-overlay" onClick={() => setShowDebtModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editingDebt ? `✏️ Edit "${editingDebt.person}"` : '৳ New Debt / Loan Record'}
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowDebtModal(false)}
                title="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveDebt} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="debt-type">
                  Classification / Direction
                </label>
                <select
                  id="debt-type"
                  value={debtForm.type}
                  onChange={(e) => setDebtForm({ ...debtForm, type: e.target.value })}
                  className="field"
                >
                  <option value="owe">🟢 They owe me (Money to receive / I lent)</option>
                  <option value="owed">🔴 I owe them (Money to pay / I borrowed)</option>
                </select>
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="debt-person">
                  Person or Organization Name
                </label>
                <input
                  id="debt-person"
                  type="text"
                  placeholder="e.g. Rahim, Ammu, Friend, Uncle"
                  value={debtForm.person}
                  onChange={(e) => setDebtForm({ ...debtForm, person: e.target.value })}
                  className="field"
                  required
                  autoFocus
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-item">
                  <label className="form-label" htmlFor="debt-amount">
                    Original Amount (৳)
                  </label>
                  <input
                    id="debt-amount"
                    type="number"
                    min="0.01"
                    step="any"
                    placeholder="5000"
                    value={debtForm.amount}
                    onChange={(e) => setDebtForm({ ...debtForm, amount: e.target.value })}
                    className="field"
                    required
                  />
                </div>

                <div className="form-item">
                  <label className="form-label" htmlFor="debt-date">
                    Record Date
                  </label>
                  <input
                    id="debt-date"
                    type="date"
                    value={debtForm.date}
                    onChange={(e) => setDebtForm({ ...debtForm, date: e.target.value })}
                    className="field"
                    required
                  />
                </div>
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="debt-note">
                  Reason or Description (optional)
                </label>
                <input
                  id="debt-note"
                  type="text"
                  placeholder="e.g. Emergency split, personal loan"
                  value={debtForm.note}
                  onChange={(e) => setDebtForm({ ...debtForm, note: e.target.value })}
                  className="field"
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: editingDebt ? 'space-between' : 'flex-end',
                  alignItems: 'center',
                  marginTop: '18px',
                  gap: '10px',
                }}
              >
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
                      fontWeight: 650,
                      cursor: 'pointer',
                    }}
                  >
                    🗑️ Delete Record
                  </button>
                ) : null}

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setShowDebtModal(false)}
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
                    }}
                  >
                    {editingDebt ? 'Save Changes' : '+ Add Record'}
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
            <div className="modal-header">
              <h2 className="modal-title">💳 Record a Repayment</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowRepayModal(false)}
                title="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRepayment} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="repay-debt">
                  Select Debt / Loan Record
                </label>
                <select
                  id="repay-debt"
                  value={repayForm.debtId}
                  onChange={(e) => setRepayForm({ ...repayForm, debtId: e.target.value })}
                  className="field"
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-item">
                  <label className="form-label" htmlFor="repay-amount">
                    Repayment Amount (৳)
                  </label>
                  <input
                    id="repay-amount"
                    type="number"
                    min="0.01"
                    step="any"
                    placeholder="1000"
                    value={repayForm.amount}
                    onChange={(e) => setRepayForm({ ...repayForm, amount: e.target.value })}
                    className="field"
                    required
                    autoFocus
                  />
                </div>

                <div className="form-item">
                  <label className="form-label" htmlFor="repay-date">
                    Repayment Date
                  </label>
                  <input
                    id="repay-date"
                    type="date"
                    value={repayForm.date}
                    onChange={(e) => setRepayForm({ ...repayForm, date: e.target.value })}
                    className="field"
                    required
                  />
                </div>
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="repay-account">
                  Deposit Into / Pay From Account
                </label>
                <select
                  id="repay-account"
                  value={repayForm.account}
                  onChange={(e) => setRepayForm({ ...repayForm, account: e.target.value })}
                  className="field"
                  required
                >
                  <option value="">-- Select Account --</option>
                  {liquidAccounts.cash.length > 0 && (
                    <optgroup label="💵 Cash in Hand">
                      {liquidAccounts.cash.map((a) => (
                        <option key={a.localId || a.name} value={a.name}>
                          {a.name} ({fmt(a.balance)})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {liquidAccounts.mfs.length > 0 && (
                    <optgroup label="📱 Mobile Wallets (MFS)">
                      {liquidAccounts.mfs.map((a) => (
                        <option key={a.localId || a.name} value={a.name}>
                          {a.name} ({fmt(a.balance)})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {liquidAccounts.bank.length > 0 && (
                    <optgroup label="🏦 Bank Accounts">
                      {liquidAccounts.bank.map((a) => (
                        <option key={a.localId || a.name} value={a.name}>
                          {a.name} ({fmt(a.balance)})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {liquidAccounts.other.length > 0 && (
                    <optgroup label="💳 Other Accounts">
                      {liquidAccounts.other.map((a) => (
                        <option key={a.localId || a.name} value={a.name}>
                          {a.name} ({fmt(a.balance)})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="repay-note">
                  Note (optional)
                </label>
                <input
                  id="repay-note"
                  type="text"
                  placeholder="e.g. Partial repayment via bKash"
                  value={repayForm.note}
                  onChange={(e) => setRepayForm({ ...repayForm, note: e.target.value })}
                  className="field"
                />
              </div>

              <div className="modal-actions" style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  onClick={() => setShowRepayModal(false)}
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
                    background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
                    borderColor: '#10b981',
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
