// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 通道消息去重模块（共享版）
 *
 * 提供基于 messageId 的**处理态**去重机制，防止 WebSocket/Webhook 重传
 * 导致的重复消息处理。适用于所有需要消息去重的通道。
 *
 * PR4（2026-10-09，`.trae/specs/dedup-message-state.md`）：处理态由原来的
 * 两个重叠结构（`inflightMessages` 集合 + `processedMessages` 映射）收敛为
 * **单一状态图** `RECEIVED / ADMITTED / REJECTED`，消除"已接收"与"已完成"
 * 的语义混淆（原超时只能"伪造已处理"）。
 *
 * 语义澄清：**Dedup = "这条 inbound Message 是否已接收"**（含其已知结局），
 * ≠ "对应 Agent 是否成功完成"（后者属 Execution 生命周期）。
 *
 * 使用示例：
 * ```typescript
 * import { claimMessage, finalizeMessage, rejectMessage } from '@modules/channels/dedup';
 *
 * const result = claimMessage(messageId);
 * if (result === 'claimed') {
 *   try {
 *     await processMessage(msg);
 *     finalizeMessage(messageId, true);      // ⇒ ADMITTED
 *   } catch (e) {
 *     if (isTimeout) rejectMessage(messageId); // ⇒ REJECTED（阻断重传，防空转超时重跑）
 *     else releaseProcessing(messageId);       // 无记录 ⇒ 允许重试
 *   }
 * }
 * ```
 *
 * 线程安全：所有操作使用 Map 实现，内存安全。
 * PR4 遗留-⑨（2026-10-09）：处理态**可选落盘**（`DedupStore` + `hydrateFromDedupStore`）——
 * 未接入 ⇒ 纯内存（重启重置）；接入 ⇒ 跨重启仍可阻断同 `messageId` 重传。
 */

/** 默认去重 TTL：24 小时 */
import { getLogger } from '@modules/monitoring';
import type { DedupStore } from './DedupStore';
const logger = getLogger('channels:dedup:index');

const DEFAULT_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

/** 默认清理间隔：1 小时 */
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** 消息处理态（唯一事实源；PR4） */
export const MESSAGE_PROCESSING_STATES = [
  'RECEIVED',
  'ADMITTED',
  'REJECTED',
] as const;
export type MessageProcessingState = (typeof MESSAGE_PROCESSING_STATES)[number];

/** 处理态记录 */
interface MessageStateRecord {
  state: MessageProcessingState;
  expiresAt: number;
}

/** 处理态存储：messageId → 记录（替代原 `processedMessages` + `inflightMessages`） */
const messageStates = new Map<string, MessageStateRecord>();

/**
 * 可选**持久化后端**（PR4 遗留-⑨，2026-10-09）。
 *
 * 未接入 ⇒ 纯内存（默认零行为变更）；启动期由 `attachDedupStore()` + `hydrateFromDedupStore()` 接线
 * ⇒ 跨重启仍可阻断同 `messageId` 重传。写盘为 best-effort（失败仅留痕，不阻断判定）。
 */
let dedupStore: DedupStore | null = null;

/** 接入持久化后端（启动期接线；传 `null` 解除，测试用） */
export function attachDedupStore(store: DedupStore | null): void {
  dedupStore = store;
}

/** 清空内存处理态（**仅测试用**；配合 `hydrateFromDedupStore` 验证"重启"语义） */
export function resetDedupState(): void {
  messageStates.clear();
  lastCleanupTime = Date.now();
}

/**
 * 启动期：从磁盘恢复**未过期**处理态并清理过期行（验收 ⑨）。
 *
 * @returns 恢复的行数
 */
export async function hydrateFromDedupStore(
  store?: DedupStore
): Promise<{ loaded: number }> {
  const target = store ?? dedupStore;
  if (!target) return { loaded: 0 };
  dedupStore = target;
  const now = Date.now();
  await target.purgeExpired(now);
  const rows = await target.loadLive(now);
  for (const row of rows) {
    messageStates.set(row.messageId, {
      state: row.state,
      expiresAt: row.expiresAt,
    });
  }
  logger.info('dedup 处理态已从磁盘恢复', { loaded: rows.length });
  return { loaded: rows.length };
}

/** best-effort 写盘（失败仅留痕） */
function persistState(
  messageId: string,
  state: MessageProcessingState,
  expiresAt: number
): void {
  const store = dedupStore;
  if (!store) return;
  void store.upsert(messageId, state, expiresAt).catch((err: unknown) => {
    logger.warn('dedup 处理态落盘失败（内存判定不受影响）', {
      messageId,
      state,
      error: String(err),
    });
  });
}

/** 上次清理过期记录的时间 */
let lastCleanupTime = Date.now();

/** 当前去重 TTL */
let dedupTtlMs = DEFAULT_DEDUP_TTL_MS;

/** 当前清理间隔 */
let cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS;

/** 取存活记录（过期即惰性删除并返回 undefined） */
function getLiveRecord(messageId: string): MessageStateRecord | undefined {
  const rec = messageStates.get(messageId);
  if (!rec) return undefined;
  if (rec.expiresAt <= Date.now()) {
    messageStates.delete(messageId);
    return undefined;
  }
  return rec;
}

/** 写入/覆盖处理态（带 TTL） */
function setState(messageId: string, state: MessageProcessingState): void {
  const expiresAt = Date.now() + dedupTtlMs;
  messageStates.set(messageId, { state, expiresAt });
  persistState(messageId, state, expiresAt);
  cleanupExpired();
}

