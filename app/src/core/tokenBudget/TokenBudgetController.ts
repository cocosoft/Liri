/**
 * Token预算控制器 - 增强版
 * 管理token使用预算，防止超出限制
 *
 * 增强功能:
 * - Cache-aware Token 追踪
 * - 上下文分类统计
 * - 多供应商/多模型支持
 *
 * === Phase 2.9 TokenBudget 收敛迁移计划 ===
 *
 * 当前状态（v9.3）:
 *   ┌─ TokenBudgetManager         (services/)  — @deprecated → QueryEngine.ts 使用
 *   ├─ TokenBudgetManagerImpl      (query/)     — @deprecated → ChatManager/TAORLoop 使用
 *   └─ TokenBudgetController      (core/)       — ★ 迁移目标，零活跃调用方
 *
 * 缺失能力（迁移前需补齐）:
 *   1. CJK 感知估算 — 当前仅 chars/4+Rust原生，需集成 ai/tokenizer/TokenEstimator
 *   2. checkDecliningReturn() — query/TokenBudget 独有，检测压缩收益递减
 *   3. graceCall() — query/TokenBudget 独有，紧急追加调用
 *   4. shouldCompact() 阈值 — services/TokenBudgetManager 的 70%/85% 警告体系
 *
 * 迁移路径:
 *   Phase A: 补齐缺失能力 + 单元测试
 *   Phase B: QueryEngine → 切到 TokenBudgetController
 *   Phase C: ChatManager + TAORLoop → 切到 TokenBudgetController
 *   Phase D: 删除 services/TokenBudgetManager + query/TokenBudgetManagerImpl
 */

import { priceManager } from './PriceManager';
import { modelContextCache } from './ModelContextCache';
import {
  calculateCacheAwareUsage,
  getCacheEfficiency,
} from './CacheAwareBudget';
import {
  createContextStatsCollector,
  type ContextStatsCollector,
} from './ContextStatsCollector';
import type {
  APIProviderType,
  TokenUsageDetail,
  ContextStats,
  TokenUsage,
} from './types';
import { estimateTokens } from '../../ai/tokenizer/TokenEstimator';
import { Logger, LogLevel } from '../../monitoring/logs/Logger';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'tokenBudget:controller',
});

// === Phase 1a: 统一阈值常量 — 所有方法共享 ===
export const UNIFIED_THRESHOLDS = {
  COMPACT_LIGHT: 0.5, // 50% → getCompressionLevel 1
  COMPACT_MEDIUM: 0.7, // 70% → getCompressionLevel 2
  WARNING: 0.75, // 75% → getCurrentBudgetState isWarning
  COMPACT_DEEP: 0.85, // 85% → getCurrentBudgetState isCritical / getCompressionLevel 3
  CRITICAL: 0.92, // 92% → checkBudget CRITICAL
} as const;

/** Phase 2.9: 统一 TokenBudgetStatus 枚举 */
export enum TokenBudgetStatus {
  NORMAL = 'normal',
  WARNING = 'warning',
  CRITICAL = 'critical',
  EXCEEDED = 'exceeded',
}

/** Phase 2.9: 统一 TokenBudgetState 接口（兼容 QueryEngine + TAORLoop） */
export interface TokenBudgetState {
  status: TokenBudgetStatus;
  currentTokens: number;
  maxTokens: number;
  maxOutputTokens: number;
  percentUsed: number;
  isWarning: boolean;
  isCritical: boolean;
  remainingTokens: number;
  remainingOutputTokens: number;
  resetAt: number;
  totalTokensUsed: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalOutputTokensUsed: number;
  messagesProcessed: number;
  shouldCompact: boolean;
  modelName: string;
  warningMessage?: string;
}

let nativeEstimateTokens: ((text: string, model?: string) => number) | null =
  null;

function lazyInitNative() {
  if (nativeEstimateTokens === undefined) {
    try {
      const native = require('../../../native');
      if (native && typeof native.estimateTokens === 'function') {
        nativeEstimateTokens = (text, model) =>
          native.estimateTokens(text, model);
      } else {
        nativeEstimateTokens = null;
      }
    } catch (err) {
      logger.warn('tokenBudget:lazyInitNative failed', { error: String(err) });
      nativeEstimateTokens = null;
    }
  }
  return nativeEstimateTokens;
}

