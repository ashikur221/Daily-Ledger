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
  const [importResult, setImportResult] = useState(null);
  const [msg, setMsg] = useState('');

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const { data } = await api.get('/backup/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daily-ledger-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Backup downloaded successfully!');
    } catch (err) {
      const errorMsg = 'Export failed: ' + (err.response?.data?.message || err.message);
      setMsg(errorMsg);
      toast.error(errorMsg);
    } finally {
      setExportLoading(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) {
      toast.warning('Please select a backup JSON file first');
      return setMsg('Please select a backup file first');
    }
    if (!window.confirm('Import will MERGE data (not replace). Continue?')) return;

    try {
      const text = await importFile.text();
      const json = JSON.parse(text);
      const { data } = await api.post('/backup/import', json);
      setImportResult(data.imported);
      const successMsg = `Import complete: ${data.imported.transactions} transactions, ${data.imported.accounts} accounts, ${data.imported.tools} tools.`;
      setMsg(successMsg);
      toast.success(successMsg);
    } catch (err) {
      const errorMsg = 'Import failed: ' + (err.response?.data?.message || err.message);
      setMsg(errorMsg);
      toast.error(errorMsg);
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
      toast.success(`Invite created for ${data.email}! Link is ready.`);
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'Failed to create invite';
      setMsg(errorMsg);
      toast.error(errorMsg);
    } finally {
      setInviteLoading(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>

      {msg && <div className="alert-info">{msg}<button className="close-btn" onClick={() => setMsg('')}>×</button></div>}

      {/* Profile */}
      <div className="settings-card">
        <h2 className="settings-section-title">Profile</h2>
        <div className="profile-info">
          <div className="profile-avatar">{user?.name?.[0]?.toUpperCase()}</div>
          <div>
            <div className="profile-name">{user?.name}</div>
            <div className="profile-email">{user?.email}</div>
            <div className="profile-role">{user?.role}</div>
          </div>
        </div>
        <button className="btn-danger" id="logout-btn" onClick={logout}>Sign Out</button>
      </div>

      {/* Backup */}
      <div className="settings-card">
        <h2 className="settings-section-title">Backup & Restore</h2>
        <p className="settings-desc">Export a full JSON backup of all your data. Keep it safe outside your device.</p>
        <button className="btn-primary" id="export-btn" onClick={handleExport} disabled={exportLoading || !isOnline}>
          {exportLoading ? <span className="spinner" /> : '⬇ Export Backup'}
        </button>
        {!isOnline && <p className="settings-warn">⚠ Online required for backup</p>}

        <div className="settings-divider" />

        <p className="settings-desc">Import a previous backup. This will MERGE records — not replace existing data.</p>
        <input type="file" accept=".json" id="import-file" onChange={e => setImportFile(e.target.files[0])} className="file-input" />
        <button className="btn-secondary" id="import-btn" onClick={handleImport} disabled={!importFile || !isOnline}>
          ⬆ Import & Merge
        </button>
      </div>

      {/* Invite — admin only */}
      {user?.role === 'admin' && (
        <div className="settings-card">
          <h2 className="settings-section-title">Invite Family Member</h2>
          <p className="settings-desc">Send an invite token to a family member so they can create their own account.</p>
          <form onSubmit={handleInvite} className="invite-form">
            <input
              type="email"
              placeholder="their@email.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              required
              id="invite-email"
              className="invite-input"
            />
            <button type="submit" className="btn-primary" disabled={inviteLoading} id="invite-btn">
              {inviteLoading ? <span className="spinner" /> : 'Create Invite'}
            </button>
          </form>

          {inviteResult && (
            <div className="invite-result">
              <p>✅ Invite created for <strong>{inviteResult.email}</strong></p>
              <p className="invite-token-label">Share this link with them:</p>
              <code className="invite-link">{inviteResult.inviteLink}</code>
              <p className="invite-warn">⚠ Token expires once used. Keep it private.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
