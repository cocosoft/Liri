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
 * 提供基于 messageId 的互斥锁 + TTL 去重机制，防止 WebSocket/Webhook 重传
 * 导致的重复消息处理。适用于所有需要消息去重的通道。
 *
 * 使用示例：
 * ```typescript
 * import { claimMessage, finalizeMessage } from '@modules/channels/dedup';
 *
 * const result = claimMessage(messageId);
 * if (result === 'claimed') {
 *   try {
 *     await processMessage(msg);
 *     finalizeMessage(messageId, true);
 *   } catch (e) {
 *     releaseProcessing(messageId);
 *   }
 * }
 * ```
 *
 * 线程安全：所有操作使用 Map/Set 实现，内存安全，重启后重置。
 */

/** 默认去重 TTL：24 小时 */
const DEFAULT_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

/** 默认清理间隔：1 小时 */
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** 去重记录：messageId → 过期时间戳 */
const processedMessages = new Map<string, number>();

/** 正在处理中的消息锁（防止并发重复处理） */
const inflightMessages = new Set<string>();

/** 上次清理过期记录的时间 */
let lastCleanupTime = Date.now();

/** 当前去重 TTL */
let dedupTtlMs = DEFAULT_DEDUP_TTL_MS;

/** 当前清理间隔 */
let cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS;

/**
 * 配置去重参数
 *
 * @param ttlMs - 去重记录过期时间（毫秒），默认 24 小时
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
  for (const [messageId, expiresAt] of processedMessages) {
    if (expiresAt <= now) {
      processedMessages.delete(messageId);
    }
  }
}

/**
 * 标记消息为正在处理
 *
 * @param messageId - 消息唯一标识
 * @returns false 表示已有其他处理者占用
 */
export function tryBeginProcessing(messageId: string): boolean {
  if (inflightMessages.has(messageId)) {
    return false;
  }
  inflightMessages.add(messageId);
  return true;
}

/**
 * 释放正在处理标记
 *
 * @param messageId - 消息唯一标识
 */
export function releaseProcessing(messageId: string): void {
  inflightMessages.delete(messageId);
}

/**
 * 检查消息是否已处理过
 *
 * @param messageId - 消息唯一标识
 * @returns true 表示已处理（仍在 TTL 范围内）
 */
export function isMessageProcessed(messageId: string): boolean {
  const expiresAt = processedMessages.get(messageId);
  if (expiresAt === undefined) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    processedMessages.delete(messageId);
    return false;
  }
  return true;
}

/**
 * 标记消息为已处理
 *
 * @param messageId - 消息唯一标识
 */
export function markMessageProcessed(messageId: string): void {
  processedMessages.set(messageId, Date.now() + dedupTtlMs);
  cleanupExpired();
}

/**
 * 尝试认领并处理消息
 *
 * 这是入口函数，封装了 isMessageProcessed + tryBeginProcessing 的逻辑。
 * 返回结果说明：
 * - 'claimed'   — 成功认领，可以开始处理
 * - 'duplicate' — 已处理过的重复消息
 * - 'inflight'  — 正在被其他处理者占用
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
  if (isMessageProcessed(normalized)) {
    return 'duplicate';
  }
  if (!tryBeginProcessing(normalized)) {
    return 'inflight';
  }
  return 'claimed';
}

/**
 * 完成消息处理（释放锁 + 标记已处理）
 *
 * 在消息处理成功后调用，清理 in-flight 锁并记录为已处理。
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
  markMessageProcessed(normalized);
  releaseProcessing(normalized);
  return true;
}

/**
 * 获取当前去重统计信息
 *
 * @returns 包含已处理、处理中、已过期数量的统计对象
 */
export function getDedupStats(): {
  processed: number;
  inflight: number;
  expired: number;
} {
  const now = Date.now();
  let expired = 0;
  for (const expiresAt of processedMessages.values()) {
    if (expiresAt <= now) {
      expired++;
    }
  }
  return {
    processed: processedMessages.size,
    inflight: inflightMessages.size,
    expired,
  };
}
