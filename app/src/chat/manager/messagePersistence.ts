// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatMessagePersistence —— 消息持久化 / 事件投影簇（ChatManager 拆分批 U-22/S3）
 *
 * **来源**：从 `ChatManager` 外移 `_addAndPersistMessage`（156 行）/
 * `_appendEventsForMessage`（163 行）/ `updateMessageBlocks`（133 行）。
 *
 * **职责（单一：消息与事件如何落盘）**：
 *   ① `addAndPersistMessage`：空正文拦截 → 工具结果持久化限额 → 内存投影 →
 *      事件溯源追加 → `messages.jsonl` 落盘（含 `throwOnError` 强一致语义）
 *   ② `appendEventsForMessage`：`MessageToEventMigrator` 转换 → 流式已写事件过滤 →
 *      `toolCallId → seq` 回填 → 逐条 append → 失败 `pendingRepair` + 对账
 *   ③ `updateMessageBlocks`：终态 blocks 合并/去重 → 投影更新 → `updateMessage` 落盘
 *
 * **行为等价**：日志文案、异常与返回值语义**逐字未变**（仅 `this.` → 注入 deps）。
 * `_pendingPersistPromises` 仍归宿主（`flushPendingPersists` 消费同一 Set）。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { Message } from '@modules/session/types/message.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { EventLogStorage, SessionGateway } from '@modules/session';
import { MessageToEventMigrator } from '@modules/session';
import { shrinkToolResultMessageForPersistence } from '@modules/tools';
import { dedupeToolCallBlocks } from '@modules/utils/chatBlocks';
import { pickMoreCompleteContent } from '@modules/utils/common';
import type {
  UnifiedMessage,
  FrontendMessageBlock,
  MessageMetadata,
} from '@modules/session/types/UnifiedMessage';
import { MessageRole as SessionMessageRole } from '@modules/session/types/UnifiedMessage';
import { resolveWorktreeHash } from '@modules/environment';

import { persistChatMessage, toSessionMsgType } from '../services/ChatHelper';
import { buildAssistantTimingData } from '../services/timingEvent';

const logger = getLogger('chat:manager');

export interface MessagePersistenceDeps {
  /** 会话内存投影（与宿主共享同一 Map） */
  chatSessions: Map<string, ChatSession>;
  sessionGateway: SessionGateway;
  /** per-session 事件日志实例（宿主缓存） */
  getOrCreateEventLog: (sessionId: string) => EventLogStorage;
  /** 重启后从事件日志懒重建 `toolCallId → seq`（宿主实现） */
  rebuildToolCallSeqMap: (sessionId: string) => Promise<void>;
  /** 与宿主共享的 `toolCallId → seq` 映射 */
  toolCallSeqMap: Map<string, number>;
  /** 事件写失败 ⇒ 触发该会话对账（宿主实现） */
  requestReconcile: (sessionId: string, eventLog: EventLogStorage) => void;
  /** 与宿主共享的待落盘 Promise 集合（`flushPendingPersists` 消费） */
  pendingPersistPromises: Set<Promise<void>>;
  createAssistantMessage: (
    content: string,
    options: { sessionId: string; id: string }
  ) => Message;
  getStreamTailSeq: (sessionId: string) => Promise<number>;
}

/**
 * FIX-8（2026-10-27）：空正文 assistant 消息**是否应拒绝持久化**（纯函数，导出便于单测）。
 *
 * 规则：无可见正文 + 无任何工具调用 + 无 `text`/`tool_call` 块 ⇒ 拒绝
 * （DeepSeek 对"历史里含空 assistant"会级联返回空响应，见下方原注释）。
 *
 * ⚠️ 本轮修复点：工具轮次的 `tool_calls` 在本仓**有两处存放位置**——
 * 顶层 `message.tool_calls` 与 `metadata.tool_calls`（`ReActToolLoop` 写后者）。
 * 原判据只查顶层 ⇒ 真机出现 4 次「空正文助手消息拒绝持久化」且 `blockTypes: []`，
 * 而同一轮 raw response 明确 `hasToolCalls: true（glob×2）`、`textChunkCount: 0`
 * （模型只输出思考 + 工具调用）⇒ **合法工具轮次被丢弃**，历史里缺
 * assistant/tool_call，下一轮模型看不到自己发起过调用。
 */
