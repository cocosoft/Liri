/**
 * AutoCompactionPolicy — 分级压缩触发策略
 *
 * 流式水位监测已迁移到 UnifiedTokenTracker（UnifiedTokenTracker.startStreamingCheck）。
 * 反抖动逻辑已内联到 UnifiedTokenTracker.shouldSkipDueToAntiFlapping()。
 *
 * **当前仍在 CompactionOrchestrator（构造函数 L9-10）和 ChatManager（L1550, L2569）中**
 * **用于发送前压缩评估（非流式路径）。删除前必须完成以下迁移：**
 *   1. CompactionOrchestrator 的评估逻辑迁移到 UnifiedTokenTracker.checkBeforeRequest()
 *   2. ChatManager 两处入口的 autoCompactionPolicy.evaluate() 替换为 unifiedTracker.checkBeforeRequest()
 *   3. 确认反抖动逻辑完全由 UnifiedTokenTracker 接管
 *
 * 决策逻辑：
 *   < 85% → skip
 *   85%-92% → warn（建议 MicroCompact 或 Snip）
 *   > 92% → trigger（必须 Full Compaction）
 *
 * 反抖动：连续 2 次 Full Compaction 各节省 < 10% 则跳过本次
 *
 * === Phase 依赖 DAG ===
 *
 *   Phase 1 (安全)
 *   ├── AsyncContextStorage.resetStore
 *   ├── LifecycleManager.destroyAll
 *   └── context.rs py_free_string
 *        ↓
 *   Phase 1.5 (前置)
 *   ├── ContextErrorCode            ──── 被 Phase 2 所有模块引用
 *   └── ContextStore 驱逐策略
 *        ↓
 *   Phase 2 (基础)
 *   ├── TokenEstimator              ──── 关键路径：AutoCompactionPolicy 依赖
 *   ├── ContextPersistence          ──── 独立，可并行
 *   ├── ContextWindowResolver       ──── 依赖 TokenEstimator
 *   ├── ToolResultBudget            ──── 独立，可并行
 *   └── UsageExtractor              ──── 独立，可并行
 *        ↓
 *   Phase 3 (压缩)                  ──── 依赖 Phase 2 全部模块
 *   ├── MicroCompactionEngine
 *   ├── SnipEngine
 *   ├── toolPairIntegrity
 *   └── AutoCompactionPolicy        ← 本文件
 *        ↓
 *   Phase 4 (架构)
 *   ├── ContextInjector WeakMap
 *   ├── ContextManager DI
 *   ├── SummaryGenerator
 *   └── CostTracker/TokenBudget 迁移
 *        ↓
 *   Phase 5 (生态)
 *   ├── MemoryProvider + MemoryManager
 *   ├── CompactionHooks
 *   └── CompactionMetrics
 */
import {
  estimateMessagesTokens,
  estimateMessagesTokensCooperative,
} from '@modules/ai';
import { resolveContextWindow } from '../window/ContextWindowResolver';
import { getLogger } from '@modules/monitoring';
import { handleError } from '../../error/handleError';

const logger = getLogger('context:compaction:policy');

export type CompactionDecision = 'skip' | 'warn' | 'trigger';

export interface AutoCompactionDecision {
  decision: CompactionDecision;
  snapshot: { tokens: number; maxTokens: number; ratio: number };
  reason?: string;
}

export class AutoCompactionPolicy {
  private warningRatio: number;
  private blockingRatio: number;
  private recentSavings: number[] = [];
  private maxRecentSavings: number;
  /** 逃生计数器：连续因反抖动跳过压缩的次数，超过阈值时强制允许压缩 */
  private antiFlappingSkipCount: number = 0;
  private static readonly ANTI_FLAPPING_ESCAPE = 10;
  /** 逃生后冷却计数：逃生后 N 轮不记录 savings，防止立即重新震荡 */
  private antiFlappingCooldown: number = 0;
  private static readonly ANTI_FLAPPING_COOLDOWN = 5;
  /** 校准因子：EMA 从 API 真实 usage 学习，修正估算偏差。1.0 = 信任估算 */
  private calibrationFactor: number = 1.0;

