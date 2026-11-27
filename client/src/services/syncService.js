import db from '../db/localDb';
import api from './api';

const LAST_SYNC_KEY = 'daily_ledger_last_sync_time';

/**
 * Clear all local user-scoped IndexedDB tables and sync metadata
 * to prevent cross-account data leakage when switching accounts.
 */
export const clearLocalUserData = async () => {
  await Promise.all([
    db.transactions.clear(),
    db.accounts.clear(),
    db.tools.clear(),
    db.syncQueue.clear(),
  ]);
  localStorage.removeItem(LAST_SYNC_KEY);
  window.dispatchEvent(new CustomEvent('daily_ledger:data_updated', { detail: { cleared: true } }));
};

/**
 * 1. PUSH: Flush local changes to the server
 */
export const flushSyncQueue = async () => {
  const pending = await db.syncQueue.toArray();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  const byEntity = pending.reduce((acc, item) => {
    if (!acc[item.entity]) acc[item.entity] = [];
    acc[item.entity].push(item);
    return acc;
  }, {});

  let totalSynced = 0;
  let totalFailed = 0;

  for (const [entity, items] of Object.entries(byEntity)) {
    try {
      const records = await Promise.all(
        items.map(async (item) => {
          const record = await db[entity].get(item.localId);
          return record || null;
        })
      );

      const validRecords = records.filter(Boolean);
      if (validRecords.length === 0) continue;

      const { data } = await api.post(`/${entity}/sync`, { records: validRecords });

      await Promise.all(
        (data.synced || []).map(async (localId) => {
          await db[entity].update(localId, { synced: true });
          await db.syncQueue.where({ entity, localId }).delete();
        })
      );

      totalSynced += (data.synced || []).length;
      totalFailed += data.failed || 0;
    } catch (err) {
      await Promise.all(
        items.map((item) =>
          db.syncQueue.update(item.id, { retries: (item.retries || 0) + 1 })
        )
      );
      totalFailed += items.length;
    }
  }

  return { synced: totalSynced, failed: totalFailed };
};

/**
 * 2. PULL: Fetch delta changes made from other devices and merge into IndexedDB
 * @param {boolean} forceFull - When true, ignores LAST_SYNC_KEY and fetches full records from cloud
 */
export const pullDeltaChanges = async (forceFull = false) => {
  try {
    let since = forceFull ? '' : (localStorage.getItem(LAST_SYNC_KEY) || '');

    // Auto-detect empty local database: if user cleared local cache or tables have 0 items,
    // don't use 'since', do a full pull so we don't leave local DB empty!
    if (!forceFull && since) {
      try {
        const [txCount, toolCount] = await Promise.all([
          db.transactions.count(),
          db.tools.count(),
        ]);
        if (txCount === 0 && toolCount === 0) {
          since = '';
        }
      } catch {}
    }

    const endpoint = since ? `/sync/pull?since=${encodeURIComponent(since)}` : '/sync/pull';

    const { data } = await api.get(endpoint);
    if (!data) return { pulled: 0 };

    let pulledCount = 0;

    // A. Merge transactions
    if (Array.isArray(data.transactions) && data.transactions.length > 0) {
      for (const t of data.transactions) {
        // Only update if not currently modified in local syncQueue
        const inQueue = await db.syncQueue.where({ entity: 'transactions', localId: t.localId }).first();
        if (!inQueue) {
          await db.transactions.put(t);
          pulledCount++;
        }
      }
    }

    // B. Merge accounts
    if (Array.isArray(data.accounts) && data.accounts.length > 0) {
      for (const a of data.accounts) {
        const inQueue = await db.syncQueue.where({ entity: 'accounts', localId: a.localId }).first();
        if (!inQueue) {
          await db.accounts.put(a);
          pulledCount++;
        }
      }
    }

    // C. Merge tools (debts/loans/repayments)
    if (Array.isArray(data.tools) && data.tools.length > 0) {
      for (const tool of data.tools) {
        const inQueue = await db.syncQueue.where({ entity: 'tools', localId: tool.localId }).first();
        if (!inQueue) {
          await db.tools.put(tool);
          pulledCount++;
        }
      }
    }

    // Save latest sync timestamp
    if (data.serverTime) {
      localStorage.setItem(LAST_SYNC_KEY, data.serverTime);
    }

    return { pulled: pulledCount };
  } catch (err) {
    console.error('Pull delta error:', err);
    return { pulled: 0, error: err };
  }
};

/**
 * 3. COMPLETE TWO-WAY SYNC: Push local changes first, then pull remote deltas
 * @param {boolean} forceFull - When true, forces complete download of all records from cloud
 */
export const syncTwoWay = async (forceFull = false) => {
  // Push upstream
  const pushRes = await flushSyncQueue();
  // Pull downstream
  const pullRes = await pullDeltaChanges(forceFull);

  // Trigger custom window event so open pages can refresh data automatically
  if (pullRes.pulled > 0) {
    window.dispatchEvent(new CustomEvent('daily_ledger:data_updated', { detail: pullRes }));
  }

  return {
    synced: pushRes.synced,
    pulled: pullRes.pulled,
    failed: pushRes.failed,
  };
};

let autoFlushTimer = null;

/**
 * Queue a record to be synced upstream and auto-flush in background if online
 */
export const queueSync = async (entity, localId) => {
  await db.syncQueue.where({ entity, localId }).delete();
  await db.syncQueue.add({ entity, localId, operation: 'upsert', retries: 0, createdAt: new Date() });

  if (typeof navigator !== 'undefined' && navigator.onLine) {
    if (autoFlushTimer) clearTimeout(autoFlushTimer);
    autoFlushTimer = setTimeout(async () => {
      try {
        await flushSyncQueue();
        window.dispatchEvent(new CustomEvent('daily_ledger:sync_completed'));
      } catch {}
    }, 450);
  }
};

/**
 * Get count of pending sync records
 */
export const getPendingCount = async () => {
  return db.syncQueue.count();
};

/**
 * Listen for network restoration and auto-trigger two-way sync
 */
export const initNetworkSync = (onSyncComplete) => {
  const handleOnline = async () => {
    console.log('🌐 Network online — running full two-way sync...');
    const result = await syncTwoWay();
    if (onSyncComplete) onSyncComplete(result);
  };

  window.addEventListener('online', handleOnline);

  // Also auto-sync when tab gains focus (e.g. user unlocks phone or switches back to app)
  // Throttled to avoid rapid firing when opening/closing file pickers and dialogs
  let lastFocusSync = 0;
  const handleFocus = async () => {
    const now = Date.now();
    if (now - lastFocusSync < 20000) return; // at most once every 20 seconds
    lastFocusSync = now;

    if (navigator.onLine) {
      try {
        const result = await syncTwoWay();
        if (onSyncComplete && (result.synced > 0 || result.pulled > 0)) {
          onSyncComplete(result);
        }
      } catch (err) {
        console.warn('Background sync on focus deferred:', err);
      }
    }
  };

  window.addEventListener('focus', handleFocus);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('focus', handleFocus);
  };
};
