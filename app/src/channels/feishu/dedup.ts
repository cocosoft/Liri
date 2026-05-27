/**
 * 飞书消息去重模块
 * 对标 OpenClaw extensions/feishu/src/dedup.ts
 *
 * 使用内存 Set + TTL 机制防止 WebSocket/Webhook 重传导致的重复消息处理
 * TTL 默认 24 小时，重启后重置
 */

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

/** 去重记录：messageId → 过期时间戳 */
const processedMessages = new Map<string, number>();

/** 正在处理中的消息锁（防止并发重复处理） */
const inflightMessages = new Set<string>();

/** 上次清理过期记录的时间 */
let lastCleanupTime = Date.now();

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 清理过期记录
 */
function cleanupExpired(): void {
  const now = Date.now();
  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) {
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
 * 返回 false 表示已有其他处理者占用
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
 */
export function releaseProcessing(messageId: string): void {
  inflightMessages.delete(messageId);
}

/**
 * 检查消息是否已处理过
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
 */
export function markMessageProcessed(messageId: string): void {
  processedMessages.set(messageId, Date.now() + DEDUP_TTL_MS);
  cleanupExpired();
}

/**
 * 尝试认领并处理消息
 * 返回 'claimed' — 成功认领，可以开始处理
 *       'duplicate' — 已处理过的重复消息
 *       'inflight' — 正在被其他处理者占用
 *       'invalid' — 消息 ID 无效
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
 * 返回 true 表示标记成功
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
