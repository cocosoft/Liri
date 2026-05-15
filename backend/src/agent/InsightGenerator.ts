/**
 * 对话洞察生成器
 * 对标 Hermes agent/insights.py
 * 分析对话内容，提取关键决策、重要变更、风险提示
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface ConversationInsight {
  type: 'decision' | 'change' | 'risk' | 'summary';
  content: string;
  confidence: 'high' | 'medium' | 'low';
  timestamp: number;
  relatedMessages: number[];
}

export interface InsightGeneratorConfig {
  maxInsights: number;
  minMessageCount: number;
  includeSummary: boolean;
}

const DEFAULT_CONFIG: InsightGeneratorConfig = {
  maxInsights: 5,
  minMessageCount: 4,
  includeSummary: true,
};

type CallLLMFn = (messages: Array<{ role: string; content: string }>) => Promise<string | null>;

export class InsightGenerator {
  private config: InsightGeneratorConfig;
  private lastAnalysisTime: number = 0;
  private lastMessageCount: number = 0;

  constructor(config: Partial<InsightGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 分析对话生成洞察
   * @param messages 对话消息列表
   * @param callLLM LLM调用函数
   * @returns 洞察列表
   */
  async generateInsights(
    messages: Array<{ role: string; content: string; index: number }>,
    callLLM: CallLLMFn,
  ): Promise<ConversationInsight[]> {
    if (messages.length < this.config.minMessageCount) {
      return [];
    }

    const prompt = this.buildInsightPrompt(messages);
    if (!prompt) return [];

    try {
      const raw = await callLLM([
        {
          role: 'system',
          content:
            'You analyze conversations and extract key insights. Return a JSON array of insights. Each insight has: type (decision|change|risk|summary), content (string), confidence (high|medium|low).',
        },
        { role: 'user', content: prompt },
      ]);

      if (!raw) return [];

      return this.parseInsights(raw, messages.length);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.warning('Insight generation failed', e);
      return [];
    }
  }

  /**
   * 条件触发分析
   * @param messages 当前消息列表
   * @param callLLM LLM调用函数
   * @returns 洞察列表（条件不满足时返回空）
   */
  async maybeGenerateInsights(
    messages: Array<{ role: string; content: string; index: number }>,
    callLLM: CallLLMFn,
  ): Promise<ConversationInsight[]> {
    const now = Date.now();
    const newMessageCount = messages.length - this.lastMessageCount;

    const shouldGenerate =
      newMessageCount >= 10 ||
      (now - this.lastAnalysisTime > 300000 && newMessageCount >= 4);

    if (!shouldGenerate) return [];

    this.lastAnalysisTime = now;
    this.lastMessageCount = messages.length;

    return this.generateInsights(messages, callLLM);
  }

  /**
   * 构建洞察分析提示
   */
  private buildInsightPrompt(
    messages: Array<{ role: string; content: string; index: number }>,
  ): string | null {
    if (messages.length === 0) return null;

    const recent = messages.slice(-20);
    const formatted = recent
      .map((m) => `[#${m.index}] [${m.role}]: ${m.content.slice(0, 300)}`)
      .join('\n\n');

    return (
      'Analyze the following conversation excerpt and extract key insights:\n\n' +
      `${formatted}\n\n` +
      'Focus on:\n' +
      '- Important decisions made by the user or assistant\n' +
      '- Notable changes (files modified, configurations changed)\n' +
      '- Potential risks or concerns\n' +
      '- Brief summary of progress\n\n' +
      'Return valid JSON array only.'
    );
  }

  /**
   * 解析 LLM 返回的洞察数据
   */
  private parseInsights(raw: string, messageCount: number): ConversationInsight[] {
    try {
      const jsonStart = raw.indexOf('[');
      const jsonEnd = raw.lastIndexOf(']');
      if (jsonStart === -1 || jsonEnd === -1) return [];

      const jsonStr = raw.slice(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(
          (item: unknown): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null,
        )
        .map(
          (item: Record<string, unknown>): ConversationInsight => ({
            type: this.normalizeType(String(item.type || 'summary')),
            content: String(item.content || ''),
            confidence: this.normalizeConfidence(String(item.confidence || 'low')),
            timestamp: Date.now(),
            relatedMessages: this.computeRelatedMessages(messageCount),
          }),
        )
        .filter((i) => i.content.length > 0)
        .slice(0, this.config.maxInsights);
    } catch {
      return [];
    }
  }

  private normalizeType(type: string): ConversationInsight['type'] {
    const valid = ['decision', 'change', 'risk', 'summary'];
    return valid.includes(type)
      ? (type as ConversationInsight['type'])
      : 'summary';
  }

  private normalizeConfidence(confidence: string): ConversationInsight['confidence'] {
    const valid = ['high', 'medium', 'low'];
    return valid.includes(confidence)
      ? (confidence as ConversationInsight['confidence'])
      : 'low';
  }

  private computeRelatedMessages(messageCount: number): number[] {
    const start = Math.max(0, messageCount - 5);
    return Array.from({ length: Math.min(5, messageCount) }, (_, i) => start + i);
  }

  getConfig(): InsightGeneratorConfig {
    return { ...this.config };
  }
}

let globalInsightGenerator: InsightGenerator | null = null;

export function getInsightGenerator(config?: Partial<InsightGeneratorConfig>): InsightGenerator {
  if (!globalInsightGenerator) {
    globalInsightGenerator = new InsightGenerator(config);
  }
  return globalInsightGenerator;
}

export function resetInsightGenerator(): void {
  globalInsightGenerator = null;
}
