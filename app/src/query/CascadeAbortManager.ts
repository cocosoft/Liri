/**
 * CascadeAbortManager — 级联中止管理器
 *
 * P1-5: 对标 cc_code StreamingToolExecutor.siblingAbortController 和
 * PilotDeck AgentLoop circuit breaker。
 *
 * 当一个"级联触发型"工具错误发生时（如 Bash 错误、文件写入错误），
 * 立即通过共享的 AbortController 中止本轮所有兄弟工具的 in-flight 执行。
 *
 * 目标：Bash 错误触发后，所有兄弟调用在 ≤500ms 内中止，0 个漏网工具。
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'query:cascadeAbort' });

// ==========================================
// Types
// ==========================================

/** 级联中止触发条件 */
export type CascadeTrigger =
  | 'bash_error'
  | 'write_error'
  | 'permission_denied'
  | 'never';

/** 级联中止配置 */
export interface CascadeAbortConfig {
  /** 是否启用，默认 true */
  enabled: boolean;
  /** 哪些错误类型触发级联中止 */
  triggers: Set<CascadeTrigger>;
  /** 目标中止超时（毫秒），默认 500 */
  targetAbortMs: number;
  /** 同级工具的中止信号（由 Manager 管理） */
  siblingSignal?: AbortSignal;
}

const DEFAULT_CONFIG: CascadeAbortConfig = {
  enabled: true,
  triggers: new Set(['bash_error', 'write_error', 'permission_denied']),
  targetAbortMs: 500,
};

/** 工具错误分类结果 */
export interface ErrorClassification {
  trigger: CascadeTrigger;
  /** 是否应触发级联中止 */
  shouldCascade: boolean;
  reason: string;
}

// ==========================================
// Error Classification
// ==========================================

/** Bash/code execution tool names that can cascade-abort */
const CASCADE_TOOL_PATTERNS = [
  /^bash$/i,
  /^sh$/i,
  /^shell$/i,
  /^run_shell$/i,
  /^powershell$/i,
  /^cmd$/i,
  /^terminal$/i,
];

/** Write tool names that can cascade-abort */
const WRITE_TOOL_PATTERNS = [
  /write/i,
  /edit/i,
  /patch/i,
  /replace/i,
  /^file_write$/i,
  /^file_edit$/i,
  /^write_file$/i,
];

/**
 * 分类工具错误，判断是否应触发级联中止
 */
export function classifyToolError(
  toolName: string,
  errorMessage: string
): ErrorClassification {
  // 1. Bash errors — always cascade (user's command failed, subsequent reads are wasteful)
  if (CASCADE_TOOL_PATTERNS.some((p) => p.test(toolName))) {
    return {
      trigger: 'bash_error',
      shouldCascade: true,
      reason: `Bash tool '${toolName}' failed: ${errorMessage}`,
    };
  }

  // 2. File write/edit errors — cascade (file system state may be inconsistent)
  if (WRITE_TOOL_PATTERNS.some((p) => p.test(toolName))) {
    return {
      trigger: 'write_error',
      shouldCascade: true,
      reason: `Write tool '${toolName}' failed: ${errorMessage}`,
    };
  }

  // 3. Permission denied errors — cascade (likely auth/config issue affecting all tools)
  if (
    /permission_denied|unauthorized|forbidden|access_denied/i.test(errorMessage)
  ) {
    return {
      trigger: 'permission_denied',
      shouldCascade: true,
      reason: `Permission denied: ${errorMessage}`,
    };
  }

  // 4. Read/network/timeout errors — do NOT cascade (transient, retry-safe)
  return {
    trigger: 'never',
    shouldCascade: false,
    reason: `Non-cascading error from '${toolName}': ${errorMessage}`,
  };
}

// ==========================================
// CascadeAbortManager
// ==========================================

export class CascadeAbortManager {
  private config: CascadeAbortConfig;
  private controller: AbortController | null = null;
  private cascadeTriggered = false;
  private triggerReason: string = '';
  private abortCount = 0;

  constructor(config?: Partial<CascadeAbortConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 开始新一轮工具执行 */
  startRound(): AbortController {
    this.controller = new AbortController();
    this.cascadeTriggered = false;
    this.triggerReason = '';
    this.abortCount = 0;
    return this.controller;
  }

  /** 获取当前轮的 signal（用于工具感知中止） */
  get signal(): AbortSignal | undefined {
    return this.controller?.signal;
  }

  /** 是否已触发级联中止 */
  get isCascaded(): boolean {
    return this.cascadeTriggered;
  }

  /** 触发原因 */
  get reason(): string {
    return this.triggerReason;
  }

  /**
   * 报告工具执行结果。
   * 如果是级联触发型错误且未中止，则触发级联中止。
   * @returns 是否触发了级联中止
   */
  reportResult(
    toolName: string,
    success: boolean,
    errorMessage?: string
  ): boolean {
    if (success || this.cascadeTriggered) return false;
    if (!this.config.enabled) return false;

    const classification = classifyToolError(toolName, errorMessage ?? '');

    if (
      classification.shouldCascade &&
      this.config.triggers.has(classification.trigger)
    ) {
      this.cascadeTriggered = true;
      this.triggerReason = classification.reason;

      logger.warn('cascadeAbort:triggered', {
        toolName,
        trigger: classification.trigger,
        reason: classification.reason,
        targetAbortMs: this.config.targetAbortMs,
      });

      // Abort all sibling tools
      if (this.controller) {
        this.controller.abort();
        this.abortCount++;
      }
      return true;
    }

    return false;
  }

  /**
   * 检查工具是否被级联中止
   */
  isAborted(): boolean {
    return this.controller?.signal.aborted ?? false;
  }

  /**
   * 为被中止的工具生成结果
   */
  createAbortedResult(
    toolCallId: string,
    toolName: string
  ): {
    toolCallId: string;
    toolName: string;
    result: string;
    error: string;
    success: false;
    aborted: true;
    durationMs: number;
  } {
    return {
      toolCallId,
      toolName,
      result: '',
      error: `[CASCADE_ABORTED] ${this.triggerReason}`,
      success: false,
      aborted: true,
      durationMs: 0,
    };
  }

  /** 重置状态 */
  reset(): void {
    this.controller = null;
    this.cascadeTriggered = false;
    this.triggerReason = '';
    this.abortCount = 0;
  }

  /** 获取统计 */
  getStats() {
    return {
      cascadeTriggered: this.cascadeTriggered,
      triggerReason: this.triggerReason,
      abortCount: this.abortCount,
    };
  }
}
