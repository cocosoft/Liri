// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ChatEventLogStore —— 会话事件日志（`EventLogStorage`）实例的缓存与生命周期
 *
 * **来源**：首批提取自 `ChatManager.ts`（D-01/D-03 文件规模债拆分）；
 * 方案与依赖验证见 `.trae/specs/file-size-debt-partition-plan.md` §7。
 *
 * **职责（单一）**：
 *   ① per-session `EventLogStorage` 的懒创建 + LRU 缓存（上限 `EVENT_LOG_CACHE_MAX`）
 *   ② 淘汰/释放（**先** `flushTextBuffer` 落盘、**再** `releaseMemory`；Write-Ahead 语义）
 *   ③ 会话切换时释放**非当前会话**的事件快照
 *   ④ `turn/end` 单写者幂等登记（`markTurnEnded` / `hasTurnEnded`）
 *   ⑤ 懒建 + 旧数据迁移就绪（`ensureEventLogReady`）
 *
 * **日志 module 名保持 `chat:manager`**：拆分不改变日志口径（行为等价）。
 *
 * **注入依赖**（`ChatEventLogStoreDeps`）：跨簇共享状态（当前会话 ID / 代码上下文 /
 * toolCallSeqMap 及其重建集合）仍归宿主所有，经 getter / 同引用访问 ⇒ 无反向依赖、无环。
 */

import {
  EventLogStorage,
  MessageToEventMigrator,
  parseSessionSummaries,
  findSummaryByKeyword,
  type SessionSummaryRecord,
} from '@modules/session';
import type { LiriEvent } from '@modules/session/types/events';
import { resolveWorktreeHash } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('chat:manager');

/**
 * 事件日志实例缓存上限（原 `ChatManagerImpl.EVENT_LOG_CACHE_MAX`，随迁为模块常量）。
 * 超出即按 LRU 淘汰最久未用实例（摘牌同步、释放异步）。
 */
const EVENT_LOG_CACHE_MAX = 8;

/** 本模块所需的注入依赖（跨簇共享状态仍归宿主 `ChatManager` 所有，经 getter / 同引用访问） */
export interface ChatEventLogStoreDeps {
  /** 当前会话 ID（`session_lookup` 的"仅当前会话"判定） */
  getCurrentSessionId: () => string | null;
  /** 是否代码/文档上下文（取回翻页字符预算翻倍） */
  isCodeContext: () => boolean;
  /** toolCallId → 事件 seq（与宿主共享同一 Map 实例） */
  getToolCallSeqMap: () => Map<string, number>;
  /** 已重建 toolCallSeqMap 的会话集合（与宿主共享同一 Set 实例） */
  getToolCallSeqMapRebuilt: () => Set<string>;
}

/** `session_lookup` 入参（对外契约，宿主转发共用） */
export interface SessionLookupArgs {
  sessionId: string;
  fromSeq?: number;
  toSeq?: number;
  offset?: number;
  limit?: number;
}

/** `session_lookup` 出参（对外契约，宿主转发共用） */
export interface SessionLookupResult {
  ok: boolean;
  content?: string;
  nextFromSeq?: number;
  reason?: string;
}

export class ChatEventLogStore {
  /** per-session `EventLogStorage` 实例缓存（key = `${worktreeHash}:${sessionId}`） */
  private _eventLogCache: Map<string, EventLogStorage> = new Map();

  /** Fix2：`turn/end` 单写者幂等登记（sessionId → 已写 end 的 turn 集合） */
  private _endedTurnsBySession = new Map<string, Set<number>>();

  constructor(private readonly deps: ChatEventLogStoreDeps) {}

