/**
 * Agent Compaction
 * 对标OpenClaw agents/compaction.ts
 * Agent级上下文压缩
 */

export interface CompactionStrategy {
  name: string;
  priority: number;
  compress: (context: CompactionContext) => Promise<CompactionResult>;
}

export interface CompactionContext {
  messages: CompactionMessage[];
  tokenCount: number;
  maxTokens: number;
  agentId: string;
  metadata?: Record<string, unknown>;
}

export interface CompactionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokenCount: number;
  timestamp: number;
  id: string;
  metadata?: Record<string, unknown>;
}

export interface CompactionResult {
  messages: CompactionMessage[];
  originalTokenCount: number;
  compressedTokenCount: number;
  compressionRatio: number;
  strategyUsed: string;
  summary?: string;
}

export interface CompactionConfig {
  maxTokens: number;
  targetRatio?: number;
  strategies?: CompactionStrategy[];
  preserveSystemMessages?: boolean;
  preserveToolResults?: boolean;
  autoCompact?: boolean;
}

export class CompactionManager {
  private strategies: CompactionStrategy[] = [];
  private config: Required<CompactionConfig>;

  constructor(config?: CompactionConfig) {
    this.config = {
      maxTokens: config?.maxTokens ?? 128000,
      targetRatio: config?.targetRatio ?? 0.5,
      strategies: config?.strategies ?? [],
      preserveSystemMessages: config?.preserveSystemMessages ?? true,
      preserveToolResults: config?.preserveToolResults ?? false,
      autoCompact: config?.autoCompact ?? true,
    };

    this.registerDefaultStrategies();
  }

  registerStrategy(strategy: CompactionStrategy): void {
    this.strategies.push(strategy);
    this.strategies.sort((a, b) => b.priority - a.priority);
  }

  unregisterStrategy(name: string): boolean {
    const index = this.strategies.findIndex((s) => s.name === name);
    if (index === -1) return false;
    this.strategies.splice(index, 1);
    return true;
  }

  async compact(context: CompactionContext): Promise<CompactionResult> {
    const originalTokenCount = context.tokenCount;
    const targetTokens = Math.round(originalTokenCount * this.config.targetRatio);

    if (originalTokenCount <= this.config.maxTokens) {
      return {
        messages: context.messages,
        originalTokenCount,
        compressedTokenCount: originalTokenCount,
        compressionRatio: 1,
        strategyUsed: 'none',
      };
    }

    let messages = [...context.messages];

    if (this.config.preserveSystemMessages) {
      const systemMessages = messages.filter((m) => m.role === 'system');
      const others = messages.filter((m) => m.role !== 'system');

      for (const strategy of this.strategies) {
        const result = await strategy.compress({
          ...context,
          messages: others,
          tokenCount: others.reduce((sum, m) => sum + m.tokenCount, 0),
        });

        messages = [...systemMessages, ...result.messages];

        const compressedCount = messages.reduce((sum, m) => sum + m.tokenCount, 0);
        if (compressedCount <= targetTokens) {
          return this.buildResult(
            messages,
            originalTokenCount,
            compressedCount,
            strategy.name,
          );
        }

        messages = result.messages;
      }
    } else {
      for (const strategy of this.strategies) {
        const result = await strategy.compress({ ...context, messages });
        messages = result.messages;

        const compressedCount = messages.reduce((sum, m) => sum + m.tokenCount, 0);
        if (compressedCount <= targetTokens) {
          return this.buildResult(
            messages,
            originalTokenCount,
            compressedCount,
            strategy.name,
          );
        }
      }
    }

    const finalCount = messages.reduce((sum, m) => sum + m.tokenCount, 0);
    return this.buildResult(messages, originalTokenCount, finalCount, 'aggressive');
  }

  needsCompaction(tokenCount: number): boolean {
    return tokenCount > this.config.maxTokens;
  }

  shouldCompact(tokenCount: number): boolean {
    return this.config.autoCompact && this.needsCompaction(tokenCount);
  }

  getConfig(): Readonly<Required<CompactionConfig>> {
    return { ...this.config };
  }

  updateConfig(config: Partial<CompactionConfig>): void {
    Object.assign(this.config, config);
  }

  private buildResult(
    messages: CompactionMessage[],
    originalCount: number,
    compressedCount: number,
    strategy: string,
  ): CompactionResult {
    return {
      messages,
      originalTokenCount: originalCount,
      compressedTokenCount: compressedCount,
      compressionRatio: originalCount > 0 ? compressedCount / originalCount : 1,
      strategyUsed: strategy,
    };
  }

  private registerDefaultStrategies(): void {
    this.registerStrategy({
      name: 'summarize-oldest',
      priority: 50,
      compress: async (ctx: CompactionContext): Promise<CompactionResult> => {
        const messages = [...ctx.messages];
        const keepRatio = 0.6;
        const keepCount = Math.max(Math.ceil(messages.length * keepRatio), 1);

        const kept = messages.slice(-keepCount);
        const removed = messages.slice(0, messages.length - keepCount);

        const summaryContent = removed
          .filter((m) => m.role !== 'system')
          .map((m) => `[${m.role}]: ${m.content.slice(0, 100)}`)
          .join('\n');

        const summaryMsg: CompactionMessage = {
          id: `summary_${Date.now()}`,
          role: 'system',
          content: `Previous conversation summary:\n${summaryContent}`,
          tokenCount: Math.ceil(summaryContent.length / 4),
          timestamp: Date.now(),
        };

        return {
          messages: [summaryMsg, ...kept],
          originalTokenCount: ctx.tokenCount,
          compressedTokenCount: kept.reduce((s, m) => s + m.tokenCount, 0) + summaryMsg.tokenCount,
          compressionRatio: 0,
          strategyUsed: 'summarize-oldest',
        };
      },
    });

    this.registerStrategy({
      name: 'trim-tool-results',
      priority: 40,
      compress: async (ctx: CompactionContext): Promise<CompactionResult> => {
        const messages = ctx.messages.map((m) => {
          if (m.role === 'tool' && m.content.length > 500) {
            return {
              ...m,
              content: m.content.slice(0, 200) + `\n... [truncated ${m.content.length - 200} chars]`,
              tokenCount: Math.ceil(250 / 4),
            };
          }
          return m;
        });

        const compressedCount = messages.reduce((sum, m) => sum + m.tokenCount, 0);

        return {
          messages,
          originalTokenCount: ctx.tokenCount,
          compressedTokenCount: compressedCount,
          compressionRatio: compressedCount / ctx.tokenCount,
          strategyUsed: 'trim-tool-results',
        };
      },
    });
  }
}

export function createCompactionManager(config?: CompactionConfig): CompactionManager {
  return new CompactionManager(config);
}