/**
 * 配置去重参数
 *
 * @param ttlMs - 处理态记录过期时间（毫秒），默认 24 小时
 * @param cleanupMs - 过期记录清理间隔（毫秒），默认 1 小时
 */
export function configureDedup(ttlMs?: number, cleanupMs?: number): void {
  if (ttlMs !== undefined && ttlMs > 0) {
    dedupTtlMs = ttlMs;
  }
  if (cleanupMs !== undefined && cleanupMs > 0) {
    cleanupIntervalMs = cleanupMs;
  }
}

/**
 * 清理过期记录
 */
function cleanupExpired(): void {
  const now = Date.now();
  if (now - lastCleanupTime < cleanupIntervalMs) {
    return;
  }
  lastCleanupTime = now;
  for (const [messageId, rec] of messageStates) {
    if (rec.expiresAt <= now) {
      messageStates.delete(messageId);
    }
  }
}

/**
 * 标记消息为正在处理（认领）
 *
 * @param messageId - 消息唯一标识
 * @returns false 表示已有存活记录（占用中或已出结局）
 */
export function tryBeginProcessing(messageId: string): boolean {
  if (getLiveRecord(messageId)) {
    return false;
  }
  setState(messageId, 'RECEIVED');
  return true;
}

/**
 * 释放正在处理标记（删除记录 ⇒ 允许后续重试）
 *
 * 用于**通用异常**路径（如 LLM 错误）：保留既有"允许渠道重传重试"行为。
 * 对**超时**请改用 `rejectMessage`（保留记录，阻断重传，防重复计费）。
 *
 * @param messageId - 消息唯一标识
 */
export function releaseProcessing(messageId: string): void {
  messageStates.delete(messageId);
  const store = dedupStore;
  if (!store) return;
  void store.remove(messageId).catch((err: unknown) => {
    logger.warn('dedup 处理态删除失败（内存判定不受影响）', {
      messageId,
      error: String(err),
    });
  });
}

/**
 * 检查消息是否已接收过（存在任意存活记录）
 *
 * @param messageId - 消息唯一标识
 * @returns true 表示已接收（仍在 TTL 范围内）
 */
export function isMessageProcessed(messageId: string): boolean {
  return getLiveRecord(messageId) !== undefined;
}

/**
 * 标记消息为**已成功处理**（→ `ADMITTED`）
 *
 * @param messageId - 消息唯一标识
 */
export function markMessageProcessed(messageId: string): void {
  setState(messageId, 'ADMITTED');
}

/**
 * 标记消息为**已接收但未成功**（→ `REJECTED`，PR4 新增）
 *
 * 用于空转超时等"已接收、但不产出成功结果、且不应重跑"的场景：
 * 保留记录在 TTL 窗口内**阻断同 `messageId` 重传**（防重复计费），
 * 但语义上**不等于成功**（E3 根修：原以 `markMessageProcessed` 冒充"已处理"）。
 *
 * @param messageId - 消息唯一标识
 */
export function rejectMessage(messageId: string): void {
  setState(messageId, 'REJECTED');
}

/**
 * 尝试认领并处理消息
 *
 * 这是入口函数，封装了"查存活记录 + 认领"的逻辑。
 * 返回结果说明：
 * - 'claimed'   — 成功认领，可以开始处理
 * - 'duplicate' — 已接收且已出结局（`ADMITTED`/`REJECTED`）
 * - 'inflight'  — 已接收且处理中（`RECEIVED`，被其他处理者占用）
 * - 'invalid'   — 消息 ID 无效
 *
 * @param messageId - 消息唯一标识（可为 null/undefined）
 */
export function claimMessage(
  messageId: string | undefined | null
): 'claimed' | 'duplicate' | 'inflight' | 'invalid' {
  const normalized = messageId?.trim();
  if (!normalized) {
    return 'invalid';
  }
  const rec = getLiveRecord(normalized);
  if (rec) {
    return rec.state === 'RECEIVED' ? 'inflight' : 'duplicate';
  }
  setState(normalized, 'RECEIVED');
  return 'claimed';
}

/**
 * 完成消息处理（→ `ADMITTED`）
 *
 * 在消息处理成功后调用，记录为已成功完成（保留 TTL 窗口内阻断重传）。
 *
 * @param messageId - 消息唯一标识
 * @param claimHeld - 是否已持有 claim（由 claimMessage 返回 'claimed' 后）
 * @returns true 表示标记成功
 */
export function finalizeMessage(
  messageId: string | undefined | null,
  claimHeld: boolean = false
): boolean {
  const normalized = messageId?.trim();
  if (!normalized) {
    return false;
  }
  if (!claimHeld && !tryBeginProcessing(normalized)) {
    return false;
  }
  setState(normalized, 'ADMITTED');
  return true;
}

/**
 * 获取当前去重统计信息
 *
 * @returns 包含已出结局（`processed`）、处理中（`inflight`）、已过期数量的统计对象
 */
export function getDedupStats(): {
  processed: number;
  inflight: number;
  expired: number;
} {
  const now = Date.now();
  let processed = 0;
  let inflight = 0;
  let expired = 0;
  for (const rec of messageStates.values()) {
    if (rec.expiresAt <= now) {
      expired++;
      continue;
    }
    if (rec.state === 'RECEIVED') inflight++;
    else processed++;
  }
  return { processed, inflight, expired };
}
