import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import api from '../services/api';

export default function SettingsPage() {
  const { user, logout, isOnline } = useAuth();
  const toast = useToast();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const { data } = await api.get('/backup/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup downloaded successfully!');
    } catch (err) {
      toast.error('Export failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setExportLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      toast.warning('Please select a backup JSON file first');
      return;
    }
    if (!window.confirm('Import will MERGE data into your account. Continue?')) return;

    try {
      const text = await importFile.text();
      const json = JSON.parse(text);
      const { data } = await api.post('/backup/import', json);
      toast.success(
        `Import complete: ${data.imported.transactions} transactions, ${data.imported.accounts} accounts, ${data.imported.tools} tools.`
      );
    } catch (err) {
      toast.error('Import failed: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviteLoading(true);
    try {
      const { data } = await api.post('/invite', { email: inviteEmail.trim() });
      setInviteResult(data);
      setInviteEmail('');
      setCopied(false);
      toast.success(`Invite created for ${data.email}!`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create invite');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!inviteResult?.inviteLink) return;
    navigator.clipboard.writeText(inviteResult.inviteLink);
    setCopied(true);
    toast.info('Invite link copied to clipboard!');
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div style={{ maxWidth: '780px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      
      {/* 1. Header */}
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', margin: 0, letterSpacing: '-0.02em' }}>
          Settings & Account
        </h1>
        <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '6px' }}>
          Manage your profile, invite family members, and handle data backups.
        </p>
      </div>

      {/* 2. Profile Card */}
      <div className="panel" style={{ padding: '24px', borderRadius: '16px', background: '#050608', border: '1px solid #1a202c' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                width: '54px',
                height: '54px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 50%, #06b6d4 100%)',
                color: '#fff',
                fontSize: '1.4rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 20px rgba(59, 130, 246, 0.35)',
              }}
            >
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>{user?.name || 'User'}</span>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    background: user?.role === 'admin' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                    color: user?.role === 'admin' ? '#38bdf8' : '#94a3b8',
                    border: user?.role === 'admin' ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid #334155',
                  }}
                >
                  {user?.role || 'member'}
                </span>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '3px' }}>{user?.email}</div>
            </div>
          </div>

          <button
            onClick={logout}
            style={{
              height: '40px',
              padding: '0 18px',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: '#fb7185',
              background: 'rgba(225, 29, 72, 0.1)',
              border: '1px solid rgba(225, 29, 72, 0.25)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(225, 29, 72, 0.2)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(225, 29, 72, 0.1)')}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* 3. Invite Family Member (Admin Only) */}
      {user?.role === 'admin' && (
        <div className="panel" style={{ padding: '24px', borderRadius: '16px', background: '#050608', border: '1px solid #1a202c' }}>
          <div style={{ marginBottom: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                Invite Family Member
              </h2>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#10b981', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '999px', padding: '2px 8px' }}>
                Admin Privileged
              </span>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '6px', lineHeight: 1.5 }}>
              Generate a secure one-time invite token for a family member so they can register their personal ledger.
            </p>
          </div>

          <form onSubmit={handleInvite} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <input
              type="email"
              placeholder="e.g. family.member@gmail.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              style={{
                flex: 1,
                minWidth: '220px',
                height: '46px',
                padding: '0 16px',
                background: '#090d15',
                border: '1px solid #232a3b',
                borderRadius: '12px',
                color: '#f8fafc',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={inviteLoading}
              className="primary"
              style={{
                height: '46px',
                padding: '0 24px',
                borderRadius: '12px',
                fontWeight: 650,
                fontSize: '0.9rem',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {inviteLoading ? 'Generating...' : '+ Create Invite'}
            </button>
          </form>

          {inviteResult && (
            <div
              style={{
                marginTop: '20px',
                padding: '16px 20px',
                borderRadius: '14px',
                background: '#0d131f',
                border: '1px solid #23344d',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#10b981' }}>
                  ✓ One-time invite link ready for <strong>{inviteResult.email}</strong>
                </span>
                <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600 }}>Expires upon use</span>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
                <input
                  readOnly
                  value={inviteResult.inviteLink}
                  style={{
                    flex: 1,
                    height: '38px',
                    padding: '0 12px',
                    background: '#06090e',
                    border: '1px solid #1a273b',
                    borderRadius: '8px',
                    color: '#94a3b8',
                    fontSize: '0.8rem',
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  style={{
                    height: '38px',
                    padding: '0 16px',
                    borderRadius: '8px',
                    background: copied ? '#10b981' : '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy Link'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Backup & Restore Card */}
      <div className="panel" style={{ padding: '24px', borderRadius: '16px', background: '#050608', border: '1px solid #1a202c' }}>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
          Cloud Data Backup & Restore
        </h2>
        <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '6px', lineHeight: 1.5 }}>
          Export a complete, encrypted JSON copy of all transactions, accounts, and loan records to keep safely outside your browser.
        </p>

        <div style={{ marginTop: '16px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          <button
            onClick={handleExport}
            disabled={exportLoading || !isOnline}
            className="secondary"
            style={{
              height: '44px',
              padding: '0 20px',
              borderRadius: '10px',
              fontWeight: 600,
              fontSize: '0.88rem',
              cursor: isOnline ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {exportLoading ? 'Exporting...' : '⬇ Export Full Backup (JSON)'}
          </button>
        </div>

        <div style={{ height: '1px', background: '#141a27', margin: '22px 0' }} />

        <div>
          <h3 style={{ fontSize: '0.92rem', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>
            Import & Merge Data
          </h3>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
            Select a previous backup file. Records will be safely merged without overwriting your newer entries.
          </p>

          <div style={{ marginTop: '14px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="file"
              accept=".json"
              onChange={(e) => setImportFile(e.target.files[0])}
              style={{
                fontSize: '0.82rem',
                color: '#94a3b8',
                background: '#090d15',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #232a3b',
              }}
            />
            <button
              onClick={handleImport}
              disabled={!importFile || !isOnline}
              className="primary"
              style={{
                height: '38px',
                padding: '0 18px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: importFile && isOnline ? 'pointer' : 'not-allowed',
                opacity: importFile && isOnline ? 1 : 0.5,
              }}
            >
              ⬆ Merge Backup
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
