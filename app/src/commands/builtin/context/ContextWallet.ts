// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ContextWallet — /context wallet 上下文钱包可视化
 *
 * P1-14: 对标 PilotDeck /context 可视化
 *
 * 提供 Token 用量按类别分解 + 优化建议生成，
 * 帮助用户了解上下文消费情况并做出优化决策。
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'commands:builtin:context:wallet' });

// ============================================================
// Types
// ============================================================

/** 单个模型的用量条目 */
export interface ModelUsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  requests: number;
}

/** 上下文钱包完整分解 */
export interface WalletBreakdown {
  sessionId: string;
  /** Token 分类 */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  /** 成本 */
  estimatedCostUsd: number;
  cacheSavingsUsd: number;
  /** 请求数 */
  totalRequests: number;
  /** 运行时长(秒) */
  sessionDurationSec: number;
  /** 各模型明细 */
  models: ModelUsageEntry[];
  /** 优化建议 */
  suggestions: WalletSuggestion[];
}

/** 优化建议类型 */
export type SuggestionType =
  | 'compact'
  | 'trim_tools'
  | 'enable_cache'
  | 'route_cheaper'
  | 'near_limit';

/** 优化建议 */
export interface WalletSuggestion {
  type: SuggestionType;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  action: string;
}

// ============================================================
// 分析函数
// ============================================================

/**
 * 分析当前会话的上下文使用情况
 * 聚合 CostTracker + LLMTracker + PromptCacheManager 数据
 */
export async function analyzeContextUsage(
  sessionId: string
): Promise<WalletBreakdown> {
  const suggestions: WalletSuggestion[] = [];

  // Get session-level stats from LLMTracker
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let reasoningTokens = 0;
  let estimatedCostUsd = 0;
  let totalRequests = 0;
  let modelsList: string[] = [];
  let sessionFromLLMTracker = false;

  try {
    const { getLLMTracker } = await import(
      '@modules/monitoring/llm/getLLMTracker'
    );
    const tracker = getLLMTracker();
    const stats = tracker.getSessionStats(sessionId);
    if (stats) {
      inputTokens = stats.totalInputTokens;
      outputTokens = stats.totalOutputTokens;
      cacheReadTokens = stats.totalCacheReadTokens;
      cacheCreationTokens = stats.totalCacheCreateTokens;
      reasoningTokens = stats.totalReasoningTokens;
      estimatedCostUsd = stats.totalCostUsd;
      totalRequests = stats.totalRequests;
      modelsList = stats.models;
      sessionFromLLMTracker = true;
    }
  } catch (err) {
    logger.debug('LLMTracker unavailable, using CostTracker fallback', {
      error: String(err),
    });
  }

  // Fallback: use global CostTracker
  let globalCostUsd = estimatedCostUsd;
  if (!sessionFromLLMTracker) {
    try {
      const { costTracker } = await import('../../../cost/CostTracker');
      inputTokens = costTracker.getTotalInputTokens();
      outputTokens = costTracker.getTotalOutputTokens();
      cacheReadTokens = costTracker.getTotalCacheReadInputTokens();
      cacheCreationTokens = costTracker.getTotalCacheCreationInputTokens();
      reasoningTokens = costTracker.getTotalReasoningTokens();
      globalCostUsd = costTracker.getTotalCostUSD();
    } catch {
      // best-effort
    }
  }

  // Get cache savings
  let cacheSavingsUsd = 0;
  try {
    const { promptCacheManager } = await import(
      '../../../ai/prompts/PromptCacheManager'
    );
    const cacheStats = promptCacheManager.getCacheStats(sessionId);
    if (cacheStats) {
      cacheSavingsUsd = cacheStats.estimatedSavingsUsd;
    } else {
      cacheSavingsUsd = promptCacheManager.getTotalSavings();
    }
  } catch {
    // best-effort
  }

  // Session duration
  let sessionDurationSec = 0;
  try {
    const { costTracker } = await import('../../../cost/CostTracker');
    sessionDurationSec = Math.round(costTracker.getSessionDuration() / 1000);
  } catch {
    // best-effort
  }

  // Per-model breakdown
  const models: ModelUsageEntry[] = [];
  try {
    const { getModelUsage } = await import('../../../cost/CostTracker');
    const modelUsage = getModelUsage();
    for (const [model, usage] of Object.entries(modelUsage)) {
      models.push({
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadInputTokens ?? 0,
        cacheCreationTokens: usage.cacheCreationInputTokens ?? 0,
        costUsd: usage.costUSD,
        requests: usage.requestCount,
      });
    }
    models.sort((a, b) => b.costUsd - a.costUsd);
  } catch {
    // best-effort
  }

  const totalTokens = inputTokens + outputTokens;

  // Generate suggestions
  generateContextSuggestions(
    {
      totalTokens,
      cacheReadTokens,
      cacheCreationTokens,
      models,
      totalRequests,
    },
    suggestions
  );

  return {
    sessionId,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    reasoningTokens,
    totalTokens,
    estimatedCostUsd: globalCostUsd || estimatedCostUsd,
    cacheSavingsUsd,
    totalRequests,
    sessionDurationSec,
    models,
    suggestions,
  };
}

