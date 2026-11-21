import Dexie from 'dexie';

// Local IndexedDB database — the offline-first local store
export const db = new Dexie('DailyLedgerDB');

db.version(1).stores({
  // localId is the primary key for all tables
  transactions: 'localId, type, date, account, synced, isDeleted',
  accounts:     'localId, name, type, synced, isDeleted',
  tools:        'localId, toolType, synced, isDeleted',

  // Queue of pending sync operations to send to the server
  syncQueue:    '++id, entity, operation, localId, retries, createdAt',
});

export default db;