  /**
   * 取（或懒建）某会话的事件日志实例。
   *
   * P2-5：hash 单一真源，缓存 key 带 hash 前缀（防不同分区同 sessionId 串实例）。
   */
  getOrCreateEventLog(sessionId: string): EventLogStorage {
    const hash = resolveWorktreeHash();
    const key = `${hash}:${sessionId}`;
    const cached = this._eventLogCache.get(key);
    if (cached) {
      // LRU：Map 保序 ⇒ 删后再插即"移到最近使用端"
      this._eventLogCache.delete(key);
      this._eventLogCache.set(key, cached);
      return cached;
    }
    const log = new EventLogStorage(sessionId, hash);
    this._eventLogCache.set(key, log);
    this._evictOverflowEventLogs(key);
    return log;
  }

  /**
   * D2：淘汰超出上限的**最久未用**实例（`protectedKey` = 刚刚使用的那一个，永不淘汰）。
   *
   * 淘汰动作分两步且**先摘牌再异步释放**：摘牌同步完成（上限即时生效），
   * 释放（落盘缓冲正文 + 清快照）异步进行，失败只记日志——释放属"省内存"，
   * 不承担正确性（实例被摘牌后仍是被引用对象，按其自身生命周期继续工作/被 GC）。
   */
  private _evictOverflowEventLogs(protectedKey: string): void {
    while (this._eventLogCache.size > EVENT_LOG_CACHE_MAX) {
      const oldestKey = this._eventLogCache.keys().next().value as
        | string
        | undefined;
      if (oldestKey === undefined || oldestKey === protectedKey) break;
      const evicted = this._eventLogCache.get(oldestKey);
      this._eventLogCache.delete(oldestKey);
      if (evicted) {
        void this._releaseEventLogMemory(oldestKey, evicted, 'lru_evict');
      }
    }
  }

  /**
   * D2：释放某个事件日志实例的常驻内存。
   *
   * 顺序不可颠倒：**先** `flushTextBuffer()` 把缓冲正文落盘（Write-Ahead：
   * 正文缓冲不得因"省内存"而丢），**再** `releaseMemory()` 释放事件快照。
   * 两处触发点：实例 LRU 淘汰（`lru_evict`）与会话切换（`session_switch`）。
   */
  private async _releaseEventLogMemory(
    key: string,
    log: EventLogStorage,
    reason: 'lru_evict' | 'session_switch'
  ): Promise<void> {
    try {
      await log.flushTextBuffer();
      log.releaseMemory();
      logger.debug('event-log: 已释放会话事件快照', { key, reason });
    } catch (err) {
      // @ignore-catch — 释放失败只影响内存占用，不影响会话数据正确性
      logger.warn('event-log: 释放事件日志内存失败（不影响正确性）', {
        key,
        reason,
        error: String(err),
      });
    }
  }

  /**
   * D2：会话切换时释放**非当前会话**的事件快照（当前会话的快照仍按需复用）。
   *
   * 为什么放在切换点：这是"用户意图已转移"的最强信号，且是一次同步可枚举的窄路径
   * （不引入定时器/后台扫描）。代价：被释放的会话若再次访问需重建快照
   * （`read()` 的建快照分支，实测单会话毫秒~百毫秒级），属可接受换内存。
   */
  async releaseInactiveEventLogSnapshots(
    activeSessionId: string
  ): Promise<void> {
    const activeKey = `${resolveWorktreeHash()}:${activeSessionId}`;
    for (const [key, log] of this._eventLogCache) {
      if (key === activeKey) continue;
      await this._releaseEventLogMemory(key, log, 'session_switch');
    }
  }

  /**
   * Fix2（2026-09-05）：登记某会话的 `turn/end` 已写（幂等去重依据）。
   *
   * 任何写者（`streamMessageFlow` / finalize）追加成功都登记，供 finalize 去重，
   * 杜绝同一 turn 双 end。
   */
  markTurnEnded(sessionId: string, turn: number): void {
    if (turn <= 0) return;
    let set = this._endedTurnsBySession.get(sessionId);
    if (!set) {
      set = new Set<number>();
      this._endedTurnsBySession.set(sessionId, set);
    }
    set.add(turn);
  }