export function shouldRejectEmptyAssistantMessage(message: Message): boolean {
  if (message.role !== 'assistant') return false;
  if (typeof message.content !== 'string') return false;
  if (message.content.trim() !== '') return false;
  if ((message.tool_calls?.length ?? 0) > 0) return false;

  const metaToolCalls = (
    message.metadata as { tool_calls?: unknown } | undefined
  )?.tool_calls;
  if (Array.isArray(metaToolCalls) && metaToolCalls.length > 0) return false;

  const blockTypes = (message.blocks ?? []).map(
    (b) => (b as { type?: unknown }).type
  );
  return !blockTypes.includes('text') && !blockTypes.includes('tool_call');
}

export class ChatMessagePersistence {
  /**
   * P0-3（2026-10-04，D-238 第 1 条）：持久化侧**单轮聚合**窗口（按会话累计工具结果载荷字符）。
   * 用户消息落盘 = 新用户轮 ⇒ 归零；由 `shrinkToolResultMessageForPersistence` 在累计超
   * `TURN_BUDGET_CHARS` 时对后续大块强制 spill（与上下文侧同预算、同文案）。
   */
  private readonly turnToolChars: Map<string, number> = new Map();

  constructor(private readonly deps: MessagePersistenceDeps) {}

  async addAndPersistMessage(
    sessionId: string,
    message: Message,
    options?: { throwOnError?: boolean }
  ): Promise<void> {
    const deps = this.deps;
    // P1 修复（2026-08-15）：空正文消息告警；2026-08-20 升级为拦截（QQ 空响应事故）：
    // DeepSeek 对"历史含空 assistant 消息/连续多条 assistant"会直接返回空响应
    // （chunkCount=0, finishReason=stop）。若空 assistant 再落盘，污染逐轮累积，
    // 形成恶性循环（每轮都空）。故空正文 + 无 toolCalls/tool_call 块 + 无 text 块的
    // assistant 消息直接拒绝持久化（含工具活动的空 content 是合法 tool 轮次，仍允许）。
    // F3（2026-09-04）：放行条件从"顶层 tool_calls"扩到"blocks 含 tool_call"——
    // 工具轮次助手消息若仅以 block 承载 toolCall（无顶层 tool_calls 字段）会被误拒。
    if (shouldRejectEmptyAssistantMessage(message)) {
      const blockTypes = (message.blocks ?? []).map(
        (b) => (b as { type?: unknown }).type
      );
      // 工具轮次快照（含 tool_call 块）放行——事件溯源按 messageId 聚合，拒绝会造成
      // 中断/崩溃场景的孤立 assistant/tool_call 事件；真正的"终态真空"仍拦截。
      logger.warn('chat:空正文助手消息拒绝持久化（防历史污染）', {
        sessionId,
        messageId: message.id,
        blockTypes: blockTypes.filter(Boolean),
      });
      return;
    }
    // T2 / D-236（2026-10-02）：**持久化侧同口径改写**（spec `.trae/specs/tool-result-persistence-limit.md` §3.1）。
    // 此前限额只在上下文侧生效、持久化存原文 ⇒ 样本会话 `messages.jsonl` 30.43MB（单条 ≈14MB）；
    // 此处复用 `ToolResultPersister` 的**同一阈值与同一文案**（阈值经 `SINGLE_RESULT_LIMIT_CHARS` 单一事实源），
    // 使磁盘与上下文一致，全量仍可在 `tool-results/{toolCallId}.txt` 回读。
    // D-240（2026-10-02）：门禁**不再要求 `string`** —— 工具结果消息的 `content` 在生产是
    // `ContentBlock[]`（`MessageService.createToolResultMessage` 构造），原 `typeof === 'string'`
    // 门禁恒 false ⇒ 整条 T2 未生效。
    // P0-3（2026-10-04，D-238 第 1 条）：持久化侧单轮聚合窗口。
    if (message.role === 'user') this.turnToolChars.set(sessionId, 0);
    const turnAcc = { chars: this.turnToolChars.get(sessionId) ?? 0 };
    if (message.content !== undefined && message.content !== null) {
      try {
        const shrunk = await shrinkToolResultMessageForPersistence(
          {
            id: message.id,
            // 落盘文件名取 `Message.toolCallId`（生产实况）—— 与上下文侧 `normalizedToolCall.id`
            // 同名同物，避免同一结果在两侧各写一份文件
            toolCallId: message.toolCallId,
            content: message.content,
            metadata: message.metadata,
          },
          { turnAcc }
        );
        // 写回累计（无论本次是否改写都要记，供本轮后续消息判定）
        this.turnToolChars.set(sessionId, turnAcc.chars);
        if (shrunk.changed) {
          message.content = shrunk.content as Message['content'];
          // D-238 第 2 条（2026-10-02）：回写落盘路径/长度，与上下文侧 `metadata.toolResultPath`
          // /`toolResultFullChars` 同字段。
          message.metadata = {
            ...(message.metadata ?? {}),
            toolResultPath: shrunk.toolResultPath,
            toolResultFullChars: shrunk.toolResultFullChars,
          };
        }
      } catch (e) {
        // CS03（落盘失败最小回退）：全量落盘是本机 IO，失败概率极低；失败时**保留原文**
        handleError(e, {
          module: 'chat:manager',
          action: 'shrinkToolResultBeforePersist',
          context: { sessionId, messageId: message.id },
        }).catch(() => {});
      }
    }
    const session = deps.chatSessions.get(sessionId);
    // D5 消息级模型落盘兜底：assistant 消息未携带 model 时，回填会话当前模型
    if (
      message.role === 'assistant' &&
      !message.metadata?.model &&
      session?.metadata?.model
    ) {
      message.metadata = {
        ...(message.metadata ?? {}),
        model: session.metadata.model,
      };
    }
    if (session) {
      // B4（2026-08-23）：流式结束复用占位对象——updateMessageBlocks 已创建同 id 占位
      //（前端 messageId 透传），此处更新该对象而非新建 push，避免内存/磁盘双条同 id
      const existing = session.messages.find((m) => m.id === message.id);
      if (existing) {
        Object.assign(existing, message);
        message = existing;
      } else {
        session.messages.push(message);
      }
      session.updatedAt = new Date();
      session.metadata.lastActivityAt = new Date();
      session.metadata.totalMessages = session.messages.length;
      // 会话恢复后清除崩溃标记（正常使用说明已恢复）
      if (session.metadata.crashRecovery) {
        delete session.metadata.crashRecovery;
        delete session.metadata.crashedAt;
        delete session.metadata.lastActivityBeforeCrash;
      }
    }
    const persistPromise = (async () => {
      // M1 事件溯源：在 messages.jsonl 落盘前，先把消息追加到事件日志。
      // 复用 Migrator 的 convertMessage 逻辑（CS01 归一化），避免重复实现。
      // 事件追加失败不阻断主路径（CS03），只记日志。
      try {
        await this.appendEventsForMessage(sessionId, message);
      } catch (e) {
        // @ignore-catch — 事件日志写入失败不阻断消息落盘
        handleError(e, {
          module: 'chat:manager',
          action: 'appendEventsForMessage',
          context: { sessionId, messageId: message.id },
        }).catch(() => {});
      }
      try {
        // BUG-H（2026-08-26）：透传 throwOnError——persistChatMessage 底层
        // 空 catch 已修复为可上抛，此处才能真正感知落盘失败
        await persistChatMessage(deps.sessionGateway, sessionId, message, {
          throwOnError: options?.throwOnError,
        });
      } catch (e) {
        // 问题二-1（2026-08-26）：调用方要求落盘强一致时（如用户回答），
        // 失败必须上抛 → HTTP 层返回失败，前端可感知并重试；否则维持吞错降级
        if (options?.throwOnError) throw e;
        // @ignore-catch — 持久化失败不阻断主流程，由 handleError 统一记录
        handleError(e, {
          module: 'chat:manager',
          action: 'persistMessage',
          context: { sessionId },
        }).catch(() => {});
      }
    })();
    deps.pendingPersistPromises.add(persistPromise);
    // 完成后自动从集合中移除，避免内存泄漏
    persistPromise.finally(() =>
      deps.pendingPersistPromises.delete(persistPromise)
    );
    await persistPromise;
  }

