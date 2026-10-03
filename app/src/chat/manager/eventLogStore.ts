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
 * 后续批次（流缓冲/刷盘、摘要/游标）迁入需要跨簇共享状态的成员时，再为本类引入注入依赖。
 */

import { EventLogStorage, MessageToEventMigrator } from '@modules/session';
import { resolveWorktreeHash } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('chat:manager');

/**
 * 事件日志实例缓存上限（原 `ChatManagerImpl.EVENT_LOG_CACHE_MAX`，随迁为模块常量）。
 * 超出即按 LRU 淘汰最久未用实例（摘牌同步、释放异步）。
 */
const EVENT_LOG_CACHE_MAX = 8;

export class ChatEventLogStore {
  /** per-session `EventLogStorage` 实例缓存（key = `${worktreeHash}:${sessionId}`） */
  private _eventLogCache: Map<string, EventLogStorage> = new Map();

  /** Fix2：`turn/end` 单写者幂等登记（sessionId → 已写 end 的 turn 集合） */
  private _endedTurnsBySession = new Map<string, Set<number>>();

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

  /** 会话删除时摘除其事件日志实例（原 `ChatManager.deleteSession` 内联逻辑） */
  dropSession(sessionId: string): void {
    this._eventLogCache.delete(`${resolveWorktreeHash()}:${sessionId}`);
  }
}