  /** Fix2：该会话的指定 turn 是否已写 turn/end */
  hasTurnEnded(sessionId: string, turn: number): boolean {
    return this._endedTurnsBySession.get(sessionId)?.has(turn) ?? false;
  }

  /** 首次使用前的 eventLog 就绪（懒建 + 旧数据迁移；`appendStreamEvent` 同款逻辑收敛复用） */
  async ensureEventLogReady(sessionId: string): Promise<EventLogStorage> {
    const eventLog = this.getOrCreateEventLog(sessionId);
    if (!eventLog.exists()) {
      const migrator = new MessageToEventMigrator(
        eventLog,
        sessionId,
        resolveWorktreeHash()
      );
      if (migrator.needsMigration()) {
        logger.info('chat:manager 流式前自动触发事件日志迁移', {
          sessionId,
        });
        await migrator.migrate();
      }
    }
    return eventLog;
  }

  /**
   * 优雅退出（2026-09-02）：flush 全部已创建会话的 text-batch 缓冲。
   *
   * 供进程级 SIGTERM/SIGINT 钩子调用（watch 重启/Ctrl+C）——退出前把缓冲正文
   * 落盘为 `assistant/text-batch`，避免 torn-tail / open-turn 与流式正文丢失。
   * 单个失败不抛错（CS03），返回 flush 的 chunk 总数。
   */
  async flushAllPendingEventBuffers(): Promise<number> {
    let flushed = 0;
    for (const log of this._eventLogCache.values()) {
      try {
        flushed += await log.flushTextBuffer();
      } catch {
        // @ignore-catch — 退出路径 flush 失败不阻断其余会话（CS03）
      }
    }
    return flushed;
  }

  /**
   * M1 事件溯源：流式过程中追加事件到 events.jsonl
   *
   * 实现 `ChatOrchestratorHost` 接口，供 `streamMessageFlow` 在每个 chunk yield 前调用。
   * - 失败不阻断流式（CS03）
   * - duplicate-seq 视为正常幂等，不告警
   * - 首次使用时若需迁移旧数据，触发迁移
   */
  async appendStreamEvent(
    sessionId: string,
    event: LiriEvent
  ): Promise<{ ok: boolean; reason?: string; tailSeq: number }> {
    try {
      const eventLog = this.getOrCreateEventLog(sessionId);

      // 首次使用时检测是否需要迁移旧数据
      if (!eventLog.exists()) {
        // TR-16（2026-09-22，N-52 同族）：原为字面量 `'default'` ⇒ 迁移器按
        // `<sessionsRoot>/default/<sid>/` 找投影，与真实分区（worktree hash）不符 ⇒
        // 此处的"流式前迁移检测"恒判错。改传 `resolveWorktreeHash()`（单一真源，与
        // `ChatManager._appendEventsForMessage` 内的用法一致）。
        const migrator = new MessageToEventMigrator(
          eventLog,
          sessionId,
          resolveWorktreeHash()
        );
        if (migrator.needsMigration()) {
          logger.info('chat:manager 流式前自动触发事件日志迁移', {
            sessionId,
          });
          await migrator.migrate();
        }
      }

      const result = await eventLog.append(event);
      if (
        !result.ok &&
        result.reason !== 'duplicate-seq' &&
        // TB-14/E1-a：会话已被外部进程删除 ⇒ 主动放弃落盘，非真实写失败（不告警/不触发对账）
        result.reason !== 'session-dir-missing'
      ) {
        logger.warn('chat:manager 流式事件追加失败', {
          sessionId,
          seq: event.seq,
          type: event.type,
          reason: result.reason,
        });
      }
      // P0-fix-4（2026-08-23）：流式实时写入的 assistant/tool_call 事件同样维护
      // toolCallId→seq 映射，保证后续 tool/result 事件的 callSeq 能正确回填
      // （与 `ChatManager._appendEventsForMessage` 中的回填逻辑保持一致）。
      if (result.ok && event.type === 'assistant/tool_call') {
        const data = event.data as { toolCallId: string };
        if (data.toolCallId) {
          // TR-19 修复（2026-09-22）：`append` **不写回** `event.seq`（调用方通常传 0 =
          // 交由 mutex 原子分配）⇒ 必须取返回值，消除两处口径不一致。
          this.deps.getToolCallSeqMap().set(data.toolCallId, result.tailSeq);
        }
      }
      // Fix2（2026-09-05）：turn/end 幂等中央记录——任何写者（streamMessageFlow /
      // finalize）追加成功的 turn/end 都登记，供 finalize 去重，杜绝同一 turn 双 end。
      if (result.ok && event.type === 'turn/end') {
        const turn = (event.data as { turn?: number }).turn ?? 0;
        this.markTurnEnded(sessionId, turn);
      }
      return { ok: result.ok, reason: result.reason, tailSeq: result.tailSeq };
    } catch (e) {
      await handleError(e, {
        module: 'chat:manager',
        action: 'appendStreamEvent',
        context: { sessionId, eventSeq: event.seq, eventType: event.type },
      }).catch(() => {});
      return { ok: false, reason: 'exception', tailSeq: 0 };
    }
  }

