/**
 * MaxOutputRetryHandler — max_output 加倍重试
 *
 * P2-12: 对标 PilotDeck 的 finishReason=length 处理。
 * 当 LLM 因输出 token 限制截断时（stop_reason === 'length'），
 * 自动加倍 outputToken 并重试（上限 64000），最多 3 次。
 *
 * 使用场景：
 *   - LLM 生成代码/长文时被截断 → 加倍 maxTokens 重试
 *   - 工具调用结果超大 → 自动扩容
 *
 * 集成点：在 provider.chat() 返回后检查 response.stop_reason，
 *         如为 'length' 且未达上限，加倍重试。
 */
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'ai:maxOutputRetry' });

export interface MaxOutputRetryConfig {
  /** 最大重试次数，默认 3 */
  maxRetries: number;
  /** 输出 token 上限，默认 64000 */
  maxOutputLimit: number;
  /** 初始 maxTokens（从首次调用中提取） */
  initialMaxTokens: number;
}

const DEFAULT_CONFIG: Omit<MaxOutputRetryConfig, 'initialMaxTokens'> = {
  maxRetries: 3,
  maxOutputLimit: 64000,
};

export interface MaxOutputRetryState {
  /** 当前 maxTokens */
  currentMaxTokens: number;
  /** 已重试次数 */
  retryCount: number;
  /** 是否应该继续重试 */
  shouldRetry: boolean;
  /** 本次调用的 maxTokens */
  nextMaxTokens: number;
}

/**
 * 检查是否应重试（stop_reason === 'length' 且未达上限和最大重试次数）
 */
export function shouldRetryMaxOutput(
  stopReason: string | undefined,
  retryCount: number,
  currentMaxTokens: number,
  config?: Partial<MaxOutputRetryConfig>
): boolean {
  if (stopReason !== 'length' && stopReason !== 'max_tokens') return false;

  const maxRetries = config?.maxRetries ?? DEFAULT_CONFIG.maxRetries;
  if (retryCount >= maxRetries) return false;

  const maxLimit = config?.maxOutputLimit ?? DEFAULT_CONFIG.maxOutputLimit;
  if (currentMaxTokens >= maxLimit) return false;

  return true;
}

/**
 * 计算下次重试的 maxTokens（加倍，不超过上限）
 */
export function computeNextMaxTokens(
  currentMaxTokens: number,
  config?: Partial<MaxOutputRetryConfig>
): number {
  const maxLimit = config?.maxOutputLimit ?? DEFAULT_CONFIG.maxOutputLimit;
  const doubled = currentMaxTokens * 2;
  return Math.min(doubled, maxLimit);
}

/**
 * 创建 max output retry 状态
 */
export function createMaxOutputRetryState(
  initialMaxTokens: number,
  config?: Partial<MaxOutputRetryConfig>
): MaxOutputRetryState {
  return {
    currentMaxTokens: initialMaxTokens,
    retryCount: 0,
    shouldRetry: false,
    nextMaxTokens: initialMaxTokens,
  };
}

/**
 * 检查并推进重试状态。
 * 返回更新后的状态。如果 shouldRetry=false，调用方应直接使用当前结果。
 */
export function advanceMaxOutputRetry(
  stopReason: string | undefined,
  state: MaxOutputRetryState,
  config?: Partial<MaxOutputRetryConfig>
): MaxOutputRetryState {
  const canRetry = shouldRetryMaxOutput(
    stopReason,
    state.retryCount,
    state.currentMaxTokens,
    config
  );

  if (!canRetry) {
    return { ...state, shouldRetry: false, nextMaxTokens: state.currentMaxTokens };
  }

  const nextMax = computeNextMaxTokens(state.currentMaxTokens, config);
  logger.info('maxOutputRetry: retrying', {
    retryCount: state.retryCount + 1,
    previousMaxTokens: state.currentMaxTokens,
    nextMaxTokens: nextMax,
    stopReason,
  });

  return {
    currentMaxTokens: nextMax,
    retryCount: state.retryCount + 1,
    shouldRetry: true,
    nextMaxTokens: nextMax,
  };
}