export interface TokenBudgetParams {
  total: number;
  remaining: number;
  used?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

export interface CacheAwareTokenUsage extends TokenUsage {
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCost: number;
}

export class TokenBudgetController {
  private budget: TokenBudgetParams;
  private spent: number = 0;
  private model: string;
  private contextWindow: number;
  private provider: APIProviderType;
  private contextStats: ContextStatsCollector;

  // Phase 2.9: 统一能力
  private totalTokensUsed: number = 0;
  private totalOutputTokensUsed: number = 0;
  private totalCacheReadTokens: number = 0;
  private totalCacheCreationTokens: number = 0;
  private messagesProcessed: number = 0;
  private resetAt: number = Date.now();
  private readonly WARNING_THRESHOLD = UNIFIED_THRESHOLDS.WARNING;
  private readonly CRITICAL_THRESHOLD = UNIFIED_THRESHOLDS.COMPACT_DEEP;
  // Declining return detection
  private recentTurnTokenUsage: number[] = [];
  private readonly DECLINING_RETURN_WINDOW = 3;
  private graceCallsUsed: number = 0;
  private readonly MAX_GRACE_CALLS = 3;

  constructor(
    model: string,
    budget: TokenBudgetParams,
    contextWindow?: number
  ) {
    this.model = model;
    this.budget = {
      total: budget.total,
      remaining: budget.remaining,
      used: budget.used || 0,
      maxInputTokens: budget.maxInputTokens,
      maxOutputTokens: budget.maxOutputTokens,
    };
    this.contextWindow = contextWindow || this.getContextWindowForModel(model);
    this.spent = this.budget.used || 0;
    this.provider = this.detectProvider(model);
    this.contextStats = createContextStatsCollector();
  }

  private detectProvider(model: string): APIProviderType {
    const lower = model.toLowerCase();
    if (lower.includes('deepseek')) return 'deepseek';
    if (lower.includes('gpt') || lower.includes('openai')) return 'openai';
    if (lower.includes('bedrock')) return 'bedrock';
    if (lower.includes('vertex')) return 'vertex';
    if (lower.includes('azure')) return 'azure';
    return 'anthropic';
  }

  private getContextWindowForModel(model: string): number {
    const cached = modelContextCache.get(model);
    if (cached) return cached.contextWindow;

    try {
      const priceResult = priceManager.getPriceSync(model);
      return priceResult.contextWindow;
    } catch (err) {
      logger.warn('tokenBudget:getContextWindow failed', {
        error: String(err),
        model,
      });
      return 200_000;
    }
  }

  shouldContinue(): boolean {
    return this.budget.remaining > 0;
  }

  recordUsage(inputTokens: number, outputTokens: number): TokenUsage {
    const totalTokens = inputTokens + outputTokens;
    this.spent += totalTokens;
    this.budget.remaining = Math.max(0, this.budget.total - this.spent);

    if (this.budget.used !== undefined) {
      this.budget.used = this.spent;
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      budgetRemaining: this.budget.remaining,
      budgetPercentage: (this.budget.remaining / this.budget.total) * 100,
    };
  }

  recordCacheAwareUsage(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
    cacheCreationTokens: number = 0
  ): CacheAwareTokenUsage {
    const usage = calculateCacheAwareUsage(
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      this.model
    );

    const totalTokens = inputTokens + outputTokens;
    this.spent += totalTokens;
    this.budget.remaining = Math.max(0, this.budget.total - this.spent);

    if (this.budget.used !== undefined) {
      this.budget.used = this.spent;
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      estimatedCost: usage.estimatedCost,
      budgetRemaining: this.budget.remaining,
      budgetPercentage: (this.budget.remaining / this.budget.total) * 100,
    };
  }

  getCacheEfficiencyMetrics(
    cacheReadTokens: number,
    cacheCreationTokens: number
  ) {
    return getCacheEfficiency(cacheReadTokens, cacheCreationTokens, this.model);
  }

  addSystemPromptTokens(tokens: number): void {
    this.contextStats.addSystemPrompt(tokens);
  }

  addToolsTokens(tokens: number): void {
    this.contextStats.addTools(tokens);
  }

  addMemoryFilesTokens(tokens: number): void {
    this.contextStats.addMemoryFiles(tokens);
  }

  addMessageTokens(tokens: number): void {
    this.contextStats.addMessages(tokens);
  }

