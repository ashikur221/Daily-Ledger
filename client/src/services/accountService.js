import { v4 as uuidv4 } from 'uuid';
import db from '../db/localDb';
import { queueSync } from './syncService';

/**
 * Fetch all active accounts from local Dexie database
 */
export async function getAllAccounts() {
  try {
    return await db.accounts.where('isDeleted').equals(0).toArray();
  } catch (err) {
    console.error('Error getting accounts:', err);
    return [];
  }
}

/**
 * Adjust the balance of an account by a delta amount.
 * If the account does not exist yet, it automatically creates it.
 *
 * @param {string} accountName - Name of the account (e.g. "bKash", "Cash in Hand", "City Bank")
 * @param {number} delta - Positive to add money, negative to subtract money
 * @param {string} defaultType - 'cash' | 'bank' | 'mfs' | 'fdr' | 'asset'
 */
export async function adjustAccountBalance(accountName, delta, defaultType = 'bank') {
  if (!accountName || !accountName.trim() || !delta) return null;
  const name = accountName.trim();
  const numDelta = Number(delta);
  if (isNaN(numDelta) || numDelta === 0) return null;

  try {
    const all = await db.accounts.where('isDeleted').equals(0).toArray();
    const existing = all.find((a) => a.name.toLowerCase() === name.toLowerCase());

    let updatedAccount;
    const now = new Date();

    if (existing) {
      const newBal = (Number(existing.balance) || 0) + numDelta;
      updatedAccount = {
        ...existing,
        balance: newBal,
        synced: false,
        clientUpdatedAt: now,
      };
      await db.accounts.put(updatedAccount);
      await queueSync('accounts', updatedAccount.localId, 'update', updatedAccount);
    } else {
      // Determine probable type from name
      let detectedType = defaultType;
      const lower = name.toLowerCase();
      if (lower.includes('cash')) detectedType = 'cash';
      else if (lower.includes('bkash') || lower.includes('nagad') || lower.includes('rocket') || lower.includes('upay')) {
        detectedType = 'mfs';
      } else if (lower.includes('fdr') || lower.includes('dps') || lower.includes('deposit')) {
        detectedType = 'fdr';
      } else if (lower.includes('gold') || lower.includes('land') || lower.includes('asset') || lower.includes('property')) {
        detectedType = 'asset';
      }

      updatedAccount = {
        localId: uuidv4(),
        name,
        type: detectedType,
        balance: numDelta,
        institution: '',
        accountNumber: '',
        notes: '',
        synced: false,
        isDeleted: 0,
        clientUpdatedAt: now,
      };
      await db.accounts.add(updatedAccount);
      await queueSync('accounts', updatedAccount.localId, 'create', updatedAccount);
    }

    window.dispatchEvent(new CustomEvent('daily_ledger:data_updated', { detail: { account: updatedAccount } }));
    return updatedAccount;
  } catch (err) {
    console.error('Error adjusting account balance:', err);
    throw err;
  }
}

/**
 * Execute an inter-account transfer (e.g. Bank to bKash, ATM withdrawal to Cash)
 *
 * @param {Object} params
 * @param {string} params.fromAccount - Source account name
 * @param {string} params.toAccount - Destination account name
 * @param {number} params.amount - Principal transfer amount
 * @param {number} [params.fee=0] - Optional transfer fee (e.g. bKash cash out fee)
 * @param {Date|string} [params.date=new Date()] - Date of transfer
 * @param {string} [params.note=''] - Optional note
 */
export async function recordInterAccountTransfer({
  fromAccount,
  toAccount,
  amount,
  fee = 0,
  date = new Date(),
  note = '',
}) {
  const fromName = (fromAccount || '').trim();
  const toName = (toAccount || '').trim();
  const numAmount = Number(amount);
  const numFee = Math.max(0, Number(fee) || 0);

  if (!fromName || !toName) {
    throw new Error('Please select both source and destination accounts.');
  }
  if (fromName.toLowerCase() === toName.toLowerCase()) {
    throw new Error('Source and destination accounts must be different.');
  }
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new Error('Please enter a valid transfer amount.');
  }

  const now = new Date();
  const txDate = date ? new Date(date) : now;

  // 1. Deduct (amount + fee) from source
  await adjustAccountBalance(fromName, -(numAmount + numFee));

  // 2. Add amount to destination
  await adjustAccountBalance(toName, numAmount);

  // 3. Create a single audit transaction record of type 'transfer'
  const transferTx = {
    localId: uuidv4(),
    type: 'transfer',
    amount: numAmount,
    fee: numFee,
    category: 'Transfer',
    account: fromName,
    toAccount: toName,
    date: txDate,
    note: note ? note.trim() : `Transfer from ${fromName} to ${toName}${numFee > 0 ? ` (Fee: ৳${numFee})` : ''}`,
    synced: false,
    isDeleted: 0,
    clientUpdatedAt: now,
  };

  await db.transactions.add(transferTx);
  await queueSync('transactions', transferTx.localId, 'create', transferTx);

  window.dispatchEvent(new CustomEvent('daily_ledger:data_updated', { detail: { transferTx } }));
  return transferTx;
}