  /**
   * M1 事件溯源：把消息转换为事件并追加到 per-session 事件日志。
   *
   * 流程：
   *   1. 获取 per-session EventLogStorage 实例（缓存）
   *   2. 首次使用时检测并迁移旧数据
   *   3. 复用 MessageToEventMigrator.convertMessage 转换
   *   4. 内存维护 toolCallId → seq 映射，回填 tool/result.callSeq
   *   5. 逐条 append（不批量，避免阻塞主路径）
   *
   * 失败处理：
   *   - append 返回 duplicate-seq：正常幂等情况，不告警
   *   - append 返回其他失败：记 warn 日志，不抛错
   */
  async appendEventsForMessage(
    sessionId: string,
    message: Message
  ): Promise<void> {
    const deps = this.deps;
    const eventLog = deps.getOrCreateEventLog(sessionId);

    // 首次使用时检测是否需要迁移旧数据
    if (!eventLog.exists()) {
      const migrator = new MessageToEventMigrator(
        eventLog,
        sessionId,
        resolveWorktreeHash()
      );
      if (migrator.needsMigration()) {
        logger.info('chat:manager 自动触发事件日志迁移', { sessionId });
        const result = await migrator.migrate();
        logger.info('chat:manager 迁移完成', {
          sessionId,
          migrated: result.migrated,
          generated: result.generated,
          errors: result.errors.length,
        });
      }
    }

    // P3-7a（2026-09-02）：批量事件在逐条 append 时统一归 0，由 append 在 mutex 内
    // 原子分配 seq——替换"getTailSeq + 1"起点，根治与实时流事件并发读同一 tailSeq 的 duplicate-seq。
    // convertMessage 生成的临时 seq（0 起）仅用于过滤与类型判定，不作为最终 seq。
    const migrator = new MessageToEventMigrator(
      eventLog,
      sessionId,
      resolveWorktreeHash()
    );
    const { events } = migrator.convertMessage(message, 0, Date.now());

    // 修复（P0-根因修复，替代 tailSeq>0 的宽泛判断）：
    // 只有明确带 __streamedEventsWritten 标记的消息才跳过完整 text/thinking 事件，
    // 避免流式 chunk 与完整正文双份写入导致前端回放重复。
    const hasStreamedMarker = Boolean(
      (message.metadata as Record<string, unknown> | undefined)
        ?.__streamedEventsWritten
    );
    // N-59 修复（2026-09-24）：标记是**传递值**，实测会在落盘路径上丢失 ——
    // 按 CS02 改问**事件层事实**：该 messageId 是否已写过正文。
    const streamedTextWritten =
      message.role === 'assistant' &&
      eventLog.hasStreamedTextForMessage(message.id);
    let filteredEvents = events;
    if (
      (hasStreamedMarker || streamedTextWritten) &&
      message.role === 'assistant'
    ) {
      const before = events.length;
      // P0-fix-4（2026-08-23）：流式路径已实时写入 tool_call 事件（工具循环内 tool_start 时），
      // 落盘时同样过滤 assistant/tool_call，避免与实时写入的事件重复（按 id 去重靠过滤实现）。
      filteredEvents = events.filter(
        (e) =>
          e.type !== 'assistant/text' &&
          // F-2（2026-09-02）：流式 text 已以 text-batch 聚合事件实时写入，
          // 最终落盘同样过滤，避免与完整正文双份写入
          e.type !== 'assistant/text-batch' &&
          e.type !== 'assistant/thinking' &&
          e.type !== 'assistant/tool_call'
      );
      const removed = before - filteredEvents.length;
      if (removed > 0) {
        logger.debug(
          'chat:appendEventsForMessage 过滤流式已写过的 text/thinking/tool_call 事件',
          {
            sessionId,
            messageId: message.id,
            hasStreamedMarker,
            removedCount: removed,
            remainingTypes: filteredEvents.map((e) => e.type),
          }
        );
      }
    }

    // T2.2（2026-08-23）：重启后 _toolCallSeqMap 为空，tool/result.callSeq === -1 时
    // 从 events 懒重建映射（每个会话一次，结果缓存），避免 -1 占位影响前端 callSeq 配对。
    const needsRebuild = filteredEvents.some(
      (e) =>
        e.type === 'tool/result' &&
        (e.data as { callSeq: number }).callSeq === -1
    );
    if (needsRebuild) await deps.rebuildToolCallSeqMap(sessionId);

    // 逐条追加
    for (const event of filteredEvents) {
      // P3-7a：seq 归 0 交由 append 在 mutex 内原子分配（根治并发 duplicate-seq）
      event.seq = 0;
      // tool/result 的 callSeq === -1 → 从 map 回填真实 tool_call 事件 seq（A1 闭环）
      if (event.type === 'tool/result') {
        const data = event.data as { callSeq: number; toolCallId: string };
        if (data.callSeq === -1) {
          data.callSeq = deps.toolCallSeqMap.get(data.toolCallId) ?? -1;
        }
      }
      const result = await eventLog.append(event);
      // tool_call 事件分配后回填 map（用 append 返回的真实 seq，前端按 callSeq 配对）
      if (event.type === 'assistant/tool_call' && result.ok) {
        const data = event.data as { toolCallId?: string };
        if (data.toolCallId) {
          deps.toolCallSeqMap.set(data.toolCallId, result.tailSeq);
        }
      }
      if (
        !result.ok &&
        result.reason !== 'duplicate-seq' &&
        // TB-14/E1-a：会话已被外部进程删除 ⇒ 主动放弃落盘，非真实写失败（不告警/不触发对账）
        result.reason !== 'session-dir-missing'
      ) {
        // A-7（2026-08-23）：写事件失败 → 投影消息打 pendingRepair 标记 + 触发该会话对账。
        logger.warn('chat:manager 事件追加失败，标记投影消息 pendingRepair', {
          sessionId,
          messageId: message.id,
          seq: event.seq,
          type: event.type,
          reason: result.reason,
        });
        message.metadata = {
          ...(message.metadata ?? {}),
          pendingRepair: true,
        };
        deps.requestReconcile(sessionId, eventLog);
      }
    }

    // TR-14-A（2026-09-22）：回合级耗时落事件（**真实墙钟** = 流式开始 → 完成）。
    const timingData = buildAssistantTimingData(message);
    if (timingData) {
      const timingResult = await eventLog.append({
        type: 'metric/timing',
        seq: 0, // 由 append 在 mutex 内原子分配（P3-7a）
        time: Date.now(),
        sessionId,
        data: timingData,
      });
      if (!timingResult.ok && timingResult.reason !== 'duplicate-seq') {
        logger.warn('metric/timing 事件追加失败（回合级耗时）', {
          sessionId,
          messageId: message.id,
          reason: timingResult.reason,
        });
      }
    }
  }

