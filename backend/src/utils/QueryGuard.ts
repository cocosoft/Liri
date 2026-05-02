/**
 * 查询守卫（基于CC源码 utils/QueryGuard.ts）
 * 保护系统免受恶意或过于昂贵的查询
 */

export interface QueryGuardConfig {
  maxPromptLength: number;
  maxContextLength: number;
  maxToolCallsPerTurn: number;
  maxConsecutiveErrors: number;
  blockedPatterns: RegExp[];
}

const DEFAULT_CONFIG: QueryGuardConfig = {
  maxPromptLength: 100_000,
  maxContextLength: 200_000,
  maxToolCallsPerTurn: 50,
  maxConsecutiveErrors: 5,
  blockedPatterns: [
    /[^\x00-\x7F]{100,}/,
    /\0/g,
  ],
};

export class QueryGuard {
  private config: QueryGuardConfig;
  private consecutiveErrors: number = 0;
  private turnCount: number = 0;

  constructor(config?: Partial<QueryGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  validatePrompt(prompt: string): { valid: boolean; reason?: string } {
    if (prompt.length > this.config.maxPromptLength) {
      return { valid: false, reason: `Prompt too long (${prompt.length} chars, max ${this.config.maxPromptLength})` };
    }

    for (const pattern of this.config.blockedPatterns) {
      if (pattern.test(prompt)) {
        return { valid: false, reason: `Prompt matches blocked pattern: ${pattern}` };
      }
    }

    return { valid: true };
  }

  checkToolCallLimit(currentCount: number): { allowed: boolean; reason?: string } {
    if (currentCount >= this.config.maxToolCallsPerTurn) {
      return { allowed: false, reason: `Tool call limit reached: ${this.config.maxToolCallsPerTurn}` };
    }
    return { allowed: true };
  }

  recordError(): boolean {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.consecutiveErrors = 0;
  }

  recordTurn(): void {
    this.turnCount++;
  }

  shouldAbort(): boolean {
    return this.consecutiveErrors >= this.config.maxConsecutiveErrors;
  }

  reset(): void {
    this.consecutiveErrors = 0;
    this.turnCount = 0;
  }

  getStatus(): {
    consecutiveErrors: number;
    turnCount: number;
    shouldAbort: boolean;
  } {
    return {
      consecutiveErrors: this.consecutiveErrors,
      turnCount: this.turnCount,
      shouldAbort: this.shouldAbort(),
    };
  }
}
