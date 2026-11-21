import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import api from '../services/api';

export default function AdminPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resettingUser, setResettingUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    // 1. Initial fetch
    fetchUsers(true);

    // 2. Auto-polling interval: fetch fresh data silently every 8 seconds
    const interval = setInterval(() => {
      fetchUsers(false);
    }, 8000);

    // 3. Window focus trigger: instantly fetch fresh data when switching back to tab
    const handleFocus = () => {
      fetchUsers(false);
    };
    window.addEventListener('focus', handleFocus);

    // 4. Custom sync listener: if any local sync event occurs, update immediately
    const handleDataUpdated = () => {
      fetchUsers(false);
    };
    window.addEventListener('daily_ledger:data_updated', handleDataUpdated);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('daily_ledger:data_updated', handleDataUpdated);
    };
  }, []);

  const fetchUsers = async (isFirstLoad = false) => {
    if (isFirstLoad) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    try {
      const { data } = await api.get('/users');
      setUsers(data.users || []);
      setLastUpdated(new Date());
    } catch (err) {
      if (isFirstLoad) toast.error('Failed to fetch admin users data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleDeactivate = async (u) => {
    if (!window.confirm(`Are you sure you want to toggle status for ${u.email}?`)) return;
    try {
      await api.patch(`/users/${u._id}/deactivate`);
      toast.success(`User ${u.email} status updated`);
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action failed');
    }
  };

  const handleOpenResetModal = (u) => {
    setResettingUser(u);
    setNewPassword('');
  };

  const handleSavePassword = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      toast.warning('Password must be at least 6 characters');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post(`/users/${resettingUser._id}/reset-password`, { newPassword });
      toast.success(`Password reset successfully for ${resettingUser.email}!`);
      setResettingUser(null);
      setNewPassword('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reset password');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;

  // Grand Totals across all registered users
  const grandTotals = users.reduce(
    (acc, u) => {
      acc.cash += u.summary?.cashInHand || 0;
      acc.bank += u.summary?.totalBankMfs || 0;
      acc.lent += u.summary?.moneyLentToReceive || 0;
      acc.borrowed += u.summary?.moneyBorrowedToPay || 0;
      acc.netWorth += u.summary?.netWorth || 0;
      return acc;
    },
    { cash: 0, bank: 0, lent: 0, borrowed: 0, netWorth: 0 }
  );

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      
      {/* 1. Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
              Admin Control Center
            </h1>
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '2px 8px',
                borderRadius: '999px',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              Strictly Restricted
            </span>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '6px' }}>
            Overview of all registered users, security controls, and live multi-ledger financial positions.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#64748b' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 10px #10b981',
                display: 'inline-block',
                animation: isRefreshing ? 'pulse 1s infinite' : 'none',
              }}
            />
            <span>Live Sync Active</span>
          </div>

          <button
            onClick={() => fetchUsers(false)}
            className="secondary"
            style={{ height: '38px', padding: '0 16px', borderRadius: '10px', fontSize: '0.82rem', fontWeight: 600 }}
          >
            {isRefreshing ? 'Syncing...' : '↻ Refresh Now'}
          </button>
        </div>
      </div>

      {/* 2. Platform Overview Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '14px',
        }}
      >
        <div className="panel" style={{ padding: '16px 20px', background: '#050608', border: '1px solid #1a202c', borderRadius: '14px' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em' }}>Total Users</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>{users.length}</div>
          <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '4px' }}>{users.filter((u) => u.isActive).length} active</div>
        </div>

        <div className="panel" style={{ padding: '16px 20px', background: '#050608', border: '1px solid #1a202c', borderRadius: '14px' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em' }}>Total Cash in Hand</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981', marginTop: '6px' }}>{fmt(grandTotals.cash)}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>Across all ledgers</div>
        </div>

        <div className="panel" style={{ padding: '16px 20px', background: '#050608', border: '1px solid #1a202c', borderRadius: '14px' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em' }}>Total in Banks & MFS</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#38bdf8', marginTop: '6px' }}>{fmt(grandTotals.bank)}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>bKash, Nagad, Banks</div>
        </div>

        <div className="panel" style={{ padding: '16px 20px', background: '#050608', border: '1px solid #1a202c', borderRadius: '14px' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em' }}>Total Money Lent</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#a78bfa', marginTop: '6px' }}>{fmt(grandTotals.lent)}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>Receivable from others</div>
        </div>

        <div className="panel" style={{ padding: '16px 20px', background: '#050608', border: '1px solid #1a202c', borderRadius: '14px' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em' }}>Total Money Borrowed</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fb7185', marginTop: '6px' }}>{fmt(grandTotals.borrowed)}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>Payable to lenders</div>
        </div>
      </div>

      {/* 3. Detailed User List & Ledger Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
          User Accounts & Live Ledgers ({users.length})
        </h2>

        {loading ? (
          <div className="panel" style={{ padding: '40px', textAlign: 'center', background: '#050608', border: '1px solid #1a202c', borderRadius: '14px' }}>
            <div className="spinner-lg" style={{ margin: '0 auto 12px' }} />
            <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Aggregating user ledgers from cloud...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="panel" style={{ padding: '40px', textAlign: 'center', background: '#050608', border: '1px solid #1a202c', borderRadius: '14px' }}>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No users registered yet.</p>
          </div>
        ) : (
          users.map((u) => (
            <div
              key={u._id}
              className="panel"
              style={{
                background: '#050608',
                border: '1px solid #1a202c',
                borderRadius: '16px',
                padding: '20px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              {/* Row 1: User Identity & Actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      width: '46px',
                      height: '46px',
                      borderRadius: '50%',
                      background: u.role === 'admin' ? 'linear-gradient(135deg, #4f46e5, #06b6d4)' : '#1e293b',
                      color: '#f8fafc',
                      fontWeight: 700,
                      fontSize: '1.2rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {u.name?.[0]?.toUpperCase() || 'U'}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>{u.name}</span>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          background: u.role === 'admin' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                          color: u.role === 'admin' ? '#38bdf8' : '#94a3b8',
                          border: u.role === 'admin' ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid #334155',
                        }}
                      >
                        {u.role}
                      </span>
                      {!u.isActive && (
                        <span style={{ fontSize: '0.65rem', color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                          Deactivated
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '2px' }}>{u.email}</div>
                  </div>
                </div>

                {/* Admin Actions for this user */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleOpenResetModal(u)}
                    className="secondary"
                    style={{
                      height: '34px',
                      padding: '0 14px',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: '#38bdf8',
                      borderColor: 'rgba(56, 189, 248, 0.3)',
                    }}
                  >
                    🔑 Reset / View Password
                  </button>
                  {u._id !== user?._id && (
                    <button
                      onClick={() => handleDeactivate(u)}
                      style={{
                        height: '34px',
                        padding: '0 12px',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        color: u.isActive ? '#fb7185' : '#10b981',
                        background: 'transparent',
                        border: '1px solid #334155',
                        cursor: 'pointer',
                      }}
                    >
                      {u.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: Security & Password Info */}
              <div
                style={{
                  background: '#0a0d14',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  border: '1px solid #1a2233',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.78rem',
                  color: '#94a3b8',
                }}
              >
                <div>
                  <span style={{ color: '#cbd5e1', fontWeight: 600 }}>Security Status: </span>
                  <span>{u.passwordStatus}</span>
                </div>
                <div style={{ color: '#64748b' }}>
                  Joined: {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-GB') : '—'}
                </div>
              </div>

              {/* Row 3: 4-Metric Financial Breakdown for this user */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '10px',
                  marginTop: '2px',
                }}
              >
                <div style={{ background: '#0e121a', padding: '12px 14px', borderRadius: '10px', border: '1px solid #1e2638' }}>
                  <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>Cash in Hand</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#10b981', marginTop: '4px' }}>
                    {fmt(u.summary?.cashInHand)}
                  </div>
                </div>

                <div style={{ background: '#0e121a', padding: '12px 14px', borderRadius: '10px', border: '1px solid #1e2638' }}>
                  <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>In Bank & MFS</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#38bdf8', marginTop: '4px' }}>
                    {fmt(u.summary?.totalBankMfs)}
                  </div>
                </div>

                <div style={{ background: '#0e121a', padding: '12px 14px', borderRadius: '10px', border: '1px solid #1e2638' }}>
                  <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>Money Lent</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#a78bfa', marginTop: '4px' }}>
                    {fmt(u.summary?.moneyLentToReceive)}
                  </div>
                </div>

                <div style={{ background: '#0e121a', padding: '12px 14px', borderRadius: '10px', border: '1px solid #1e2638' }}>
                  <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>Money Borrowed</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fb7185', marginTop: '4px' }}>
                    {fmt(u.summary?.moneyBorrowedToPay)}
                  </div>
                </div>

                <div style={{ background: '#0e121a', padding: '12px 14px', borderRadius: '10px', border: '1px solid #1e2638' }}>
                  <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>Net Position</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: (u.summary?.netWorth || 0) >= 0 ? '#f8fafc' : '#fb7185', marginTop: '4px' }}>
                    {fmt(u.summary?.netWorth)}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 4. Password Reset Modal for Admin */}
      {resettingUser && (
        <div className="modal-overlay" onClick={() => setResettingUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', background: '#0b0f17', border: '1px solid #232a3b' }}>
            <h2 className="modal-title" style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc' }}>
              Reset User Password
            </h2>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '6px' }}>
              Enter a new password for <strong>{resettingUser.email}</strong>. This will overwrite their existing password.
            </p>

            <form onSubmit={handleSavePassword} className="modal-form" style={{ marginTop: '16px' }}>
              <div className="form-item">
                <label className="form-label" htmlFor="newPassword">New Password</label>
                <input
                  id="newPassword"
                  type="text"
                  placeholder="Enter new password (min 6 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="field"
                  style={{ height: '44px', background: '#05070c', borderColor: '#232a3b' }}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
                <button
                  type="button"
                  className="secondary flex-1"
                  onClick={() => setResettingUser(null)}
                  style={{ height: '42px', borderRadius: '10px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="primary flex-1"
                  style={{ height: '42px', borderRadius: '10px', fontWeight: 600 }}
                >
                  {isSubmitting ? 'Saving...' : 'Set New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
