/**
 * 上下文窗口解析器（Phase 2 + P2 DB 动态读取增强 + P1-7 渐进降级探测）
 * 对标 openclaw resolveContextWindowInfo() + PilotDeck 溢出恢复
 *       + hermes-agent 6级降级探测链 + parse_context_limit_from_error
 *
 * 多层 fallback 解析模型上下文窗口大小：
 *   1. DB model_registry 动态读取（context_window 字段，唯一事实来源）
 *   2. 1M 启发式检测
 *   3. 默认 200K
 * 说明：context_window 为模型注册数据（DB model_registry），代码不维护硬编码模型名表。
 */
import { getLogger } from '@modules/monitoring';
import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core';
import { ModelRegistry } from '@modules/ai';

const logger = getLogger('context:window');

/** 默认 fallback 上下文窗口（tokens） */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** P1-7: 最小上下文门槛（低于此值直接拒绝） */
const MINIMUM_CONTEXT_LENGTH = 64_000;

/** P1-7: 运行时降级探测层级（从大到小依次尝试） */
const CONTEXT_PROBE_TIERS = [
  256_000, 128_000, 64_000, 32_000, 16_000, 8_000,
] as const;

/** 1M 上下文关键词（启发式，非供应商特定）
 * #12 修复：移除 '2.0'（子串过于宽泛，未来 qwen-2.0/claude-2.0 等都会被误判为 1M）；
 * 保留带明确 1M 语义的 '1m' 与 '1.5-pro'。模型真实窗口以 DB model_registry 为准。 */
const ONE_M_CONTEXT_KEYWORDS = ['1m', '1.5-pro'] as const;

export interface ContextWindowInfo {
  tokens: number;
  source: 'known_model' | 'config' | 'default' | 'db';
}

/**
 * 从 DB model_registry 表读取上下文窗口（动态路径）
 * 如果 DB 有 model_registry 表且指定模型的 context_window 字段有值，则优先使用
 */
async function resolveFromDB(model: string): Promise<number | null> {
  try {
    const db = new Database(resolveDbPath());
    const row = await new Promise<{ context_window?: number } | undefined>(
      (resolve) => {
        db.get(
          'SELECT context_window FROM model_registry WHERE model_id = ? AND context_window IS NOT NULL AND context_window > 0 LIMIT 1',
          [model],
          (err: Error | null, row: { context_window?: number } | undefined) =>
            resolve(err ? undefined : row)
        );
      }
    );
    if (row?.context_window) return row.context_window;
  } catch {
    // @ignore-catch: DB unavailable, fallback
  }
  return null;
}

/**
 * 解析模型上下文窗口大小（异步，DB 优先）
 * 优先级：DB model_registry → known model → 1M 启发式 → config override → default
 */
export async function resolveContextWindowAsync(
  model: string,
  configOverride?: number
): Promise<ContextWindowInfo> {
  // 0. 尝试从 DB 读取
  const dbWindow = await resolveFromDB(model);
  if (dbWindow) {
    return { tokens: configOverride ?? dbWindow, source: 'db' };
  }

  return resolveContextWindow(model, configOverride);
}

/**
 * 解析模型上下文窗口大小（同步，不含 DB 查询）
 * 优先级：config override → DB 运行时缓存（model_registry 事实来源） → 1M 启发式 → default
 * 注：模型级 context_window 以 DB model_registry 为事实来源（resolveContextWindowAsync）；
 * 同步路径通过 ModelRegistry 内存缓存读取同一来源，避免本地 GGUF 等模型回落默认值导致请求超限。
 */
export function resolveContextWindow(
  model: string,
  configOverride?: number
): ContextWindowInfo {
  // 1. 显式配置覆盖优先
  if (configOverride) {
    return { tokens: configOverride, source: 'config' };
  }

  // 2. DB 运行时缓存（model_registry 唯一事实来源，同步读取不回源 DB）
  const registryModel = ModelRegistry.getInstance().getModel(model);
  const dbWindow = registryModel?.contextWindow;
  if (dbWindow && dbWindow > 0) {
    return { tokens: dbWindow, source: 'db' };
  }

  // 3. 1M context 启发式检测（模型名含 1m 关键词）
  const normalized = model.toLowerCase();
  if (ONE_M_CONTEXT_KEYWORDS.some((k) => normalized.includes(k))) {
    return { tokens: 1_000_000, source: 'known_model' };
  }

  return { tokens: DEFAULT_CONTEXT_WINDOW, source: 'default' };
}

/**
 * 计算有效上下文窗口（预留输出 tokens）
 */
export function getEffectiveContextWindow(
  model: string,
  reservedOutputTokens: number = 20_000
): number {
  const { tokens } = resolveContextWindow(model);
  return Math.max(tokens * 0.95 - reservedOutputTokens, 0);
}

// ============================================================
// P1-7: 运行时降级探测
// 对标 hermes-agent CONTEXT_PROBE_TIERS + parse_context_limit_from_error
// ============================================================

/**
 * P1-7: 从 API 错误响应中提取实际上下文限制
 */
