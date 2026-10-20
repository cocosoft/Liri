/**
 * 主动消息投递目标解析（U-01 方案 A，2026-10-20 用户裁定「配置兜底」）。
 *
 * 背景：通道投递链本身早已打通（`ProactiveTarget.mode` 含 `'channel'`、
 * `ProactiveRuntime.createDelivery()` 已分流、`ProactiveDeliveryAdapter` 复用 `DeliveryRouter`），
 * 唯一缺口是**生产者不知道该投到哪个通道** ⇒ 此前一律写死 `{ mode: 'local' }`。
 *
 * 口径（安全优先，避免意外外发）：
 * - 只有 `proactive.target.channelId` **与** `proactive.target.conversationId` **同时**配置且非空，
 *   才返回 `channel` 目标；
 * - 任一缺失 / 空串 / 非字符串 ⇒ `local`（与现状逐字一致，不外发）；
 * - 纯函数 + 端口注入（不直接读全局配置），便于单测穷尽「配了才会发」。
 */
import type { ProactiveTarget } from './types';

/** 配置读取端口（与 `configManager.getValue` 的只读子集对齐） */
export interface ProactiveTargetConfigPort {
  getValue(key: string, defaultValue?: unknown): unknown;
}

/** 读取非空字符串配置（空白串视为未配置，避免 `''` 被当成有效目标） */
function readNonEmptyString(
  port: ProactiveTargetConfigPort,
  key: string
): string | undefined {
  const raw = port.getValue(key);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 解析主动消息投递目标。
 *
 * @returns `{ mode: 'channel', channelId, conversationId }`（两项都配了）
 *          或 `{ mode: 'local' }`（默认，写通知中心）
 */
export function resolveProactiveTarget(
  port: ProactiveTargetConfigPort
): ProactiveTarget {
  const channelId = readNonEmptyString(port, 'proactive.target.channelId');
  const conversationId = readNonEmptyString(
    port,
    'proactive.target.conversationId'
  );
  if (channelId && conversationId) {
    return { mode: 'channel', channelId, conversationId };
  }
  return { mode: 'local' };
}
