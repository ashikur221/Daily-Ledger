import React, { useState, useEffect, useMemo } from 'react';
import db from '../db/localDb';
import { queueSync } from '../services/syncService';
import { useToast } from '../context/ToastContext';

const INSIGHT_CATEGORIES = [
  'Food & drinks',
  'Transport',
  'Phone & communication',
  'Health',
  'Personal care',
  'Clothing',
  'Study & supplies',
  'Housing',
  'Laundry & household',
  'Other',
  'Uncategorized',
];

function suggestedCategory(title) {
  const t = String(title || '').toLowerCase();
  if (
    /dinner|lunch|breakfast|burger|kichuri|cocacola|coca cola|juice|cha|tea|sosa|food|meal|meatbox|rice|snack|water|coffee|biscuit|fuchka|singara|paratha/.test(
      t
    )
  )
    return 'Food & drinks';
  if (/bus|rickshaw|cng|transport|ticket|train|launch|fare|fuel|petrol/.test(t))
    return 'Transport';
  if (/recharge|fexiload|mobile|internet|data pack|sim/.test(t))
    return 'Phone & communication';
  if (/medicine|saline|doctor|hospital|medical|tablet|health/.test(t))
    return 'Health';
  if (
    /spray|handwash|soap|shampoo|toothpaste|nailcutter|comb|cream|lotion|perfume|sandel|sandal|haircut|salon|vwash|coil/.test(
      t
    )
  )
    return 'Personal care';
  if (/dress|shirt|pant|trouser|shoe|sandal|cloth|t-shirt|jeans/.test(t))
    return 'Clothing';
  if (/khata|pen|book|paper|exam|print|photocopy|education|training/.test(t))
    return 'Study & supplies';
  if (/room vara|rent|house rent|hostel/.test(t)) return 'Housing';
  if (/laundry|londri|multiplug|charger|bag|bucket|plate|utensil|household|clean/.test(t))
    return 'Laundry & household';
  if (!t || /jani na|unknown|misc/.test(t)) return 'Uncategorized';
  return 'Other';
}