  /**
   * 更新消息的 blocks 结构并持久化
   * 使用 storage.updateMessage 按 ID 替换，避免重复追加
   */
  async updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>,
    text?: string
  ): Promise<void> {
    const deps = this.deps;
    // T1.1（2026-08-23）：落盘前对同 toolCallId 的 tool_call 块合并去重（终态优先 + 保留首非空 arguments），
    // 与前端 SaveQueue 同策略；对历史污染数据 + SSE 重复发送产生的重复做防御兜底。
    blocks = dedupeToolCallBlocks(blocks);
    const session = deps.chatSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    let message = session.messages.find((m) => m.id === messageId);

    if (!message) {
      // P1-6（N2/B4，2026-08-23）：前端 id 未命中时**不再取"最后一条 assistant"**——
      // 前端传入的 messageId 即事件 messageId，必须按它直接创建占位（id 与事件侧一致），
      // 否则投影消息 id ≠ 事件 messageId，§5.1 按消息对位失败。
      logger.debug(
        'updateMessageBlocks: 前端 id 未命中，按 messageId 创建占位',
        {
          sessionId,
          messageId,
          blockCount: blocks.length,
        }
      );
      message = deps.createAssistantMessage('', { sessionId, id: messageId });
      if (text !== undefined) message.content = text;
      message.blocks = blocks;
      message.createdAt = new Date();
      message.updatedAt = new Date();
      session.messages.push(message);
      await persistChatMessage(deps.sessionGateway, sessionId, message);
      return;
    } else {
      logger.debug('updateMessageBlocks: 前端 id 直接命中', {
        sessionId,
        messageId,
        blockCount: blocks.length,
      });
    }

    // P0-1②（2026-10-04）：无工具回合终稿修复时，content 必须与 blocks 同步
    // （否则导出 / 下一轮上下文仍读到修复前的旧文本）
    if (text !== undefined) message.content = text;
    message.blocks = blocks;
    session.updatedAt = new Date();
    session.metadata.lastActivityAt = new Date();

    const toolCalls =
      message.tool_calls ||
      (message.metadata?.tool_calls as
        | Array<Record<string, unknown>>
        | undefined);
    const metadataObj: MessageMetadata = {
      ...(message.metadata as MessageMetadata | undefined),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    };
    // L-修复（2026-08-23）：content 为空但 blocks 含 text 时聚合 text 到 content。
    // 规则单点实现见 `pickMoreCompleteContent`（`@modules/utils/common`），读路径同源。
    const rawContent =
      typeof message.content === 'string' ? message.content : '';
    const blocksText = blocks
      .filter(
        (b) =>
          b.type === 'text' &&
          typeof b.content === 'string' &&
          (b.content as string).trim().length > 0
      )
      .map((b) => b.content as string)
      .join('')
      .trim();
    const content = pickMoreCompleteContent(rawContent, blocksText);
    // P1-6（G8/N11）：投影版本戳 lastEventSeq = 写盘时刻的会话全局事件 seq。
    let lastEventSeq: number | undefined;
    try {
      lastEventSeq = await deps.getStreamTailSeq(sessionId);
      message.lastEventSeq = lastEventSeq;
    } catch {
      // @ignore-catch — tailSeq 获取失败不阻断 blocks 落盘
    }
    const unifiedMessage: UnifiedMessage = {
      id: message.id,
      sessionId,
      type: toSessionMsgType(message),
      role: message.role as unknown as SessionMessageRole,
      content,
      timestamp: message.createdAt?.getTime() ?? Date.now(),
      metadata: metadataObj,
      blocks: message.blocks as unknown as FrontendMessageBlock[] | undefined,
      lastEventSeq,
    };
    try {
      // P0 修复（2026-08-14 排查）：必须用实际消息 id（msg-xxx）而非调用方传入的
      // 前端 UUID。原实现 storage.updateMessage 按 UUID 查找 → 找不到 idx 静默 return
      // → blocks 永不落盘。
      await deps.sessionGateway.updateMessage(
        sessionId,
        message.id,
        unifiedMessage
      );
      logger.debug('updateMessageBlocks: blocks 已提交落盘', {
        sessionId,
        messageId: message.id,
        requestedId: messageId,
        blockCount: blocks.length,
      });
    } catch (err) {
      // 更新失败不应影响主消息流
      handleError(err, {
        module: 'chat:manager',
        action: 'updateMessage_appendAssistant',
      });
    }
  }
}