  /**
   * A-2①（2026-09-02，v4 §5.2 选项①）：缓冲一条流式正文 chunk（存储层缓冲；
   * 不落盘、不分配 seq；落盘由 `flushStreamEventBuffer` / 读路径自动 flush 驱动）。
   */
  async bufferStreamTextChunk(
    sessionId: string,
    messageId: string,
    content: string
  ): Promise<{ ok: boolean }> {
    try {
      const eventLog = await this.ensureEventLogReady(sessionId);
      const r = await eventLog.bufferTextChunk(messageId, content);
      return { ok: r.ok };
    } catch (e) {
      await handleError(e, {
        module: 'chat:manager',
        action: 'bufferStreamTextChunk',
        context: { sessionId, messageId },
      }).catch(() => {});
      return { ok: false };
    }
  }

  /**
   * A-2①：flush 会话全部缓冲正文——按 messageId 聚合为 assistant/text-batch 落盘
   * （F-2 schema），批量失败回退逐 chunk（A-1）。存储层 read/getTailSeq/append
   * 前同样自动 flush（所有权闭环）。
   */
  async flushStreamEventBuffer(
    sessionId: string
  ): Promise<{ ok: boolean; flushed: number }> {
    try {
      const eventLog = await this.ensureEventLogReady(sessionId);
      const flushed = await eventLog.flushTextBuffer();
      return { ok: true, flushed };
    } catch (e) {
      await handleError(e, {
        module: 'chat:manager',
        action: 'flushStreamEventBuffer',
        context: { sessionId },
      }).catch(() => {});
      return { ok: false, flushed: 0 };
    }
  }

