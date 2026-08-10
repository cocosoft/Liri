/**
 * ToolInputSelfCorrector — JSON 自纠正循环
 *
 * P2-11: 对标 cc_code/PilotDeck 的 invalid_tool_arguments 处理。
 * 当工具输入 JSON 解析失败时，自动向模型发送修正提示并重试（最多 3 次）。
 *
 * 与 P2-2 (ToolArgCoercer) 的关系：
 *   - ToolArgCoercer: 请求前自动修复（best-effort，不增加 round-trip）
 *   - ToolInputSelfCorrector: Coercer 失败后的显式重试循环
 *
 * 对标：cc_code formatZodValidationError + PilotDeck jsonSelfCorrect
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:selfCorrector');

// ==========================================
// Types
// ==========================================

export interface CorrectionConfig {
  /** 最大重试次数，默认 3 */
  maxRetries: number;
  /** 是否启用，默认 true */
  enabled: boolean;
}

export interface CorrectionResult {
  /** 修正后的输入（成功时）或 null（所有重试失败） */
  corrected: Record<string, unknown> | null;
  /** 重试次数 */
  attempts: number;
  /** 修正历史 */
  history: CorrectionAttempt[];
}

export interface CorrectionAttempt {
  attempt: number;
  originalInput: string;
  errorMessage: string;
  correctionHint: string;
  result?: Record<string, unknown>;
  success: boolean;
}

// ==========================================
// Error Analysis
// ==========================================

/** 分类常见的 JSON 解析错误类型 */
export type JsonErrorType =
  | 'missing_field'
  | 'unexpected_field'
  | 'type_mismatch'
  | 'invalid_json'
  | 'empty_value'
  | 'unknown';

export function classifyJsonError(
  error: string,
  params: string[]
): JsonErrorType {
  const msg = error.toLowerCase();
  if (msg.includes('missing') || msg.includes('required'))
    return 'missing_field';
  if (
    msg.includes('unrecognized') ||
    msg.includes('unknown') ||
    msg.includes('unexpected key')
  )
    return 'unexpected_field';
  if (
    msg.includes('type') ||
    msg.includes('expected') ||
    msg.includes('invalid type')
  )
    return 'type_mismatch';
  if (
    msg.includes('unexpected token') ||
    msg.includes('unexpected end') ||
    msg.includes('json')
  )
    return 'invalid_json';
  if (
    msg.includes('empty') ||
    msg.includes('null') ||
    msg.includes('undefined')
  )
    return 'empty_value';
  return 'unknown';
}

// ==========================================
// Correction Hints
// ==========================================

function buildCorrectionHint(
  errorType: JsonErrorType,
  errorMessage: string,
  toolName: string,
  params: string[],
  attempt: number
): string {
  const paramList = params.join(', ');
  const urgency = attempt >= 2 ? 'CRITICAL: ' : '';

  switch (errorType) {
    case 'missing_field':
      return `${urgency}The tool call for "${toolName}" is missing required fields. Valid parameters are: ${paramList}. Error: ${errorMessage}. Please provide ALL required fields.`;
    case 'unexpected_field':
      return `${urgency}The tool call for "${toolName}" contains unexpected fields. Only these parameters are allowed: ${paramList}. Remove the extra field. Error: ${errorMessage}`;
    case 'type_mismatch':
      return `${urgency}The tool call for "${toolName}" has a wrong type for one of its parameters. Expected types are listed in the tool's input schema. Error: ${errorMessage}`;
    case 'invalid_json':
      return `${urgency}The tool call for "${toolName}" has invalid JSON arguments. Please output valid JSON with these fields: ${paramList}. Error: ${errorMessage}`;
    case 'empty_value':
      return `${urgency}The tool call for "${toolName}" has an empty or null value. Please provide a valid value for: ${paramList}.`;
    default:
      return `${urgency}The tool call for "${toolName}" failed validation: ${errorMessage}. Valid parameters: ${paramList}. Please fix and retry.`;
  }
}

// ==========================================
// Self-Corrector
// ==========================================

export class ToolInputSelfCorrector {
  private config: CorrectionConfig;
  private history: CorrectionAttempt[] = [];

  constructor(config?: Partial<CorrectionConfig>) {
    this.config = { maxRetries: 3, enabled: true, ...config };
  }

  /**
   * 生成修正提示消息（发送给 LLM 作为下一轮输入）
   */
  generateCorrectionMessage(
    toolName: string,
    originalInput: string,
    errorMessage: string,
    params: string[],
    attempt: number
  ): CorrectionAttempt {
    const errorType = classifyJsonError(errorMessage, params);
    const hint = buildCorrectionHint(
      errorType,
      errorMessage,
      toolName,
      params,
      attempt
    );

    const attempt_: CorrectionAttempt = {
      attempt,
      originalInput,
      errorMessage,
      correctionHint: hint,
      success: false,
    };

    this.history.push(attempt_);

    logger.info('selfCorrector:attempt', {
      toolName,
      attempt,
      errorType,
      maxRetries: this.config.maxRetries,
    });

    return attempt_;
  }

  /**
   * 检查是否应继续重试
   */
  shouldRetry(attempt: number): boolean {
    return this.config.enabled && attempt < this.config.maxRetries;
  }

  /**
   * 记录成功
   */
  recordSuccess(
    attempt: number,
    correctedInput: Record<string, unknown>
  ): void {
    const last = this.history[this.history.length - 1];
    if (last) {
      last.result = correctedInput;
      last.success = true;
    }
    logger.info('selfCorrector:success', {
      attempt,
      totalAttempts: attempt + 1,
    });
  }

  /**
   * 重置历史（新一轮工具调用开始时调用）
   */
  reset(): void {
    this.history = [];
  }

  /**
   * 获取统计
   */
  getStats() {
    const successCount = this.history.filter((h) => h.success).length;
    return {
      totalAttempts: this.history.length,
      successCount,
      successRate:
        this.history.length > 0 ? successCount / this.history.length : 0,
      history: this.history,
    };
  }
}

/** 默认单例 */
let _defaultCorrector: ToolInputSelfCorrector;

export function getToolInputSelfCorrector(
  config?: Partial<CorrectionConfig>
): ToolInputSelfCorrector {
  if (!_defaultCorrector) {
    _defaultCorrector = new ToolInputSelfCorrector(config);
  }
  return _defaultCorrector;
}
