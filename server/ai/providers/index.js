const GeminiProvider = require('./geminiProvider');

/**
 * Provider factory for Ledger AI
 * Allows switching providers via AI_PROVIDER env var (gemini, qwen, deepseek)
 */
function getAiProvider() {
  const providerName = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

  switch (providerName) {
    case 'gemini':
    default:
      return new GeminiProvider();
  }
}

module.exports = { getAiProvider };