  /** 消息数量兜底阈值：超过此数量时强制至少 warn（绕过 token 估算偏差） */
  private static readonly MESSAGE_COUNT_FALLBACK = 50;
  /** 消息数兜底触发的水位下限：低于此水位（估算严重偏低但有偏差也不会超限）不强制 */
  private static readonly MESSAGE_COUNT_FALLBACK_RATIO_MIN = 0.3;
  /** 消息数兜底触发的最低比率：仅当估算低于此阈值（50%）时才认为估算失准 */
  private static readonly MESSAGE_COUNT_FALLBACK_RATIO_MAX = 0.5;

  constructor(warningRatio = 0.85, blockingRatio = 0.92) {
    this.warningRatio = warningRatio;
    this.blockingRatio = blockingRatio;
    this.maxRecentSavings = 2; // 反抖动窗口
  }

  /**
   * 获取当前生效的触发阈值（考虑小窗口模型）。
   * C8 修复（压缩链路排查 2026-08-13）：阈值是 evaluate 动态计算的（小窗口 60%/70%，
   * 大窗口构造默认 85%/92%），对外暴露供 /context debug 等诊断输出真实值。
   * @param model 模型名（用于解析上下文窗口判断小窗口）
   */
  getThresholds(model: string): { warnRatio: number; blockRatio: number } {
    const { tokens: maxTokens } = resolveContextWindow(model);
    const isSmallWindow = maxTokens < 128_000;
    return {
      warnRatio: isSmallWindow ? 0.6 : this.warningRatio,
      blockRatio: isSmallWindow ? 0.7 : this.blockingRatio,
    };
  }

  /**
   * 设置校准因子（由 UnifiedTokenTracker 同步，EMA 平滑后的值）
   * @param factor 校准因子，有下限保护避免完全不触发压缩
   */
  setCalibrationFactor(factor: number): void {
    if (!isFinite(factor) || factor <= 0) {
      logger.warn('compaction:invalid calibration factor rejected', { factor });
      return;
    }
    // 下限保护：0.2（tiktoken BPE 精确估算 + Trace 真实数据校准闭环，
    // 因子不会大幅偏离 1.0，但仍需防止极端情况下完全不触发压缩）
    this.calibrationFactor = Math.max(factor, 0.2);
    logger.info('compaction:calibration set', {
      factor: this.calibrationFactor,
    });
  }

  /**
   * 获取当前校准因子
   */
  getCalibrationFactor(): number {
    return this.calibrationFactor;
  }

  /**
   * 评估是否触发压缩（同步估算）
   * @param messages 当前消息列表
   * @param model 模型名（用于解析上下文窗口）
   */
  evaluate(
    messages: readonly { role?: string; content?: string | unknown }[],
    model: string,
    configOverride?: number
  ): AutoCompactionDecision {
    try {
      return this._evaluateWithTokens(
        messages,
        estimateMessagesTokens(messages),
        model,
        configOverride
      );
    } catch (err) {
      void handleError(err, {
        module: 'context:compaction',
        action: '压缩评估失败，回退到warn',
      });
      return {
        decision: 'warn',
        snapshot: { tokens: 0, maxTokens: 0, ratio: 0 },
      };
    }
  }

  /**
   * 评估是否触发压缩（协作式异步估算，不阻塞事件循环）
   * 2026-08-19 TRAE 式回合开始评估：大历史（数百条消息）同步估算会阻塞事件循环
   * （实测约 49s），改分批让出事件循环后评估可安全用于发送前路径。
   * 与 evaluate() 共用决策核心 _evaluateWithTokens，仅估算路径不同（CS01 不重复决策逻辑）。
   */
  async evaluateAsync(
    messages: readonly { role?: string; content?: string | unknown }[],
    model: string,
    configOverride?: number
  ): Promise<AutoCompactionDecision> {
    try {
      return this._evaluateWithTokens(
        messages,
        await estimateMessagesTokensCooperative(messages),
        model,
        configOverride
      );
    } catch (err) {
      void handleError(err, {
        module: 'context:compaction',
        action: '压缩评估失败，回退到warn',
      });
      return {
        decision: 'warn',
        snapshot: { tokens: 0, maxTokens: 0, ratio: 0 },
      };
    }
  }

