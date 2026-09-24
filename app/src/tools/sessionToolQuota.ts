/**
 * 会话级工具调用通用配额（8.4①，2026-09-16）
 *
 * 对齐 code_run 的 roundTracker 双约束模式：
 *   - hard limit：单会话内 LLM 驱动的工具调用总量超限 → 降级提示（拒绝继续执行，返回可读提示）
 *   - soft limit：由工具描述/提示静态约束（与 roundTracker 一致，不做动态注入）
 * 避免"单会话工具爆炸"把对话轮次与 Token 预算一次性打穿。
 */

import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
const logger = getLogger('tools:sessionQuota');

/** 默认会话级工具调用总上限（env SESSION_TOOL_QUOTA 可调） */
const DEFAULT_MAX_TOOL_CALLS = 150;

function resolveMaxCalls(): number {
  // 经统一出入口（R05-012）
  const raw = configManager.env('SESSION_TOOL_QUOTA');
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return DEFAULT_MAX_TOOL_CALLS;
}

export class SessionToolQuota {
  private readonly counts = new Map<string, number>();
  private readonly maxCalls: number;

  constructor(maxCalls: number = resolveMaxCalls()) {
    this.maxCalls = maxCalls;
  }

  /** 上限（供降级提示展示） */
  get max(): number {
    return this.maxCalls;
  }

  /** 当前已用工具调用数 */
  current(sessionId: string): number {
    return this.counts.get(sessionId) ?? 0;
  }

  /** 是否已超限 */
  isExceeded(sessionId: string): boolean {
    return this.current(sessionId) >= this.maxCalls;
  }

  /** 是否接近上限（≥80%，供 soft limit 提示预留） */
  isNearLimit(sessionId: string): boolean {
    return this.current(sessionId) >= this.maxCalls * 0.8;
  }

  /** 消耗一次工具调用 */
  consume(sessionId: string): number {
    const next = this.current(sessionId) + 1;
    this.counts.set(sessionId, next);
    if (next === this.maxCalls || next % 20 === 0) {
      logger.info('session tool quota progress', {
        sessionId,
        used: next,
        max: this.maxCalls,
      });
    }
    return next;
  }

  /** 重置（会话删除/手动重置） */
  reset(sessionId: string): void {
    this.counts.delete(sessionId);
  }
}

/** 全局单例（ToolExecutor 使用） */
export const sessionToolQuota = new SessionToolQuota();
