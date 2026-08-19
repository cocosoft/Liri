/**
 * UnifiedTokenTracker — Token 跟踪与预算收敛的统一入口
 *
 * Phase 1b: 新建，作为 TokenBudgetController 的统一上层入口。
 * 职责：请求前预检 + 流式水位监测 + 请求后校准 + 压缩历史记录。
 *
 * 最终目标：取代 TokenBudgetController 成为唯一的 token 预算管理入口。
 */

import type { ContextTracker } from '../../query/context/ContextTracker';
import { extractUsage } from '../../ai/tokenizer/UsageExtractor';
import {
  estimateTokens,
  estimateMessagesTokensCooperative,
} from '../../ai/tokenizer/TokenEstimator';
import { getCachedTiktokenEncoder } from '../../ai/tokenizer/TiktokenEstimator';
import { resolveContextWindow } from '../../context/window/ContextWindowResolver';
import { getLogger } from '../../monitoring/logs/Logger';
import { handleError } from '@modules/error';
import {
  TokenBudgetController,
  UNIFIED_THRESHOLDS,
} from './TokenBudgetController';
import {
  getCalibrationFactor,
  persistCalibrationFactor,
} from './CalibrationStore';

// 订阅 Trace 引擎的真实 token 消耗数据
import { traceUsageListeners } from '../../trace-recording/AITracePlugin';
// 订阅子 Agent token 消耗汇聚
import { subAgentTokenListeners } from './SubAgentTokenBridge';

const logger = getLogger('tokenBudget:unified');

// ==========================================
// Types
// ==========================================

export interface WatermarkState {
  currentTokens: number;
  contextLimit: number;
  outputTokensSoFar: number;
  ratio: number;
  severity: 'normal' | 'warn' | 'compact';
}

export interface CompactionDecision {
  decision: 'trigger' | 'warn' | 'skip';
  beforeTokens: number;
}

export interface CompactionRecord {
  savedPercent: number;
  timestamp: number;
  crossModel?: boolean;
}

// ==========================================
// Model Threshold Presets
// ==========================================

/** 模型阈值映射：key 是模型前缀，值从 UNIFIED_THRESHOLDS 引用 */
const MODEL_THRESHOLD_PRESETS: Record<
  string,
  { warn: number; compact: number }
> = {
  default: {
    warn: UNIFIED_THRESHOLDS.WARNING,
    compact: UNIFIED_THRESHOLDS.CRITICAL,
  },
  'gemini-2.5': { warn: 0.85, compact: 0.95 },
  gemini: { warn: 0.85, compact: 0.95 },
  claude: {
    warn: UNIFIED_THRESHOLDS.WARNING,
    compact: UNIFIED_THRESHOLDS.CRITICAL,
  },
  'llama-local': { warn: 0.6, compact: 0.75 },
};

/** 最长前缀优先匹配 */
function getModelThresholds(model: string): { warn: number; compact: number } {
  const sorted = Object.keys(MODEL_THRESHOLD_PRESETS).sort(
    (a, b) => b.length - a.length
  );
  const matched = sorted.find((k) => model.startsWith(k));
  return MODEL_THRESHOLD_PRESETS[matched || 'default'];
}

// ==========================================
// UnifiedTokenTracker
// ==========================================

export class UnifiedTokenTracker {
  private readonly controller: TokenBudgetController;
  private readonly contextTracker: ContextTracker;
  private calibrationFactor: number = 1.0;
  private baselineInputTokens: number = 0;
  /** 消息总字符数（checkDuringStreaming 回退用，避免正反馈污染） */
  private totalMessageChars: number = 0;
  private estimatedStreamTokens: number = 0;
  private compactionHistory: Array<CompactionRecord> = [];
  private currentModel: string = '';
  private lastNotifiedSeverity: 'normal' | 'warn' | 'compact' = 'normal';
  private checkInterval: NodeJS.Timeout | null = null;

  // Fixed overhead (set by caller at construction)
  private readonly overheadSystemPrompt: number;
  private readonly overheadToolDefs: number;

  /** EMA 平滑因子：新值权重 30% */
  private readonly CALIBRATION_ALPHA = 0.3;

  /** 反抖动参数 */
  private readonly ANTI_FLAP_WINDOW = 3;
  private readonly ANTI_FLAP_MIN_SAVING = 0.1;