  /**
   * C 阶段（2026-09-02，P1，C 详设 §4）：`session_lookup` 取回实现。
   * 按事件 seq 区间读取（复用 EventLogStorage.read + idx 二分），格式化为可读原文
   * （assistant/text-batch 经 F-2 语义展开为正文），每页 ≤ 8K 字符（≈2K tokens），
   * 截断点对齐用户轮次边界；nextFromSeq 支持续页。仅限当前会话（跨会话拒绝）。
   */
  async sessionLookup(args: SessionLookupArgs): Promise<SessionLookupResult> {
    try {
      const { sessionId, fromSeq, toSeq, offset } = args;
      if (!sessionId || sessionId !== this.deps.getCurrentSessionId()) {
        return {
          ok: false,
          reason:
            'sessionId 缺失或与当前会话不匹配（session_lookup 仅支持当前会话）',
        };
      }
      const eventLog = await this.ensureEventLogReady(sessionId);
      if (!eventLog.exists()) {
        return { ok: true, content: '（会话暂无事件记录）' };
      }
      // 代码/文档会话翻倍（D5② 取回增强，2026-09-02）：代码原文按页取回更完整，
      // 仍受 LLM 输出预算与 truncation 约束
      const PAGE_CHARS = this.deps.isCodeContext() ? 16000 : 8000; // ≈2K tokens（4 chars/token 保守口径）
      const MAX_EVENTS = 3000;
      const from = fromSeq && fromSeq > 0 ? fromSeq : 1;
      const events = await eventLog.read({
        fromSeq: from,
        toSeq: toSeq ?? Number.MAX_SAFE_INTEGER,
        limit: Math.min(args.limit ?? MAX_EVENTS, 10000),
      });
      const startIdx = offset && offset > 0 && !fromSeq ? offset : 0;
      if (startIdx >= events.length) {
        return { ok: true, content: '（无更多记录）' };
      }
      const lines: string[] = [];
      let usedChars = 0;
      let breakAt = events.length; // 首个未包含事件下标
      for (let i = startIdx; i < events.length; i++) {
        const e = events[i];
        const line = this.formatEventLine(e);
        if (!line) continue;
        // 轮次边界（user/turn 起点）处允许收尾后截断；轮中断言则不截断在中间
        const isRoundStart =
          e.type === 'user/message' || e.type === 'turn/start';
        if (usedChars + line.length > PAGE_CHARS) {
          if (isRoundStart) {
            breakAt = i;
            break;
          }
          continue; // 大事件（巨型单行）直接跳过，避免撑爆单页
        }
        lines.push(line);
        usedChars += line.length;
      }
      const content =
        lines.length > 0 ? lines.join('\n') : '（区间内无可读内容）';
      const nextFromSeq =
        breakAt < events.length ? events[breakAt].seq : undefined;
      return {
        ok: true,
        content,
        ...(nextFromSeq ? { nextFromSeq } : {}),
      };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** C 阶段：单事件 → 可读行（无用户可读语义的事件返回 null 跳过） */
  private formatEventLine(e: LiriEvent): string | null {
    const d = e.data as
      | {
          content?: unknown;
          name?: string;
          args?: unknown;
          result?: unknown;
          toolCallId?: string;
          summary?: unknown;
          keywords?: unknown;
          text?: unknown;
        }
      | undefined;
    const trunc = (s: string, n: number): string =>
      s.length > n ? `${s.slice(0, n)}…[截断 ${s.length - n} 字符]` : s;
    switch (e.type) {
      case 'user/message':
        return `用户: ${trunc(String(d?.content ?? ''), 2000)}`;
      case 'assistant/text':
      case 'assistant/text-batch':
        return `助手: ${trunc(String(d?.content ?? ''), 4000)}`;
      case 'assistant/thinking':
        return `> 思考: ${trunc(String(d?.content ?? ''), 800)}`;
      case 'assistant/tool_call':
        return `工具调用: ${d?.name ?? 'unknown'}(${trunc(
          JSON.stringify(d?.args ?? {}),
          500
        )})`;
      case 'tool/result':
        return `工具结果: ${trunc(String(d?.result ?? ''), 1500)}`;
      case 'context/summary':
        return `[历史摘要] ${trunc(
          String(d?.summary ?? d?.content ?? ''),
          1500
        )}`;
      case 'session/summary':
        // D-1（2026-09-02）：会话远期摘要事件（取回原文的检索视图）
        return `[会话摘要] ${trunc(String(d?.content ?? ''), 1500)}${
          Array.isArray(d?.keywords) && (d.keywords as string[]).length > 0
            ? `\n关键词: ${(d.keywords as string[]).join('、')}`
            : ''
        }`;
      default:
        return null; // 系统/状态/心跳类事件不进取回原文
    }
  }

  /**
   * D 阶段（2026-09-02，v4 §8）：读取会话远期摘要（检索视图，事件日志只读）。
   * 返回 seq 升序的摘要记录；无事件日志/异常返回 []（CS03）。
   */
  async getSessionSummaries(
    sessionId: string,
    limit: number = 200
  ): Promise<SessionSummaryRecord[]> {
    try {
      const eventLog = this.getOrCreateEventLog(sessionId);
      if (!eventLog.exists()) return [];
      const events = await eventLog.read({
        types: ['session/summary'],
        limit: Math.min(limit, 1000),
      });
      return parseSessionSummaries(events);
    } catch (err) {
      await handleError(err, {
        module: 'chat:manager',
        action: 'getSessionSummaries',
        context: { sessionId },
      }).catch(() => {});
      return [];
    }
  }

  /**
   * D 阶段：按关键词检索会话摘要（data.keywords 元数据命中优先，正文次之）。
   * 供后续知识库/记忆联动与 UI 会话摘要视图使用。
   */
  async searchSessionSummaries(
    sessionId: string,
    keyword: string,
    limit: number = 5
  ): Promise<SessionSummaryRecord[]> {
    const summaries = await this.getSessionSummaries(sessionId, 500);
    return findSummaryByKeyword(summaries, keyword, limit);
  }

  /**
   * M1 事件溯源：获取当前会话的 tailSeq（供 streamMessageFlow 分配新 seq）
   */
  async getStreamTailSeq(sessionId: string): Promise<number> {
    const eventLog = this.getOrCreateEventLog(sessionId);
    return eventLog.getTailSeq();
  }

  /**
   * T2.2（2026-08-23）：从 events 重建 toolCallId → 事件 seq 映射。
   *
   * 背景（A1④）：该映射原仅运行时维护（appendStreamEvent/落盘时增量 set），
   * 后端重启后为空，同轮内 tool/result 回填 callSeq 走 -1 兜底。本方法按会话**懒重建**
   * （首次需要回填且 Map 未命中时触发，每个会话只扫一次 events，结果缓存）。
   */
  async rebuildToolCallSeqMap(sessionId: string): Promise<void> {
    const rebuilt = this.deps.getToolCallSeqMapRebuilt();
    const seqMap = this.deps.getToolCallSeqMap();
    if (rebuilt.has(sessionId)) return;
    try {
      const eventLog = this.getOrCreateEventLog(sessionId);
      if (!eventLog.exists()) {
        rebuilt.add(sessionId);
        return;
      }
      let fromSeq = 1;
      for (;;) {
        const batch = await eventLog.read({ fromSeq, limit: 10000 });
        for (const e of batch) {
          if (e.type === 'assistant/tool_call') {
            const d = e.data as { toolCallId?: string };
            if (d.toolCallId) seqMap.set(d.toolCallId, e.seq);
          }
        }
        if (batch.length < 10000) break;
        fromSeq = batch[batch.length - 1].seq + 1;
      }
      logger.debug('chat:manager 重建 _toolCallSeqMap', {
        sessionId,
        entries: seqMap.size,
      });
    } catch {
      // @ignore-catch — 重建失败不影响主流程（回填走 -1 兜底）
    }
    rebuilt.add(sessionId);
  }

  /**
   * M1 事件溯源：获取当前会话已有事件的最大 turn 编号（重启后恢复 turn 计数）
   *
   * 背景：turn 编号原由内存计数器 _toolRoundCount 生成，后端重启后归零，
   * 导致同一会话的 events.jsonl 中出现重复 turn 号（如 turn=1 出现多次），
   * 前端回放时误判为"重复回放"整块丢弃，造成重新进入会话信息不全/顺序错乱。
   *
   * 修复：写入 turn/start 前调用本方法取事件日志中的最大 turn，继续递增。
   */
  async getStreamMaxTurn(sessionId: string): Promise<number> {
    const eventLog = this.getOrCreateEventLog(sessionId);
    return eventLog.getMaxTurn();
  }

  /** 会话删除时摘除其事件日志实例（原 `ChatManager.deleteSession` 内联逻辑） */
  dropSession(sessionId: string): void {
    this._eventLogCache.delete(`${resolveWorktreeHash()}:${sessionId}`);
  }
}
