/**
 * dedupGuard.ts — QQ 入站消息三级去重守卫
 *
 * 由 `QQChannel.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §40）：**只搬不改**（含全部原注释）。
 *
 * 三级去重：`isDuplicate`（message_id）→ `isCrossEventDuplicate`（senderId:content）
 * → `isContentDuplicate`（纯内容，兜底层）。
 * logger 由宿主注入（同一实例）⇒ 日志 module 字段与拆分前逐字一致。
 */

import { Logger } from '@modules/monitoring';

export class QQDedupGuard {
  /** 消息去重缓存：message_id → 时间戳 */
  private readonly dedupCache = new Map<string, number>();

  /** 消息去重窗口（毫秒） */
  private readonly dedupWindowMs = 300_000;

  /** 跨事件类型去重缓存:content_hash -> 时间戳 */
  private readonly crossEventDedupCache = new Map<string, number>();

  /** 跨事件去重窗口(毫秒) */
  private readonly crossEventDedupWindowMs = 10_000;

  /** 内容级去重缓存（纯内容哈希，不依赖 senderId）
   *  QQ 对同一条群 @消息可能同时发送 AT_MESSAGE_CREATE 和 GROUP_AT_MESSAGE_CREATE，
   *  两者 author.id 不同（guild user ID vs open ID），导致 isCrossEventDuplicate 不生效。
   *  此缓存仅基于消息内容本身做去重，窗口 60s，覆盖 LLM 响应时间。 */
  private readonly contentDedupCache = new Map<string, number>();

  /** 内容级去重窗口（毫秒） */
  private readonly contentDedupWindowMs = 60000;

  constructor(private readonly logger: Logger) {}

  /** 清空 message_id 去重缓存（宿主 onDisconnect 复用） */
  clear(): void {
    this.dedupCache.clear();
  }

  /**
   * 检查消息是否重复（参考 Hermes _is_duplicate）
   */
  isDuplicate(messageId: string): boolean {
    if (!messageId) return false;
    const now = Date.now();
    const lastTime = this.dedupCache.get(messageId);
    if (lastTime && now - lastTime < this.dedupWindowMs) {
      return true;
    }
    this.dedupCache.set(messageId, now);
    // 定期清理过期条目
    if (this.dedupCache.size > 1000) {
      for (const [key, time] of this.dedupCache) {
        if (now - time > this.dedupWindowMs) {
          this.dedupCache.delete(key);
        }
      }
    }
    return false;
  }

  /**
   * 跨事件类型去重检查
   * QQ 开放平台可能对同一条群聊 @消息同时发送 AT_MESSAGE_CREATE 和 GROUP_AT_MESSAGE_CREATE,
   * 两者 messageId 不同但内容相同。基于 content + senderId 生成哈希做二次去重。
   */
  isCrossEventDuplicate(content: string, senderId: string): boolean {
    const hash = `${senderId}:${content}`;
    const now = Date.now();
    const lastTime = this.crossEventDedupCache.get(hash);
    if (lastTime && now - lastTime < this.crossEventDedupWindowMs) {
      this.logger.info('QQ Bot 跨事件去重命中', { hash });
      return true;
    }
    this.crossEventDedupCache.set(hash, now);
    if (this.crossEventDedupCache.size > 1000) {
      for (const [key, time] of this.crossEventDedupCache) {
        if (now - time > this.crossEventDedupWindowMs) {
          this.crossEventDedupCache.delete(key);
        }
      }
    }
    return false;
  }

  /**
   * 内容级去重检查（纯内容哈希，不依赖 senderId）
   *
   * QQ 开放平台对同一条群 @消息可能同时推送 AT_MESSAGE_CREATE 和 GROUP_AT_MESSAGE_CREATE，
   * 两者 author.id 分属不同 ID 体系（guild user ID vs open ID），导致 isCrossEventDuplicate()
   * 的 "${senderId}:${content}" 哈希 Key 不同、无法命中。
   *
   * 此方法仅基于内容本身做去重，作为跨事件去重的兜底层。
   * 窗口 60s，覆盖 LLM 响应时间，确保同一消息的两个事件不会触发两次 AI 调用。
   */
  isContentDuplicate(content: string): boolean {
    const now = Date.now();
    const lastTime = this.contentDedupCache.get(content);
    if (lastTime && now - lastTime < this.contentDedupWindowMs) {
      this.logger.info('QQ Bot 内容级去重命中', {
        content: content.slice(0, 50),
      });
      return true;
    }
    this.contentDedupCache.set(content, now);
    if (this.contentDedupCache.size > 1000) {
      for (const [key, time] of this.contentDedupCache) {
        if (now - time > this.contentDedupWindowMs) {
          this.contentDedupCache.delete(key);
        }
      }
    }
    return false;
  }
}