  /** Trace 引擎 usage 订阅的取消函数 */
  private _unsubscribeTrace: (() => void) | null = null;

  /** 子 Agent token 订阅的取消函数 */
  private _unsubscribeSubAgent: (() => void) | null = null;

  constructor(
    controller: TokenBudgetController,
    contextTracker: ContextTracker,
    overhead?: { systemPrompt: number; toolDefs: number }
  ) {
    this.controller = controller;
    this.contextTracker = contextTracker;
    this.overheadSystemPrompt = overhead?.systemPrompt ?? 0;
    this.overheadToolDefs = overhead?.toolDefs ?? 0;

    // 订阅 Trace 引擎的真实 token 消耗数据，用于校准因子闭环
    this._subscribeTraceUsage();
    // 订阅子 Agent token 消耗汇聚
    this._subscribeSubAgentUsage();
  }

  /** 获取当前校准因子（供 AutoCompactionPolicy 同步） */
  getCalibrationFactor(): number {
    return this.calibrationFactor;
  }

  // ==========================================
  // 请求前评估
  // ==========================================

  /** 请求前评估：估算 input + output 是否超限（2026-08-19 改为异步协作式估算） */
  async checkBeforeRequest(
    messages: readonly { role?: string; content?: string | unknown }[],
    model: string,
    maxOutputTokens?: number
  ): Promise<CompactionDecision> {
    try {
      this.currentModel = model;
      // 根因①修复：大列表同步估算阻塞事件循环，改用协作式分批估算
      this.baselineInputTokens =
        await estimateMessagesTokensCooperative(messages);
      // 计算消息总字符数（流式水位回退用，避免正反馈污染）
      this.totalMessageChars = messages.reduce(
        (sum, m) =>
          sum + (typeof m.content === 'string' ? m.content.length : 0),
        0
      );
      const estimatedOutput = maxOutputTokens ?? 4096;
      const limit = resolveContextWindow(model).tokens;
      const effectiveFactor =
        this.calibrationFactor > 0 ? this.calibrationFactor : 1.2;
      const estimatedTotal = this.baselineInputTokens + estimatedOutput;
      const ratio = (estimatedTotal * effectiveFactor) / limit;

      const thresholds = getModelThresholds(model);
      const decision: CompactionDecision =
        ratio >= thresholds.compact
          ? { decision: 'trigger', beforeTokens: estimatedTotal }
          : ratio >= thresholds.warn
            ? { decision: 'warn', beforeTokens: estimatedTotal }
            : { decision: 'skip', beforeTokens: estimatedTotal };

      logger.info('unified:checkBeforeRequest', {
        decision: decision.decision,
        ratio: Math.round(ratio * 100) / 100,
        estimatedTotal,
        contextLimit: limit,
        model,
        calibrationFactor: Math.round(this.calibrationFactor * 100) / 100,
        warnThreshold: thresholds.warn,
        compactThreshold: thresholds.compact,
      });
      return decision;
    } catch (err) {
      handleError(err, {
        module: 'core:tokenBudget',
        action: 'check_before_request',
      });
      return { decision: 'skip', beforeTokens: 0 };
    }
  }

  // ==========================================
  // 流式中监测
  // ==========================================

  /** 流式中：优先 tiktoken BPE 精确计数，fallback CJK 感知估算，不再用 chars/4 */
  onStreamChunk(chunk: string): void {
    try {
      const encoder = getCachedTiktokenEncoder();
      if (encoder) {
        const result = encoder.encode(chunk);
        this.estimatedStreamTokens += Array.isArray(result)
          ? result.length
          : result.length;
      } else {
        // tiktoken 未加载时回退 CJK 感知估算（≈ 1.5/CJK char，比 chars/4 准确 3-6x）
        this.estimatedStreamTokens += estimateTokens(chunk);
      }
    } catch (err) {
      logger.warn('unified:onStreamChunk error', { error: String(err) });
      // 不阻断流式输出
    }
  }

  /** 重置流式输出 token 计数器（每轮 LLM 调用前调用） */
  resetStreamTokens(): void {
    this.estimatedStreamTokens = 0;
  }

