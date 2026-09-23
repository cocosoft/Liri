/**
 * UnifiedTokenTracker — Token 跟踪与预算收敛的统一入口
 *
 * Phase 1b: 新建，作为 TokenBudgetController 的统一上层入口。
 * 职责：请求前预检 + 流式水位监测 + 请求后校准 + 压缩历史记录。
 *
 * 最终目标：取代 TokenBudgetController 成为唯一的 token 预算管理入口。
 */

import type { ContextTracker } from '@modules/query';
import { extractUsage } from '@modules/ai';
import {
  estimateTokens,
  estimateMessagesTokensCooperative,
  estimateMessagesTokens,
} from '@modules/ai';
import { getCachedTiktokenEncoder } from '@modules/ai';
import { resolveContextWindow } from '@modules/context';
import { getLogger } from '../../monitoring/logs/Logger';
import { handleError } from '@modules/error';
import {
  TokenBudgetController,
  UNIFIED_THRESHOLDS,
} from './TokenBudgetController';
import { getCalibrationFactor } from './CalibrationStore';
// FSZ-162（2026-09-23）：校准与统计逻辑抽至 `./tokenCalibration`（状态仍由本类持有）
import {
  applyUsageSample,
  calibrationStats,
  createCalibrationState,
} from './tokenCalibration';
import type {
  CalibrationHost,
  CalibrationState,
} from './tokenCalibration';

// D1（2026-09-23）：**不再**订阅 trace-recording 的 usage（`traces/` 已降级为观测层，
// 不可作业务判据）。校准数据源收敛为 `metric/timing` 事件载荷，由调用方直接喂入
// （见 `recordTimingUsage`）——复用既有"调用方直接喂入"通路，不新建总线/轮询。
// 订阅子 Agent token 消耗汇聚
import { subAgentTokenListeners } from './SubAgentTokenBridge';
// 模块级访问器已抽至 `./trackerRegistry`（本文件曾因它达 819 行、超出 lint:size 阈值）
import { setUnifiedTokenTracker } from './trackerRegistry';

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
  /** 决策快照（C7 收敛：由 AutoCompactionPolicy 迁移而来，供调用方显示水位/日志） */
  snapshot: { tokens: number; maxTokens: number; ratio: number };
  /** 决策原因（如消息数兜底强制触发 / 反抖动跳过） */
  reason?: string;
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
export function getModelThresholds(model: string): {
  warn: number;
  compact: number;
} {
  const sorted = Object.keys(MODEL_THRESHOLD_PRESETS).sort(
    (a, b) => b.length - a.length
  );
  const matched = sorted.find((k) => model.startsWith(k));
  return MODEL_THRESHOLD_PRESETS[matched || 'default'];
}

/** 消息数兜底阈值（C7 收敛：checkBeforeRequest 与 fallback 评估共享） */
const MESSAGE_COUNT_FALLBACK = 50;

/**
 * 纯评估 fallback（C7 收敛）：无 UnifiedTokenTracker 实例时的同步兜底评估。
 * 与 checkBeforeRequest 共享阈值表（getModelThresholds）与消息数兜底，
 * 仅不参与校准因子与反抖动状态。正常路径（调用方持有 unifiedTracker）不使用。
 */
export function evaluateCompactionFallback(
  messages: readonly { role?: string; content?: string | unknown }[],
  model: string
): CompactionDecision {
  const estimatedTotal = estimateMessagesTokens(messages);
  const limit = resolveContextWindow(model).tokens;
  const ratio = limit > 0 ? estimatedTotal / limit : 0;
  const thresholds = getModelThresholds(model);

  let decision: 'trigger' | 'warn' | 'skip';
  let reason: string | undefined;
  if (messages.length > MESSAGE_COUNT_FALLBACK && ratio > 0.3 && ratio < 0.5) {
    decision = 'trigger';
    reason = `message count ${messages.length} > ${MESSAGE_COUNT_FALLBACK} (token ratio ${(ratio * 100).toFixed(1)}% below warn, estimation may be off — forcing trigger for safety)`;
  } else if (ratio >= thresholds.compact) {
    decision = 'trigger';
  } else if (ratio >= thresholds.warn) {
    decision = 'warn';
  } else {
    decision = 'skip';
  }
  return {
    decision,
    beforeTokens: estimatedTotal,
    snapshot: { tokens: estimatedTotal, maxTokens: limit, ratio },
    reason,
  };
}

