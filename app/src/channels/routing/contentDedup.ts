// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 内容级去重（自 `messageRouter.ts` **内聚抽取**，2026-10-09 C3-S3）。
// 仅搬查询/登记/清理逻辑；日志、追踪与路由返回由调用方负责（语义逐字不变）。

import { getLogger } from '@modules/monitoring';
import { CONTENT_DEDUP_WINDOW_MS } from './messageRouterContract';

const logger = getLogger('channels:routing');

/** 内容去重缓存：key = `渠道:会话:发送者:内容` → 首次见到的时间戳 */
const contentDedupCache = new Map<string, number>();

/** 定期清理过期去重缓存条目 */
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [key, time] of contentDedupCache) {
    if (now - time > CONTENT_DEDUP_WINDOW_MS * 2) {
      contentDedupCache.delete(key);
      removed++;
    }
  }
  // R08-002: 清理循环记录（skip=无需清理）
  if (removed > 0) {
    logger.debug('内容去重缓存清理', {
      removed,
      remaining: contentDedupCache.size,
    });
  }
}, 30000).unref();

export interface ContentDedupClaim {
  /** true = 窗口内已见过同内容（调用方应判重返回） */
  duplicate: boolean;
  /** 去重 key（供日志截断展示） */
  contentKey: string;
  /** 距上次见到的毫秒数（仅 duplicate 时有意义） */
  ageMs: number;
}

/**
 * 内容级去重判定：同一「渠道 : 会话 : 发送者 : 内容」在窗口内重复 ⇒ `duplicate=true`；
 * 非重复则**登记**（占坑）并返回。
 *
 * 维度（PR4/DEEP-7）：
 * - DEEP-7：key 含 `senderId`，避免误杀不同用户发送的相同内容；
 * - PR4（2026-10-09）：**再补"会话维度"**（`conversationId`，DM 下等于 `senderId`）——
 *   原 key 不含会话 ⇒ 同一用户在不同会话发相同内容会被误判重复（P7/E11）。
 */
export function claimContentDedup(
  message: {
    channelId?: string;
    conversationId?: string;
    senderId: string;
    content?: string;
  },
  channelName: string
): ContentDedupClaim {
  const conversationDim = message.conversationId ?? message.senderId;
  const contentKey = `${message.channelId || channelName}:${conversationDim}:${message.senderId}:${message.content}`;
  const now = Date.now();
  const lastContentTime = contentDedupCache.get(contentKey);
  if (lastContentTime && now - lastContentTime < CONTENT_DEDUP_WINDOW_MS) {
    return { duplicate: true, contentKey, ageMs: now - lastContentTime };
  }
  contentDedupCache.set(contentKey, now);
  // 定期清理过期条目
  if (contentDedupCache.size > 1000) {
    for (const [key, time] of contentDedupCache) {
      if (now - time > CONTENT_DEDUP_WINDOW_MS) {
        contentDedupCache.delete(key);
      }
    }
  }
  return { duplicate: false, contentKey, ageMs: 0 };
}
