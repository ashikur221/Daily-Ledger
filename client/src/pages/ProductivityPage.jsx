import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
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
  const [todoFilter, setTodoFilter] = useState('all'); // 'all' | 'active' | 'completed'
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

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '60px' }}>
      
      {/* 1. Header with Tab Switcher */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
            Daily Tasks & Secure Vault
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '6px' }}>
            Daily to-do management and client-side encrypted password keeper for banks & MFS.
          </p>
        </div>

        {/* Tab Toggle */}
        <div style={{ display: 'flex', background: '#090d15', padding: '4px', borderRadius: '12px', border: '1px solid #1a202c' }}>
          <button
            onClick={() => setActiveTab('todos')}
            style={{
              padding: '8px 18px',
              borderRadius: '9px',
              fontSize: '0.85rem',
              fontWeight: 650,
              border: 'none',
              cursor: 'pointer',
              background: activeTab === 'todos' ? '#3b82f6' : 'transparent',
              color: activeTab === 'todos' ? '#ffffff' : '#94a3b8',
              transition: 'all 0.18s ease',
            }}
          >
            ✓ Daily Tasks ({todos.filter((t) => !t.data?.completed).length})
          </button>
          <button
            onClick={() => setActiveTab('vault')}
            style={{
              padding: '8px 18px',
              borderRadius: '9px',
              fontSize: '0.85rem',
              fontWeight: 650,
              border: 'none',
              cursor: 'pointer',
              background: activeTab === 'vault' ? '#e11d48' : 'transparent',
              color: activeTab === 'vault' ? '#ffffff' : '#94a3b8',
              transition: 'all 0.18s ease',
            }}
          >
            🔒 Bank & bKash Vault
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* TAB 1: DAILY TO-DO LIST                                   */}
      {/* ========================================================= */}
      {activeTab === 'todos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Header & Filter Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', background: '#050608', border: '1px solid #1a202c', padding: '14px 20px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '0.95rem', color: '#f8fafc', fontWeight: 700 }}>
                📋 Tasks
              </span>
              <span style={{ fontSize: '0.82rem', color: '#94a3b8', background: '#0c121e', padding: '3px 10px', borderRadius: '12px', border: '1px solid #1e293b' }}>
                {todos.length} total · {todos.filter((t) => t.data?.completed).length} completed
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                {['all', 'active', 'completed'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setTodoFilter(f)}
                    style={{
                      fontSize: '0.78rem',
                      padding: '5px 12px',
                      borderRadius: '8px',
                      border: '1px solid',
                      borderColor: todoFilter === f ? '#3b82f6' : '#232a3b',
                      background: todoFilter === f ? 'rgba(59, 130, 246, 0.15)' : '#090d15',
                      color: todoFilter === f ? '#38bdf8' : '#94a3b8',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                      fontWeight: 600,
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="primary"
                onClick={() => setShowAddTodoModal(true)}
                style={{ padding: '6px 16px', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 700 }}
              >
                + New Task
              </button>
            </div>
          </div>

          {/* Tasks List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredTodos.length === 0 ? (
              <div className="panel" style={{ padding: '36px', textAlign: 'center', background: '#050608', border: '1px solid #1a202c', borderRadius: '14px' }}>
                <p style={{ color: '#64748b', fontSize: '0.88rem' }}>No tasks found in this view.</p>
              </div>
            ) : (
              filteredTodos.map((t) => {
                const isDone = t.data?.completed;
                return (
                  <div
                    key={t.localId}
                    className="panel"
                    style={{
                      background: '#050608',
                      border: '1px solid #1a202c',
                      borderRadius: '12px',
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '14px',
                      transition: 'all 0.2s ease',
                      opacity: isDone ? 0.6 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={isDone || false}
                        onChange={() => handleToggleTodo(t)}
                        style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#3b82f6' }}
                      />
                      <span
                        style={{
                          fontSize: '0.92rem',
                          color: isDone ? '#64748b' : '#f8fafc',
                          textDecoration: isDone ? 'line-through' : 'none',
                        }}
                      >
                        {t.data?.text}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span
                        style={{
                          fontSize: '0.68rem',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background:
                            t.data?.priority === 'high'
                              ? 'rgba(239, 68, 68, 0.15)'
                              : t.data?.priority === 'medium'
                              ? 'rgba(245, 158, 11, 0.15)'
                              : 'rgba(16, 185, 129, 0.15)',
                          color:
                            t.data?.priority === 'high'
                              ? '#f87171'
                              : t.data?.priority === 'medium'
                              ? '#fbbf24'
                              : '#34d399',
                        }}
                      >
                        {t.data?.priority}
                      </span>

                      <button
                        onClick={() => handleDeleteTodo(t)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#64748b',
                          cursor: 'pointer',
                          fontSize: '1.1rem',
                        }}
                        title="Delete"
                      >
                        ×
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
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fb7185' }}>
                🛡️ Zero-Knowledge AES-256 Client-Side Encryption
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
                }}
              >
                🔒 Lock Vault
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
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔐</div>
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
                  }}
                >
                  Unlock Vault 🔓
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
                  }}
                >
                  + Add Bank / bKash Secret
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
                        fontSize: '0.95rem',
                        pointerEvents: 'none',
                      }}
                    >
                      🔍
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
                        paddingLeft: '38px',
                        paddingRight: vaultSearchQuery ? '36px' : '14px',
                        borderRadius: '10px',
                        background: '#090d15',
                        border: '1px solid #1a202c',
                        fontSize: '0.88rem',
                      }}
                    />
                    {vaultSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setVaultSearchQuery('')}
                        style={{
                          position: 'absolute',
                          right: '12px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'transparent',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          fontSize: '1rem',
                          padding: '4px',
                        }}
                        title="Clear search"
                      >
                        ✕
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

                  return (
                    <div
                      key={item.localId}
                      className="panel"
                      style={{
                        background: '#050608',
                        border: '1px solid #1a202c',
                        borderRadius: '14px',
                        padding: '18px 22px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>
                              {item.data?.title}
                            </span>
                            <span
                              style={{
                                fontSize: '0.68rem',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                fontWeight: 700,
                                background:
                                  item.data?.category === 'bKash'
                                    ? 'rgba(225, 29, 72, 0.15)'
                                    : item.data?.category === 'Nagad'
                                    ? 'rgba(245, 158, 11, 0.15)'
                                    : 'rgba(56, 189, 248, 0.15)',
                                color:
                                  item.data?.category === 'bKash'
                                    ? '#fb7185'
                                    : item.data?.category === 'Nagad'
                                    ? '#fbbf24'
                                    : '#38bdf8',
                              }}
                            >
                              {item.data?.category}
                            </span>
                          </div>
                          {dec.accountNumber && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: '#94a3b8', marginTop: '4px' }}>
                              <span>Account / Phone:</span>
                              <strong style={{ color: '#e2e8f0' }}>{dec.accountNumber}</strong>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(dec.accountNumber);
                                  toast.info('Account number copied!');
                                }}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#38bdf8',
                                  fontSize: '0.78rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: '0 4px',
                                }}
                                title="Copy Account Number"
                              >
                                📋 Copy
                              </button>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => handleDeleteVaultItem(item)}
                          style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1.2rem' }}
                          title="Delete"
                        >
                          ×
                        </button>
                      </div>

                      {/* Decrypted PIN / Password Display */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: '#090d15',
                          borderRadius: '10px',
                          padding: '10px 14px',
                          border: '1px solid #1a202c',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>PIN / Password:</span>
                          <span style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: isVisible ? '0.08em' : '0.25em', color: isVisible ? '#38bdf8' : '#94a3b8' }}>
                            {isVisible ? dec.secretPin || 'None' : '••••••••'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => togglePinVisibility(item.localId)}
                            style={{
                              background: '#151b23',
                              border: '1px solid #232a3b',
                              borderRadius: '6px',
                              padding: '4px 10px',
                              color: '#cbd5e1',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {isVisible ? 'Hide' : 'Reveal'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (dec.secretPin) {
                                navigator.clipboard.writeText(dec.secretPin);
                                toast.info('PIN copied to clipboard!');
                              }
                            }}
                            style={{
                              background: '#151b23',
                              border: '1px solid #232a3b',
                              borderRadius: '6px',
                              padding: '4px 10px',
                              color: '#cbd5e1',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      </div>

                      {dec.notes && (
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5, background: '#090d15', padding: '8px 12px', borderRadius: '8px' }}>
                          📝 {dec.notes}
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
            <h2 className="modal-title" style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc' }}>
              🔒 Add Encrypted Credential
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
                  }}
                >
                  Encrypt & Save 🔒
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
            <h2 className="modal-title" style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc' }}>
              📋 Add New Task
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