// ==========================================
// UnifiedTokenTracker
// ==========================================

/** 每会话流式状态（并发隔离）——多会话同时流式时互不覆盖 */
interface StreamSessionState {
  baselineInputTokens: number;
  /** 消息总字符数（checkDuringStreaming 回退用，避免正反馈污染） */
  totalMessageChars: number;
  estimatedStreamTokens: number;
  currentModel: string;
  lastNotifiedSeverity: 'normal' | 'warn' | 'compact';
  checkInterval: NodeJS.Timeout | null;
}

// 访问器实现已移至 `./trackerRegistry`；re-export 保持既有导入路径可用
export {
  getUnifiedTokenTracker,
  setUnifiedTokenTracker,
} from './trackerRegistry';

export class UnifiedTokenTracker {
  private readonly controller: TokenBudgetController;
  private readonly contextTracker: ContextTracker;
  /**
   * 校准状态（FSZ-162，2026-09-23：**逻辑**抽至 `./tokenCalibration`，**状态**仍由本类持有
   * —— 因 `factor` 在本类另有 4 处外部触点：模型切换恢复、会话元数据恢复、状态快照、
   * `streamState` 初值；把状态也搬走会连带改动这些触点及其不变量）。
   */
  private readonly calibration: CalibrationState = createCalibrationState();
  /**
   * 校准宿主（窄接口）：用闭包把本类 4 项能力暴露给 `./tokenCalibration`。
   * 闭包体在**调用时**才求值 ⇒ 可安全引用构造函数中才赋值的 `controller`。
   */
  private readonly calibrationHost: CalibrationHost = {
    recordUsage: (input, output) => this.controller.recordUsage(input, output),
    baselineInputTokens: () => this.streamState().baselineInputTokens,
    overheadTokens: () => this.overheadSystemPrompt + this.overheadToolDefs,
    currentModel: () => this.currentModel,
  };
  private compactionHistory: Array<CompactionRecord> = [];
  /** 默认会话流式状态（无 sessionId 调用兼容旧路径，惰性创建） */
  private defaultSession: StreamSessionState | null = null;
  /** 按会话隔离的流式状态（并发防污染） */
  private streamSessions: Map<string, StreamSessionState> = new Map();
  /** 最近活跃模型（日志/校准用，非流式判断依据） */
  private currentModel: string = '';

  // Fixed overhead (set by caller at construction)
  private readonly overheadSystemPrompt: number;
  private readonly overheadToolDefs: number;

  /** 反抖动参数 */
  private readonly ANTI_FLAP_WINDOW = 3;
  private readonly ANTI_FLAP_MIN_SAVING = 0.1;

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

