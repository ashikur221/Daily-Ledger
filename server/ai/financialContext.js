const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const Tool = require('../models/Tool');

/**
 * Deterministically compute the user's complete financial profile
 * from verified database records.
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Object>} Clean, deterministic financial metrics and context
 */
async function getUserFinancialContext(userId) {
  const [transactions, accounts, tools] = await Promise.all([
    Transaction.find({ userId, isDeleted: false }).lean(),
    Account.find({ userId, isDeleted: false }).lean(),
    Tool.find({ userId, isDeleted: false }).lean(),
  ]);

  // 1. Filter Transactions (exclude internal banking transfers from cash flow totals)
  const everydayExpenses = transactions.filter(
    (t) => t.type === 'expense' && t.category !== 'Banking'
  );
  const everydayIncome = transactions.filter(
    (t) => t.type === 'income' && t.category !== 'Banking'
  );

  const totalExpense = everydayExpenses.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const totalIncome = everydayIncome.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const netCashFlow = totalIncome - totalExpense;
  const savingsRate = totalIncome > 0 ? Math.max(0, ((netCashFlow / totalIncome) * 100)).toFixed(1) : '0.0';

  // 2. Account Categories
  const liquidAccounts = accounts.filter((a) => a.type !== 'fdr' && a.type !== 'asset');
  const fdrAccounts = accounts.filter((a) => a.type === 'fdr');
  const physicalAssets = accounts.filter((a) => a.type === 'asset');

  const totalLiquid = liquidAccounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  const totalFdr = fdrAccounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  const totalPhysicalAssets = physicalAssets.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  const totalAssets = totalLiquid + totalFdr + totalPhysicalAssets;

  const cashInHandAccount = accounts.find((a) => a.type === 'cash') || null;
  const cashInHand = cashInHandAccount ? Number(cashInHandAccount.balance) || 0 : 0;

  // 3. Debts & Liabilities (from Tool collection)
  const debtRecords = tools.filter((t) => t.toolType === 'debt');
  const repaymentRecords = tools.filter((t) => t.toolType === 'repayment');

  let totalMoneyToReceive = 0; // People owe user
  let totalMoneyToPay = 0;     // User owes people

  debtRecords.forEach((d) => {
    const origAmount = Number(d.data?.amount) || 0;
    const relatedRepayments = repaymentRecords.filter((r) => r.data?.debtId === d.localId);
    const repaid = relatedRepayments.reduce((sum, r) => sum + (Number(r.data?.amount) || 0), 0);
    const remaining = Math.max(0, origAmount - repaid);

    if (d.data?.type === 'owe') {
      totalMoneyToReceive += remaining;
    } else {
      totalMoneyToPay += remaining;
    }
  });

  const totalLiabilities = totalMoneyToPay;
  const netWorth = totalAssets - totalLiabilities;

  // 4. Expense Breakdown by Category
  const categoryMap = {};
  everydayExpenses.forEach((t) => {
    const cat = t.category || 'General';
    categoryMap[cat] = (categoryMap[cat] || 0) + (Number(t.amount) || 0);
  });

  const topCategories = Object.entries(categoryMap)
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: totalExpense > 0 ? ((amount / totalExpense) * 100).toFixed(1) : '0.0',
    }))
    .sort((a, b) => b.amount - a.amount);

  // 5. Recent Transactions (sanitized summary, last 10 entries)
  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime())
    .slice(0, 10)
    .map((t) => ({
      date: t.date ? new Date(t.date).toISOString().split('T')[0] : 'N/A',
      type: t.type,
      category: t.category || 'General',
      amount: Number(t.amount) || 0,
      account: t.account || 'Cash in Hand',
      note: (t.note || '').slice(0, 40), // truncate note for prompt injection safety
    }));

  return {
    metrics: {
      totalIncome,
      totalExpense,
      netCashFlow,
      savingsRate: Number(savingsRate),
      totalLiquid,
      cashInHand,
      totalFdr,
      totalPhysicalAssets,
      totalAssets,
      totalLiabilities,
      totalMoneyToReceive,
      netWorth,
    },
    accounts: accounts.map((a) => ({
      name: a.name,
      type: a.type,
      balance: Number(a.balance) || 0,
      institution: a.institution || '',
    })),
    topCategories,
    recentTransactions,
  };
}

/**
 * Format deterministic metrics into a strict, secure System Instruction for the AI model.
 */
function buildAiSystemInstruction(financialContext, userName = 'User') {
  const m = financialContext.metrics;
  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;

  const categoryBreakdownText = financialContext.topCategories
    .slice(0, 6)
    .map((c) => `- ${c.category}: ${fmt(c.amount)} (${c.percentage}%)`)
    .join('\n');

  const accountsText = financialContext.accounts
    .map((a) => `- ${a.name} (${a.type}): ${fmt(a.balance)}`)
    .join('\n');

  return `You are Ledger AI, the intelligent, security-conscious personal finance advisor built into Daily Ledger.
You are assisting ${userName}.

CRITICAL SYSTEM GUARDRAILS:
1. READ-ONLY MODE: You cannot create, edit, or delete transactions or accounts. You are an advisory intelligence.
2. DETERMINISTIC ACCURACY: All numbers below have been pre-computed by the Daily Ledger backend. NEVER hallucinate or alter any financial figures. Always use the exact numbers provided.
3. CURRENCY: All amounts are in Bangladeshi Taka (৳ / BDT).
4. TONE: Professional, supportive, analytical, concise, and actionable. Use bullet points and bold formatting for clarity.
5. LANGUAGE: Respond in natural, clear Bengali (বাংলা) by default for all explanations, headings, and recommendations, unless the user explicitly asks for English or another language. Keep currency figures formatted clearly with ৳.

VERIFIED FINANCIAL METRICS FOR ${userName.toUpperCase()}:
- Total Inflow / Income Recorded: ${fmt(m.totalIncome)}
- Total Outflow / Expenses Recorded: ${fmt(m.totalExpense)}
- Net Cash Flow: ${fmt(m.netCashFlow)}
- Savings Rate: ${m.savingsRate}%
- Cash in Hand: ${fmt(m.cashInHand)}
- Total Liquid Funds (Banks + MFS + Cash): ${fmt(m.totalLiquid)}
- Fixed Deposits & DPS Schemes: ${fmt(m.totalFdr)}
- Physical Assets (Gold / Deeds): ${fmt(m.totalPhysicalAssets)}
- Total Combined Assets: ${fmt(m.totalAssets)}
- Liabilities / Debts Owed to Others: ${fmt(m.totalLiabilities)}
- Receivables / Money Lent to Others: ${fmt(m.totalMoneyToReceive)}
- Calculated Net Worth: ${fmt(m.netWorth)}

TOP EXPENSE CATEGORIES:
${categoryBreakdownText || 'No expense entries recorded yet.'}

REGISTERED ACCOUNTS & BALANCES:
${accountsText || 'No registered accounts yet.'}

When asked for financial advice or goal planning, ground all feasibility, timeline, and budget recommendations on these exact numbers.`;
}

module.exports = {
  getUserFinancialContext,
  buildAiSystemInstruction,
};