  /**
   * 决策核心：基于已估算的 rawTokens 计算水位并返回 skip/warn/trigger
   * @param messages 当前消息列表（用于消息数兜底判断）
   * @param rawTokens 已估算的原始 token 数（同步估算或协作式估算的产物）
   */
  private _evaluateWithTokens(
    messages: readonly { role?: string; content?: string | unknown }[],
    rawTokens: number,
    model: string,
    configOverride?: number
  ): AutoCompactionDecision {
    try {
      // 用校准因子修正估算偏差，使 token 计数更接近真实值
      const tokens = Math.round(rawTokens * this.calibrationFactor);
      const { tokens: maxTokens } = resolveContextWindow(model, configOverride);
      // 小窗口模型（<128K，如 llama.cpp n_ctx=4096 本地模型）用更保守的触发阈值：
      // 85%/92% 的触发水位对小窗口几乎等于"压线才动手"，提前到 60%/70% 触发压缩。
      const isSmallWindow = maxTokens < 128_000;
      const warnRatio = isSmallWindow ? 0.6 : this.warningRatio;
      const blockRatio = isSmallWindow ? 0.7 : this.blockingRatio;
      const ratio = maxTokens > 0 ? tokens / maxTokens : 0;

      const snapshot = { tokens, maxTokens, ratio };

      // 水位评估上下文日志（2026-08-14 补充，观察水位触发行为用）：完整展示触发决策的
      // 输入链路——原始估算(rawTokens) × 校准因子 = 修正后 tokens，水位 ratio 与
      // warn/block 阈值对比，以及小窗口判定。一条日志即可定位"为什么 skip/warn/trigger"。
      logger.info('compaction:evaluate context', {
        model,
        messageCount: messages.length,
        rawTokens,
        calibrationFactor: this.calibrationFactor,
        tokens,
        maxTokens,
        ratio: Math.round(ratio * 100) / 100,
        warnRatio,
        blockRatio,
        isSmallWindow,
        warnPct: Math.round(warnRatio * 100),
        blockPct: Math.round(blockRatio * 100),
      });

      // 消息数量兜底：当 token 估算严重偏低时（消息数已达上限但 ratio 处于可疑区间），
      // 强制 trigger 以启动完整 Tier2→Tier3 压缩管线，防止压缩永远不触发。
      // 复检报告（2026-08-14 第三轮）建议联动水位：原实现 ratio < 0.5 一律强制，
      // 短消息会话（130 条/水位 6.9%）每轮都走完整压缩评估偏激进——水位过低（<30%）
      // 时即使估算偏差 3 倍也不会超限，无需强制；仅 0.3-0.5 可疑区间（偏差可能致超限）强制。
      if (
        messages.length > AutoCompactionPolicy.MESSAGE_COUNT_FALLBACK &&
        ratio > AutoCompactionPolicy.MESSAGE_COUNT_FALLBACK_RATIO_MIN &&
        ratio < AutoCompactionPolicy.MESSAGE_COUNT_FALLBACK_RATIO_MAX
      ) {
        logger.info('compaction:evaluate message-count fallback', {
          decision: 'trigger',
          messageCount: messages.length,
          threshold: AutoCompactionPolicy.MESSAGE_COUNT_FALLBACK,
          ratio: Math.round(ratio * 100) / 100,
          tokens,
          maxTokens,
          model,
          isSmallWindow,
          warnRatio,
          blockRatio,
          calibrationFactor: this.calibrationFactor,
        });
        return {
          decision: 'trigger',
          snapshot,
          reason: `message count ${messages.length} > ${AutoCompactionPolicy.MESSAGE_COUNT_FALLBACK} (token ratio ${(ratio * 100).toFixed(1)}% still below ${(warnRatio * 100).toFixed(0)}%, estimation may be off — forcing trigger for safety)`,
        };
      }

      if (ratio < warnRatio) {
        logger.info('compaction:evaluate', {
          decision: 'skip',
          ratio: Math.round(ratio * 100) / 100,
          tokens,
          maxTokens,
          model,
          isSmallWindow,
          warnRatio,
          blockRatio,
          calibrationFactor: this.calibrationFactor,
        });
        return { decision: 'skip', snapshot };
      }

      if (ratio >= blockRatio) {
        // 反抖动检查
        if (this.shouldSkipDueToAntiFlapping()) {
          logger.info('compaction:evaluate anti-flapping skip', {
            ratio: Math.round(ratio * 100) / 100,
            tokens,
            maxTokens,
            model,
            isSmallWindow,
            warnRatio,
            blockRatio,
            calibrationFactor: this.calibrationFactor,
            recentSavings: [...this.recentSavings],
            antiFlappingSkipCount: this.antiFlappingSkipCount,
          });
          return {
            decision: 'skip',
            snapshot,
            reason: `anti-flapping: last ${this.maxRecentSavings} compactions each saved < 10%`,
          };
        }

        logger.info('compaction:evaluate triggered', {
          decision: 'trigger',
          tier: 3,
          ratio: Math.round(ratio * 100) / 100,
          tokens,
          maxTokens,
          model,
          isSmallWindow,
          warnRatio,
          blockRatio,
          calibrationFactor: this.calibrationFactor,
        });
        return {
          decision: 'trigger',
          snapshot,
          reason: `token ratio ${(ratio * 100).toFixed(1)}% >= ${(blockRatio * 100).toFixed(0)}%`,
        };
      }

      logger.info('compaction:evaluate warn', {
        decision: 'warn',
        ratio: Math.round(ratio * 100) / 100,
        tokens,
        maxTokens,
        model,
        isSmallWindow,
        warnRatio,
        blockRatio,
        calibrationFactor: this.calibrationFactor,
      });
      return {
        decision: 'warn',
        snapshot,
        reason: `token ratio ${(ratio * 100).toFixed(1)}% >= ${(warnRatio * 100).toFixed(0)}%`,
      };
    } catch (err) {
      void handleError(err, {
        module: 'context:compaction',
        action: '压缩评估失败，回退到warn',
      });
      return {
        decision: 'warn',
        snapshot: { tokens: 0, maxTokens: 0, ratio: 0 },
      };
    }
  }

