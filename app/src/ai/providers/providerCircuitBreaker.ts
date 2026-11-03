/**
 * 供应商「余额/配额耗尽」短期熔断（2026-11-03 实时巡检）
 *
 * **现场证据**：账户余额不足时，OpenAI 兼容端点返回 `402 … account balance is insufficient`。
 * `BaseAIProvider.shouldBackOff()` 只对 429/529 退避 ⇒ 402 **本来就不重试**，这是对的；
 * 但**没有跨调用记忆** —— Dream 精炼等批量链路会逐条继续发请求，
 * 实测 2 秒内连打 3 次 402，全部必然失败，白烧网络/日志并放大告警。
 *
 * 本模块只做一件事：**把"刚确认余额不足"这件事记住一小段时间**，让后续调用直接失败
 * （fail-fast，带可操作文案），而不是再发一次注定 402 的请求。
 *
 * 边界（刻意不做）：
 * - 不做持久化（进程重启即失效，充值后重启/等 TTL 均可恢复）；
 * - 不按模型/密钥细分（`label` 是 Provider 标签，如 `OpenAI`）——粗粒度足够止血，
 *   细粒度需要调用方提供 providerId，属后续优化；
 * - 不拦 5xx / 429（那些已有退避重试链路，语义不同）。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
// B 类常量统一放 infra 常量包（`lint:consts` D-2：生产代码不新增裸数字常量）
import { PROVIDER_BALANCE_CIRCUIT_MS } from '@openliri/infra/constants';

/** 熔断时长：默认 5 分钟（充值/换 key 后最迟 5 分钟自动恢复，无需重启） */
export const BALANCE_CIRCUIT_TTL_MS = PROVIDER_BALANCE_CIRCUIT_MS;

/** provider label → 熔断到期时间戳 */
const openUntil = new Map<string, number>();

/**
 * 是否是「余额/配额不足」类错误（可安全熔断）。
 *
 * 判据：`status === 402`，或消息命中常见文案（部分兼容端点不回 402 只在正文里写原因）。
 */
export function isInsufficientBalanceError(error: unknown): boolean {
  const e = error as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  } | null;
  if (!e) return false;
  const status =
    typeof e.status === 'number'
      ? e.status
      : typeof e.statusCode === 'number'
        ? e.statusCode
        : 0;
  if (status === 402) return true;
  const message = typeof e.message === 'string' ? e.message : '';
  return /insufficient (balance|quota)|account balance is insufficient|余额不足|配额不足/i.test(
    message
  );
}

/** 命中余额不足时调用：打开（或续期）该 provider 的熔断窗口 */
export function tripProviderBalanceCircuit(
  provider: string,
  now: number = Date.now()
): void {
  openUntil.set(provider, now + BALANCE_CIRCUIT_TTL_MS);
}

/**
 * 熔断是否仍生效。
 *
 * @returns 剩余毫秒数；`0` = 未熔断（调用方可继续请求）
 */
export function providerBalanceCircuitRemaining(
  provider: string,
  now: number = Date.now()
): number {
  const until = openUntil.get(provider);
  if (until === undefined) return 0;
  const remaining = until - now;
  if (remaining <= 0) {
    openUntil.delete(provider);
    return 0;
  }
  return remaining;
}

/**
 * 熔断期间的**立即失败**错误。
 *
 * 保留 `status = 402` ⇒ 上游既有分类（`APISceneClassifier` / 错误追踪）口径不变，
 * 只是不再产生一次真实网络请求。
 */
export class ProviderBalanceCircuitOpenError extends AppError {
  readonly status = 402;
  readonly provider: string;
  readonly remainingMs: number;

  constructor(provider: string, remainingMs: number) {
    super(
      `供应商「${provider}」账户余额/配额不足，请求已暂缓（${Math.ceil(
        remainingMs / 1000
      )} 秒后重试）。请充值或切换供应商后再试；本次未发起网络请求。`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM,
      'PROVIDER_BALANCE_INSUFFICIENT',
      { provider, remainingMs }
    );
    this.name = 'ProviderBalanceCircuitOpenError';
    this.provider = provider;
    this.remainingMs = remainingMs;
  }
}

/** 仅测试用：清空所有熔断窗口 */
export function resetProviderBalanceCircuitForTest(): void {
  openUntil.clear();
}
