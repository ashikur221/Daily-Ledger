import db from './localDb';
import api from '../services/api';

const CLEAN_PURGE_FLAG = 'daily_ledger_cleaned_v2';

/**
 * Clean slate initialization:
 * Ensures NO dummy seed data is shown.
 * Automatically purges any legacy dummy records from local IndexedDB and cloud MongoDB Atlas
 * while strictly preserving real user records and encrypted password vault items.
 */
export async function seedInitialDataIfNeeded() {
  try {
    // 1. Purge local dummy seed transactions (localId starts with 'seed_')
    const allTxs = await db.transactions.toArray();
    const seedTxIds = allTxs
      .filter((t) => String(t.localId || '').startsWith('seed_'))
      .map((t) => t.localId);

    if (seedTxIds.length > 0) {
      console.log(`[CleanSlate] Purging ${seedTxIds.length} legacy dummy seed transactions...`);
      await db.transactions.bulkDelete(seedTxIds);
      for (const id of seedTxIds) {
        await db.syncQueue.where({ entity: 'transactions', localId: id }).delete();
      }
    }

    // 2. Purge local dummy seed accounts with dummy balances
    const seedAccIds = ['acc_cash', 'acc_islami_bank', 'acc_prime_bank', 'acc_bkash', 'acc_nagad', 'acc_rocket'];
    for (const id of seedAccIds) {
      await db.accounts.delete(id);
      await db.syncQueue.where({ entity: 'accounts', localId: id }).delete();
    }

    // 3. Mark cleaned in localStorage
    localStorage.setItem(CLEAN_PURGE_FLAG, 'true');

    // 4. If online, notify backend to permanently delete dummy seed data from MongoDB Atlas
    if (navigator.onLine) {
      try {
        await api.post('/transactions/purge-seed');
      } catch {}
    }
  } catch (err) {
    console.error('[CleanSlate] Error cleaning legacy seed data:', err);
  }
}