export function parseContextLimitFromError(
  errorMessage: string
): number | null {
  if (!errorMessage) return null;
  const anthropicMatch = /(\d+)\s+maximum|maximum of (\d+)/i.exec(errorMessage);
  if (anthropicMatch) {
    const limit = parseInt(anthropicMatch[1] || anthropicMatch[2], 10);
    if (limit > 0) return limit;
  }
  const openaiMatch = /maximum context length is (\d+)/i.exec(errorMessage);
  if (openaiMatch) return parseInt(openaiMatch[1], 10);
  // llama.cpp 本地服务错误：request (15408 tokens) exceeds the available context size (4096 tokens)
  // 或 request exceeds the available context size (4096 tokens)
  const llamacppMatch =
    /exceeds the available context size \(?\s*(\d+)\s*tokens?\)?/i.exec(
      errorMessage
    );
  if (llamacppMatch) return parseInt(llamacppMatch[1], 10);
  if (/context_length_exceeded|prompt_too_long/i.test(errorMessage)) {
    return -1; // signal: overflow occurred, no exact number
  }
  return null;
}

/**
 * 从 llama.cpp 400 错误中提取真实输入 token 数（n_prompt_tokens）
 * 格式: request (15408 tokens) exceeds the available context size (4096 tokens)
 * 用于与发送前估算对比，量化 estimateMessagesTokens 偏差（校准 calibrationFactor 的依据）。
 */
export function parsePromptTokensFromError(
  errorMessage: string
): number | null {
  if (!errorMessage) return null;
  const match = /request\s*\(\s*(\d[\d,]*)\s*tokens?\)/i.exec(errorMessage);
  if (match) return parseInt(match[1].replace(/,/g, ''), 10);
  return null;
}

export function isOutputCapError(errorMessage: string): boolean {
  return /output.*(?:too|exceed|cap|maximum)/i.test(errorMessage);
}

/**
 * 被动校准：API 返回 context 超限错误时，把服务端真实 n_ctx 回写 DB model_registry，
 * 使应用侧 context_window 自动跟随模型真实能力（云端/Ollama/llama.cpp 通用）。
 * 仅当值不同时更新；失败静默，不阻断请求错误处理链。
 * DB 是唯一事实源，写 DB 后刷新 ModelRegistry 运行时缓存。
 */
export async function calibrateContextWindow(
  model: string,
  actualLimit: number
): Promise<boolean> {
  if (!model || !(actualLimit > 0)) return false;
  try {
    const registry = ModelRegistry.getInstance();
    const existing = registry.getModel(model);
    const current = existing?.contextWindow ?? 0;
    if (current === actualLimit) return false; // 已一致

    const { modelPricingService } =
      await import('../../ai/models/ModelPricingService.js');
    await modelPricingService.initialize();
    const rec = await modelPricingService.getPricing(model);
    if (!rec) return false; // 模型未注册，不校准
    // upsertPricing 更新已有记录时仅 contextWindow 生效，但 input/output 价格必填且会被覆盖，
    // 必须传回原值，避免校准把价格清零
    await modelPricingService.upsertPricing({
      modelId: model,
      contextWindow: actualLimit,
      inputCostPerMillion: rec.inputCostPerMillion,
      outputCostPerMillion: rec.outputCostPerMillion,
    });
    registry.refreshDbPricing().catch(() => {
      // @ignore-catch: 缓存刷新失败不影响 DB 事实源
    });
    logger.info('contextWindow 已自动校准（API 400 回写）', {
      model,
      from: current,
      to: actualLimit,
    });
    return true;
  } catch (err) {
    logger.warn('contextWindow 自动校准失败', {
      model,
      actualLimit,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function getNextDegradationTier(currentTokens: number): number | null {
  const tiers = [...CONTEXT_PROBE_TIERS].sort((a, b) => b - a);
  for (const tier of tiers) {
    if (tier < currentTokens && tier >= MINIMUM_CONTEXT_LENGTH) return tier;
  }
  return null;
}

export function validateMinimumContext(model: string, tokens: number): boolean {
  if (tokens < MINIMUM_CONTEXT_LENGTH) {
    logger.warn('context_window:below_minimum', { model, tokens });
    return false;
  }
  return true;
}

export function applyDegradationProbe(
  model: string,
  errorMessage: string,
  currentTokens: number
): { tokens: number; degraded: boolean; reason: string } {
  const parsedLimit = parseContextLimitFromError(errorMessage);
  if (parsedLimit && parsedLimit > 0 && parsedLimit >= MINIMUM_CONTEXT_LENGTH) {
    return {
      tokens: parsedLimit,
      degraded: true,
      reason: `API reported: ${parsedLimit}`,
    };
  }
  const nextTier = getNextDegradationTier(currentTokens);
  if (nextTier) {
    return {
      tokens: nextTier,
      degraded: true,
      reason: `Probe tier: ${nextTier}`,
    };
  }
  return {
    tokens: DEFAULT_CONTEXT_WINDOW,
    degraded: true,
    reason: 'Exhausted, using default',
  };
}

// ============================================================
// 溢出恢复策略
// ============================================================

/**
 * 渐进式溢出恢复策略
 * 对标 PilotDeck ContextOverflowRecovery: 50% → 25% → give_up
 */
export interface RecoveryDecision {
  action: 'truncate_head_and_retry' | 'strip_images_and_truncate' | 'give_up';
  keepRatio: number;
}

export function decideOverflowRecovery(attemptCount: number): RecoveryDecision {
  switch (attemptCount) {
    case 1:
      return { action: 'truncate_head_and_retry', keepRatio: 0.5 };
    case 2:
      return { action: 'strip_images_and_truncate', keepRatio: 0.25 };
    default:
      logger.warn('overflow_recovery:exhausted', { attemptCount });
      return { action: 'give_up', keepRatio: 0 };
  }
}