  addDeferredTokens(tokens: number): void {
    this.contextStats.addDeferred(tokens);
  }

  getContextStats(): ContextStats {
    return this.contextStats.collect(this.model);
  }

  resetContextStats(): void {
    this.contextStats.reset();
  }

  getRemainingBudget(): number {
    return this.budget.remaining;
  }

  getUsedBudget(): number {
    return this.spent;
  }

  getTotalBudget(): number {
    return this.budget.total;
  }

  getBudgetPercentage(): number {
    return (this.budget.remaining / this.budget.total) * 100;
  }

  resetBudget(): void {
    this.spent = 0;
    this.totalTokensUsed = 0;
    this.totalOutputTokensUsed = 0;
    this.messagesProcessed = 0;
    this.recentTurnTokenUsage = [];
    this.graceCallsUsed = 0;
    this.resetAt = Date.now();
    this.budget.remaining = this.budget.total;
    if (this.budget.used !== undefined) {
      this.budget.used = 0;
    }
  }

  getModel(): string {
    return this.model;
  }

  getContextWindow(): number {
    return this.contextWindow;
  }

  getProvider(): APIProviderType {
    return this.provider;
  }

  setBudget(budget: TokenBudgetParams): void {
    this.budget = budget;
    this.spent = this.budget.used || 0;
  }

  getBudgetParams(): TokenBudgetParams {
    return { ...this.budget };
  }

  isBudgetExhausted(): boolean {
    return this.budget.remaining <= 0;
  }

  isBudgetLow(): boolean {
    return this.getBudgetPercentage() < 20;
  }

  isBudgetCritical(): boolean {
    return this.getBudgetPercentage() < 10;
  }

  // ==========================================
  // Phase 2.9: 统一接口（兼容 QueryEngine + ChatManager + TAORLoop）
  // ==========================================

  /** 简单 token 消耗（ChatManager path） */
  consumeTokens(tokens: number): void {
    this.spent += tokens;
    this.totalTokensUsed += tokens;
    this.messagesProcessed++;
    this.budget.remaining = Math.max(0, this.budget.total - this.spent);
  }

  /** 输出 token 消耗 */
  consumeOutputTokens(tokens: number): void {
    this.totalOutputTokensUsed += tokens;
  }

  /** 预算状态检查 — 统一到 percentUsed = spent/total 基线 */
  checkBudget(): TokenBudgetStatus {
    const pct = this.budget.total > 0 ? this.spent / this.budget.total : 0;
    let status: TokenBudgetStatus;
    if (this.budget.remaining <= 0) status = TokenBudgetStatus.EXCEEDED;
    else if (pct >= UNIFIED_THRESHOLDS.CRITICAL)
      status = TokenBudgetStatus.EXCEEDED;
    else if (pct >= UNIFIED_THRESHOLDS.COMPACT_DEEP)
      status = TokenBudgetStatus.CRITICAL;
    else if (pct >= UNIFIED_THRESHOLDS.WARNING)
      status = TokenBudgetStatus.WARNING;
    else status = TokenBudgetStatus.NORMAL;
    logger.info('tokenBudget:checkBudget', {
      status,
      percentUsed: Math.round(pct * 100) / 100,
      spent: this.spent,
      total: this.budget.total,
      model: this.model,
    });
    return status;
  }

  /** 获取完整预算状态 */
  getCurrentBudgetState(): TokenBudgetState {
    const remaining = this.getRemainingBudget();
    const percentUsed =
      this.budget.total > 0 ? this.spent / this.budget.total : 0;
    const isWarning = remaining / this.budget.total <= this.WARNING_THRESHOLD;
    const isCritical = remaining / this.budget.total <= this.CRITICAL_THRESHOLD;
    const status = this.checkBudget();

    return {
      status,
      currentTokens: this.spent,
      maxTokens: this.budget.total,
      maxOutputTokens:
        this.budget.maxOutputTokens ?? Math.floor(this.budget.total * 0.2),
      percentUsed,
      isWarning,
      isCritical,
      remainingTokens: remaining,
      remainingOutputTokens: Math.max(
        0,
        (this.budget.maxOutputTokens ?? 0) - this.totalOutputTokensUsed
      ),
      resetAt: this.resetAt,
      totalTokensUsed: this.totalTokensUsed,
      totalCacheReadTokens: this.totalCacheReadTokens,
      totalCacheCreationTokens: this.totalCacheCreationTokens,
      totalOutputTokensUsed: this.totalOutputTokensUsed,
      messagesProcessed: this.messagesProcessed,
      shouldCompact: isWarning || isCritical,
      modelName: this.model,
    };
  }

