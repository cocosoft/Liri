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
 * CoreAPIImpl 批 B2 纯搬迁（2026-10-05）：C12 消息读取 / 事件派生 + C13 派生校验 / 事件流 / 审批块。
 *
 * 自同目录 `CoreAPIImpl.ts` 外迁 —— 方法体逐字保留（仅把 `this.<宿主依赖>` 改写为
 * `this.deps.<getter>()`）。宿主依赖经 {@link SessionMessagesReadDeps} 的 getter 注入
 * （宿主 `chatManager` / `sessionManager` 本身即懒解析 getter ⇒ 用 getter 注入零初始化顺序陷阱）。
 *
 * 宿主保留 `getSessionMessages` / `verifySessionDerivation` / `getSessionEvents` 三个对外
 * 薄转发（`CoreAPIImpl implements CoreAPI` + HTTP 消费者）；`_deriveSessionMessagesFromEvents`
 * 由宿主 `deleteMessage`（C14，待批 B3）直调 ⇒ 此处 `public`。
 */

import {
  MessageToEventMigrator,
  deriveMessagesFromEvents,
  diffDerivationMessages,
  type EventLogStorage,
  type DerivationDiff,
  type DerivedMessage,
} from '@modules/session';
import { dedupeMessagesToolCallBlocks } from '@modules/utils/chatBlocks';
import { withPaginationSeq } from './paginationSeq';
import { LRUCache } from '../../utils/cache';
import type { LiriEvent } from '@modules/session/types/events';
import type { SessionManager } from '@modules/session/types/session';
import type {
  UnifiedMessage,
  FrontendMessageBlock,
} from '@modules/session/types/UnifiedMessage';
import type { ChatManager } from '@modules/chat';
import { resolveWorktreeHash } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('runtime:api:CoreAPIImpl');

/**
 * N-55（2026-09-20，长会话读性能）：事件派生结果的消息形状（供派生缓存复用）。
 */
type DerivedSessionMessages = Array<{
  id: string;
  role: string;
  content: string;
  timestamp: number;
  startedAt?: number;
  finishReason?: string;
  tool_calls?: Array<Record<string, unknown>>;
  toolCallId?: string;
  blocks?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}>;

/**
 * N-55：派生结果缓存的**副本**。
 *
 * 消费方 `_attachPendingApprovalBlocks` 会往最后一条助手消息的 `blocks` 里追加审批卡片
 *（直接改写入参）⇒ 命中缓存时必须返回副本，否则缓存被污染、后续读会带上别人的卡片。
 */
function cloneDerivedMessages(
  messages: DerivedSessionMessages
): DerivedSessionMessages {
  return messages.map((m) => ({
    ...m,
    blocks: Array.isArray(m.blocks)
      ? (m.blocks as Array<Record<string, unknown>>).map((b) => ({ ...b }))
      : m.blocks,
  }));
}

/**
 * B2（2026-10-05）：宿主依赖（全 getter，零初始化顺序陷阱）。
 */
export interface SessionMessagesReadDeps {
  getChatManager: () => ChatManager;
  getSessionManager: () => SessionManager;
  /**
   * N-50（2026-09-20）：按会话元数据"删除墓碑"过滤**事件派生**消息
   * （宿主 `CoreAPIImpl._filterDeletedRanges`；按 spec §18 归属 C14，待批 B3 迁出前仍留宿主）。
   */
  getFilterDeletedRanges: () => <T>(sessionId: string, messages: T[]) => T[];
}

/**
 * B2（2026-10-05）：消息读取 / 事件派生 / 派生校验 / 事件流 / 审批块。
 */
export class SessionMessagesRead {
  constructor(private readonly deps: SessionMessagesReadDeps) {}