  /** 更新 per-round baseline（工具执行后消息列表变化时调用） */
  async updateBaselineForRound(
    messages: readonly { role?: string; content?: string | unknown }[],
    model: string
  ): Promise<void> {
    this.currentModel = model;
    // 2026-08-19 根因①修复：工具轮间也改协作式估算，避免 mid-stream 阻塞
    this.baselineInputTokens =
      await estimateMessagesTokensCooperative(messages);
    this.totalMessageChars = messages.reduce(
      (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0),
      0
    );
  }

  /** 流式中检查：使用 baselineInputTokens（per-round 估算）而非累计 spent。
   *  getUsedBudget() 是会话累计值，会导致 1.3M/200K=674% 的虚高显示。*/
  checkDuringStreaming(
    model: string,
    _messageCharCount?: number
  ): WatermarkState {
    try {
      const limit = resolveContextWindow(model).tokens;
      // 使用 per-round baselineInputTokens（checkBeforeRequest 设置，tiktoken BPE 精确）
      // 不用 getUsedBudget() — 那是会话累计值，跨轮叠加导致 674% 虚高
      const estimatedInput =
        this.baselineInputTokens > 0
          ? this.baselineInputTokens
          : _messageCharCount
            ? Math.ceil(_messageCharCount / 3.5)
            : 0;
      const estimatedTotal = estimatedInput + this.estimatedStreamTokens;
      const ratio = estimatedTotal / limit;
      const thresholds = getModelThresholds(model);
      const severity =
        ratio >= thresholds.compact
          ? ('compact' as const)
          : ratio >= thresholds.warn
            ? ('warn' as const)
            : ('normal' as const);
      logger.debug('unified:checkDuringStreaming', {
        estimatedInput: this.baselineInputTokens,
        estimatedStreamTokens: this.estimatedStreamTokens,
        estimatedTotal,
        ratio: Math.round(ratio * 100) / 100,
        severity,
      });
      return {
        currentTokens: estimatedTotal,
        contextLimit: limit,
        outputTokensSoFar: this.estimatedStreamTokens,
        ratio,
        severity,
      };
    } catch (err) {
      logger.warn('unified:checkDuringStreaming error', {
        error: String(err),
        model,
      });
      return {
        currentTokens: 0,
        contextLimit: 0,
        outputTokensSoFar: 0,
        ratio: 0,
        severity: 'normal',
      };
    }
  }

  /** 启动流式检查定时器：每 1.5s 检查水位并通知前端（实时进度条更新） */
  startStreamingCheck(onNotify: (state: WatermarkState) => void): void {
    try {
      this.checkInterval = setInterval(() => {
        try {
          const state = this.checkDuringStreaming(
            this.currentModel,
            this.totalMessageChars
          );
          // 始终通知前端（进度条实时刷新），store 层有 dedup 保护
          onNotify(state);
          // 仅在严重级别变化时记录日志
          if (state.severity !== this.lastNotifiedSeverity) {
            this.lastNotifiedSeverity = state.severity;
            if (state.severity !== 'normal') {
              logger.info('unified:streamingWatermark', {
                severity: state.severity,
                ratio: Math.round(state.ratio * 100) / 100,
                currentTokens: state.currentTokens,
                contextLimit: state.contextLimit,
              });
            }
          }
        } catch (err) {
          logger.warn('unified:streamingCheck interval error', {
            error: String(err),
          });
        }
      }, 1500);
    } catch (err) {
      handleError(err, {
        module: 'core:tokenBudget',
        action: 'start_streaming_check',
      });
    }
  }

  /** 停止流式检查定时器 */
  stopStreamingCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // ==========================================
  // 请求后记录
  // ==========================================