// ============================================================
// 优化建议生成
// ============================================================

interface SuggestionInput {
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  models: ModelUsageEntry[];
  totalRequests: number;
}

/**
 * 基于用量数据生成 5 类优化建议
 */
export function generateContextSuggestions(
  data: SuggestionInput,
  target: WalletSuggestion[] = []
): WalletSuggestion[] {
  // 1. Near context limit → suggest compaction
  const MAX_SAFE_TOKENS = 100_000;
  if (data.totalTokens > MAX_SAFE_TOKENS) {
    target.push({
      type: 'near_limit',
      severity: data.totalTokens > 180_000 ? 'critical' : 'warning',
      message: `上下文接近上限 (${data.totalTokens.toLocaleString()} tokens)`,
      action: '建议执行 /context compact 压缩上下文，或 /context trim <N> 裁剪旧消息',
    });
  }

  // 2. Cache not utilized → suggest enable cache
  const cacheHitRate =
    data.totalTokens > 0
      ? data.cacheReadTokens / (data.cacheReadTokens + data.cacheCreationTokens + 1)
      : 0;
  if (data.totalTokens > 10_000 && cacheHitRate < 0.1) {
    target.push({
      type: 'enable_cache',
      severity: 'info',
      message: `缓存命中率低 (${(cacheHitRate * 100).toFixed(1)}%)，未充分利用 Prompt 缓存`,
      action: '使用 Anthropic 模型时 cache_control 可降低 90% 输入成本。换用 Claude 模型可获得缓存加速。',
    });
  }

  // 3. High-cost model dominating → suggest routing
  const highCostModels = data.models.filter((m) => m.costUsd > 0.5);
  if (highCostModels.length > 0) {
    const expensiveModel = highCostModels[0];
    target.push({
      type: 'route_cheaper',
      severity: 'warning',
      message: `模型 ${expensiveModel.model} 成本较高 ($${expensiveModel.costUsd.toFixed(4)}), ${expensiveModel.requests} 次请求`,
      action: '简单任务可路由到廉价模型。执行 /models tasks 查看当前任务分工配置。',
    });
  }

  // 4. High request count without cache → suggest trimming tools
  if (data.totalRequests > 20 && cacheHitRate < 0.2) {
    target.push({
      type: 'trim_tools',
      severity: 'info',
      message: `${data.totalRequests} 次请求中工具定义可能占用大量上下文`,
      action: '检查是否启用了不必要的工具。MCP 工具可通过 /mcp disable <tool> 禁用。',
    });
  }

  // 5. Context growing rapidly → suggest proactive compact
  if (data.totalTokens > 50_000 && data.totalTokens < MAX_SAFE_TOKENS) {
    target.push({
      type: 'compact',
      severity: 'info',
      message: `上下文正在增长 (${data.totalTokens.toLocaleString()} tokens)，建议提前压缩`,
      action: '执行 /context compact 可触发自动摘要压缩，减少后续轮次的 Token 消耗。',
    });
  }

  return target;
}

