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
 * CoreAPIImpl 批 B3 纯搬迁（2026-10-05）：C14 消息编辑 / 回滚。
 *
 * 自同目录 `CoreAPIImpl.ts` 外迁 —— 方法体逐字保留（仅把 `this.<宿主依赖>` 改写为
 * `this.deps.<getter>()`）。宿主依赖经 {@link MessageMutationDeps} 的 getter 注入
 * （宿主 `chatManager` / `sessionManager` 本身即懒解析 getter ⇒ 用 getter 注入零初始化顺序陷阱）。
 *
 * 宿主保留 `updateMessageBlocks` / `deleteMessage` / `truncateMessages` 三个对外薄转发
 *（`CoreAPIImpl implements CoreAPI` + HTTP 消费者）；`_filterDeletedRanges` 随迁并改名为
 * **public** `filterDeletedRanges`（泛型 `<T>` 保留）—— 其语义属本簇（删除墓碑的读侧过滤），
 * 由宿主 `sessionMessagesRead` 的 `getFilterDeletedRanges` 经注入调用。
 *
 * ⚠️ 惰性引用环（**无构造顺序问题、无运行时递归**）：本模块的
 * `getDeriveSessionMessagesFromEvents` 指向 B2 `SessionMessagesRead._deriveSessionMessagesFromEvents`，
 * 而 B2 的 `getFilterDeletedRanges` 指向本模块 `filterDeletedRanges` —— 两模块互指。因两者均为
 * **调用时**求值的闭包（而非构造期解引用），且 `derive` 不调 `filter`、`filter` 不调 `derive`，
 * 故不存在初始化顺序陷阱，也不存在运行时递归。
 */

import { addDeletedRange, isSeqInDeletedRanges } from '@modules/session';
import type { SessionManager } from '@modules/session/types/session';
import type { ChatManager } from '@modules/chat';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('runtime:api:CoreAPIImpl');

/**
 * B3（2026-10-05）：宿主依赖（全 getter，零初始化顺序陷阱）。
 */
export interface MessageMutationDeps {
  getChatManager: () => ChatManager;
  getSessionManager: () => SessionManager;
  /** C20（宿主 `CoreAPIImpl.cleanupOrphanAttachments`）：删除消息后清理孤儿附件。 */
  getCleanupOrphanAttachments: () => (
    sessionId: string,
    ids: string[]
  ) => Promise<void>;
  /** B2 模块（public `_deriveSessionMessagesFromEvents`）：事件派生消息（墓碑区间定位用）。 */
  getDeriveSessionMessagesFromEvents: () => (
    sessionId: string
  ) => Promise<unknown>;
}

/**
 * B3（2026-10-05）：消息编辑 / 回滚（消息块更新 / 单条删除 / 墓碑读侧过滤 / 截断回退）。
 */
export class MessageMutation {
  constructor(private readonly deps: MessageMutationDeps) {}

