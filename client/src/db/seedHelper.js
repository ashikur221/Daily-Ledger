import db from './localDb';
import seedData from './seedData.json';

const SEED_FLAG_KEY = 'daily_ledger_seeded_v1';

export async function seedInitialDataIfNeeded() {
  try {
    if (localStorage.getItem(SEED_FLAG_KEY)) {
      return;
    }

    const txCount = await db.transactions.count();
    if (txCount > 0) {
      localStorage.setItem(SEED_FLAG_KEY, 'true');
      return;
    }

    console.log('Seeding initial data from legacy ledger...');

    // 1. Seed Accounts
    const defaultAccounts = [
      { localId: 'acc_cash', name: 'Cash in Hand', type: 'cash', balance: seedData.settings?.openingCashBalance || 7515, synced: false, isDeleted: 0, clientUpdatedAt: new Date() },
      { localId: 'acc_islami_bank', name: 'Islamic Bank', type: 'bank', balance: 25000, synced: false, isDeleted: 0, clientUpdatedAt: new Date() },
      { localId: 'acc_prime_bank', name: 'Prime Bank', type: 'bank', balance: 20, synced: false, isDeleted: 0, clientUpdatedAt: new Date() },
      { localId: 'acc_bkash', name: 'Bkash', type: 'mfs', balance: 2412, synced: false, isDeleted: 0, clientUpdatedAt: new Date() },
      { localId: 'acc_nagad', name: 'Nogod', type: 'mfs', balance: 7, synced: false, isDeleted: 0, clientUpdatedAt: new Date() },
      { localId: 'acc_rocket', name: 'Rocket', type: 'mfs', balance: 8, synced: false, isDeleted: 0, clientUpdatedAt: new Date() },
    ];
    await db.accounts.bulkPut(defaultAccounts);

    // 2. Map & Seed Expenses
    const transactions = [];
    if (Array.isArray(seedData.expenses)) {
      for (const e of seedData.expenses) {
        if (!e.amount) continue; // Skip notes / closed markers
        transactions.push({
          localId: `seed_${e.id}`,
          type: 'expense',
          amount: Number(e.amount),
          category: categorizeExpense(e.title),
          account: 'Cash in Hand',
          date: new Date(e.date || '2026-09-14'),
          note: e.title || '',
          synced: false,
          isDeleted: 0,
          clientUpdatedAt: new Date(),
        });
      }
    }

    // 3. Map & Seed Deposits (Income)
    if (Array.isArray(seedData.deposits)) {
      for (const d of seedData.deposits) {
        if (!d.amount) continue;
        transactions.push({
          localId: `seed_${d.id}`,
          type: 'income',
          amount: Number(d.amount),
          category: 'Deposit / Allowance',
          account: 'Cash in Hand',
          date: new Date(d.date || '2026-09-16'),
          note: d.source ? `From ${d.source}` : 'Deposit',
          synced: false,
          isDeleted: 0,
          clientUpdatedAt: new Date(),
        });
      }
    }

    // 4. Map & Seed Bank transactions
    if (Array.isArray(seedData.bankTransactions)) {
      for (const b of seedData.bankTransactions) {
        transactions.push({
          localId: `seed_${b.id}`,
          type: b.type === 'deposit' ? 'income' : 'expense',
          amount: Number(b.amount),
          category: 'Banking',
          account: b.account || 'Islamic Bank',
          date: new Date(b.date || '2026-08-16'),
          note: b.note || '',
          synced: false,
          isDeleted: 0,
          clientUpdatedAt: new Date(),
        });
      }
    }

    if (transactions.length > 0) {
      await db.transactions.bulkPut(transactions);
    }

    localStorage.setItem(SEED_FLAG_KEY, 'true');
    console.log(`Successfully seeded ${transactions.length} transactions and ${defaultAccounts.length} accounts!`);
  } catch (err) {
    console.error('Error during initial seed:', err);
  }
}

function categorizeExpense(title) {
  const t = String(title || '').toLowerCase();
  if (t.includes('bus') || t.includes('rickshaw') || t.includes('cng') || t.includes('uber') || t.includes('transport')) return 'Transport';
  if (t.includes('burger') || t.includes('dinner') || t.includes('cha') || t.includes('kichuri') || t.includes('lunch') || t.includes('breakfast') || t.includes('juice') || t.includes('icecream') || t.includes('sprite') || t.includes('sosa') || t.includes('banana')) return 'Food';
  if (t.includes('fexiload') || t.includes('recharge') || t.includes('bill') || t.includes('wifi') || t.includes('coil')) return 'Utilities';
  if (t.includes('saline') || t.includes('medicine') || t.includes('handwash')) return 'Medical';
  if (t.includes('dress') || t.includes('bag') || t.includes('sandel') || t.includes('pen') || t.includes('khata') || t.includes('multiplug') || t.includes('londri') || t.includes('londry')) return 'Shopping';
  if (t.includes('room vara') || t.includes('rent')) return 'Housing';
  return 'Other';
}
