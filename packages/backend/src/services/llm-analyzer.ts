import type { ISemanticAnalyzer, SemanticMatch } from '@open-hive/shared';

export interface LLMAnalyzerConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'generic';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  confidenceThreshold: number;
  rateLimitPerMin: number;
}

const COMPARISON_PROMPT = `You are a code coordination assistant. Two developers are working in the same repository. Determine if their intents overlap (working on the same concern, touching the same subsystem, or likely to cause merge conflicts).

Developer A intent: "{intentA}"
Developer B intent: "{intentB}"

Respond with ONLY valid JSON (no markdown, no explanation):
{"overlap": true/false, "confidence": 0.0-1.0, "explanation": "brief reason"}`;

export class LLMAnalyzer implements ISemanticAnalyzer {
  readonly name = 'llm-comparison';
  readonly tier = 'L3c' as const;

  private timestamps: number[] = [];

  constructor(private config: LLMAnalyzerConfig) {}

  async compare(a: string, b: string): Promise<SemanticMatch | null> {
    // Rate limiting
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => t > now - 60_000);
    if (this.timestamps.length >= this.config.rateLimitPerMin) return null;
    this.timestamps.push(now);

    try {
      const result = await this.callLLM(a, b);
      if (result.confidence < this.config.confidenceThreshold) return null;
      if (!result.overlap) return null;

      return {
        score: result.confidence,
        tier: 'L3c',
        explanation: result.explanation,
      };
    } catch {
      // LLM errors are non-fatal -- return null to fall back to cheaper tiers
      return null;
    }
  }

  private async callLLM(
    intentA: string,
    intentB: string,
  ): Promise<{ overlap: boolean; confidence: number; explanation: string }> {
    const prompt = COMPARISON_PROMPT
      .replace('{intentA}', intentA)
      .replace('{intentB}', intentB);

    const raw = await this.sendToProvider(prompt);
    return JSON.parse(raw);
  }

  private async sendToProvider(prompt: string): Promise<string> {
    switch (this.config.provider) {
      case 'openai':
      case 'generic':
        return this.sendOpenAICompatible(prompt);
      case 'anthropic':
        return this.sendAnthropic(prompt);
      case 'ollama':
        return this.sendOllama(prompt);
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }
  }

  private async sendOpenAICompatible(prompt: string): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1';
    const model = this.config.model ?? 'gpt-4o-mini';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0].message.content;
  }

  private async sendAnthropic(prompt: string): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'https://api.anthropic.com';
    const model = this.config.model ?? 'claude-haiku-4-5-20251001';
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json() as { content: Array<{ text: string }> };
    return data.content[0].text;
  }

  private async sendOllama(prompt: string): Promise<string> {
    const baseUrl = this.config.baseUrl ?? 'http://localhost:11434';
    const model = this.config.model ?? 'llama3.2';
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
    const data = await res.json() as { response: string };
    return data.response;
  }
}