export default function ReportsPage() {
  const toast = useToast();
  const [expenses, setExpenses] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [categoryOverrides, setCategoryOverrides] = useState({});
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [monthlyBudget, setMonthlyBudget] = useState(
    () => localStorage.getItem('daily_ledger_monthly_budget') || '12000'
  );
  const [budgetValue, setBudgetValue] = useState(
    () => localStorage.getItem('daily_ledger_monthly_budget') || '12000'
  );
  const [advisorPrompt, setAdvisorPrompt] = useState('summary');
  const [advisorQuestion, setAdvisorQuestion] = useState('');
  const [advisorAnswer, setAdvisorAnswer] = useState(
    'Choose a question and tap "Ask advisor" to get a personalized answer.'
  );

  useEffect(() => {
    loadData();
    const savedOverrides = localStorage.getItem('daily_ledger_cat_overrides');
    if (savedOverrides) {
      try {
        setCategoryOverrides(JSON.parse(savedOverrides));
      } catch {}
    }
  }, []);

  const loadData = async () => {
    const txs = await db.transactions.where('isDeleted').equals(0).toArray();
    setExpenses(txs.filter((t) => t.type === 'expense' && t.category !== 'Banking'));
    setDeposits(txs.filter((t) => t.type === 'income' && t.category !== 'Banking'));
  };

  const getCategory = (e) => {
    // 1. If explicit category exists on the transaction, respect it first
    if (e.category && e.category !== 'General' && e.category !== 'Deposit / Allowance') {
      return e.category;
    }
    const id = e.localId || e.id || e._id;
    if (categoryOverrides[id]) {
      return categoryOverrides[id];
    }
    return suggestedCategory(e.note || e.title);
  };

  const handleCategoryChange = async (id, newCat) => {
    const updated = { ...categoryOverrides, [id]: newCat };
    setCategoryOverrides(updated);
    localStorage.setItem('daily_ledger_cat_overrides', JSON.stringify(updated));

    // Also persist directly into IndexedDB and cloud sync queue
    try {
      await db.transactions.update(id, { category: newCat, synced: false, clientUpdatedAt: new Date() });
      await queueSync('transactions', id, 'update', { localId: id, category: newCat });
      window.dispatchEvent(new CustomEvent('daily_ledger:data_updated'));
    } catch {}
  };

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;

  const itemizedTotal = useMemo(() => {
    return expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  }, [expenses]);

  const daysMap = useMemo(() => {
    const map = {};
    expenses.forEach((e) => {
      const d = e.date ? new Date(e.date).toISOString().split('T')[0] : '';
      if (d) {
        map[d] = (map[d] || 0) + (Number(e.amount) || 0);
      }
    });
    return map;
  }, [expenses]);

  const daysCount = Object.keys(daysMap).length;
  const avgPerDay = daysCount > 0 ? (itemizedTotal / daysCount).toFixed(2) : '0';

  const highestSpend = useMemo(() => {
    let topDay = '';
    let topAmt = 0;
    Object.entries(daysMap).forEach(([date, amt]) => {
      if (amt > topAmt) {
        topAmt = amt;
        topDay = date;
      }
    });
    return { date: topDay, amount: topAmt };
  }, [daysMap]);

  const { currentMonthLabel, currentMonthSpend, previousMonthLabel, previousMonthSpend } = useMemo(() => {
    const todayISO = new Date().toISOString().split('T')[0];
    const curMonthKey = todayISO.slice(0, 7);
    const curDateObj = new Date(`${curMonthKey}-15T12:00:00`);
    const prevDateObj = new Date(curDateObj.getFullYear(), curDateObj.getMonth() - 1, 15, 12, 0, 0);
    const prevMonthKey = `${prevDateObj.getFullYear()}-${String(prevDateObj.getMonth() + 1).padStart(2, '0')}`;

    const curSpend = expenses
      .filter((e) => e.date && new Date(e.date).toISOString().slice(0, 7) === curMonthKey)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);

    const prevSpend = expenses
      .filter((e) => e.date && new Date(e.date).toISOString().slice(0, 7) === prevMonthKey)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);

    return {
      currentMonthLabel: curDateObj.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      currentMonthSpend: curSpend,
      previousMonthLabel: prevDateObj.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      previousMonthSpend: prevSpend,
    };
  }, [expenses]);

  const categoryStats = useMemo(() => {
    const map = {};
    INSIGHT_CATEGORIES.forEach((c) => (map[c] = 0));
    expenses.forEach((e) => {
      const c = getCategory(e);
      map[c] = (map[c] || 0) + (Number(e.amount) || 0);
    });
    return Object.entries(map)
      .map(([name, amount]) => ({
        name,
        amount,
        pct: itemizedTotal > 0 ? Math.round((amount / itemizedTotal) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, categoryOverrides, itemizedTotal]);

  const repeatedExpenses = useMemo(() => {
    const sums = {};
    const counts = {};
    expenses.forEach((e) => {
      const key = String(e.note || e.title || 'Untitled').trim();
      if (!key) return;
      sums[key] = (sums[key] || 0) + (Number(e.amount) || 0);
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.keys(sums)
      .filter((k) => counts[k] >= 2)
      .map((k) => ({ title: k, count: counts[k], amount: sums[k] }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [expenses]);

  const savingIdeas = useMemo(() => {
    const food = categoryStats.find((c) => c.name === 'Food & drinks')?.amount || 0;
    const small = expenses
      .filter((e) => Number(e.amount) > 0 && Number(e.amount) <= 100)
      .reduce((s, e) => s + Number(e.amount), 0);
    const unclearCount = expenses.filter((e) => getCategory(e) === 'Uncategorized').length;

    const list = [];
    if (food > 0) {
      list.push(
        `Food & drinks total ${fmt(food)}. Try planning meals and setting a weekly food limit; even a 10% reduction would save about ${fmt(
          Math.round(food * 0.1)
        )} over this recorded period.`
      );
    }
    if (small > 0) {
      list.push(
        `Entries of ৳100 or less add up to ${fmt(small)}. Review which small purchases were optional before trying to cut them.`
      );
    }
    if (highestSpend.amount > 0) {
      const dLabel = highestSpend.date
        ? new Date(highestSpend.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Unknown date';
      list.push(
        `${dLabel} is the highest recorded day at ${fmt(
          highestSpend.amount
        )}. It may include one-off costs, so check the individual entries before treating it as a spending habit.`
      );
    }
    if (unclearCount > 0) {
      list.push(
        `${unclearCount} entry/entries need clearer titles or category review. In particular, clear up vague descriptions so future insights are more useful.`
      );
    }
    return list;
  }, [categoryStats, expenses, highestSpend]);

  const handleAskAdvisor = () => {
    const q = (advisorQuestion.trim() || advisorPrompt).toLowerCase();
    const totalDeposits = deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const remaining = totalDeposits - itemizedTotal;
    const topCat = categoryStats[0];
    const b = Number(monthlyBudget) || 0;

    let ans = '';
    if (q === 'balance' || /balance|money left|taka left|tk left|koto taka baki|remaining/.test(q)) {
      ans = `আপনার রেকর্ড করা মোট টাকা এসেছে ${fmt(totalDeposits)} এবং itemized খরচ ${fmt(
        itemizedTotal
      )}। হিসাব অনুযায়ী বাকি ${fmt(remaining)}। এটি শুধু ledger-এর হিসাব; বাস্তব cash/bank balance আলাদা হতে পারে।`;
    } else if (q === 'whatif' || /50|daily|per day|protidin|প্রতিদিন/.test(q)) {
      ans = `প্রতিদিন ৳৫০ কম খরচ করে জমাতে পারলে ৩০ দিনে ${fmt(1500)} এবং ৩৬৫ দিনে ${fmt(
        18250
      )} সেভ হবে। এটি একটি পরিকল্পনার হিসাব; ledger-এর কোনো entry বদলানো হয়নি।`;
    } else if (q === 'food' || /food|khabar|খাবার|meal/.test(q)) {
      const foodAmt = categoryStats.find((c) => c.name === 'Food & drinks')?.amount || 0;
      const foodPct = itemizedTotal ? Math.round((foodAmt / itemizedTotal) * 100) : 0;
      ans = `আপনার রেকর্ডে Food & drinks খরচ ${fmt(foodAmt)} (${foodPct}% মোট খরচের)। আগামী ৭ দিন খাবারের জন্য ছোট একটি সীমা ঠিক করুন এবং চা/স্ন্যাকসের মতো optional খরচ নোট করুন। এই ক্যাটাগরিতে ১০% কমাতে পারলে এই recorded period-এ প্রায় ${fmt(
        Math.round(foodAmt * 0.1)
      )} বাঁচতে পারে।`;
    } else if (q === 'small' || /small|choto|ছোট|100|one hundred/.test(q)) {
      const smallAmt = expenses
        .filter((e) => Number(e.amount) > 0 && Number(e.amount) <= 100)
        .reduce((s, e) => s + Number(e.amount), 0);
      ans = `৳১০০ বা তার কমের entry-গুলো মিলিয়ে ${fmt(smallAmt)}। সবটাই অপচয় নয়—দরকারি আর ঐচ্ছিক খরচ আলাদা করে দেখুন। ঐচ্ছিক ছোট খরচের ১০% কমাতে পারলে আনুমানিক ${fmt(
        Math.round(smallAmt * 0.1)
      )} বাঁচতে পারে।`;
    } else if (q === 'budget' || /budget|monthly|masik|মাসিক|মাসের বাজেট/.test(q)) {
      ans = `সাম্প্রতিক রেকর্ড থাকা মাস (${currentMonthLabel})-এ খরচ ${fmt(currentMonthSpend)}। ${
        b
          ? `আপনার monthly target ${fmt(b)}। ${
              currentMonthSpend > b
                ? `এখন পর্যন্ত target-এর চেয়ে ${fmt(currentMonthSpend - b)} বেশি খরচ রেকর্ড হয়েছে।`
                : `এখন পর্যন্ত target-এর ${fmt(b - currentMonthSpend)} বাকি আছে।`
            }`
          : 'Monthly target সেট করা নেই। আগের পূর্ণ মাসের খরচ দেখে জরুরি খরচ ও সামান্য সেভিংসের জায়গা রেখে target দিন।'
      } রেকর্ড অসম্পূর্ণ হলে এই তুলনা পুরো মাসের চিত্র নাও দেখাতে পারে।`;
    } else if (q === 'save' || /save|saving|bach|bacha|কম খরচ|সেভ|জমাব|taka|ses|khoroch|spend|why|keno/.test(q)) {
      ans = `টাকা বাঁচাতে শুরু করুন: 1. ${topCat?.name || 'খাবার'} সবচেয়ে বড় ক্যাটাগরি (${fmt(
        topCat?.amount || 0
      )}); এখানে ১০% কমানোর উপায় দেখুন। 2. ৳১০০ বা কমের ছোট খরচে শুধু ঐচ্ছিক অংশ কমান। 3. বারবার হওয়া খরচের frequency কমান। তথ্য ছাড়া কোনো খরচকে অপচয় বলা হচ্ছে না।`;
    } else {
      ans = `আপনার ledger summary: মোট খরচ ${fmt(itemizedTotal)}, গড়ে ${fmt(avgPerDay)} প্রতি recorded spending day, হিসাব অনুযায়ী বাকি ${fmt(
        remaining
      )}। সবচেয়ে বড় ক্যাটাগরি ${topCat?.name || '—'}: ${fmt(topCat?.amount || 0)} (${topCat?.pct || 0}%)। পরের পদক্ষেপ: অস্পষ্ট entry-গুলো পরিষ্কার করুন এবং বড় ক্যাটাগরিতে বাস্তবসম্মত সীমা ঠিক করুন।`;
    }
    setAdvisorAnswer(ans);
  };

  const handleSaveBudget = (e) => {
    e.preventDefault();
    const num = Number(budgetValue);
    if (!Number.isFinite(num) || num < 0) return;
    setMonthlyBudget(budgetValue);
    localStorage.setItem('daily_ledger_monthly_budget', budgetValue);
    setShowBudgetModal(false);
    toast.success('Monthly budget target updated!');
  };

  const budgetNum = Number(monthlyBudget) || 0;

  /* ─── Styles ─── */
  const sectionGap = { display: 'flex', flexDirection: 'column', gap: '20px' };
  const panelStyle = {
    background: '#050608',
    border: '1px solid #1a202c',
    borderRadius: '14px',
    padding: '20px 22px',
  };
  const headingStyle = { fontWeight: 700, color: '#f1f5f9', fontSize: '1rem', margin: 0 };
  const subTextStyle = { fontSize: '0.82rem', color: '#94a3b8', marginTop: '5px', lineHeight: 1.5 };
  const tinyLabelStyle = {
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontWeight: 700,
    color: '#94a3b8',
  };
  const metricBoxStyle = {
    ...panelStyle,
    padding: '18px 20px',
    flex: 1,
    minWidth: 0,
  };
  const metricValStyle = { fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc', marginTop: '8px' };
  const metricSubStyle = { fontSize: '0.75rem', color: '#64748b', marginTop: '4px' };
  const compCardStyle = {
    background: '#0d1117',
    border: '1px solid #232a3b',
    borderRadius: '12px',
    padding: '14px 18px',
    flex: 1,
    minWidth: 0,
  };
  const catRowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    fontSize: '0.88rem',
    marginBottom: '4px',
  };
  const barTrackStyle = {
    height: '7px',
    borderRadius: '999px',
    background: '#151b23',
    overflow: 'hidden',
  };
  const barFillStyle = (pct) => ({
    height: '100%',
    borderRadius: '999px',
    background: '#334155',
    width: `${Math.max(pct, 1)}%`,
    transition: 'width 0.3s ease',
  });
  const repeatRowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid #151b23',
  };
  const ideaCardStyle = {
    background: '#0d1117',
    border: '1px solid #232a3b',
    borderRadius: '12px',
    padding: '14px 18px',
    fontSize: '0.85rem',
    lineHeight: 1.6,
    color: '#cbd5e1',
  };
  const fieldStyle = {
    width: '100%',
    height: '44px',
    padding: '0 14px',
    background: '#090c12',
    border: '1px solid #232a3b',
    borderRadius: '10px',
    color: '#f8fafc',
    fontSize: '0.88rem',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  };
  const primaryBtnStyle = {
    height: '44px',
    padding: '0 20px',
    background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 50%, #06b6d4 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    fontWeight: 600,
    fontSize: '0.88rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
  const badgeStyle = {
    borderRadius: '999px',
    background: '#151b23',
    border: '1px solid #303946',
    color: '#cbd5e1',
    fontSize: '0.72rem',
    fontWeight: 600,
    padding: '4px 12px',
  };

  return (
    <div style={sectionGap}>
      {/* 1. Header */}
      <div>
        <h2 style={{ ...headingStyle, fontSize: '1.2rem' }}>Spending insights</h2>
        <p style={subTextStyle}>
          Find patterns from your recorded itemized expenses. Categories are suggestions and can be corrected.
        </p>
      </div>

      {/* 2. Top 3-Box Metrics (Responsive CSS Grid: 1 col on mobile, 3 cols on desktop) */}
      <div className="insights-metrics-grid">
        <div className="insights-metric-card">
          <div className="tiny-label">Itemized spending</div>
          <div className="metric-val">{fmt(itemizedTotal)}</div>
          <p className="metric-sub">{daysCount} days with itemized expenses</p>
        </div>

        <div className="insights-metric-card">
          <div className="tiny-label">Average per recorded day</div>
          <div className="metric-val">৳{avgPerDay}</div>
          <p className="metric-sub">Days with itemized expenses</p>
        </div>

        <div className="insights-metric-card">
          <div className="tiny-label">Highest-spend day</div>
          <div className="metric-val">
            {highestSpend.amount > 0 ? fmt(highestSpend.amount) : '—'}
          </div>
          <p className="metric-sub">
            {highestSpend.date
              ? new Date(highestSpend.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
              : 'No recorded day yet'}
          </p>
        </div>
      </div>

      {/* 3. Monthly Spending Comparison */}
      <div style={panelStyle}>
        <h3 style={headingStyle}>Monthly spending comparison</h3>
        <p style={{ ...subTextStyle, marginBottom: '16px' }}>
          Current calendar month compared with the previous month, using itemized expenses only.
        </p>

        <div className="insights-comp-grid">
          <div className="insights-comp-card">
            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{currentMonthLabel}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f1f5f9', marginTop: '8px' }}>
              {fmt(currentMonthSpend)}
            </div>
          </div>
          <div className="insights-comp-card">
            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{previousMonthLabel}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f1f5f9', marginTop: '8px' }}>
              {fmt(previousMonthSpend)}
            </div>
          </div>
        </div>

        <p style={{ fontSize: '0.82rem', marginTop: '14px', color: '#94a3b8', lineHeight: 1.5 }}>
          {previousMonthSpend === 0
            ? 'No itemized expenses recorded for the previous month, so a percentage comparison is not available.'
            : currentMonthSpend > previousMonthSpend
            ? `Current month is ${fmt(
                currentMonthSpend - previousMonthSpend
              )} higher than the previous month so far. This is a partial-month comparison, not a full-month forecast.`
            : currentMonthSpend < previousMonthSpend
            ? `Current month is ${fmt(
                previousMonthSpend - currentMonthSpend
              )} lower than the previous month. Since the current month is still in progress, compare again at month-end.`
            : 'Recorded spending is equal in both months; the current month may still be incomplete.'}
        </p>
      </div>

      {/* 4. Spending by Category */}
      <div style={panelStyle}>
        <h3 style={headingStyle}>Spending by category</h3>
        <p style={{ ...subTextStyle, marginBottom: '18px' }}>
          Change any category below if the automatic suggestion is wrong. Your original title and amount stay unchanged.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {categoryStats.map((c) => (
            <div key={c.name}>
              <div style={catRowStyle}>
                <span style={{ fontWeight: 500, color: '#e2e8f0' }}>{c.name}</span>
                <strong style={{ color: '#f1f5f9', whiteSpace: 'nowrap' }}>
                  {fmt(c.amount)}{' '}
                  <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#94a3b8' }}>{c.pct}%</span>
                </strong>
              </div>
              <div style={barTrackStyle}>
                <div style={barFillStyle(c.pct)} />
              </div>
            </div>
          ))}
        </div>

        {/* Accordion: Review categories for each expense */}
        <details style={{ marginTop: '20px' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, color: '#cbd5e1' }}>
            ▸ Review categories for each expense
          </summary>
          <div style={{ marginTop: '12px', maxHeight: '384px', overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {expenses.map((e) => {
              const curCat = getCategory(e);
              return (
                <div
                  key={e.localId || e._id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 4px',
                    borderBottom: '1px solid rgba(30,41,59,0.4)',
                    fontSize: '0.85rem',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 500, color: '#e2e8f0' }}>{e.note || e.title}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {e.date ? new Date(e.date).toISOString().split('T')[0] : 'No date'} · {fmt(e.amount)}
                    </div>
                  </div>
                  <select
                    style={{
                      ...fieldStyle,
                      width: 'auto',
                      maxWidth: '12rem',
                      height: '32px',
                      fontSize: '0.75rem',
                      padding: '0 10px',
                    }}
                    value={curCat}
                    onChange={(ev) => handleCategoryChange(e.localId || e._id, ev.target.value)}
                  >
                    {INSIGHT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </details>
      </div>

      {/* 5. Repeated Expenses */}
      <div style={panelStyle}>
        <h3 style={headingStyle}>Repeated expenses</h3>
        <p style={{ ...subTextStyle, marginBottom: '12px' }}>
          Frequent items are not automatically wasteful; use this list to decide what you can reasonably reduce.
        </p>

        <div>
          {repeatedExpenses.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: '#64748b', padding: '12px 0' }}>No repeated items yet.</p>
          ) : (
            repeatedExpenses.map((r, i) => (
              <div
                key={r.title}
                style={{
                  ...repeatRowStyle,
                  borderBottom: i === repeatedExpenses.length - 1 ? 'none' : repeatRowStyle.borderBottom,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '0.9rem' }}>{r.title}</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>{r.count} entries</div>
                </div>
                <strong style={{ color: '#f1f5f9', fontSize: '0.9rem', fontWeight: 600 }}>{fmt(r.amount)}</strong>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 6. Possible Saving Opportunities */}
      <div style={panelStyle}>
        <h3 style={headingStyle}>Possible saving opportunities</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
          {savingIdeas.map((idea, idx) => (
            <div key={idx} style={ideaCardStyle}>
              {idea}
            </div>
          ))}
        </div>
      </div>

      {/* 7. Smart Financial Advisor */}
      <div style={{ ...panelStyle, border: '1px solid #334155' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={tinyLabelStyle}>FREE · NO API KEY</div>
            <h3 style={{ ...headingStyle, fontSize: '1.1rem', marginTop: '4px' }}>Smart Financial Advisor</h3>
            <p style={subTextStyle}>
              Ask about your spending, savings, or budget. Answers use your ledger data on this device.
            </p>
          </div>
          <span style={badgeStyle}>Private · Local</span>
        </div>

        <div style={{ marginTop: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <select
            id="advisorPrompt"
            value={advisorPrompt}
            onChange={(e) => setAdvisorPrompt(e.target.value)}
            style={{ ...fieldStyle, flex: 1, minWidth: '200px' }}
          >
            <option value="summary">Give me a financial summary</option>
            <option value="save">How can I save more money?</option>
            <option value="food">Am I spending too much on food?</option>
            <option value="small">Are small expenses adding up?</option>
            <option value="balance">How much money is left?</option>
            <option value="whatif">If I save ৳50 per day, how much will I save?</option>
            <option value="budget">Help me set a monthly budget</option>
          </select>
          <button
            type="button"
            onClick={handleAskAdvisor}
            style={primaryBtnStyle}
          >
            Ask advisor
          </button>
        </div>

        <div style={{ marginTop: '14px' }}>
          <label
            htmlFor="advisorQuestion"
            style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '8px', color: '#cbd5e1' }}
          >
            Or ask your own question
          </label>
          <input
            id="advisorQuestion"
            value={advisorQuestion}
            onChange={(e) => setAdvisorQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAskAdvisor();
              }
            }}
            style={fieldStyle}
            placeholder="e.g. Amar taka eto taratari sesh hoy keno?"
          />
        </div>

        <div
          style={{
            ...ideaCardStyle,
            marginTop: '16px',
          }}
          aria-live="polite"
        >
          {advisorAnswer}
        </div>

        <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '14px', lineHeight: 1.5 }}>
          This is a free, rule-based advisor—not a generative AI chatbot. It does not send your financial data anywhere. Unclear expense names can limit accuracy.
        </p>
      </div>

      {/* 8. Monthly Spending Target (Budget) */}
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
          <div>
            <h3 style={{ ...headingStyle, marginBottom: '4px' }}>Monthly Spending Target</h3>
            <p style={{ ...subTextStyle, marginBottom: 0 }}>
              Optional planning target. It does not alter your entries or account balances.
            </p>
          </div>
          <button
            type="button"
            style={primaryBtnStyle}
            onClick={() => {
              setBudgetValue(monthlyBudget || '');
              setShowBudgetModal(true);
            }}
          >
            {budgetNum ? '✏️ Edit Target' : '🎯 Set Target'}
          </button>
        </div>

        <div style={{ 
          background: '#050608', 
          border: '1px solid #1a202c', 
          borderRadius: '12px', 
          padding: '16px 20px', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '12px' 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Target Limit:</span>
              <span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', marginLeft: '8px' }}>{budgetNum ? fmt(budgetNum) : 'None'}</span>
            </div>
            <div>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Spent This Month:</span>
              <span style={{ fontSize: '1.2rem', fontWeight: 700, color: currentMonthSpend > budgetNum && budgetNum > 0 ? '#fb7185' : '#38bdf8', marginLeft: '8px' }}>
                {fmt(currentMonthSpend)}
              </span>
            </div>
          </div>

          {budgetNum > 0 && (
            <div>
              <div style={{ height: '8px', background: '#0d131f', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: '4px',
                    background: currentMonthSpend > budgetNum ? '#f43f5e' : 'linear-gradient(90deg, #3b82f6, #06b6d4)',
                    width: `${Math.min(100, Math.round((currentMonthSpend / budgetNum) * 100))}%`,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginTop: '6px', color: '#94a3b8' }}>
                <span>{Math.round((currentMonthSpend / budgetNum) * 100)}% consumed</span>
                <span>
                  {currentMonthSpend > budgetNum
                    ? `Exceeded by ${fmt(currentMonthSpend - budgetNum)}`
                    : `Remaining: ${fmt(budgetNum - currentMonthSpend)}`}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <p style={{ fontSize: '0.72rem', color: '#94a3b8', textAlign: 'center', paddingBottom: '16px', lineHeight: 1.5 }}>
        Important: this analysis uses only entries in this ledger. Unclear titles may be placed in "Uncategorized"; review them before making decisions.
      </p>

      {/* Modal: Set Monthly Spending Target */}
      {showBudgetModal && (
        <div className="modal-overlay" onClick={() => setShowBudgetModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px', background: '#0b0f17', border: '1px solid #232a3b' }}>
            <h2 className="modal-title" style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc' }}>
              🎯 Set Monthly Budget Target
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.82rem', marginTop: '4px', marginBottom: '16px', lineHeight: 1.5 }}>
              Set a monthly spending limit to monitor your cash burn rate. It helps alert you when expenses approach or exceed your target.
            </p>

            <form onSubmit={handleSaveBudget} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="monthlyBudget">Target Amount (৳)</label>
                <input
                  id="monthlyBudget"
                  type="number"
                  min="0"
                  step="100"
                  style={{ ...fieldStyle, width: '100%' }}
                  placeholder="e.g. 15000"
                  value={budgetValue}
                  onChange={(e) => setBudgetValue(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
                <button
                  type="button"
                  className="secondary flex-1"
                  onClick={() => setShowBudgetModal(false)}
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
                  Save Target
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
