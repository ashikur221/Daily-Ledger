const BaseAiProvider = require('./baseProvider');

class GeminiProvider extends BaseAiProvider {
  constructor() {
    super('gemini');
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    this.maxTokens = parseInt(process.env.AI_MAX_TOKENS || '1024', 10);
    this.temperature = parseFloat(process.env.AI_TEMPERATURE || '0.3');
  }

  async generateResponse({ prompt, systemInstruction, history = [] }) {
    if (!this.apiKey) {
      return {
        content:
          "⚠️ **Gemini API Key Required**\n\n" +
          "Ledger AI is running in offline deterministic mode. To enable live conversational AI with Google Gemini, set `GEMINI_API_KEY` in your `server/.env` file with a free key from [Google AI Studio](https://aistudio.google.com/).\n\n" +
          "In the meantime, your deterministic financial metrics and reports are calculated and verified directly from your ledger data.",
        provider: 'gemini-fallback',
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
}

module.exports = GeminiProvider;
