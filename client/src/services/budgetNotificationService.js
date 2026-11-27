import db from '../db/localDb';

const NOTIF_SETTINGS_KEY = 'daily_ledger_smart_notifs';

export function getNotificationSettings() {
  try {
    const raw = localStorage.getItem(NOTIF_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    enabled: false,
    date: '',
    sentSlots: [],
    lastSentAt: 0,
  };
}

export function saveNotificationSettings(settings) {
  try {
    localStorage.setItem(NOTIF_SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

/**
 * Generates up to 5 personalized, catchy Bangla coaching notifications
 * grounded in the user's real IndexedDB transactions and monthly budget.
 */
export async function buildPersonalizedNotifications() {
  const txs = await db.transactions.where('isDeleted').equals(0).toArray();
  const expenses = txs.filter((t) => t.type === 'expense' && t.category !== 'Banking');
  const incomes = txs.filter((t) => t.type === 'income' && t.category !== 'Banking');

  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();

  let monthExpense = 0;
  let monthIncome = 0;
  const catTotals = {};

  expenses.forEach((e) => {
    const d = new Date(e.date);
    if (isNaN(d.getTime())) return;
    if (d.getFullYear() === curY && d.getMonth() === curM) {
      const amt = Number(e.amount) || 0;
      monthExpense += amt;
      const cat = e.category && e.category !== 'General' ? e.category : 'General';
      catTotals[cat] = (catTotals[cat] || 0) + amt;
    }
  });

  incomes.forEach((i) => {
    const d = new Date(i.date);
    if (isNaN(d.getTime())) return;
    if (d.getFullYear() === curY && d.getMonth() === curM) {
      monthIncome += Number(i.amount) || 0;
    }
  });

  const budget = parseFloat(localStorage.getItem('daily_ledger_monthly_budget') || '12000') || 12000;
  const budgetPct = budget > 0 ? Math.round((monthExpense / budget) * 100) : 0;
  const remainingBudget = Math.max(0, budget - monthExpense);
  const netCash = monthIncome - monthExpense;
  const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;

  const notifications = [
    // Slot 0 (Morning): Income / Earn More Motivation
    monthIncome <= monthExpense
      ? {
          title: '💰 আরও আয় বাড়ানোর সময়!',
          body: `এই মাসে আপনার আয় ${fmt(monthIncome)} আর খরচ ${fmt(monthExpense)}। নতুন কোনো ইনকাম সোর্স বা ফ্রিল্যান্সিং থেকে আজই টাকা অ্যাড করার চেষ্টা করুন!`,
        }
      : {
          title: '🚀 ইনকাম মোমেন্টাম ধরে রাখুন!',
          body: `দারুণ! এই মাসে আপনার নিট সেভিংস ${fmt(netCash)}। আরও একটু চেষ্টা করে আয়ের টার্গেট পরবর্তী লেভেলে নিয়ে যান!`,
        },

    // Slot 1 (Midday): Top Category Trim Alert
    topCat
      ? {
          title: `🔥 ${topCat[0]}-এ খরচ একটু কমান!`,
          body: `এই মাসে সবচেয়ে বেশি ${fmt(topCat[1])} খরচ হয়েছে "${topCat[0]}"-এ। মাত্র ১০% কমালেই ${fmt(Math.round(topCat[1] * 0.1))} অতিরিক্ত সেভ হবে!`,
        }
      : {
          title: '📊 স্মার্ট খরচের শুরু!',
          body: 'আজকের প্রতিটি ছোট খরচ লিখে রাখুন—মাস শেষে কোথায় টাকা বাঁচানো যায় তা সহজেই ধরতে পারবেন!',
        },

    // Slot 2 (Afternoon): Budget Target Pacing
    budgetPct >= 80
      ? {
          title: `⚡ বাজেট অ্যালার্ট (${budgetPct}% শেষ)!`,
          body: `আপনার ${fmt(budget)} মাসিক বাজেটের ${fmt(monthExpense)} খরচ হয়ে গেছে। বাকি ${fmt(remainingBudget)} দিয়ে মাসটা স্মার্টলি শেষ করুন!`,
        }
      : {
          title: `🎯 বাজেট কন্ট্রোলে আছে (${budgetPct}%)`,
          body: `মাসিক বাজেটের আরও ${fmt(remainingBudget)} বাকি! অপ্রয়োজনীয় খরচ এড়িয়ে চললে মাস শেষে বড় সঞ্চয় থাকবে।`,
        },

    // Slot 3 (Evening): Wealth & Growth Nudge
    {
      title: '💎 আজকের টাকা, আগামীর সম্পদ!',
      body: `প্রতিদিনের অপ্রয়োজনীয় খরচ থেকে মাত্র ৳100 বাঁচালে মাসে ৳3,000 জমে! আজই আপনার ইনকাম ও ব্যালেন্স আপডেট করুন।`,
    },

    // Slot 4 (Night): Daily Check-in Streak
    {
      title: '✨ রাতের ফাইনান্স চেক-ইন!',
      body: `আজকের সব আয় ও খরচ Daily Ledger-এ যোগ করেছেন তো? নিয়মিত ট্র্যাকিং মানেই আর্থিক স্বাধীনতা!`,
    },
  ];

  return notifications;
}

/**
 * Displays a notification using ServiceWorkerRegistration (best for Mobile PWA)
 * or fallback Web Notification API.
 */
export async function showNativeNotification({ title, body }) {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const options = {
    body,
    icon: '/app-logo.png',
    badge: '/app-logo.png',
    tag: `daily-ledger-insight-${Date.now()}`,
    renotify: true,
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return true;
      }
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Requests permission and enables 4–5 daily budget insight notifications.
 */
export async function enableSmartNotifications() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    throw new Error('This browser does not support notifications.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was denied.');
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const state = getNotificationSettings();
  saveNotificationSettings({
    ...state,
    enabled: true,
    date: state.date || todayStr,
  });

  // Immediately send a welcome coaching notification
  const list = await buildPersonalizedNotifications();
  await showNativeNotification(list[0]);
  return true;
}

export function disableSmartNotifications() {
  const state = getNotificationSettings();
  saveNotificationSettings({
    ...state,
    enabled: false,
  });
}

/**
 * Checks if a scheduled daily notification slot (9 AM, 1 PM, 4 PM, 7 PM, 9:30 PM)
 * is due and sends at most 1 notification per check (up to 5/day).
 */
export async function checkAndDispatchDailyNotification() {
  const state = getNotificationSettings();
  if (!state.enabled) return false;
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
    return false;
  }

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Reset daily slots on a new day
  let sentSlots = state.date === todayStr && Array.isArray(state.sentSlots) ? [...state.sentSlots] : [];

  // 5 daily coaching slots: 9:00 AM, 1:00 PM, 4:00 PM, 7:00 PM, 9:30 PM
  const slotMinutes = [9 * 60, 13 * 60, 16 * 60, 19 * 60, 21 * 60 + 30];

  // Prevent firing multiple notifications within 45 minutes of each other
  if (Date.now() - (state.lastSentAt || 0) < 45 * 60 * 1000) {
    return false;
  }

  const dueSlotIndex = slotMinutes.findIndex(
    (mins, idx) => currentMinutes >= mins && !sentSlots.includes(idx)
  );

  if (dueSlotIndex === -1) return false;

  const list = await buildPersonalizedNotifications();
  const payload = list[dueSlotIndex % list.length];
  const ok = await showNativeNotification(payload);

  if (ok) {
    sentSlots.push(dueSlotIndex);
    saveNotificationSettings({
      enabled: true,
      date: todayStr,
      sentSlots,
      lastSentAt: Date.now(),
    });
  }
  return ok;
}