  async getSessionMessages(
    sessionId: string,
    query?: { limit?: number; before?: number }
  ): Promise<{
    messages: Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      tool_calls?: Array<Record<string, unknown>>;
      blocks?: Array<Record<string, unknown>>;
    }>;
    hasMore: boolean;
  }> {
    // P2-1（2026-08-23）：优先 events 统一派生（评审 G7）——事件聚合为基线 +
    // 投影做版本覆盖。事件派生返回 user/assistant 聚合消息（tool 信息嵌入 blocks），
    // 与前端渲染契约一致；投影（messages.jsonl）含独立 tool 消息（1601/1634）且
    // lastEventSeq 覆盖低，不宜作主源（方案 B 验证否决，2026-08-29）。
    // N-55 分段计时（2026-09-20）：定位命中路径的残余成本（派生或投影读取 / 审批查询 / 分页）
    const perfStart = Date.now();
    try {
      const derived = await this._deriveSessionMessagesFromEvents(sessionId);
      if (derived) {
        const afterDerive = Date.now();
        // N-50（2026-09-20）：过滤"已删除轮次"（元数据墓碑的 seq 区间）——派生路径生效后
        // 仅删投影不足以移除该轮（agg 会按事件重新派生）⇒ 必须在此按 `lastEventSeq` 过滤；
        // 下方 catch 的投影回退路径依赖投影条目已由 `deleteMessage` 整轮删除。
        const visible = this.deps.getFilterDeletedRanges()(sessionId, derived);
        await this._attachPendingApprovalBlocks(
          sessionId,
          visible as unknown as UnifiedMessage[]
        );
        const afterApproval = Date.now();
        const out = this._paginateMessages(visible, query);
        // N-55 分段计时：日志级别为 DEBUG（2026-09-20 由 INFO 降级）—— 常规会话读
        // 每次都打计时行属噪音，需要观测时把日志级别调到 DEBUG 即可。
        logger.debug('[perf] getSessionMessages', {
          path: 'derived',
          sessionId,
          deriveMs: afterDerive - perfStart,
          approvalMs: afterApproval - afterDerive,
          totalMs: Date.now() - perfStart,
          messages: visible.length,
          returned: out.messages.length,
          hasMore: out.hasMore,
        });
        return out;
      }
    } catch {
      // @ignore-catch — 派生失败回退投影路径
    }

    // 投影兜底（事件派生为空/失败：存量 v0 会话等）
    try {
      const gateway = this.deps.getChatManager().getSessionGateway();
      if (gateway) {
        const storedMessages = await gateway.getMessages(sessionId);
        if (storedMessages && storedMessages.length > 0) {
          // 读时合成 pending 审批卡片：提交期的 blocks 注入存在竞态（详见 InboxManager），
          // 读取时按会话动态附加，确保前端实时拿到审批交互卡片。
          await this._attachPendingApprovalBlocks(sessionId, storedMessages);
          // T1.3（2026-08-23）：投影返回前 blocks 去重（同 toolCallId 合并，终态优先）
          const mapped = storedMessages.map((m: UnifiedMessage) => ({
            id: m.id,
            role: m.role.toLowerCase(),
            content: typeof m.content === 'string' ? m.content : '',
            session_id: sessionId,
            timestamp: m.timestamp,
            // 1.6：流式开始时间回传前端（导出显示开始时间与耗时）
            startedAt: m.startedAt,
            // AB-11：finishReason 随消息持久化后回传前端（区分截断/错误/正常）
            finishReason: m.finishReason,
            tool_calls: m.metadata?.tool_calls as
              | Array<Record<string, unknown>>
              | undefined,
            toolCallId: m.metadata?.toolCallId as string | undefined,
            blocks: m.blocks as Array<Record<string, unknown>> | undefined,
            metadata: m.metadata as Record<string, unknown> | undefined,
            // 分页游标透传（方案 C）
            lastEventSeq: m.lastEventSeq,
          }));
          return this._paginateMessages(
            dedupeMessagesToolCallBlocks(mapped),
            query
          );
        }
      }
    } catch (_err) {
      // 持久化读取失败，降级到内存缓存
    }

    // fallback: 从内存缓存读取
    const session = this.deps.getSessionManager().getSession(sessionId);
    if (!session) {
      return { messages: [], hasMore: false };
    }

    // T1.3（2026-08-23）：内存 fallback 返回前 blocks 去重（同 toolCallId 合并，终态优先）
    const mapped = (session.messages || []).map((msg) => {
      let content: string;
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter((b) => b.type === 'text');
        if (textBlocks.length > 0) {
          content = textBlocks
            .map((b) => (b as unknown as { type: 'text'; text: string }).text)
            .join('');
        } else {
          const toolResultBlock = msg.content.find(
            (b) => b.type === 'tool_result'
          );
          if (toolResultBlock) {
            content =
              (
                toolResultBlock as unknown as {
                  type: 'tool_result';
                  content: string;
                }
              ).content || '';
          } else {
            content = '';
          }
        }
      } else {
        content = '';
      }

      return {
        id: msg.id,
        role: msg.role.toLowerCase(),
        content,
        session_id: sessionId,
        timestamp:
          msg.createdAt instanceof Date ? msg.createdAt.getTime() : Date.now(),
        // AB-11：内存 fallback 路径同样回传 finishReason
        finishReason: msg.finishReason,
        tool_calls: msg.tool_calls as
          | Array<Record<string, unknown>>
          | undefined,
        toolCallId:
          msg.toolCallId || (msg.metadata?.toolCallId as string | undefined),
        blocks: msg.blocks,
        metadata: msg.metadata as Record<string, unknown> | undefined,
      };
    });
    return this._paginateMessages(dedupeMessagesToolCallBlocks(mapped), query);
  }

  /**
   * KB-LONG-SESSION（2026-08-29）：getSessionMessages 分页——消息按首事件 seq 升序，
   * 取末尾 limit 条（最近的），hasMore 精确表示是否还有更早。排序键 lastEventSeq
   * 优先，回退 timestamp（投影/内存 fallback 路径无 lastEventSeq）。不传 limit 时
   * 返回全量（行为不变），小会话前端传大 limit 也等效全量。
   *
   * P1-6b（2026-09-27，Spec §10）：**分页键归一化**（`withPaginationSeq`）。
   * 原键 `lastEventSeq ?? timestamp` 混比两种量纲（事件序号 ~1e3 vs epoch 毫秒 ~1.7e12）：
   * 一旦 `before` 落在 timestamp 量纲，`key(m) <= before` 对所有条目恒真 ⇒ **过滤失效**、
   * 每页恒返回同一批尾部消息（前端 id 去重后"点了没反应"、`hasMore` 恒 true）；
   * 且前端游标只读 `messages[0].lastEventSeq` ⇒ 尾页首条缺该字段时游标为 null。
   * 故**仅在分页启用时**（limit > 0）先回填单调键：量纲统一 + 每页首条恒有键。
   * 不传 limit 的全量响应**保持原样**（不改动其他消费者可见字段）。
   */
  private _paginateMessages<
    T extends { lastEventSeq?: number; timestamp?: number },
  >(
    messages: T[],
    query?: { limit?: number; before?: number }
  ): { messages: T[]; hasMore: boolean } {
    const limit = query?.limit;
    if (limit == null || limit <= 0) {
      return { messages, hasMore: false };
    }
    const normalized = withPaginationSeq(messages);
    const key = (m: T): number => m.lastEventSeq ?? m.timestamp ?? 0;
    let filtered = normalized;
    if (query?.before != null) {
      // N-57（2026-09-20）：排序键 `lastEventSeq` **存在重复值**（同轮多条消息共享 seq，
      // 实测会话开头有 `1,1 / 2,2 / 3,3`）⇒ 用 `<` 会把与边界同 seq 的消息漏掉
      // （总条数落在 limit+1..limit+5 的会话会丢条）。改用 `<=` 保证不丢，
      // 边界条目会重复返回，由前端 `loadOlderMessagesImpl` 按 id 去重消除。
      filtered = filtered.filter((m) => key(m) <= (query.before as number));
    }
    const hasMore = filtered.length > limit;
    // N-57（2026-09-20）：filtered.length <= limit 时必须返回全部 —— 原
    // `filtered.slice(filtered.length - limit)` 在"剩余条数不足一页"时退化为负索引，
    // 等价于 `slice(-|残余|)` 只取尾部若干条（实测 92 条只回 8 条）且 hasMore=false ⇒
    // 最后一页丢失、中间消息永久不可达。
    const page = hasMore ? filtered.slice(filtered.length - limit) : filtered;
    return { messages: page, hasMore };
  }

  /**
   * N-55（2026-09-20）：事件派生结果缓存（key=sessionId；命中要求指纹一致；命中返回副本）。
   * 容量 32 会话（LRU 淘汰），无 TTL —— 正确性由指纹保证（tailSeq/投影/压缩区间任一变化即重算）。
   */
  private readonly _derivedMessagesCache = new LRUCache<{
    fingerprint: string;
    messages: DerivedSessionMessages;
  }>(32);

  /**
   * P2-7/G4（2026-09-25）：派生读路径的**取数头部**（**不含 events**）。
   *
   * 与 `_deriveSessionMessagesFromEvents` 共用，避免两处重复"分区解析 + 投影读取 + 压缩区间解析"；
   * **不含 events** 是为保持既有缓存语义：派生缓存命中时**不应读事件**（N-55 的省算语义）。
   *
   * @returns `null` = 无事件日志（未落盘 / 已删除）⇒ 无法派生
   */
  private async _loadDerivationHead(sessionId: string): Promise<{
    eventLog: EventLogStorage;
    tailSeq: number;
    projections: UnifiedMessage[];
    mappedProjections: DerivedMessage[];
    compactionRanges?: Array<{
      startSeq: number;
      endSeq: number;
      summaryMessageId?: string;
    }>;
  } | null> {
    // N-52 修复（2026-09-20）：与 `getSessionEvents` 用**同一访问器**取事件日志 ——
    // worktreeHash 走 `resolveWorktreeHash()` 单一真源（P2-5）并复用 ChatManager 的实例缓存。
    // 原实现 `new EventLogStorage(sessionId, 'default')` 把 `'default'` 当 worktreeHash
    // （真实分区为 worktree hash，如 `57971aa3`）⇒ `exists()` 恒 false ⇒ 派生恒返回 null、
    // 事件派生路径沦为死代码。详见 `.trae/specs/event-derivation-read-path-rootfix.md`。
    const chatManager = this.deps.getChatManager() as unknown as {
      _getOrCreateEventLog?(sessionId: string): EventLogStorage;
    };
    const eventLog = chatManager._getOrCreateEventLog?.(sessionId);
    if (!eventLog || !eventLog.exists()) return null;

    const gateway = this.deps.getChatManager().getSessionGateway();
    const projections: UnifiedMessage[] = gateway
      ? await gateway.getMessages(sessionId)
      : [];
    // A-3（2026-08-23）/ D4（2026-09-23）：派生时传入会话 metadata 压缩区间表
    // （trajectoryCompactions）作为**可重建缓存** —— 命中优先，但与 `context/compaction`
    // 事件冲突时**以事件为准**（并在派生器内记 warning）；缓存缺失 ⇒ 仅凭事件重建。
    const sessionMeta = this.deps.getSessionManager().getSession(sessionId)
      ?.metadata as Record<string, unknown> | undefined;
    const compactionRanges = sessionMeta?.trajectoryCompactions as
      | Array<{
          startSeq: number;
          endSeq: number;
          summaryMessageId?: string;
        }>
      | undefined;

    const tailSeq = await eventLog.getTailSeq();
    const mappedProjections: DerivedMessage[] = projections.map((m) => ({
      id: m.id,
      role: m.role.toLowerCase(),
      content: typeof m.content === 'string' ? m.content : '',
      timestamp: m.timestamp,
      startedAt: m.startedAt,
      finishReason: m.finishReason,
      tool_calls: m.metadata?.tool_calls as
        | Array<Record<string, unknown>>
        | undefined,
      toolCallId: m.metadata?.toolCallId as string | undefined,
      blocks: m.blocks as Array<Record<string, unknown>> | undefined,
      metadata: m.metadata as Record<string, unknown> | undefined,
      lastEventSeq: m.lastEventSeq,
    }));

    return {
      eventLog,
      tailSeq,
      projections,
      mappedProjections,
      compactionRanges,
    };
  }

  /**
   * P2-7/G4（2026-09-25）：读取派生所需事件（**排除** `assistant/thinking`）。
   *
   * @returns `null` = 无 v1（`messageId`）事件 ⇒ 不可派生（与既有 `hasV1` 判据一致）
   */
  private async _loadDerivationEvents(
    eventLog: EventLogStorage
  ): Promise<LiriEvent[] | null> {
    // 循环拉取 events（G5：read limit≤10000 无分页，防静默截断）
    // KB-LONG-SESSION（2026-08-29）：排除 assistant/thinking 高频细节事件——
    // 长会话 events.jsonl 中 thinking 占 90%+，载入跳过可降事件处理量一个量级，
    // 派生消息不依赖 thinking（thinking 块仅回放展示用，流式时已实时推送）。
    const events: LiriEvent[] = [];
    let fromSeq = 1;
    for (;;) {
      const batch = await eventLog.read({
        fromSeq,
        limit: 10000,
        excludeTypes: ['assistant/thinking'],
      });
      events.push(...batch);
      if (batch.length < 10000) break;
      fromSeq = batch[batch.length - 1].seq + 1;
    }
    const hasV1 = events.some((e) => {
      const d = e.data as { messageId?: string };
      return typeof d.messageId === 'string';
    });
    return hasV1 ? events : null;
  }

  /**
   * P2-1（2026-08-23）：从 events 统一派生消息（事件聚合 + 投影覆盖，评审 G7/A1'）。
   * 仅当 events 含 v1（messageId）事件时返回派生结果，否则返回 null（回退投影路径，
   * 存量 v0 会话安全兼容）。
   */
  public async _deriveSessionMessagesFromEvents(
    sessionId: string
  ): Promise<Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
    startedAt?: number;
    finishReason?: string;
    tool_calls?: Array<Record<string, unknown>>;
    toolCallId?: string;
    blocks?: Array<Record<string, unknown>>;
    metadata?: Record<string, unknown>;
  }> | null> {
    // P2-7/G4（2026-09-25）：取数拆到 `_loadDerivationHead` / `_loadDerivationEvents`，
    // 与 `verifySessionDerivation` 共用（避免两处重复"分区解析 + 事件循环"）。
    // ⚠️ 缓存命中路径**顺序不变**：head 不含 events ⇒ 命中时不会读事件（N-55 的省算语义保持）。
    const head = await this._loadDerivationHead(sessionId);
    if (!head) return null;
    const {
      eventLog,
      tailSeq,
      projections,
      mappedProjections,
      compactionRanges,
    } = head;

    // N-55（2026-09-20，长会话读性能）：**派生结果缓存**。
    // 实测：3847 事件 / 192 消息的长会话，热读 ~34ms —— 其中"读 events"已被 EventLogStorage 的
    // 事件快照缓存覆盖（P1-2），余下主要是**每次重算派生**（聚合 + 覆盖 + 块合并 + 去重）。
    // 指纹 = tailSeq + 投影规模/末条 id + 压缩区间数：任一变化即失效重算（无 TTL，正确性靠指纹）。
    const lastProjection = projections[projections.length - 1];
    const fingerprint = [
      tailSeq,
      projections.length,
      lastProjection?.id ?? '',
      compactionRanges?.length ?? 0,
    ].join('|');
    const cached = this._derivedMessagesCache.get(sessionId);
    if (cached && cached.fingerprint === fingerprint) {
      // 命中 ⇒ 返回**副本**（消费方 `_attachPendingApprovalBlocks` 会改写 blocks）
      return cloneDerivedMessages(cached.messages);
    }
    logger.debug('deriveCache:未命中（重算派生）', {
      sessionId,
      tailSeq,
      projections: projections.length,
      hasCached: Boolean(cached),
    });
    const deriveStart = Date.now();

    const events = await this._loadDerivationEvents(eventLog);
    if (!events) return null;
    const derived = deriveMessagesFromEvents(events, mappedProjections, {
      compactionRanges,
    });
    // T1.3（2026-08-23）：派生结果返回前对 blocks 去重（合并同 toolCallId 的 tool_call 块，
    // 终态优先 + 保留首非空 arguments），消除 SSE 层重复发送在投影/内存中残留的污染块。
    const mapped = derived.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      session_id: sessionId,
      timestamp: m.timestamp,
      startedAt: m.startedAt,
      finishReason: m.finishReason,
      tool_calls: m.tool_calls,
      toolCallId: m.toolCallId,
      blocks: m.blocks,
      metadata: m.metadata,
      // B-2（2026-08-23）：透传排序键（事件派生序），前端 setMessages 据此排序
      lastEventSeq: m.lastEventSeq,
    }));
    const result = dedupeMessagesToolCallBlocks(mapped);
    // N-55：诊断用（DEBUG）—— 长会话冷派生实测 ~1.2s（3847 事件），命中缓存后每次读不再重算
    logger.debug('deriveCache:计算完成', {
      sessionId,
      deriveMs: Date.now() - deriveStart,
      events: events.length,
      messages: result.length,
    });
    // N-55：写入派生缓存（指纹与上面的命中判据一致）
    this._derivedMessagesCache.set(sessionId, {
      fingerprint,
      messages: result as DerivedSessionMessages,
    });
    return result;
  }

  /**
   * P2-7/G4（2026-09-25）：**派生一致性校验** —— 比对"纯事件派生基线"与"落盘投影"。
   *
   * **只报告、不改写**（自动修复会掩盖根因，CS05）。基线取法：
   * `deriveMessagesFromEvents(events, [])`（`projections` 传空 ⇒ 不做投影覆盖）。
   *
   * ⚠️ 语义边界：基线与投影来自**两条写入路径**，不一致**未必**是缺陷
   * （如压缩摘要只存在于事件侧）⇒ 返回的是**事实差异报告**，本方法不判错。
   *
   * @returns `available=false` ⇒ 无事件日志 / 无 v1 事件（**无法校验**，不是"一致"）
   */
  async verifySessionDerivation(sessionId: string): Promise<{
    available: boolean;
    diff?: DerivationDiff;
    reason?: string;
  }> {
    const head = await this._loadDerivationHead(sessionId);
    if (!head) {
      return { available: false, reason: '无事件日志（未落盘或已删除）' };
    }
    const events = await this._loadDerivationEvents(head.eventLog);
    if (!events) {
      return {
        available: false,
        reason: '无 v1 事件（缺 messageId），不可派生',
      };
    }

    const baseline = deriveMessagesFromEvents(events, [], {
      compactionRanges: head.compactionRanges,
    });
    return {
      available: true,
      diff: diffDerivationMessages(baseline, head.projections),
    };
  }

  /**
   * 读时合成 pending 审批卡片 blocks（P0-2 审批链路）
   * 提交期的 blocks 注入（InboxManager._injectInboxBlock）会被流式持久化覆盖，
   * 改为消息读取时按会话动态附加，确保前端实时拿到审批交互卡片。
   */
  private async _attachPendingApprovalBlocks(
    sessionId: string,
    messages: UnifiedMessage[]
  ): Promise<void> {
    try {
      const { inboxManager } = await import('@modules/runtime/InboxManager.js');
      // 直查 inbox_items.session_id（而非 JOIN session_inbox_map）：
      // Web 提交的审批项无 channelSessionId 不写 map 表，getBySession 会漏掉。
      const { items } = await inboxManager.list({
        sessionId,
        status: 'pending',
        type: 'approval',
      });
      const pending = items;
      // 排查 J-1.3：记录读时合成的待审批项数量，确认审批卡片能注入会话消息
      logger.info('attachPendingApprovalBlocks: 查询待审批项', {
        sessionId,
        pendingCount: pending.length,
      });
      if (pending.length === 0) return;

      const lastAssistant = messages
        .filter((m) => m.role === 'assistant')
        .pop();
      if (!lastAssistant) return;

      const existing =
        (lastAssistant.blocks as unknown as FrontendMessageBlock[]) ?? [];
      const blocks = pending.map(
        (item) =>
          ({
            id: item.id,
            type: 'inbox',
            content: '',
            inboxData: {
              inboxId: item.id,
              type: item.type,
              title: item.title,
              content: item.message || '',
              status: 'pending',
              priority: 'normal',
              actions: (item.options?.length
                ? item.options
                : ['approve', 'deny']
              ).map((o) => ({
                label: o === 'approve' ? '批准' : o === 'deny' ? '拒绝' : o,
                reply: o,
                style:
                  o === 'deny' ? ('danger' as const) : ('primary' as const),
              })),
              channelSource: item.channelId,
            },
          }) as FrontendMessageBlock
      );
      lastAssistant.blocks = [...existing, ...blocks];
    } catch (err) {
      // 合成失败不影响消息读取
      void handleError(err, {
        module: 'runtime:api',
        action: 'attach_pending_approval_blocks',
      });
    }
  }

  /**
   * M1 事件溯源：获取会话事件流
   *
   * 通过 ChatManager 持有的 EventLogStorage 读取事件。
   * 首次访问时若 events.jsonl 不存在但 messages.jsonl 存在，ChatManager 自动触发迁移。
   *
   * recent=true（P8 补充，2026-08-26）：未传 fromSeq 时从会话尾部向前取 limit 条
   * （日志/轨迹面板显示最近事件，避免长会话只看到开头 1000 条）。
   */
  async getSessionEvents(
    sessionId: string,
    query?: {
      fromSeq?: number;
      toSeq?: number;
      /**
       * 向前补页（P1-1，2026-09-22）：只取 `seq < beforeSeq` 的事件，返回其中
       * **紧邻该点之前**的一页（至多 `limit` 条）。与 `fromSeq` 互斥优先。
       */
      beforeSeq?: number;
      types?: Array<string>;
      limit?: number;
      recent?: boolean;
    }
  ): Promise<{
    events: Array<LiriEvent>;
    tailSeq: number;
    /** 更早方向是否还有事件（向前补页用；与 `hasMore` 对称） */
    hasEarlier: boolean;
    hasMore: boolean;
  }> {
    // 复用 ChatManager 的事件日志能力（ChatManager 持有 EventLogStorage 实例缓存）
    const chatManager = this.deps.getChatManager() as unknown as {
      _getOrCreateEventLog?(sessionId: string): EventLogStorage;
    };

    const log = chatManager._getOrCreateEventLog?.(sessionId);
    if (!log) {
      return { events: [], tailSeq: 0, hasEarlier: false, hasMore: false };
    }

    // 首次访问时触发迁移（与 ChatManager._appendEventsForMessage 一致）
    if (!log.exists()) {
      // N-52 同族修复（2026-09-22）：迁移器同样需要正确的 worktreeHash 才能找到该会话
      // 投影（`messages.jsonl`）所在分区 —— 传字面量 `'default'` 会查错目录、迁移恒不生效。
      const migrator = new MessageToEventMigrator(
        log,
        sessionId,
        resolveWorktreeHash()
      );
      if (migrator.needsMigration()) {
        await migrator.migrate();
      }
    }

    const limit = query?.limit ?? 1000;

    // recent=true 且未传 fromSeq：尾部优先窗口（最后 limit 条），
    // 覆盖长会话"只看到开头 1000 条"的展示缺口
    let effectiveFrom = query?.fromSeq;
    let effectiveTo = query?.toSeq;
    if (query?.recent && effectiveFrom === undefined) {
      const realTail = await log.getTailSeq();
      effectiveFrom = Math.max(1, realTail - limit + 1);
    }
    // 向前补页（P1-1，2026-09-22）：取 `[beforeSeq - limit, beforeSeq)` 这一页。
    // 说明：`EventLogStorage.read` 的语义是"从 `fromSeq` 向后至多 `limit` 条"，故把
    // `fromSeq` 预置到 `beforeSeq - limit`、`toSeq` 收到 `beforeSeq - 1` 即恰好命中该窗口
    //（**无需在存储层新增反向读能力**）。到顶时 `fromSeq` 被钳到 1 ⇒ 自然返回不足一页。
    if (query?.beforeSeq !== undefined) {
      effectiveTo = query.beforeSeq - 1;
      effectiveFrom = Math.max(1, query.beforeSeq - limit);
    }

    // types: string[] → LiriEventType[]（HTTP 入参为字符串，运行时已校验）
    const logQuery = query
      ? {
          fromSeq: effectiveFrom,
          toSeq: effectiveTo,
          types: query.types as Array<LiriEvent['type']> | undefined,
          limit: query.limit,
        }
      : undefined;
    const events = await log.read(logQuery);
    const tailSeq = await log.getTailSeq();
    const hasMore =
      events.length > 0 && events[events.length - 1].seq < tailSeq;
    // 更早方向是否还有：首条 seq > 1 即说明该侧存在更早事件（seq 自 1 起单调）
    const hasEarlier = events.length > 0 && events[0].seq > 1;

    return { events, tailSeq, hasEarlier, hasMore };
  }
}