// ============================================================
// 格式化输出
// ============================================================

/** 格式化钱包分解为可读文本 */
export function formatWalletBreakdown(breakdown: WalletBreakdown): string {
  const lines: string[] = ['## 上下文钱包', ''];

  // Session summary
  lines.push('### 会话概览');
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 会话 ID | ${breakdown.sessionId} |`);
  lines.push(
    `| 总 Token | ${breakdown.totalTokens.toLocaleString()} |`
  );
  lines.push(
    `| 估计成本 | $${breakdown.estimatedCostUsd.toFixed(6)} |`
  );
  if (breakdown.sessionDurationSec > 0) {
    const mins = Math.floor(breakdown.sessionDurationSec / 60);
    const secs = breakdown.sessionDurationSec % 60;
    lines.push(`| 运行时长 | ${mins}m ${secs}s |`);
  }
  lines.push(
    `| 请求数 | ${breakdown.totalRequests} |`
  );
  lines.push('');

  // Token breakdown
  lines.push('### Token 分解');
  lines.push(`| 类别 | Token 数 | 占比 |`);
  lines.push(`|------|---------|------|`);
  const total = breakdown.totalTokens || 1;
  lines.push(
    `| 输入 | ${breakdown.inputTokens.toLocaleString()} | ${((breakdown.inputTokens / total) * 100).toFixed(1)}% |`
  );
  lines.push(
    `| 输出 | ${breakdown.outputTokens.toLocaleString()} | ${((breakdown.outputTokens / total) * 100).toFixed(1)}% |`
  );
  if (breakdown.cacheReadTokens > 0) {
    lines.push(
      `| 缓存读取 | ${breakdown.cacheReadTokens.toLocaleString()} | — |`
    );
  }
  if (breakdown.cacheCreationTokens > 0) {
    lines.push(
      `| 缓存写入 | ${breakdown.cacheCreationTokens.toLocaleString()} | — |`
    );
  }
  if (breakdown.reasoningTokens > 0) {
    lines.push(
      `| 推理 | ${breakdown.reasoningTokens.toLocaleString()} | — |`
    );
  }
  lines.push('');

  // Cost & savings
  lines.push('### 成本');
  lines.push(`- 估计成本: **$${breakdown.estimatedCostUsd.toFixed(6)}**`);
  if (breakdown.cacheSavingsUsd > 0) {
    lines.push(
      `- 缓存节省: **$${breakdown.cacheSavingsUsd.toFixed(6)}**`
    );
    const savingsRate =
      (breakdown.cacheSavingsUsd /
        (breakdown.estimatedCostUsd + breakdown.cacheSavingsUsd + 0.000001)) *
      100;
    lines.push(`- 节省率: **${savingsRate.toFixed(1)}%**`);
  }
  lines.push('');

  // Per-model breakdown
  if (breakdown.models.length > 0) {
    lines.push('### 各模型明细');
    lines.push(`| 模型 | 请求 | 输入 | 输出 | 成本 |`);
    lines.push(`|------|------|------|------|------|`);
    for (const m of breakdown.models.slice(0, 10)) {
      lines.push(
        `| ${m.model} | ${m.requests} | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | $${m.costUsd.toFixed(6)} |`
      );
    }
    lines.push('');
  }

  // Suggestions
  if (breakdown.suggestions.length > 0) {
    lines.push('### 优化建议');
    for (const s of breakdown.suggestions) {
      const icon =
        s.severity === 'critical'
          ? '🔴'
          : s.severity === 'warning'
            ? '🟡'
            : '🔵';
      lines.push(`${icon} **${s.message}**`);
      lines.push(`   → ${s.action}`);
      lines.push('');
    }
  } else {
    lines.push('### 优化建议');
    lines.push('✅ 上下文使用健康，暂无优化建议。');
    lines.push('');
  }

  return lines.join('\n');
}
