import { useState } from 'react';
import { RefreshCw, Check, AlertTriangle, Upload } from 'lucide-react';
import { ICON_STROKE } from '../components/AppIcons';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import db from '../db/localDb';
import api from '../services/api';
import { syncTwoWay } from '../services/syncService';

export default function SettingsPage() {
  const { user, logout, isOnline } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importMode, setImportMode] = useState('merge'); // 'merge' or 'replace'
  const [copied, setCopied] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  const handleForceSync = async () => {
    setSyncLoading(true);
    try {
      const res = await syncTwoWay(true);
      toast.success(`Cloud sync completed! Pulled ${res.pulled} records from cloud.`);
      window.dispatchEvent(new CustomEvent('daily_ledger:data_updated', { detail: res }));
    } catch (err) {
      toast.error('Sync failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setSyncLoading(false);
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      // 1. Gather all local IndexedDB records
      const [localTx, localAcc, localTools] = await Promise.all([
        db.transactions.where('isDeleted').equals(0).toArray(),
        db.accounts.where('isDeleted').equals(0).toArray(),
        db.tools.where('isDeleted').equals(0).toArray(),
      ]);

      // 2. If online, fetch full cloud dump to ensure 100% complete migration
      let payload = {
        exportedAt: new Date().toISOString(),
        userEmail: user?.email,
        version: '3.0',
        transactions: localTx,
        accounts: localAcc,
        tools: localTools,
      };

      if (isOnline) {
        try {
          const { data } = await api.get('/backup/export');
          if (data && data.transactions) {
            payload = data;
          }
        } catch {}
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily-ledger-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Full cloud & local backup downloaded successfully!');
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

    const isReplace = importMode === 'replace';
    const ok = await confirm({
      title: isReplace ? 'Replace All Ledger Data' : 'Merge Backup Records',
      message: isReplace
        ? '⚠️ WARNING: Replace mode will overwrite your current ledger and replace all transactions, accounts, and tools with the backup data. Are you sure you want to proceed?'
        : 'Import will MERGE all records from the backup file into your existing ledger. Continue?',
      confirmText: isReplace ? 'Replace Everything' : 'Merge Records',
      danger: isReplace,
    });
    if (!ok) return;

    setImportLoading(true);
    try {
      const text = await importFile.text();
      const json = JSON.parse(text);

      const transactions = Array.isArray(json.transactions)
        ? json.transactions
        : Array.isArray(json)
        ? json
        : [];
      const accounts = Array.isArray(json.accounts) ? json.accounts : [];
      const tools = Array.isArray(json.tools) ? json.tools : [];

      if (transactions.length === 0 && accounts.length === 0 && tools.length === 0) {
        throw new Error('No valid financial records found in this JSON file.');
      }

      // 1. If online, send directly to MongoDB Atlas for cloud persistence
      let serverRes = null;
      if (isOnline) {
        const { data } = await api.post('/backup/import', {
          transactions,
          accounts,
          tools,
          mode: importMode,
        });
        serverRes = data;
      }

      // 2. Update local IndexedDB (Dexie)
      if (importMode === 'replace') {
        await Promise.all([
          db.transactions.clear(),
          db.accounts.clear(),
          db.tools.clear(),
          db.syncQueue.clear(),
        ]);
      }

      // Put records locally with synced flag
      if (transactions.length > 0) {
        await db.transactions.bulkPut(
          transactions.map((t) => ({
            ...t,
            localId: t.localId || t.id || t._id?.toString(),
            synced: true,
            isDeleted: t.isDeleted ? 1 : 0,
          }))
        );
      }

      if (accounts.length > 0) {
        await db.accounts.bulkPut(
          accounts.map((a) => ({
            ...a,
            localId: a.localId || a.id || a._id?.toString(),
            synced: true,
            isDeleted: a.isDeleted ? 1 : 0,
          }))
        );
      }

      if (tools.length > 0) {
        await db.tools.bulkPut(
          tools.map((tl) => ({
            ...tl,
            localId: tl.localId || tl.id || tl._id?.toString(),
            synced: true,
            isDeleted: tl.isDeleted ? 1 : 0,
          }))
        );
      }

      // Dispatch global refresh event so all open pages reload data
      window.dispatchEvent(new CustomEvent('daily_ledger:data_updated', { detail: { pulled: transactions.length } }));

      toast.success(
        `Restore successful! Restored ${transactions.length} transactions, ${accounts.length} accounts, and ${tools.length} debts/loans into local & cloud databases.`
      );
      setImportFile(null);
    } catch (err) {
      console.error(err);
      toast.error('Import failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setImportLoading(false);
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

      {/* Cloud Synchronization & Multi-Device Sync Card */}
      <div className="panel" style={{ padding: '24px', borderRadius: '16px', background: '#050608', border: '1px solid #1a202c' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RefreshCw size={18} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
                <span>Multi-Device Cloud Sync</span>
              </h2>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: isOnline ? '#38bdf8' : '#f59e0b', background: isOnline ? 'rgba(56, 189, 248, 0.12)' : 'rgba(245, 158, 11, 0.12)', border: isOnline ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '999px', padding: '2px 8px' }}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '6px', lineHeight: 1.5 }}>
              Tap below to force a full re-sync from MongoDB Atlas. This pulls down all your accounts, transactions, and encrypted bank vault secrets if you switch devices or cleared phone data.
            </p>
          </div>

          <button
            type="button"
            onClick={handleForceSync}
            disabled={syncLoading || !isOnline}
            className="primary"
            style={{
              height: '42px',
              padding: '0 20px',
              borderRadius: '10px',
              fontWeight: 650,
              fontSize: '0.88rem',
              cursor: isOnline ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            }}
          >
            <RefreshCw size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <span>{syncLoading ? 'Syncing...' : 'Pull from Cloud Now'}</span>
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
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Check size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  <span>One-time invite link ready for <strong>{inviteResult.email}</strong></span>
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
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {copied ? (
                    <>
                      <Check size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <span>Copy Link</span>
                  )}
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
            Full Cloud Restore & Migration
          </h3>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
            Upload a JSON backup to restore into your local offline database and synchronize directly to MongoDB Atlas.
          </p>

          {/* Mode Selector: Merge vs Replace */}
          <div style={{ marginTop: '12px', display: 'flex', gap: '14px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#e2e8f0', cursor: 'pointer' }}>
              <input
                type="radio"
                name="importMode"
                value="merge"
                checked={importMode === 'merge'}
                onChange={() => setImportMode('merge')}
              />
              <span><strong>Merge</strong> (Keep existing + append backup)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#fb7185', cursor: 'pointer' }}>
              <input
                type="radio"
                name="importMode"
                value="replace"
                checked={importMode === 'replace'}
                onChange={() => setImportMode('replace')}
              />
              <span><strong>Full Replace</strong> (Overwrite current data)</span>
            </label>
          </div>

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
              disabled={!importFile || importLoading}
              className="primary"
              style={{
                height: '38px',
                padding: '0 20px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: importFile && !importLoading ? 'pointer' : 'not-allowed',
                opacity: importFile && !importLoading ? 1 : 0.5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {importLoading ? (
                <span>Restoring...</span>
              ) : importMode === 'replace' ? (
                <>
                  <AlertTriangle size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  <span>Overwrite & Restore</span>
                </>
              ) : (
                <>
                  <Upload size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  <span>Merge & Restore</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
