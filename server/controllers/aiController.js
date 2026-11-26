const AiConversation = require('../models/AiConversation');
const { getAiProvider } = require('../ai/providers');
const { getUserFinancialContext, buildAiSystemInstruction } = require('../ai/financialContext');
const { calculateGoalFeasibility } = require('../ai/goalService');

/**
 * POST /api/ai/chat
 * Primary chat endpoint for Ledger AI
 */
const chatWithAi = async (req, res) => {
  try {
    const userId = req.user._id;
    const { prompt, conversationId } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ message: 'Prompt text is required' });
    }

    const trimmedPrompt = prompt.trim();

    // 1. Retrieve or initialize conversation thread
    let conversation;
    if (conversationId) {
      conversation = await AiConversation.findOne({ _id: conversationId, userId, isDeleted: false });
    }

    if (!conversation) {
      // Auto-generate title from first prompt
      const autoTitle = trimmedPrompt.length > 36 ? `${trimmedPrompt.slice(0, 36)}...` : trimmedPrompt;
      conversation = new AiConversation({
        userId,
        title: autoTitle || 'Financial Consultation',
        messages: [],
      });
    }

    // 2. Deterministically assemble verified financial context
    const financialContext = await getUserFinancialContext(userId);
    const systemInstruction = buildAiSystemInstruction(financialContext, req.user.name || 'User');

    // 3. Format history for provider
    const history = (conversation.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // 4. Request response from AI provider
    const provider = getAiProvider();
    const aiResult = await provider.generateResponse({
      prompt: trimmedPrompt,
      systemInstruction,
      history,
    });

    // 5. Append messages to thread
    conversation.messages.push({
      role: 'user',
      content: trimmedPrompt,
      timestamp: new Date(),
    });

    conversation.messages.push({
      role: 'assistant',
      content: aiResult.content,
      timestamp: new Date(),
      metadata: {
        provider: aiResult.provider,
        isFallback: aiResult.isFallback || false,
      },
    });

    await conversation.save();

    res.json({
      reply: aiResult.content,
      conversationId: conversation._id,
      provider: aiResult.provider,
      metrics: financialContext.metrics,
    });
  } catch (err) {
    console.error('Ledger AI chat error:', err);
    res.status(500).json({ message: 'Error processing AI consultation' });
  }
};

/**
 * GET /api/ai/conversations
 * Fetch user's conversation list
 */
const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;
    const conversations = await AiConversation.find({ userId, isDeleted: false })
      .select('title createdAt updatedAt messages')
      .sort({ updatedAt: -1 })
      .lean();

    const list = conversations.map((c) => ({
      _id: c._id,
      title: c.title,
      messageCount: (c.messages || []).length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    res.json({ conversations: list });
  } catch (err) {
    console.error('Fetch conversations error:', err);
    res.status(500).json({ message: 'Error fetching conversations' });
  }
};

/**
 * GET /api/ai/conversations/:id
 * Fetch single conversation with messages
 */
const getConversationById = async (req, res) => {
  try {
    const userId = req.user._id;
    const conversation = await AiConversation.findOne({
      _id: req.params.id,
      userId,
      isDeleted: false,
    });

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    res.json({ conversation });
  } catch (err) {
    console.error('Fetch conversation error:', err);
    res.status(500).json({ message: 'Error fetching conversation' });
  }
};

/**
 * DELETE /api/ai/conversations/:id
 * Soft-delete conversation
 */
const deleteConversation = async (req, res) => {
  try {
    const userId = req.user._id;
    const conversation = await AiConversation.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { isDeleted: true } },
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    res.json({ message: 'Conversation deleted' });
  } catch (err) {
    console.error('Delete conversation error:', err);
    res.status(500).json({ message: 'Error deleting conversation' });
  }
};

/**
 * POST /api/ai/goals
 * Deterministically evaluate a financial goal
 */
const evaluateGoal = async (req, res) => {
  try {
    const userId = req.user._id;
    const { targetAmount, goalName, targetMonths, allocatedSavings } = req.body;

    if (!targetAmount || isNaN(parseFloat(targetAmount))) {
      return res.status(400).json({ message: 'Valid target amount is required' });
    }

    const financialContext = await getUserFinancialContext(userId);
    const plan = calculateGoalFeasibility({
      targetAmount,
      goalName,
      targetMonths,
      allocatedSavings,
      financialContext,
    });

    res.json({ plan });
  } catch (err) {
    console.error('Goal evaluation error:', err);
    res.status(500).json({ message: 'Error evaluating financial goal' });
  }
};

/**
 * GET /api/ai/report
 * Generate on-demand deterministic financial analysis report
 */
const getFinancialReport = async (req, res) => {
  try {
    const userId = req.user._id;
    const context = await getUserFinancialContext(userId);

    const m = context.metrics;
    const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;

    const report = {
      generatedAt: new Date().toISOString(),
      userName: req.user.name || 'User',
      summary: {
        totalIncome: m.totalIncome,
        totalExpense: m.totalExpense,
        netCashFlow: m.netCashFlow,
        savingsRate: m.savingsRate,
        liquidFunds: m.totalLiquid,
        totalAssets: m.totalAssets,
        totalLiabilities: m.totalLiabilities,
        netWorth: m.netWorth,
      },
      topCategories: context.topCategories,
      accounts: context.accounts,
      recommendation:
        m.netCashFlow > 0
          ? `Positive monthly net surplus of ${fmt(m.netCashFlow)} (${m.savingsRate}% savings rate). Recommend allocating ${fmt(Math.round(m.netCashFlow * 0.4))} towards liquid emergency reserves and the remainder towards debt reduction or fixed deposits.`
          : `Outflow currently matches or exceeds inflow by ${fmt(Math.abs(m.netCashFlow))}. Focus on reducing top expense categories (${context.topCategories[0]?.category || 'General'}) to achieve a sustainable surplus.`,
    };

    res.json({ report });
  } catch (err) {
    console.error('Report generation error:', err);
    res.status(500).json({ message: 'Error generating financial report' });
  }
};

module.exports = {
  chatWithAi,
  getConversations,
  getConversationById,
  deleteConversation,
  evaluateGoal,
  getFinancialReport,
};