  /**
   * 记录压缩节省比例（用于反抖动）
   * @param savedPercent 节省百分比（0-100）
   */
  recordSaving(savedPercent: number): void {
    // 冷却期不记录 savings，防止逃生后立即重新震荡
    if (this.antiFlappingCooldown > 0) {
      this.antiFlappingCooldown--;
      return;
    }
    this.recentSavings.push(savedPercent);
    if (this.recentSavings.length > this.maxRecentSavings) {
      this.recentSavings.shift();
    }
  }

  /**
   * 反抖动：最近 N 次压缩各节省 < 10% 则跳过
   * 逃生机制：连续跳过超过 ANTI_FLAPPING_ESCAPE 次时强制允许压缩，防止永久卡死
   */
  private shouldSkipDueToAntiFlapping(): boolean {
    if (this.recentSavings.length < this.maxRecentSavings) return false;
    if (this.recentSavings.every((s) => s < 10)) {
      this.antiFlappingSkipCount++;
      if (
        this.antiFlappingSkipCount >= AutoCompactionPolicy.ANTI_FLAPPING_ESCAPE
      ) {
        logger.info('compaction:anti_flapping_escape', {
          skipCount: this.antiFlappingSkipCount,
        });
        this.recentSavings = [];
        this.antiFlappingSkipCount = 0;
        this.antiFlappingCooldown = AutoCompactionPolicy.ANTI_FLAPPING_COOLDOWN;
        return false;
      }
      return true;
    }
    this.antiFlappingSkipCount = 0;
    return false;
  }

  /** 重置反抖动状态 */
  reset(): void {
    this.recentSavings = [];
    this.antiFlappingSkipCount = 0;
    this.antiFlappingCooldown = 0;
  }
}

/** 默认实例 */
export const autoCompactionPolicy = new AutoCompactionPolicy();
