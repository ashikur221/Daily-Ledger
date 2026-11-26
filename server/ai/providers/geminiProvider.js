const BaseAiProvider = require('./baseProvider');

class GeminiProvider extends BaseAiProvider {
  constructor() {
    super('gemini');
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    this.maxTokens = parseInt(process.env.AI_MAX_TOKENS || '1024', 10);
    this.temperature = parseFloat(process.env.AI_TEMPERATURE || '0.3');
  }

  async generateResponse({ prompt, systemInstruction, history = [], financialContext = null }) {
    if (!this.apiKey) {
      const fallbackContent = this.generateDeterministicFallback(prompt, financialContext);
      return {
        content: fallbackContent,
        provider: 'ledger-deterministic-engine',
        isFallback: true,
      };
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    // Format chat history for Gemini API format (role: 'user' | 'model')
    const contents = [];

    // Prior conversation history (up to last 10 messages for token economy)
    const recentHistory = history.slice(-10);
    for (const msg of recentHistory) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(msg.content) }],
      });
    }

    // Current user prompt
    contents.push({
      role: 'user',
      parts: [{ text: String(prompt) }],
    });

    const requestBody = {
      contents,
      systemInstruction: systemInstruction
        ? { parts: [{ text: systemInstruction }] }
        : undefined,
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens,
        topP: 0.8,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ],
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 429) {
          return {
            content:
              "⚠️ **Gemini Free Tier Quota Exceeded**\n\n" +
              "The free-tier rate limit for the Gemini API was temporarily reached. Please wait a minute and try again. Your ledger data remains safe.",
            provider: 'gemini',
            isFallback: true,
          };
        }
        console.error('Gemini API Error:', response.status, errorText);
        return {
          content: `⚠️ **AI Service Notice**: Received error status ${response.status} from Gemini API. Please verify your GEMINI_API_KEY in server/.env.`,
          provider: 'gemini',
          isFallback: true,
        };
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const replyText = candidate?.content?.parts?.[0]?.text || 'No response generated.';

      return {
        content: replyText,
        provider: 'gemini',
        usage: data.usageMetadata,
      };
    } catch (err) {
      console.error('Gemini request failed:', err);
      if (err.name === 'AbortError') {
        return {
          content: '⚠️ **Request Timeout**: The Gemini API did not respond within 20 seconds. Please check your network connection and retry.',
          provider: 'gemini',
          isFallback: true,
        };
      }
      return {
        content: `⚠️ **Connection Notice**: Unable to contact Gemini API (${err.message}). Your ledger records and reports remain fully accessible offline.`,
        provider: 'gemini',
        isFallback: true,
      };
    }
  }

  generateDeterministicFallback(prompt, context) {
    if (!context || !context.metrics) {
      return (
        "📊 **Ledger Financial Summary**\n\n" +
        "Your financial records are being synchronized. Once you log income and expenses, Ledger AI will provide complete deterministic analytics.\n\n" +
        "*Tip: You can optionally add a free `GEMINI_API_KEY` in `server/.env` to enable natural conversational explanations.*"
      );
    }

    const m = context.metrics;
    const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;
    const p = (prompt || '').toLowerCase();

    // 1. Spending / Expense Analysis
    if (p.includes('spend') || p.includes('expense') || p.includes('category') || p.includes('cut cost')) {
      const catList = (context.topCategories || [])
        .slice(0, 5)
        .map((c, i) => `${i + 1}. **${c.category}**: ${fmt(c.amount)} (${c.percentage}%)`)
        .join('\n');

      return (
        `📊 **Deterministic Spending Analysis**\n\n` +
        `• **Total Outflow Logged**: ${fmt(m.totalExpense)}\n` +
        `• **Total Inflow Logged**: ${fmt(m.totalIncome)}\n` +
        `• **Net Cash Flow**: ${m.netCashFlow >= 0 ? '+' : ''}${fmt(m.netCashFlow)}\n\n` +
        `**Top Spending Categories**:\n${catList || 'No categorized expenses found.'}\n\n` +
        `💡 **Recommendation**: ${(context.topCategories && context.topCategories[0]) ? `Your highest outflow is in **${context.topCategories[0].category}** (${context.topCategories[0].percentage}% of total spending). Target reducing this category by 10–15% to increase monthly free cash flow.` : 'Keep logging your daily expenses to see category breakdowns.'}\n\n` +
        `*(Calculated live from your verified ledger data. For natural conversational chat, you can add a free Google Gemini key anytime in server/.env)*`
      );
    }

    // 2. Emergency Fund / Buffer
    if (p.includes('emergency') || p.includes('fund') || p.includes('buffer')) {
      const monthlyExpEst = Math.max(5000, m.totalExpense > 0 ? Math.round(m.totalExpense / 3) : 10000);
      const target3Mo = monthlyExpEst * 3;
      const target6Mo = monthlyExpEst * 6;
      const liquidFunds = m.totalLiquid || 0;
      const coveragePercent = target3Mo > 0 ? Math.min(100, Math.round((liquidFunds / target3Mo) * 100)) : 0;

      return (
        `🛡️ **Emergency Reserve Assessment**\n\n` +
        `• **Estimated Monthly Basic Outflow**: ~${fmt(monthlyExpEst)}/month\n` +
        `• **Recommended 3-Month Safety Target**: ${fmt(target3Mo)}\n` +
        `• **Recommended 6-Month Full Target**: ${fmt(target6Mo)}\n` +
        `• **Current Available Liquid Capital**: ${fmt(liquidFunds)}\n` +
        `• **3-Month Target Coverage**: **${coveragePercent}% funded**\n\n` +
        `💡 **Strategy**: ${liquidFunds >= target3Mo ? `You have adequate liquid cash to cover at least 3 months of baseline living costs. Any extra surplus can safely be channeled into fixed deposits, DPS, or investments.` : `You have a gap of ${fmt(target3Mo - liquidFunds)} to achieve a 3-month safety cushion. Prioritize building this reserve before committing to large non-essential purchases.`}\n\n` +
        `*(Calculated live from your verified ledger data. For natural conversational chat, you can add a free Google Gemini key anytime in server/.env)*`
      );
    }

    // 3. Savings Rate / Cash Flow
    if (p.includes('savings') || p.includes('rate') || p.includes('surplus') || p.includes('cash flow')) {
      return (
        `💰 **Savings Rate & Cash Flow Profile**\n\n` +
        `• **Total Inflow Recorded**: ${fmt(m.totalIncome)}\n` +
        `• **Total Outflow Recorded**: ${fmt(m.totalExpense)}\n` +
        `• **Net Cash Flow Surplus**: ${fmt(m.netCashFlow)}\n` +
        `• **Current Savings Rate**: **${m.savingsRate}%**\n` +
        `• **Cash in Hand**: ${fmt(m.cashInHand)}\n` +
        `• **Total Liquid Balances**: ${fmt(m.totalLiquid)}\n\n` +
        `💡 **Guidance**: ${m.savingsRate >= 20 ? 'Your savings rate is above the recommended 20% benchmark. Maintain this habit to achieve compound financial security.' : 'Aim to bring your monthly savings rate to at least 20% by reviewing recurring utility, communication, and discretionary spending.'}\n\n` +
        `*(Calculated live from your verified ledger data. For natural conversational chat, you can add a free Google Gemini key anytime in server/.env)*`
      );
    }

    // 4. Net Worth / Assets / Liabilities
    if (p.includes('net worth') || p.includes('asset') || p.includes('debt') || p.includes('owe') || p.includes('liability')) {
      return (
        `🏛️ **Net Worth & Balance Sheet**\n\n` +
        `• **Liquid Capital (Cash + MFS + Banks)**: ${fmt(m.totalLiquid)}\n` +
        `• **Fixed Deposits & DPS Schemes**: ${fmt(m.totalFdr)}\n` +
        `• **Physical Assets (Gold & Land)**: ${fmt(m.totalPhysicalAssets)}\n` +
        `• **Total Combined Assets**: **${fmt(m.totalAssets)}**\n` +
        `• **Total Liabilities (Money You Owe)**: −${fmt(m.totalLiabilities)}\n` +
        `• **Receivables (Money Owed to You)**: +${fmt(m.totalMoneyToReceive)}\n\n` +
        `⭐ **Calculated Net Worth**: **${fmt(m.netWorth)}**\n\n` +
        `💡 **Insight**: ${m.totalLiabilities > 0 ? `Focus on clearing the remaining ${fmt(m.totalLiabilities)} in personal debts to immediately increase your net position.` : 'You have zero recorded borrowed liabilities. Your asset foundation is unencumbered.'}\n\n` +
        `*(Calculated live from your verified ledger data. For natural conversational chat, you can add a free Google Gemini key anytime in server/.env)*`
      );
    }

    // 5. Default General Overview
    return (
      `✨ **Executive Financial Intelligence**\n\n` +
      `Here is your real-time verified ledger snapshot:\n\n` +
      `• **Net Worth**: **${fmt(m.netWorth)}**\n` +
      `• **Total Inflow**: ${fmt(m.totalIncome)} · **Total Outflow**: ${fmt(m.totalExpense)}\n` +
      `• **Net Cash Flow**: ${m.netCashFlow >= 0 ? '+' : ''}${fmt(m.netCashFlow)} (${m.savingsRate}% savings rate)\n` +
      `• **Total Liquid Funds**: ${fmt(m.totalLiquid)} (Cash in Hand: ${fmt(m.cashInHand)})\n` +
      `• **Fixed Deposits & Assets**: ${fmt(m.totalFdr + m.totalPhysicalAssets)}\n` +
      `• **Debts / Liabilities**: ${fmt(m.totalLiabilities)}\n\n` +
      `💡 **Quick Tip**: You can use the **Goal Planner** modal above to test any financial targets, or click **Executive Report** for a complete printable audit.\n\n` +
      `*(Note: Operating via Daily Ledger's Deterministic Calculation Engine. To enable open conversational responses with Google Gemini, simply paste a free API key into \`GEMINI_API_KEY\` in \`server/.env\`)*`
    );
  }
}

module.exports = GeminiProvider;