  /** 请求后记录：复用 UsageExtractor 自动解析多种 API 格式 */
  recordPostRequest(apiBody: Record<string, unknown>): void {
    try {
      const usage = extractUsage(apiBody);
      if (!usage) return;
      this.controller.recordUsage(usage.inputTokens, usage.outputTokens);

      // 更新校准因子（EMA 平滑 + overhead 修正）
      const overhead = this.overheadSystemPrompt + this.overheadToolDefs;
      const correctedInput = usage.inputTokens - overhead;
      if (this.baselineInputTokens > 0 && correctedInput > 0) {
        const raw = correctedInput / this.baselineInputTokens;
        if (isFinite(raw) && raw > 0) {
          const oldFactor = this.calibrationFactor;
          this.calibrationFactor =
            this.CALIBRATION_ALPHA * raw +
            (1 - this.CALIBRATION_ALPHA) * this.calibrationFactor;
          // 持久化校准因子（按模型，重启后直接恢复，无需重新学习）
          persistCalibrationFactor(this.currentModel, this.calibrationFactor);
          logger.info('unified:calibration updated', {
            oldFactor: Math.round(oldFactor * 100) / 100,
            newFactor: Math.round(this.calibrationFactor * 100) / 100,
            raw,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          });
        }
      }
    } catch (err) {
      logger.warn('unified:recordPostRequest error', { error: String(err) });
    }
  }

  // ==========================================
  // 压缩记录
  // ==========================================

  /** 压缩后记录：写入 ContextTracker 复用现有持久化 */
  recordCompaction(beforeTokens: number, afterTokens: number): void {
    try {
      const savedPercent =
        beforeTokens > 0 ? (1 - afterTokens / beforeTokens) * 100 : 0;
      this.contextTracker.record({
        timestamp: Date.now(),
        turnCount: 0,
        engineName: 'UnifiedTokenTracker',
        beforeTokens,
        afterTokens,
        compressionRatio: afterTokens / beforeTokens,
        messageCountBefore: 0,
        messageCountAfter: 0,
        hasFocusTopic: false,
      });
      this.compactionHistory.push({ savedPercent, timestamp: Date.now() });
      if (this.compactionHistory.length > this.ANTI_FLAP_WINDOW) {
        this.compactionHistory.shift();
      }
      logger.info('unified:compaction recorded', {
        beforeTokens,
        afterTokens,
        savedPercent: Math.round(savedPercent),
        model: this.currentModel,
      });
    } catch (err) {
      logger.warn('unified:recordCompaction error', { error: String(err) });
    }
  }

  /** 反抖动检查：连续 N 次压缩节省不足时跳过 */
  shouldSkipDueToAntiFlapping(): boolean {
    if (this.compactionHistory.length < this.ANTI_FLAP_WINDOW) return false;
    const recent = this.compactionHistory.slice(-this.ANTI_FLAP_WINDOW);
    return recent.every(
      (r) => r.savedPercent / 100 < this.ANTI_FLAP_MIN_SAVING
    );
  }

  /** 清除反抖动历史（如 context_length_exceeded 发生时应调用） */
  clearAntiFlappingHistory(): void {
    this.compactionHistory = [];
  }

  // ==========================================
  // 模型切换
  // ==========================================

  /** 模型切换：重置校准因子、重算 budget total、标记压缩历史失效 */
  onModelSwitch(newModel: string): void {
    const newWindow = resolveContextWindow(newModel).tokens;
    this.currentModel = newModel;
    this.controller.setModel(newModel);
    if (this.controller.getUsedBudget() >= newWindow) {
      this.baselineInputTokens = 0;
      this.totalMessageChars = 0;
      this.estimatedStreamTokens = 0;
    }
    // 加载该模型的持久化校准因子（重启后无需从默认重新学习；无记录则用默认 1.2）
    const persisted = getCalibrationFactor(newModel);
    this.calibrationFactor = persisted ?? 1.2;
    if (persisted) {
      logger.info('unified:calibration loaded from store', {
        model: newModel,
        factor: Math.round(persisted * 100) / 100,
      });
    }
    this.compactionHistory.forEach((r) => {
      r.crossModel = true;
    });
  }

  // ==========================================
  // 生命周期
  // ==========================================

