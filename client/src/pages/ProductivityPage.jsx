import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  Check,
  Lock,
  Unlock,
  ShieldCheck,
  ListTodo,
  Plus,
  Trash2,
  Search,
  X,
  Copy,
  Eye,
  EyeOff,
  FileText,
} from 'lucide-react';
import { ICON_STROKE } from '../components/AppIcons';
import db from '../db/localDb';
import api from '../services/api';
import { queueSync, pullDeltaChanges } from '../services/syncService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { encryptSecret, decryptSecret } from '../utils/cryptoVault';

export default function ProductivityPage() {
  const { isOnline, refreshPendingCount } = useAuth();
  const toast = useToast();
  const { confirm } = useConfirm();

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'todos');

  // --- 1. To-Do State ---
  const [todos, setTodos] = useState([]);
  const [newTodoText, setNewTodoText] = useState('');
  const [newTodoPriority, setNewTodoPriority] = useState('medium');
  const [todoFilter, setTodoFilter] = useState('active'); // 'active' | 'completed'
  const [showAddTodoModal, setShowAddTodoModal] = useState(false);

  // --- 2. Vault (Bank & bKash Security) State ---
  const [vaultItems, setVaultItems] = useState([]);
  const [masterPin, setMasterPin] = useState('');
  const [isVaultUnlocked, setIsVaultUnlocked] = useState(false);
  const [unlockedSecrets, setUnlockedSecrets] = useState({}); // localId -> decrypted object
  const [visiblePins, setVisiblePins] = useState({}); // localId -> boolean
  const [vaultSearchQuery, setVaultSearchQuery] = useState(() => searchParams.get('search') || '');
  const [vaultCategoryFilter, setVaultCategoryFilter] = useState('all');

  // Form for new Bank / bKash secret
  const [vaultForm, setVaultForm] = useState({
    title: '',
    category: 'bKash', // bKash, Nagad, Bank, Card, Note
    accountNumber: '',
    secretPin: '',
    notes: '',
  });
  const [showAddVaultModal, setShowAddVaultModal] = useState(false);

  useEffect(() => {
    loadLocalData();

    const handleRemoteUpdate = () => {
      loadLocalData();
    };
    window.addEventListener('daily_ledger:data_updated', handleRemoteUpdate);
    return () => window.removeEventListener('daily_ledger:data_updated', handleRemoteUpdate);
  }, []);

  const loadLocalData = async () => {
    try {
      let allTools = await db.tools.where('isDeleted').equals(0).toArray();
      let localTodos = allTools.filter((t) => t.toolType === 'todo');
      let localVault = allTools.filter((t) => t.toolType === 'vault_item');
      setTodos(localTodos);
      setVaultItems(localVault);

      // If local vault is empty and online, pull full delta from cloud to ensure any existing secrets stored in cloud are restored locally
      if (localVault.length === 0 && isOnline) {
        pullDeltaChanges(true).then(async (res) => {
          if (res?.pulled > 0) {
            allTools = await db.tools.where('isDeleted').equals(0).toArray();
            setTodos(allTools.filter((t) => t.toolType === 'todo'));
            setVaultItems(allTools.filter((t) => t.toolType === 'vault_item'));
          }
        });
      }
    } catch (err) {
      console.error('Error loading tools:', err);
    }
  };

  // --- To-Do Handlers ---
  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;

    const localId = uuidv4();
    const todoRecord = {
      localId,
      toolType: 'todo',
      data: {
        text: newTodoText.trim(),
        priority: newTodoPriority,
        completed: false,
        createdAt: new Date().toISOString(),
      },
      synced: false,
      isDeleted: 0,
      clientUpdatedAt: new Date(),
    };

    await db.tools.put(todoRecord);
    await queueSync('tools', localId);
    refreshPendingCount();

    if (isOnline) {
      try {
        await api.post('/tools', todoRecord);
        await db.tools.update(localId, { synced: true });
        await db.syncQueue.where({ entity: 'tools', localId }).delete();
      } catch {}
    }

    setNewTodoText('');
    setShowAddTodoModal(false);
    loadLocalData();
    toast.success('Task added!');
  };

  const handleToggleTodo = async (todo) => {
    const updatedStatus = !todo.data?.completed;
    const updatedRecord = {
      ...todo,
      data: {
        ...todo.data,
        completed: updatedStatus,
      },
      synced: false,
      clientUpdatedAt: new Date(),
    };

    await db.tools.put(updatedRecord);
    await queueSync('tools', todo.localId);
    refreshPendingCount();

    if (isOnline) {
      try {
        await api.put(`/tools/${todo.localId}`, updatedRecord);
        await db.tools.update(todo.localId, { synced: true });
        await db.syncQueue.where({ entity: 'tools', localId: todo.localId }).delete();
      } catch {}
    }

    loadLocalData();
  };

  const handleDeleteTodo = async (item) => {
    const localId = typeof item === 'object' ? item.localId : item;
    const taskTitle = typeof item === 'object' ? item.data?.text : 'this task';

    const ok = await confirm({
      title: 'Delete Task',
      message: `Are you sure you want to delete "${taskTitle}"?`,
      confirmText: 'Delete Task',
      danger: true,
    });
    if (!ok) return;

    await db.tools.update(localId, { isDeleted: 1, synced: false });
    await queueSync('tools', localId);
    refreshPendingCount();

    if (isOnline) {
      try {
        await api.delete(`/tools/${localId}`);
        await db.tools.update(localId, { synced: true });
        await db.syncQueue.where({ entity: 'tools', localId }).delete();
      } catch {}
    }

    loadLocalData();
    toast.info('Task deleted');
  };

  // --- Vault Handlers ---
  const handleUnlockVault = async (e) => {
    e.preventDefault();
    if (!masterPin || masterPin.length < 4) {
      toast.warning('Enter your Master PIN / Password (min 4 characters)');
      return;
    }

    // Try decrypting all existing vault items with this master key
    try {
      const decryptedMap = {};
      let failureCount = 0;

      for (const item of vaultItems) {
        try {
          const raw = await decryptSecret(item.data?.encryptedPayload, masterPin);
          if (raw) {
            decryptedMap[item.localId] = JSON.parse(raw);
          }
        } catch {
          failureCount++;
        }
      }

      if (vaultItems.length > 0 && failureCount === vaultItems.length) {
        toast.error('Incorrect Master PIN! Unable to decrypt vault.');
        return;
      }

      setUnlockedSecrets(decryptedMap);
      setIsVaultUnlocked(true);
      toast.success('Secure Vault Unlocked!');
    } catch {
      toast.error('Failed to unlock vault');
    }
  };

  const handleSaveVaultItem = async (e) => {
    e.preventDefault();
    if (!vaultForm.title.trim()) {
      toast.warning('Please enter an account title');
      return;
    }

    try {
      const payloadToEncrypt = JSON.stringify({
        accountNumber: vaultForm.accountNumber.trim(),
        secretPin: vaultForm.secretPin.trim(),
        notes: vaultForm.notes.trim(),
      });

      // Encrypt with Master Password using AES-256-GCM
      const encryptedPayload = await encryptSecret(payloadToEncrypt, masterPin);

      const localId = uuidv4();
      const vaultRecord = {
        localId,
        toolType: 'vault_item',
        data: {
          title: vaultForm.title.trim(),
          category: vaultForm.category,
          encryptedPayload, // Encrypted string: salt:iv:ciphertext
          hasPin: !!vaultForm.secretPin.trim(),
          createdAt: new Date().toISOString(),
        },
        synced: false,
        isDeleted: 0,
        clientUpdatedAt: new Date(),
      };

      await db.tools.put(vaultRecord);
      await queueSync('tools', localId);
      refreshPendingCount();

      if (isOnline) {
        try {
          await api.post('/tools', vaultRecord);
          await db.tools.update(localId, { synced: true });
          await db.syncQueue.where({ entity: 'tools', localId }).delete();
        } catch {}
      }

      // Add to decrypted map in memory immediately
      setUnlockedSecrets((prev) => ({
        ...prev,
        [localId]: {
          accountNumber: vaultForm.accountNumber.trim(),
          secretPin: vaultForm.secretPin.trim(),
          notes: vaultForm.notes.trim(),
        },
      }));

      setShowAddVaultModal(false);
      setVaultForm({
        title: '',
        category: 'bKash',
        accountNumber: '',
        secretPin: '',
        notes: '',
      });
      loadLocalData();
      toast.success('Secure item saved to encrypted vault!');
    } catch (err) {
      toast.error('Encryption failed: ' + err.message);
    }
  };

  const handleDeleteVaultItem = async (item) => {
    const localId = typeof item === 'object' ? item.localId : item;
    const itemTitle = typeof item === 'object' ? item.data?.title : 'this credential';

    const ok = await confirm({
      title: 'Delete Secret Credential',
      message: `Are you sure you want to permanently delete "${itemTitle}" from your encrypted vault? This cannot be undone.`,
      confirmText: 'Delete Credential',
      danger: true,
    });
    if (!ok) return;

    await db.tools.update(localId, { isDeleted: 1, synced: false });
    await queueSync('tools', localId);
    refreshPendingCount();

    if (isOnline) {
      try {
        await api.delete(`/tools/${localId}`);
        await db.tools.update(localId, { synced: true });
        await db.syncQueue.where({ entity: 'tools', localId }).delete();
      } catch {}
    }

    setUnlockedSecrets((prev) => {
      const copy = { ...prev };
      delete copy[localId];
      return copy;
    });

    loadLocalData();
    toast.info('Secret removed from vault');
  };

  const togglePinVisibility = (id) => {
    setVisiblePins((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Filtered Todos
  const filteredTodos = todos.filter((t) => {
    if (todoFilter === 'active') return !t.data?.completed;
    if (todoFilter === 'completed') return t.data?.completed;
    return true;
  });

  // Filtered Vault Secrets
  const filteredVaultItems = vaultItems.filter((item) => {
    const matchesCategory =
      vaultCategoryFilter === 'all' || item.data?.category === vaultCategoryFilter;
    if (!matchesCategory) return false;

    if (!vaultSearchQuery.trim()) return true;

    const q = vaultSearchQuery.toLowerCase().trim();
    const dec = unlockedSecrets[item.localId] || {};
    const title = (item.data?.title || '').toLowerCase();
    const category = (item.data?.category || '').toLowerCase();
    const accNum = (dec.accountNumber || '').toLowerCase();
    const notes = (dec.notes || '').toLowerCase();

    return (
      title.includes(q) ||
      category.includes(q) ||
      accNum.includes(q) ||
      notes.includes(q)
    );
  });

  const getProviderBadgeStyle = (category = '') => {
    const cat = category.toLowerCase();
    if (cat.includes('bkash')) {
      return { background: 'rgba(225, 29, 72, 0.14)', color: '#fb7185', border: '1px solid rgba(225, 29, 72, 0.28)' };
    }
    if (cat.includes('nagad')) {
      return { background: 'rgba(245, 158, 11, 0.14)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.28)' };
    }
    if (cat.includes('rocket')) {
      return { background: 'rgba(168, 85, 247, 0.14)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.28)' };
    }
    if (cat.includes('card')) {
      return { background: 'rgba(16, 185, 129, 0.14)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.28)' };
    }
    return { background: 'rgba(56, 189, 248, 0.14)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.28)' };
  };

  return (
    <div className="pv-page-wrap">
      
      {/* 1. Header with Segmented Tab Switcher */}
      <div className="pv-header-row">
        <div>
          <h1 className="pv-title">Daily Tasks &amp; Secure Vault</h1>
          <p className="pv-subtitle">
            Daily to-do management and client-side encrypted password keeper for banks &amp; MFS.
          </p>
        </div>

        {/* Segmented Tab Toggle */}
        <div className="pv-tabs-bar" role="tablist" aria-label="Workspace Sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'todos'}
            onClick={() => setActiveTab('todos')}
            className={`pv-tab-btn ${activeTab === 'todos' ? 'active-tasks' : ''}`}
          >
            <Check size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <span>Daily Tasks ({todos.filter((t) => !t.data?.completed).length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'vault'}
            onClick={() => setActiveTab('vault')}
            className={`pv-tab-btn ${activeTab === 'vault' ? 'active-vault' : ''}`}
          >
            <Lock size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <span>Bank &amp; bKash Vault</span>
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* TAB 1: DAILY TO-DO LIST (DL-008)                          */}
      {/* ========================================================= */}
      {activeTab === 'todos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Task Summary, Segmented Filter & New Task Action */}
          <div className="tasks-toolbar">
            <div className="tasks-summary-meta">
              <span style={{ fontSize: '0.95rem', color: '#f5f7fa', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                <ListTodo size={17} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
                <span>Tasks</span>
              </span>
              <span className="tasks-summary-pill">
                {todos.length} total · {todos.filter((t) => t.data?.completed).length} completed
              </span>
            </div>

            <div className="tasks-controls-group">
              <div className="tasks-filter-group" role="group" aria-label="Filter tasks">
                {['active', 'completed'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setTodoFilter(f)}
                    className={`tasks-filter-btn ${todoFilter === f ? 'active' : ''}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="primary tasks-new-btn"
                onClick={() => setShowAddTodoModal(true)}
              >
                <Plus size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <span>New Task</span>
              </button>
            </div>
          </div>

          {/* Tasks List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredTodos.length === 0 ? (
              <div className="panel" style={{ padding: '36px', textAlign: 'center', background: '#101116', border: '1px solid #252936', borderRadius: '14px' }}>
                <p style={{ color: '#9ca3af', fontSize: '0.88rem', margin: 0 }}>No tasks found in this view.</p>
              </div>
            ) : (
              filteredTodos.map((t) => {
                const isDone = Boolean(t.data?.completed);
                const priority = (t.data?.priority || 'medium').toLowerCase();
                return (
                  <div
                    key={t.localId}
                    className={`task-card ${isDone ? 'completed' : ''}`}
                  >
                    <label className="task-card-left" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isDone}
                        onChange={() => handleToggleTodo(t)}
                        className="task-checkbox"
                        aria-label={`Mark "${t.data?.text}" as ${isDone ? 'active' : 'completed'}`}
                      />
                      <span className="task-title-text">
                        {t.data?.text}
                      </span>
                    </label>

                    <div className="task-card-right">
                      <span className={`priority-badge ${priority}`}>
                        {t.data?.priority}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleDeleteTodo(t)}
                        className="pv-icon-delete-btn"
                        title="Delete task"
                        aria-label={`Delete task "${t.data?.text}"`}
                      >
                        <Trash2 size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: ZERO-KNOWLEDGE ENCRYPTED BANK & bKASH VAULT        */}
      {/* ========================================================= */}
      {activeTab === 'vault' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Security Banner */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: '14px',
              background: 'rgba(225, 29, 72, 0.08)',
              border: '1px solid rgba(225, 29, 72, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fb7185', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShieldCheck size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <span>Zero-Knowledge AES-256 Client-Side Encryption</span>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '4px 0 0', lineHeight: 1.5 }}>
                Your PINs and bank passwords are encrypted in your browser using PBKDF2 + AES-GCM before ever being saved to IndexedDB or MongoDB. The server never sees your plain-text secrets.
              </p>
            </div>

            {isVaultUnlocked && (
              <button
                onClick={() => {
                  setIsVaultUnlocked(false);
                  setUnlockedSecrets({});
                  setMasterPin('');
                  setVaultSearchQuery('');
                  setVaultCategoryFilter('all');
                  toast.info('Vault Locked');
                }}
                style={{
                  height: '34px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#fb7185',
                  background: 'rgba(225, 29, 72, 0.15)',
                  border: '1px solid rgba(225, 29, 72, 0.3)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Lock size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <span>Lock Vault</span>
              </button>
            )}
          </div>

          {/* Locked Screen: Master PIN Authentication */}
          {!isVaultUnlocked ? (
            <div
              className="panel"
              style={{
                padding: '36px 28px',
                background: '#050608',
                border: '1px solid #1a202c',
                borderRadius: '18px',
                textAlign: 'center',
                maxWidth: '460px',
                margin: '20px auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px', color: '#fb7185' }}>
                <Lock size={36} strokeWidth={1.6} aria-hidden="true" />
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Unlock Password Vault
              </h2>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: '6px' }}>
                Enter your private Master PIN / Password to decrypt your stored bank credentials.
              </p>

              <form onSubmit={handleUnlockVault} style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <input
                  type="password"
                  placeholder="Enter Master PIN (e.g. 1234 or password)"
                  value={masterPin}
                  onChange={(e) => setMasterPin(e.target.value)}
                  className="field"
                  style={{ height: '46px', textAlign: 'center', fontSize: '1.05rem', letterSpacing: '0.2em', borderRadius: '12px' }}
                  required
                />
                <button
                  type="submit"
                  className="primary"
                  style={{
                    height: '46px',
                    borderRadius: '12px',
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  <Unlock size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  <span>Unlock Vault</span>
                </button>
              </form>
            </div>
          ) : (
            // Unlocked State: View & Add Bank / bKash Credentials
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9' }}>
                    Stored Secrets ({vaultItems.length})
                  </span>
                  {(vaultSearchQuery || vaultCategoryFilter !== 'all') && (
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8', background: '#090d15', padding: '2px 8px', borderRadius: '6px', border: '1px solid #1a202c' }}>
                      {filteredVaultItems.length} found
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowAddVaultModal(true)}
                  className="primary"
                  style={{
                    height: '38px',
                    padding: '0 18px',
                    borderRadius: '10px',
                    fontWeight: 650,
                    fontSize: '0.85rem',
                    background: 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Plus size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  <span>Add Bank / bKash Secret</span>
                </button>
              </div>

              {/* Search Bar & Category Filter Pills */}
              {vaultItems.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ position: 'relative', width: '100%' }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: '14px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: '#64748b',
                        display: 'inline-flex',
                        pointerEvents: 'none',
                      }}
                    >
                      <Search size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                    </span>
                    <input
                      type="text"
                      placeholder="Search vault (e.g. bKash, City Bank, 017xx, card notes)..."
                      value={vaultSearchQuery}
                      onChange={(e) => setVaultSearchQuery(e.target.value)}
                      className="field"
                      style={{
                        width: '100%',
                        height: '42px',
                        paddingLeft: '40px',
                        paddingRight: vaultSearchQuery ? '38px' : '14px',
                        borderRadius: '10px',
                        background: '#0a0a0f',
                        border: '1px solid #252936',
                        fontSize: '0.88rem',
                      }}
                    />
                    {vaultSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setVaultSearchQuery('')}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'transparent',
                          border: 'none',
                          color: '#9ca3af',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'inline-flex',
                        }}
                        title="Clear search"
                        aria-label="Clear search"
                      >
                        <X size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  {/* Category Filter Pills */}
                  <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                    {['all', 'bKash', 'Nagad', 'Rocket', 'Bank', 'Debit / Credit Card', 'Private Note'].map((cat) => {
                      const isSelected = vaultCategoryFilter === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setVaultCategoryFilter(cat)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '8px',
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            border: '1px solid',
                            borderColor: isSelected ? '#fb7185' : '#1f2937',
                            background: isSelected ? 'rgba(225, 29, 72, 0.2)' : '#090d15',
                            color: isSelected ? '#fda4af' : '#94a3b8',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {cat === 'all' ? 'All Secrets' : cat}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {vaultItems.length === 0 ? (
                <div className="panel" style={{ padding: '36px', textAlign: 'center', background: '#050608', border: '1px solid #1a202c', borderRadius: '14px' }}>
                  <p style={{ color: '#64748b', fontSize: '0.88rem' }}>No credentials stored yet. Click "+ Add Bank / bKash Secret" to store one securely.</p>
                </div>
              ) : filteredVaultItems.length === 0 ? (
                <div className="panel" style={{ padding: '36px', textAlign: 'center', background: '#050608', border: '1px solid #1a202c', borderRadius: '14px' }}>
                  <p style={{ color: '#f87171', fontSize: '0.92rem', fontWeight: 600 }}>No matching secrets found</p>
                  <p style={{ color: '#64748b', fontSize: '0.82rem', marginTop: '4px' }}>
                    No items match &quot;{vaultSearchQuery}&quot; {vaultCategoryFilter !== 'all' ? `in category "${vaultCategoryFilter}"` : ''}.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setVaultSearchQuery('');
                      setVaultCategoryFilter('all');
                    }}
                    style={{
                      marginTop: '12px',
                      background: '#151b23',
                      border: '1px solid #283347',
                      color: '#38bdf8',
                      padding: '6px 14px',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Reset Search & Filters
                  </button>
                </div>
              ) : (
                filteredVaultItems.map((item) => {
                  const dec = unlockedSecrets[item.localId] || {};
                  const isVisible = visiblePins[item.localId];
                  const badgeStyle = getProviderBadgeStyle(item.data?.category);

                  return (
                    <div key={item.localId} className="vault-card">
                      <div className="vault-card-header">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="vault-card-title-row">
                            <span className="vault-card-title">
                              {item.data?.title}
                            </span>
                            <span className="vault-provider-badge" style={badgeStyle}>
                              {item.data?.category}
                            </span>
                          </div>
                          {dec.accountNumber && (
                            <div className="vault-account-row">
                              <span>Account / Phone:</span>
                              <span className="vault-account-number">{dec.accountNumber}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(dec.accountNumber);
                                  toast.info('Account number copied!');
                                }}
                                className="vault-copy-inline-btn"
                                title="Copy Account Number"
                                aria-label={`Copy account number for ${item.data?.title}`}
                              >
                                <Copy size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
                                <span>Copy</span>
                              </button>
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteVaultItem(item)}
                          className="pv-icon-delete-btn"
                          title="Remove credential"
                          aria-label={`Remove ${item.data?.title}`}
                        >
                          <Trash2 size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        </button>
                      </div>

                      {/* Decrypted PIN / Password Display */}
                      <div className="vault-pin-box">
                        <div className="vault-pin-value-wrap">
                          <span className="vault-pin-label">PIN / Password:</span>
                          <span
                            className="vault-pin-value"
                            style={{
                              letterSpacing: isVisible ? '0.08em' : '0.22em',
                              color: isVisible ? '#38bdf8' : '#9ca3af',
                            }}
                          >
                            {isVisible ? dec.secretPin || 'None' : '••••••••'}
                          </span>
                        </div>

                        <div className="vault-pin-actions">
                          <button
                            type="button"
                            onClick={() => togglePinVisibility(item.localId)}
                            className="vault-pin-btn"
                            aria-label={isVisible ? 'Hide PIN or password' : 'Reveal PIN or password'}
                          >
                            {isVisible ? (
                              <>
                                <EyeOff size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                                <span>Hide</span>
                              </>
                            ) : (
                              <>
                                <Eye size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                                <span>Reveal</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (dec.secretPin) {
                                navigator.clipboard.writeText(dec.secretPin);
                                toast.info('PIN copied to clipboard!');
                              }
                            }}
                            className="vault-pin-btn"
                            aria-label="Copy PIN or password"
                          >
                            <Copy size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                            <span>Copy</span>
                          </button>
                        </div>
                      </div>

                      {dec.notes && (
                        <div className="vault-notes-box">
                          <FileText size={14} strokeWidth={ICON_STROKE} style={{ marginTop: '2px', flexShrink: 0 }} aria-hidden="true" />
                          <span>{dec.notes}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal: Add Secure Item */}
      {showAddVaultModal && (
        <div className="modal-overlay" onClick={() => setShowAddVaultModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px', background: '#0b0f17', border: '1px solid #232a3b' }}>
            <h2 className="modal-title" style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Lock size={18} strokeWidth={ICON_STROKE} color="#fb7185" aria-hidden="true" />
              <span>Add Encrypted Credential</span>
            </h2>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
              Stored with 256-bit client-side AES encryption.
            </p>

            <form onSubmit={handleSaveVaultItem} className="modal-form" style={{ marginTop: '16px' }}>
              <div className="form-item">
                <label className="form-label" htmlFor="vault-category">Account Type</label>
                <select
                  id="vault-category"
                  value={vaultForm.category}
                  onChange={(e) => setVaultForm({ ...vaultForm, category: e.target.value })}
                  className="field"
                >
                  <option value="bKash">bKash (Personal/Agent)</option>
                  <option value="Nagad">Nagad MFS</option>
                  <option value="Rocket">Rocket</option>
                  <option value="Bank">Bank Account / Internet Banking</option>
                  <option value="Debit / Credit Card">Debit / Credit Card</option>
                  <option value="Private Note">Private Secret Note</option>
                </select>
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="vault-title">Label / Name</label>
                <input
                  id="vault-title"
                  type="text"
                  placeholder="e.g. Personal bKash, City Bank Dual Card, EBL"
                  value={vaultForm.title}
                  onChange={(e) => setVaultForm({ ...vaultForm, title: e.target.value })}
                  className="field"
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="vault-account">Account / Phone Number</label>
                <input
                  id="vault-account"
                  type="text"
                  placeholder="e.g. 017xxxxxxxx or 105.xxx.xxxx"
                  value={vaultForm.accountNumber}
                  onChange={(e) => setVaultForm({ ...vaultForm, accountNumber: e.target.value })}
                  className="field"
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="vault-pin">PIN / Password / OTP Key</label>
                <input
                  id="vault-pin"
                  type="password"
                  placeholder="Your private PIN or password"
                  value={vaultForm.secretPin}
                  onChange={(e) => setVaultForm({ ...vaultForm, secretPin: e.target.value })}
                  className="field"
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="vault-notes">Additional Notes / Security Qs</label>
                <textarea
                  id="vault-notes"
                  rows={2}
                  placeholder="Optional secret hints, recovery email, card CVV..."
                  value={vaultForm.notes}
                  onChange={(e) => setVaultForm({ ...vaultForm, notes: e.target.value })}
                  className="field"
                  style={{ height: 'auto', padding: '8px 12px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
                <button
                  type="button"
                  className="secondary flex-1"
                  onClick={() => setShowAddVaultModal(false)}
                  style={{ height: '42px', borderRadius: '10px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary flex-1"
                  style={{
                    height: '42px',
                    borderRadius: '10px',
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <Lock size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  <span>Encrypt &amp; Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Task / To-Do */}
      {showAddTodoModal && (
        <div className="modal-overlay" onClick={() => setShowAddTodoModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px', background: '#0b0f17', border: '1px solid #232a3b' }}>
            <h2 className="modal-title" style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ListTodo size={18} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
              <span>Add New Task</span>
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: '4px', marginBottom: '16px' }}>
              Keep track of bills to pay, cash transfers, or daily financial chores.
            </p>

            <form onSubmit={handleAddTodo} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="todo-text">Task Description</label>
                <input
                  id="todo-text"
                  type="text"
                  placeholder="e.g. Deposit ৳5,000 in bKash, Pay electricity bill..."
                  value={newTodoText}
                  onChange={(e) => setNewTodoText(e.target.value)}
                  className="field"
                  autoFocus
                  required
                />
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="todo-priority">Priority Level</label>
                <select
                  id="todo-priority"
                  value={newTodoPriority}
                  onChange={(e) => setNewTodoPriority(e.target.value)}
                  className="field"
                >
                  <option value="high">🔴 High Priority (Urgent / Due Today)</option>
                  <option value="medium">🟡 Medium Priority (Important)</option>
                  <option value="low">🟢 Normal Priority</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
                <button
                  type="button"
                  className="secondary flex-1"
                  onClick={() => setShowAddTodoModal(false)}
                  style={{ height: '42px', borderRadius: '10px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary flex-1"
                  style={{
                    height: '42px',
                    borderRadius: '10px',
                    fontWeight: 700,
                  }}
                >
                  Save Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