    // D1（2026-09-23）：校准数据源不再订阅 trace（观测层），改由调用方喂入
    // `metric/timing` 事件载荷（`recordTimingUsage`）。
    // 订阅子 Agent token 消耗汇聚
    this._subscribeSubAgentUsage();
  }

  /** 获取当前校准因子（供调用方诊断/日志；C7 收敛后评估在内部闭环，无需外部同步） */
  getCalibrationFactor(): number {
    return this.calibration.factor;
  }

  /**
   * O9/G14：取某会话**当前上下文**的输入 token 估算（最后一次基线的值，非累计）。
   * `baselineInputTokens` 按"本轮消息"覆盖而非累加 ⇒ 正是"父当前上下文大小"口径。
   * 无该会话状态/基线未建立 ⇒ `undefined`（调用方退化，不臆测）；本方法只读、无副作用。
   */
  getCurrentInputTokens(sessionId?: string): number | undefined {
    const state = sessionId
      ? this.streamSessions.get(sessionId)
      : (this.defaultSession ?? undefined);
    if (!state || state.baselineInputTokens <= 0) return undefined;
    return state.baselineInputTokens;
  }

  // ==========================================
  // 请求前评估
  // ==========================================

  /** 开始会话流式监测（并发隔离：每个 session 独立状态，不互相覆盖） */
  beginStreamSession(sessionId: string, model: string): void {
    const existing = this.streamSessions.get(sessionId);
    if (existing) {
      existing.currentModel = model;
      return;
    }
    this.streamSessions.set(sessionId, {
      baselineInputTokens: 0,
      totalMessageChars: 0,
      estimatedStreamTokens: 0,
      currentModel: model,
      lastNotifiedSeverity: 'normal',
      checkInterval: null,
    });
  }

  /** 结束会话流式监测：仅停本会话定时器并移除状态（不再误停其他会话） */
  endStreamSession(sessionId: string): void {
    const state = this.streamSessions.get(sessionId);
    if (state?.checkInterval) {
      clearInterval(state.checkInterval);
      state.checkInterval = null;
    }
    this.streamSessions.delete(sessionId);
  }

  /** 解析流式状态：优先会话级，回退默认态（兼容无 sessionId 旧调用） */
  private streamState(sessionId?: string): StreamSessionState {
    if (sessionId) {
      const state = this.streamSessions.get(sessionId);
      if (state) return state;
    }
    if (!this.defaultSession) {
      this.defaultSession = {
        baselineInputTokens: 0,
        totalMessageChars: 0,
        estimatedStreamTokens: 0,
        currentModel: this.currentModel,
        lastNotifiedSeverity: 'normal',
        checkInterval: null,
      };
    }
    return this.defaultSession;
  }

  /** 请求前评估：估算 input + output 是否超限（2026-08-19 改为异步协作式估算） */
  async checkBeforeRequest(
    messages: readonly { role?: string; content?: string | unknown }[],
    model: string,
    maxOutputTokens?: number,
    sessionId?: string
  ): Promise<CompactionDecision> {
    try {
      this.currentModel = model;
      const state = this.streamState(sessionId);
      state.currentModel = model;
      // 根因①修复：大列表同步估算阻塞事件循环，改用协作式分批估算
      state.baselineInputTokens =
        await estimateMessagesTokensCooperative(messages);
      // 计算消息总字符数（流式水位回退用，避免正反馈污染）
      state.totalMessageChars = messages.reduce(
        (sum, m) =>
          sum + (typeof m.content === 'string' ? m.content.length : 0),
        0
      );
      const estimatedOutput = maxOutputTokens ?? 4096;
      const limit = resolveContextWindow(model).tokens;
      const effectiveFactor =
        this.calibration.factor > 0 ? this.calibration.factor : 1.2;
      const estimatedTotal = state.baselineInputTokens + estimatedOutput;
      // C7 收敛（自 AutoCompactionPolicy）：修正后 tokens + 决策快照（调用方显示水位用）
      const tokens = Math.round(estimatedTotal * effectiveFactor);
      const ratio = limit > 0 ? tokens / limit : 0;
      const snapshot = { tokens, maxTokens: limit, ratio };
      const thresholds = getModelThresholds(model);

      let decision: 'trigger' | 'warn' | 'skip';
      let reason: string | undefined;

      // 消息数兜底：token 估算严重偏低时（消息数已达上限但 ratio 处于可疑区间），
      // 强制 trigger 启动完整压缩管线，防止压缩永远不触发（水位过低 <30% 时即使
      // 估算偏差 3 倍也不会超限，无需强制；仅 0.3-0.5 可疑区间强制）。
      if (
        messages.length > MESSAGE_COUNT_FALLBACK &&
        ratio > 0.3 &&
        ratio < 0.5
      ) {
        decision = 'trigger';
        reason = `message count ${messages.length} > ${MESSAGE_COUNT_FALLBACK} (token ratio ${(ratio * 100).toFixed(1)}% below warn, estimation may be off — forcing trigger for safety)`;
      } else if (ratio >= thresholds.compact) {
        if (this.shouldSkipDueToAntiFlapping()) {
          decision = 'skip';
          reason = 'anti-flapping: last compactions each saved < 10%';
        } else {
          decision = 'trigger';
        }
      } else if (ratio >= thresholds.warn) {
        decision = 'warn';
      } else {
        decision = 'skip';
      }

      logger.info('unified:checkBeforeRequest', {
        decision,
        ratio: Math.round(ratio * 100) / 100,
        estimatedTotal,
        contextLimit: limit,
        model,
        calibrationFactor: Math.round(this.calibration.factor * 100) / 100,
        warnThreshold: thresholds.warn,
        compactThreshold: thresholds.compact,
        reason,
      });
      return { decision, beforeTokens: estimatedTotal, snapshot, reason };
    } catch (err) {
      handleError(err, {
        module: 'core:tokenBudget',
        action: 'check_before_request',
      });
      return {
        decision: 'skip',
        beforeTokens: 0,
        snapshot: { tokens: 0, maxTokens: 0, ratio: 0 },
      };
    }
  }

  // ==========================================
  // 流式中监测
  // ==========================================

  /** 流式中：优先 tiktoken BPE 精确计数，fallback CJK 感知估算，不再用 chars/4 */
  onStreamChunk(chunk: string, sessionId?: string): void {
    try {
      const state = this.streamState(sessionId);
      const encoder = getCachedTiktokenEncoder();
      if (encoder) {
        const result = encoder.encode(chunk);
        state.estimatedStreamTokens += Array.isArray(result)
          ? result.length
          : result.length;
      } else {
        // tiktoken 未加载时回退 CJK 感知估算（≈ 1.5/CJK char，比 chars/4 准确 3-6x）
        state.estimatedStreamTokens += estimateTokens(chunk);
      }
    } catch (err) {
      logger.warn('unified:onStreamChunk error', { error: String(err) });
      // 不阻断流式输出
    }
  }

  /** 重置流式输出 token 计数器（每轮 LLM 调用前调用） */
  resetStreamTokens(sessionId?: string): void {
    this.streamState(sessionId).estimatedStreamTokens = 0;
  }

  /** 更新 per-round baseline（工具执行后消息列表变化时调用） */
  async updateBaselineForRound(
    messages: readonly { role?: string; content?: string | unknown }[],
    model: string,
    sessionId?: string
  ): Promise<void> {
    const state = this.streamState(sessionId);
    state.currentModel = model;
    // 2026-08-19 根因①修复：工具轮间也改协作式估算，避免 mid-stream 阻塞
    state.baselineInputTokens =
      await estimateMessagesTokensCooperative(messages);
    state.totalMessageChars = messages.reduce(
      (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0),
      0
    );
  }

  /** 流式中检查：使用 baselineInputTokens（per-round 估算）而非累计 spent。
   *  getUsedBudget() 是会话累计值，会导致 1.3M/200K=674% 的虚高显示。*/
  checkDuringStreaming(
    model: string,
    _messageCharCount?: number,
    sessionId?: string
  ): WatermarkState {
    try {
      const state = this.streamState(sessionId);
      const limit = resolveContextWindow(model).tokens;
      // 使用 per-round baselineInputTokens（checkBeforeRequest 设置，tiktoken BPE 精确）
      // 不用 getUsedBudget() — 那是会话累计值，跨轮叠加导致 674% 虚高
      const estimatedInput =
        state.baselineInputTokens > 0
          ? state.baselineInputTokens
          : _messageCharCount
            ? Math.ceil(_messageCharCount / 3.5)
            : 0;
      const estimatedTotal = estimatedInput + state.estimatedStreamTokens;
      const ratio = estimatedTotal / limit;
      const thresholds = getModelThresholds(model);
      const severity =
        ratio >= thresholds.compact
          ? ('compact' as const)
          : ratio >= thresholds.warn
            ? ('warn' as const)
            : ('normal' as const);
      logger.debug('unified:checkDuringStreaming', {
        sessionId,
        estimatedInput: state.baselineInputTokens,
        estimatedStreamTokens: state.estimatedStreamTokens,
        estimatedTotal,
        ratio: Math.round(ratio * 100) / 100,
        severity,
      });
      return {
        currentTokens: estimatedTotal,
        contextLimit: limit,
        outputTokensSoFar: state.estimatedStreamTokens,
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
  startStreamingCheck(
    onNotify: (state: WatermarkState) => void,
    sessionId?: string
  ): void {
    try {
      const state = this.streamState(sessionId);
      if (state.checkInterval) clearInterval(state.checkInterval);
      state.checkInterval = setInterval(() => {
        try {
          const s = this.checkDuringStreaming(
            state.currentModel,
            state.totalMessageChars,
            sessionId
          );
          // 始终通知前端（进度条实时刷新），store 层有 dedup 保护
          onNotify(s);
          // 仅在严重级别变化时记录日志
          if (s.severity !== state.lastNotifiedSeverity) {
            state.lastNotifiedSeverity = s.severity;
            if (s.severity !== 'normal') {
              logger.info('unified:streamingWatermark', {
                severity: s.severity,
                ratio: Math.round(s.ratio * 100) / 100,
                currentTokens: s.currentTokens,
                contextLimit: s.contextLimit,
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

  /** 停止流式检查定时器（仅停止本会话的，不再误停其他会话） */
  stopStreamingCheck(sessionId?: string): void {
    const state = this.streamState(sessionId);
    if (state.checkInterval) {
      clearInterval(state.checkInterval);
      state.checkInterval = null;
    }
  }

  // ==========================================
  // 请求后记录
  // ==========================================

  /**
   * D1（2026-09-23）：**校准主通路** —— 喂入 `metric/timing` 事件的用量载荷。
   *
   * 入参是**结构类型**（不 import chat 模块，保持 core 的依赖方向）：
   * `chat/services/timingEvent.ts#buildRequestTimingData` 的产物（`TimingEventData`）
   * 即满足本签名 —— 该校验/构造点是"事件侧 usage"的**唯一实现**，本方法消费它。
   *
   * 缺 usage ⇒ 只计数（`missingUsageSamples`）并保持既有因子，**不用估算冒充**。
   */
  recordTimingUsage(
    sample: { inputTokens?: number; outputTokens?: number },
    model?: string
  ): void {
    try {
      applyUsageSample(
        this.calibration,
        this.calibrationHost,
        sample.inputTokens,
        sample.outputTokens,
        model
      );
    } catch (err) {
      logger.warn('unified:recordTimingUsage error', { error: String(err) });
    }
  }

  /** D1 可观测计数（诊断/单测）：校准样本应用次数与两类缺样本计数 */
  getCalibrationStats(): {
    applied: number;
    missingUsage: number;
    missingBaseline: number;
    factor: number;
  } {
    return {
      applied: this.calibration.applied,
      missingUsage: this.calibration.missingUsage,
      missingBaseline: this.calibration.missingBaseline,
      factor: this.calibration.factor,
    };
  }

  /**
   * 请求后记录：复用 UsageExtractor 自动解析多种 API 格式。
   *
   * 非 chat 路径（`QueryEngine`）的入口：其调用方拿到的是 provider 返回的
   * **原始 usage 对象**（不是 `metric/timing` 载荷）。两条入口共用下面的
   * `applyUsageSample` 单一实现，**数据源都是真实 usage**，无第三方落盘源。
   */
  recordPostRequest(apiBody: Record<string, unknown>): void {
    try {
      const usage = extractUsage(apiBody);
      if (!usage) {
        this.calibration.missingUsage++;
        logger.debug('unified:recordPostRequest 无可解析 usage（不校准）', {
          missingUsage: this.calibration.missingUsage,
        });
        return;
      }
      applyUsageSample(
        this.calibration,
        this.calibrationHost,
        usage.inputTokens,
        usage.outputTokens
      );
    } catch (err) {
      logger.warn('unified:recordPostRequest error', { error: String(err) });
    }
  }

  // （`_applyUsageSample` 已于 FSZ-162（2026-09-23）抽至
  //   `./tokenCalibration#applyUsageSample`；本类仅保留两条入口 + 状态）

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
    // 流式基线由每轮 checkBeforeRequest/updateBaselineForRound 重新估算（per-session），
    // 切换模型无需重置（原全局基线重置逻辑已随 per-session 化移除）
    if (this.controller.getUsedBudget() >= newWindow) {
      // no-op：预算已满时强制下次请求重新评估（checkBeforeRequest 会重算 baseline）
    }
    // 加载该模型的持久化校准因子（重启后无需从默认重新学习；无记录则用默认 1.2）
    const persisted = getCalibrationFactor(newModel);
    this.calibration.factor = persisted ?? 1.2;
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
    // 清理全部会话的流式定时器与状态
    for (const [sid, state] of this.streamSessions) {
      if (state.checkInterval) {
        clearInterval(state.checkInterval);
        state.checkInterval = null;
      }
      this.streamSessions.delete(sid);
    }
    if (this.defaultSession?.checkInterval) {
      clearInterval(this.defaultSession.checkInterval);
      this.defaultSession.checkInterval = null;
    }
    this.compactionHistory = [];
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
    // O9/G14：会话恢复路径同样注册（供摘要预算等跨模块读取"父当前上下文大小"）
    setUnifiedTokenTracker(tracker);
    if (session.metadata?.calibrationFactor) {
      tracker.calibration.factor = session.metadata.calibrationFactor;
    }
    return tracker;
  }
}