  /** 订阅 Trace 引擎的真实 usage，用于校准因子闭环 */
  private _subscribeTraceUsage(): void {
    const self = this;
    const callback = (usage: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreateTokens: number;
      durationMs: number;
      status: number;
      timestamp: string;
    }) => {
      self._onTraceUsage(usage);
    };
    traceUsageListeners.push(callback);
    this._unsubscribeTrace = () => {
      const idx = traceUsageListeners.indexOf(callback);
      if (idx >= 0) traceUsageListeners.splice(idx, 1);
    };
  }

  /** 收到 Trace 引擎的真实 token 消耗时，更新校准因子并记录 budget */
  private _onTraceUsage(usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreateTokens: number;
    durationMs: number;
    status: number;
    timestamp: string;
  }): void {
    try {
      // 记录到 TokenBudgetController
      this.controller.recordUsage(usage.inputTokens, usage.outputTokens);

      // 更新校准因子：真实 inputTokens / 估算 baselineInputTokens
      const overhead = this.overheadSystemPrompt + this.overheadToolDefs;
      const correctedInput = usage.inputTokens - overhead;
      if (this.baselineInputTokens > 0 && correctedInput > 0) {
        const raw = correctedInput / this.baselineInputTokens;
        if (isFinite(raw) && raw > 0) {
          const oldFactor = this.calibrationFactor;
          this.calibrationFactor =
            this.CALIBRATION_ALPHA * raw +
            (1 - this.CALIBRATION_ALPHA) * this.calibrationFactor;
          // 持久化校准因子（按模型，重启后直接恢复）
          persistCalibrationFactor(usage.model, this.calibrationFactor);
          logger.info('unified:calibration updated from trace', {
            source: 'trace',
            oldFactor: Math.round(oldFactor * 100) / 100,
            newFactor: Math.round(this.calibrationFactor * 100) / 100,
            raw,
            traceInputTokens: usage.inputTokens,
            traceOutputTokens: usage.outputTokens,
            baselineInputTokens: this.baselineInputTokens,
            model: usage.model,
          });
        }
      }
    } catch (err) {
      logger.warn('unified:_onTraceUsage error', { error: String(err) });
    }
  }

  /** 订阅子 Agent token 消耗汇聚 */
  private _subscribeSubAgentUsage(): void {
    const self = this;
    const callback = (usage: {
      sessionId: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }) => {
      self._onSubAgentUsage(usage);
    };
    subAgentTokenListeners.push(callback);
    this._unsubscribeSubAgent = () => {
      const idx = subAgentTokenListeners.indexOf(callback);
      if (idx >= 0) subAgentTokenListeners.splice(idx, 1);
    };
  }

  /** 收到子 Agent 的 token 消耗时，计入父会话预算 */
  private _onSubAgentUsage(usage: {
    sessionId: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): void {
    try {
      this.controller.recordUsage(usage.promptTokens, usage.completionTokens);
      logger.info('unified:subAgent usage recorded', {
        sessionId: usage.sessionId,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      });
    } catch (err) {
      logger.warn('unified:_onSubAgentUsage error', { error: String(err) });
    }
  }

  /** 实例级清理 */
  dispose(): void {
    this.stopStreamingCheck();
    this.lastNotifiedSeverity = 'normal';
    this.compactionHistory = [];
    this.baselineInputTokens = 0;
    this.totalMessageChars = 0;
    this.estimatedStreamTokens = 0;
    if (this._unsubscribeTrace) {
      this._unsubscribeTrace();
      this._unsubscribeTrace = null;
    }
    if (this._unsubscribeSubAgent) {
      this._unsubscribeSubAgent();
      this._unsubscribeSubAgent = null;
    }
  }

  /** 从会话元数据恢复实例 */
  static fromSession(
    session: {
      metadata?: {
        tokenBudget?: { total: number; spent: number };
        currentModel?: string;
        calibrationFactor?: number;
      };
    },
    contextTracker: ContextTracker
  ): UnifiedTokenTracker {
    const contextWindow = resolveContextWindow(
      session.metadata?.currentModel ?? 'default'
    ).tokens;
    const storedBudget = session.metadata?.tokenBudget as
      | { total: number; spent: number; remaining?: number }
      | undefined;
    const budget = storedBudget
      ? {
          total: storedBudget.total,
          remaining:
            storedBudget.remaining ??
            storedBudget.total - (storedBudget.spent ?? 0),
          used: storedBudget.spent ?? 0,
        }
      : {
          total: contextWindow,
          remaining: contextWindow,
          used: 0,
        };
    const controller = new TokenBudgetController(
      'default',
      budget,
      budget.total
    );
    const tracker = new UnifiedTokenTracker(controller, contextTracker);
    if (session.metadata?.calibrationFactor) {
      tracker.calibrationFactor = session.metadata.calibrationFactor;
    }
    return tracker;
  }
}
