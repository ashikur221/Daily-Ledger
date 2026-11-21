import db from '../db/localDb';
import api from './api';

// Try to sync all pending records to the server
// Called: on login, on network restore, on app focus
export const flushSyncQueue = async () => {
  const pending = await db.syncQueue.toArray();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  // Group pending records by entity for bulk sync
  const byEntity = pending.reduce((acc, item) => {
    if (!acc[item.entity]) acc[item.entity] = [];
    acc[item.entity].push(item);
    return acc;
  }, {});

  let totalSynced = 0;
  let totalFailed = 0;

  for (const [entity, items] of Object.entries(byEntity)) {
    try {
      const endpoint = `/api/${entity}/sync`;
      const records = await Promise.all(
        items.map(async (item) => {
          // Get latest data from local DB for this localId
          const record = await db[entity].get(item.localId);
          return record || null;
        })
      );

      const validRecords = records.filter(Boolean);
      if (validRecords.length === 0) continue;

      const { data } = await api.post(`/${entity}/sync`, { records: validRecords });

      // Mark as synced in local DB
      await Promise.all(
        (data.synced || []).map(async (localId) => {
          await db[entity].update(localId, { synced: true });
          // Remove from queue
          await db.syncQueue.where({ entity, localId }).delete();
        })
      );

      totalSynced += (data.synced || []).length;
      totalFailed += data.failed || 0;
    } catch (err) {
      // Network still unavailable — increment retry count
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

// Add a record to the sync queue (called after every local write)
export const queueSync = async (entity, localId) => {
  // Remove any existing queue entry for this entity+localId first
  await db.syncQueue.where({ entity, localId }).delete();
  await db.syncQueue.add({ entity, localId, operation: 'upsert', retries: 0, createdAt: new Date() });
};

// Get count of pending sync records
export const getPendingCount = async () => {
  return db.syncQueue.count();
};

// Listen for network restoration and auto-sync
export const initNetworkSync = (onSyncComplete) => {
  const handleOnline = async () => {
    console.log('🌐 Network restored — syncing...');
    const result = await flushSyncQueue();
    if (onSyncComplete) onSyncComplete(result);
  };

  window.addEventListener('online', handleOnline);
  return () => window.removeEventListener('online', handleOnline);
};