  /** 更新模型 */
  setModel(modelName: string): void {
    this.model = modelName;
    this.provider = this.detectProvider(modelName);
    this.contextWindow = this.getContextWindowForModel(modelName);
  }

  /** 估算消息 token */
  estimateMessageTokens(content: string): number {
    return estimateTokens(content);
  }

  /** 是否可以发送消息 */
  canSendMessage(content: string): boolean {
    const estimated = this.estimateMessageTokens(content);
    return estimated <= this.budget.remaining;
  }

  /** 是否可以输出指定 token */
  canSendOutput(tokens: number): boolean {
    return (
      tokens <= (this.budget.maxOutputTokens ?? 0) - this.totalOutputTokensUsed
    );
  }

  /** 压缩等级（0=无需, 1=轻度, 2=中度, 3=重度）— 统一使用 UNIFIED_THRESHOLDS */
  getCompressionLevel(): 0 | 1 | 2 | 3 {
    const pct = this.budget.total > 0 ? this.spent / this.budget.total : 0;
    if (pct >= UNIFIED_THRESHOLDS.COMPACT_DEEP) return 3; // 85%→重度（原 90%）
    if (pct >= UNIFIED_THRESHOLDS.COMPACT_MEDIUM) return 2; // 70%→中度
    if (pct >= UNIFIED_THRESHOLDS.COMPACT_LIGHT) return 1; // 50%→轻度
    return 0;
  }

  /** 获取模型名 */
  getModelName(): string {
    return this.model;
  }

  /** Phase 3: 递减回报检测 */
  checkDecliningReturn(): {
    isDeclining: boolean;
    consecutiveLowTurns: number;
  } {
    let consecutiveLowTurns = 0;
    for (let i = this.recentTurnTokenUsage.length - 1; i >= 0; i--) {
      if (this.recentTurnTokenUsage[i] < 100) {
        consecutiveLowTurns++;
      } else {
        break;
      }
    }
    return {
      isDeclining: consecutiveLowTurns >= this.DECLINING_RETURN_WINDOW,
      consecutiveLowTurns,
    };
  }

  /** 是否允许 grace call */
  canUseGraceCall(): boolean {
    return this.graceCallsUsed < this.MAX_GRACE_CALLS;
  }

  /** 使用一次 grace call */
  useGraceCall(): void {
    this.graceCallsUsed++;
  }
}

export function getContextWindowForModel(model: string): number {
  const cached = modelContextCache.get(model);
  if (cached) return cached.contextWindow;

  try {
    const priceResult = priceManager.getPriceSync(model);
    return priceResult.contextWindow;
  } catch (err) {
    logger.warn('tokenBudget:getContextWindowForModel failed', {
      error: String(err),
      model,
    });
    return 200_000;
  }
}

export function getEffectiveContextWindow(
  model: string,
  reservedOutputTokens: number = 20000
): number {
  const contextWindow = getContextWindowForModel(model);
  return Math.max(0, contextWindow - reservedOutputTokens);
}

export function getDefaultTokenBudget(model: string): TokenBudgetParams {
  const contextWindow = getContextWindowForModel(model);
  return {
    total: contextWindow,
    remaining: contextWindow,
    used: 0,
    maxInputTokens: Math.floor(contextWindow * 0.8),
    maxOutputTokens: Math.floor(contextWindow * 0.2),
  };
}

export function estimateTokenCount(text: string): number {
  const native = lazyInitNative();
  if (native) {
    return native(text);
  }
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokenCount(message: unknown): number {
  const native = lazyInitNative();

  function doCount(text: string): number {
    if (native) return native(text);
    return Math.ceil(text.length / 4);
  }

  if (typeof message === 'string') {
    return doCount(message);
  }

  const msg = message as Record<string, unknown>;
  if (msg.content) {
    if (typeof msg.content === 'string') {
      return doCount(msg.content);
    }
    if (Array.isArray(msg.content)) {
      let total = 0;
      for (const part of msg.content) {
        const p = part as Record<string, unknown>;
        if (p.text && typeof p.text === 'string') {
          total += doCount(p.text);
        }
      }
      return total;
    }
  }

  return 0;
}
