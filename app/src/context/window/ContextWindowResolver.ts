/**
 * 上下文窗口解析器（Phase 2 + P2 DB 动态读取增强）
 * 对标 openclaw resolveContextWindowInfo() + PilotDeck 溢出恢复
 *
 * 多层 fallback 解析模型上下文窗口大小：
 *   1. DB model_registry 动态读取（context_window 字段）
 *   2. 已知模型硬编码映射（fallback）
 *   3. 1M 启发式检测
 *   4. 默认 200K
 */
import { Logger, LogLevel } from '@modules/monitoring';
import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath } from '@modules/core';

const logger = new Logger({ module: 'context:window', level: LogLevel.INFO });

/** 默认 fallback 上下文窗口（tokens） */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** 已知模型的上下文窗口映射（DB 无记录时的 hardcoded fallback） */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-3-5-sonnet': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-haiku': 200_000,
  'claude-3.5-sonnet': 200_000,
  'claude-sonnet-4': 200_000,
  'gpt-4': 128_000,
  'gpt-4o': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4.1': 1_000_000,
  'gemini-1.5-pro': 2_000_000,
  'gemini-2.0-flash': 1_000_000,
  'deepseek-v3': 128_000,
  'deepseek-r1': 128_000,
  'deepseek-chat': 128_000,
  'deepseek-reasoner': 128_000,
  'deepseek-coder': 128_000,
};

export interface ContextWindowInfo {
  tokens: number;
  source: 'known_model' | 'config' | 'default';
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
    return { tokens: configOverride ?? dbWindow, source: 'config' };
  }

  return resolveContextWindow(model, configOverride);
}

/**
 * 解析模型上下文窗口大小（同步，不含 DB 查询）
 * 优先级：known model → 1M 启发式 → config override → default
 */
export function resolveContextWindow(
  model: string,
  configOverride?: number
): ContextWindowInfo {
  // 1. 检查已知模型映射
  const normalized = model.toLowerCase();
  for (const [key, tokens] of Object.entries(KNOWN_CONTEXT_WINDOWS)) {
    if (normalized.includes(key)) {
      return {
        tokens: configOverride ?? tokens,
        source: configOverride ? 'config' : 'known_model',
      };
    }
  }

  // 2. 1M context 检测（模型名含 1m 关键词）
  if (
    normalized.includes('1m') ||
    normalized.includes('1.5-pro') ||
    normalized.includes('2.0')
  ) {
    return {
      tokens: configOverride ?? 1_000_000,
      source: configOverride ? 'config' : 'known_model',
    };
  }

  return {
    tokens: configOverride ?? DEFAULT_CONTEXT_WINDOW,
    source: configOverride ? 'config' : 'default',
  };
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
