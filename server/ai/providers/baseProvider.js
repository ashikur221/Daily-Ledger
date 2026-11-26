/**
 * Base AI Provider Interface
 * All AI adapters (Gemini, Qwen, DeepSeek) implement this contract.
 */
class BaseAiProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Generate an AI response given a prompt and context
   * @param {Object} options
   * @param {string} options.prompt - User message
   * @param {string} options.systemInstruction - Guardrails, persona, and deterministic financial data
   * @param {Array} options.history - Prior conversation messages [{ role: 'user'|'assistant', content: string }]
   * @returns {Promise<{ content: string, provider: string, usage?: Object }>}
   */
  async generateResponse({ prompt, systemInstruction, history = [] }) {
    throw new Error('generateResponse must be implemented by provider subclass');
  }
}

module.exports = BaseAiProvider;
