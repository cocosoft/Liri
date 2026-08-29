/**
 * 工具结果预算管理（Phase 2 + P2 token-aware 增强）
 * 对标 PilotDeck ToolResultBudget + cc_code truncateFunctionOutputPayload
 *
 * 超限工具结果截断，防止大工具输出填满上下文窗口。
 * v2.1: 增加 token-aware 截断（在字符预算基础上增加 token 预算检查）。
 */
import { getLogger } from '@modules/monitoring';
import { estimateTokens } from '@modules/ai';

const logger = getLogger('context:budget');

const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;
/** token-aware: 工具结果最大 token 预算（防止 CJK 文本的 token 消耗远超字符数预期） */
const DEFAULT_MAX_RESULT_TOKENS = 25_000;
const TRUNCATION_NOTICE = '\n\n[... 工具结果超出上下文预算，已截断]';

export interface ToolResultBudgetOptions {
  maxResultSizeChars?: number;
  maxResultTokens?: number;
  toolResultsDir?: string;
}

export class ToolResultBudget {
  private maxResultSizeChars: number;
  private maxResultTokens: number;
  private toolResultsDir: string;

  constructor(options: ToolResultBudgetOptions = {}) {
    this.maxResultSizeChars =
      options.maxResultSizeChars ?? DEFAULT_MAX_RESULT_SIZE_CHARS;
    this.maxResultTokens = options.maxResultTokens ?? DEFAULT_MAX_RESULT_TOKENS;
    this.toolResultsDir = options.toolResultsDir ?? '';
  }

  /**
   * 对工具结果应用预算限制（字符 + token 双重检查）
   * @returns 截断后的内容，如果未超限则返回原始内容
   */
  apply(
    content: string,
    toolCallId?: string
  ): {
    truncated: boolean;
    content: string;
    originalLength: number;
    estimatedTokens: number;
  } {
    const originalLength = content.length;
    const estimatedTokens = estimateTokens(content);

    // 双重检查：字符数超限 或 token 数超限
    const charsOver = originalLength > this.maxResultSizeChars;
    const tokensOver = estimatedTokens > this.maxResultTokens;

    if (!charsOver && !tokensOver) {
      return { truncated: false, content, originalLength, estimatedTokens };
    }

    // Token-aware 截断：按 token 比例缩小字符预算
    let effectiveLimit = this.maxResultSizeChars;
    if (tokensOver && !charsOver) {
      // CJK 场景：字符数未超但 token 数超了，按比例缩
      const ratio = this.maxResultTokens / estimatedTokens;
      effectiveLimit = Math.floor(originalLength * ratio);
    }

    logger.info('tool_result:truncated', {
      toolCallId,
      originalLength,
      estimatedTokens,
      maxChars: this.maxResultSizeChars,
      maxTokens: this.maxResultTokens,
      effectiveLimit,
      reason: tokensOver && !charsOver ? 'token_budget' : 'char_budget',
    });

    // 安全截断：尽量在换行处截断
    let truncated = content.slice(0, effectiveLimit);
    const lastNewline = truncated.lastIndexOf('\n');
    if (lastNewline > effectiveLimit * 0.7) {
      truncated = truncated.slice(0, lastNewline);
    }
    truncated += TRUNCATION_NOTICE;

    return {
      truncated: true,
      content: truncated,
      originalLength,
      estimatedTokens,
    };
  }

  /** 是否超过预算 */
  exceedsBudget(content: string): boolean {
    return (
      content.length > this.maxResultSizeChars ||
      estimateTokens(content) > this.maxResultTokens
    );
  }

  /** 获取当前字符预算上限 */
  getMaxSize(): number {
    return this.maxResultSizeChars;
  }

  /** 获取当前 token 预算上限 */
  getMaxTokens(): number {
    return this.maxResultTokens;
  }

  /** 更新字符预算上限 */
  setMaxSize(chars: number): void {
    this.maxResultSizeChars = chars;
  }

  /** 更新 token 预算上限 */
  setMaxTokens(tokens: number): void {
    this.maxResultTokens = tokens;
  }
}

/** 默认实例 */
export const toolResultBudget = new ToolResultBudget();