  async updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>
  ): Promise<void> {
    await this.deps
      .getChatManager()
      .updateMessageBlocks(sessionId, messageId, blocks);
  }

  /**
   * 删除单条消息（软删除）
   */
  async deleteMessage(
    sessionId: string,
    messageId: string
  ): Promise<{ success: boolean; messages: Array<Record<string, unknown>> }> {
    const gateway = this.deps.getChatManager().getSessionGateway();
    if (!gateway) {
      throw new Error('SessionGateway not available');
    }

    // 并发防护：检查是否正在流式输出
    const session = this.deps.getSessionManager().getSession(sessionId);
    if (session?.metadata?.isStreaming) {
      const err = new Error('Cannot delete message while streaming');
      (err as unknown as Record<string, unknown>).statusCode = 409;
      throw err;
    }

    // 校验消息存在且是 user 消息
    const messages = await gateway.getMessages(sessionId);
    const targetMsg = messages.find((m) => m.id === messageId);
    if (!targetMsg) {
      const err = new Error('Message not found');
      (err as unknown as Record<string, unknown>).statusCode = 404;
      throw err;
    }
    if (targetMsg.role !== 'user') {
      const err = new Error('Only user messages can be deleted');
      (err as unknown as Record<string, unknown>).statusCode = 400;
      throw err;
    }

    // ── N-50（2026-09-20）修复：删除**整轮**（该提问 + 其助手/工具回复），避免遗留孤儿回复 ──
    //
    // 原实现只删该条 user 消息，其助手/工具回复仍留在投影（`messages.jsonl`）⇒ 界面上出现
    // "没有提问的回复气泡"（实测证据见台账 N-50）。改为删除该轮全部条目：
    // 从该 user 消息起，到下一个 user 消息之前止。
    //
    // 注（N-52，2026-09-20 修复 / 2026-09-22 复核）：`_deriveSessionMessagesFromEvents` 已改走
    // `_getOrCreateEventLog()`（`resolveWorktreeHash()` 单一真源 + LRU 缓存）⇒ **事件派生读路径已生效**
    //（旧实现把 `'default'` 当 worktreeHash ⇒ `exists()` 恒 false ⇒ 当时实际读源确为投影）。
    // 与之配套的"按轮次 seq 墓碑 + 读时过滤"（`_filterDeletedRanges`）已同批落地（见下方
    // `startSeq`/`endSeq`）—— 否则被删轮次会被事件重新派生出来。
    const targetIndex = messages.findIndex((m) => m.id === messageId);
    let turnEndIndex = messages.length;
    for (let i = targetIndex + 1; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        turnEndIndex = i;
        break;
      }
    }
    const turnMessageIds = messages
      .slice(targetIndex, turnEndIndex)
      .map((m) => m.id);

    // N-50 墓碑（与 N-52 修复同批）：记录该轮的**事件 seq 区间** —— 派生读路径生效后，仅删
    // 投影不足以移除该轮（agg 会按事件重新派生）⇒ 读时按墓碑过滤（`_filterDeletedRanges`）。
    // 区间边界取**派生结果**的 `lastEventSeq` —— 与读时过滤比较的是同一 seq 空间。
    let startSeq: number | undefined;
    let endSeq: number | null = null;
    try {
      const derived = (await this.deps.getDeriveSessionMessagesFromEvents()(
        sessionId
      )) as Array<{ id: string; role: string; lastEventSeq?: number }> | null;
      const idx = derived?.findIndex((m) => m.id === messageId) ?? -1;
      const from = idx >= 0 ? derived?.[idx]?.lastEventSeq : undefined;
      if (idx >= 0 && typeof from === 'number' && Number.isFinite(from)) {
        startSeq = from;
        const nextUser = derived?.slice(idx + 1).find((m) => m.role === 'user');
        const nextSeq = nextUser?.lastEventSeq;
        endSeq =
          typeof nextSeq === 'number' && Number.isFinite(nextSeq)
            ? Math.max(nextSeq - 1, from)
            : null;
      }
    } catch (err) {
      await handleError(err, {
        module: 'runtime:api',
        action: 'deleteMessage:computeDeletedRange',
        context: { sessionId, messageId },
      });
    }

    if (startSeq === undefined) {
      logger.warn(
        'deleteMessage: 未能定位该轮的事件 seq 区间，墓碑未写入（投影侧仍已整轮删除）',
        { sessionId, messageId, turnMessageIds }
      );
    } else {
      const ranges = addDeletedRange(session?.metadata?.deletedMessageRanges, {
        startSeq,
        endSeq,
      });
      if (session?.metadata) {
        session.metadata.deletedMessageRanges = ranges;
        this.deps.getSessionManager().updateSession?.(session);
      }
      try {
        const storedSession = await gateway.getSession(sessionId);
        if (storedSession) {
          storedSession.metadata.deletedMessageRanges = ranges;
          await gateway.updateSession(storedSession);
        }
      } catch (err) {
        await handleError(err, {
          module: 'runtime:api',
          action: 'deleteMessage:persistDeletedRange',
          context: { sessionId, messageId, ranges },
        });
      }
    }

    // 投影侧：删除该轮全部条目（用户消息 + 其助手/工具回复）
    await gateway.deleteMessages(sessionId, turnMessageIds);

    // 附件清理（引用计数归零时删除文件）
    this.deps
      .getCleanupOrphanAttachments()(sessionId, turnMessageIds)
      .catch((err) => {
        logger.debug('附件清理失败（非关键）', { error: String(err) });
      });

    // 审计日志
    logger.info('Message deleted', {
      module: 'audit:message',
      sessionId,
      messageId,
      // N-50：记录整轮删除范围 + 事件 seq 墓碑，便于追溯"连带删了哪些回复"
      deletedMessageIds: turnMessageIds,
      deletedRange: startSeq === undefined ? null : { startSeq, endSeq },
      timestamp: new Date().toISOString(),
    });

    // 返回更新后的消息列表
    const updatedMessages = await gateway.getMessages(sessionId);
    return {
      success: true,
      messages: updatedMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        timestamp: m.timestamp,
      })),
    };
  }

  /**
   * N-50（2026-09-20）：按会话元数据的"删除墓碑"过滤**事件派生**消息。
   *
   * 无墓碑时零成本返回原数组（绝大多数会话）；过滤键为派生消息的 `lastEventSeq`
   * （事件派生两条分支都会带上：`agg.maxChunkSeq`）。仅作用于事件派生路径 ——
   * 投影回退路径依赖 `deleteMessage` 已整轮删除投影条目。
   *
   * B3（2026-10-05）：随 C14 外迁，由 `private _filterDeletedRanges` 改名为模块 public
   * `filterDeletedRanges`（泛型 `<T>` 保留）；宿主 `sessionMessagesRead` 经
   * `getFilterDeletedRanges` 注入调用。
   */
  public filterDeletedRanges<T>(sessionId: string, messages: T[]): T[] {
    const ranges = this.deps.getSessionManager().getSession(sessionId)
      ?.metadata?.deletedMessageRanges;
    if (!ranges || ranges.length === 0) return messages;
    const kept = messages.filter(
      (m) =>
        !isSeqInDeletedRanges(
          (m as { lastEventSeq?: unknown }).lastEventSeq,
          ranges
        )
    );
    if (kept.length !== messages.length) {
      logger.info('已按删除墓碑过滤事件派生消息', {
        module: 'runtime:api',
        sessionId,
        before: messages.length,
        after: kept.length,
        ranges,
      });
    }
    return kept;
  }

  /**
   * 截断消息（回退到指定消息之前）
   */
  async truncateMessages(
    sessionId: string,
    beforeMessageId: string
  ): Promise<{
    success: boolean;
    messages: Array<Record<string, unknown>>;
    remainingRollbacks: number;
    deletedMessageIds: string[];
    undoResults: Array<{ roundId: number; success: boolean; error?: string }>;
  }> {
    const gateway = this.deps.getChatManager().getSessionGateway();
    if (!gateway) {
      throw new Error('SessionGateway not available');
    }

    // 并发防护：检查是否正在流式输出
    const session = this.deps.getSessionManager().getSession(sessionId);
    if (session?.metadata?.isStreaming) {
      const err = new Error('Cannot rollback while streaming');
      (err as unknown as Record<string, unknown>).statusCode = 409;
      throw err;
    }

    // 回退次数限制检查
    const rollbackCount: number =
      (session?.metadata?.rollbackCount as number) ?? 0;
    const MAX_ROLLBACKS = 5;
    if (rollbackCount >= MAX_ROLLBACKS) {
      const err = new Error('Rollback limit reached (max 5)');
      (err as unknown as Record<string, unknown>).statusCode = 429;
      throw err;
    }

    // 收集要删除的消息 ID（beforeMessageId 及之后的所有消息）
    const messages = await gateway.getMessages(sessionId);
    const targetIndex = messages.findIndex((m) => m.id === beforeMessageId);
    if (targetIndex === -1) {
      const err = new Error('Target message not found');
      (err as unknown as Record<string, unknown>).statusCode = 404;
      throw err;
    }
    if (messages[targetIndex].role !== 'user') {
      const err = new Error('Can only rollback to a user message');
      (err as unknown as Record<string, unknown>).statusCode = 400;
      throw err;
    }

    const messagesToDelete = messages.slice(targetIndex);
    const deletedMessageIds = messagesToDelete.map((m) => m.id);

    // === 文件回滚（核心新增） ===
    let undoResults: Array<{
      roundId: number;
      success: boolean;
      error?: string;
    }> = [];
    const roundIndex = session?.metadata?.roundIndex;
    if (roundIndex && beforeMessageId in roundIndex) {
      const targetRoundId = roundIndex[beforeMessageId];
      const maxRound =
        (session?.metadata?.roundCounter as number) ?? targetRoundId;
      try {
        undoResults = await this.deps
          .getChatManager()
          .undoRoundsSince(sessionId, targetRoundId, maxRound, roundIndex);
        logger.info('File rollback completed', {
          sessionId,
          targetRoundId,
          undoCount: undoResults.length,
          failedCount: undoResults.filter((r) => !r.success).length,
        });
      } catch (err) {
        logger.warn('File rollback failed, continuing with message deletion', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 批量软删除
    await gateway.deleteMessages(sessionId, deletedMessageIds);

    // 附件清理（引用计数归零时删除文件）
    this.deps
      .getCleanupOrphanAttachments()(sessionId, deletedMessageIds)
      .catch((err) => {
        logger.debug('附件清理失败（非关键）', { error: String(err) });
      });

    // 审计日志
    logger.info('Messages truncated (rollback)', {
      module: 'audit:message',
      sessionId,
      beforeMessageId,
      deletedMessageIds,
      undoResults: undoResults.map((r) => ({
        roundId: r.roundId,
        success: r.success,
      })),
      timestamp: new Date().toISOString(),
    });

    // 递增回退计数
    if (session) {
      session.metadata.rollbackCount = rollbackCount + 1;
      this.deps.getSessionManager().updateSession?.(session);
    }

    // 返回更新后的消息列表
    const updatedMessages = await gateway.getMessages(sessionId);
    return {
      success: true,
      messages: updatedMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        timestamp: m.timestamp,
      })),
      remainingRollbacks: MAX_ROLLBACKS - (rollbackCount + 1),
      deletedMessageIds,
      undoResults,
    };
  }
}
