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
 * FTS5 分片索引（`SessionGateway` 的 FTS 簇）
 *
 * 由 `session/SessionGateway.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §34）。收拢：
 * ① 索引存储层与引擎访问 ② 启动重建 + roundCount 迁移 ③ 事件总线索引维护监听
 * ④ 定期落盘 / 损坏片重建 ⑤ 检索。
 *
 * ⚠️ **只搬不改**：逻辑逐字保留；logger module 名保持 `session:gateway`
 * （与宿主一致）⇒ 日志输出不变。
 */

import { join } from 'path';
import { resolveDataDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import {
  getFTS5SearchEngine,
  type FTS5SearchEngine,
  type FTSDocument,
  type FTSSearchResult,
} from '../FTS5SearchEngine.js';
import { FTSIndexStore } from '../persistence/FTSIndexStore.js';
import type {
  SessionLifecycleEventBus,
  SessionLifecycleEvent,
} from '../lifecycle/index.js';
import type {
  UnifiedSession,
  SessionMetadata,
} from '../types/UnifiedSession.js';
import type { UnifiedMessage } from '../types/UnifiedMessage.js';

const logger = getLogger('session:gateway');

/**
 * 扫描/重建所需的**最小存储端口** —— `UnifiedSessionStorage` 的结构子集
 * （本簇只读会话列表与消息、并在 roundCount 迁移时回写会话）。
 */
export interface FtsIndexStoragePort {
  listSessions(): Promise<UnifiedSession[]>;
  getMessages(sessionId: string): Promise<UnifiedMessage[]>;
  updateSession(session: UnifiedSession): Promise<void>;
}

export interface FtsIndexDeps {
  storage: FtsIndexStoragePort;
}

/**
 * FTS5 分片索引门面
 *
 * 生命周期：`rebuildIndex()`（启动重建）→ `startPersistence()`（定期落盘）
 * → `flush('close')` + `stopPersistence()`（关闭）。
 */
export class SessionGatewayFtsIndex {
  private static readonly SAVE_INTERVAL_MS = 60_000;

  /**
   * 重建时的分批落盘批大小（§8-6 内存峰值控制）。
   *
   * 为什么必须分批：`rebuildSession` 会把新建片放入 store 缓存，若全部会话建完再一次性
   * flush，则**整个索引同时驻留内存**（实测 156 片 / 358MB ⇒ RSS 峰值 3.2GB）。每批落盘后
   * store 会把已转干净的片压回缓存上限（64 片 / 64 MiB），峰值即与批大小同阶。
   */
  private static readonly REBUILD_FLUSH_BATCH = 16;

  private readonly storage: FtsIndexStoragePort;
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  /** FTS 索引存储层（分片重构 §11.3：索引目录归属 store，引擎不再持有路径） */
  private store: FTSIndexStore | null = null;

  constructor(deps: FtsIndexDeps) {
    this.storage = deps.storage;
  }

  /**
   * 注册事件总线上的 FTS 索引维护监听（`initialize()` 期）。
   *
   * 三个监听语义（§8-4：index/remove 均异步 ⇒ 不阻塞事件总线，失败仅记日志）：
   * ① `message:created` → 写入倒排（temporary 消息不写）
   * ② `session:deleted` → 按删除前取到的 messageIds 清理
   * ③ `messages:deleted` → 单条/批量消息删除清理
   */
  wireLifecycleListeners(bus: SessionLifecycleEventBus): void {
    bus.on('message:created', (event: SessionLifecycleEvent) => {
      const { messageId, type, role, content, sessionKey, temporary } =
        event.metadata ?? {};
      // A1 临时对话：temporary 消息不写 FTS 倒排索引
      if (!temporary && messageId && typeof content === 'string') {
        // §8-4：index 为异步（分片存储需读盘）⇒ 不阻塞事件总线，失败仅记日志
        void this.engine()
          .index({
            id: `msg_${messageId}`,
            title: '',
            category: 'message',
            content: content,
            timestamp: event.timestamp,
            metadata: {
              messageId,
              sessionId: event.sessionId,
              sessionKey,
              type,
              role,
            },
          })
          .catch((err: unknown) => {
            logger.warn('FTS 索引写入失败', {
              sessionId: event.sessionId,
              messageId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }
    });

    bus.on('session:deleted', (event: SessionLifecycleEvent) => {
      // BUG-3 修复：消费 deleteSession 携带的 messageIds（删除前已取），
      // 不再删除后重新 getMessages（会得空数组导致 FTS 索引残留）。
      const messageIds: string[] =
        (event.metadata?.messageIds as string[]) ?? [];
      // §8-4：remove 需按会话定位片（异步）⇒ 不阻塞事件总线
      for (const msgId of messageIds) {
        void this.engine()
          .remove(event.sessionId, `msg_${msgId}`)
          .catch((err: unknown) => {
            logger.warn('FTS 索引删除失败', {
              sessionId: event.sessionId,
              messageId: msgId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }
    });

    // 单条/批量消息删除时的 FTS5 索引清理
    bus.on('messages:deleted', (event: SessionLifecycleEvent) => {
      const messageIds: string[] =
        (event.metadata?.messageIds as string[]) ?? [];
      // §8-4：remove 需按会话定位片（异步）⇒ 不阻塞事件总线
      for (const msgId of messageIds) {
        void this.engine()
          .remove(event.sessionId, `msg_${msgId}`)
          .catch((err: unknown) => {
            logger.warn('FTS 索引删除失败', {
              sessionId: event.sessionId,
              messageId: msgId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }
    });
  }

  /**
   * 启动时建立 FTS5 分片索引（§8-4 / §8-6）：
   * ① 清理崩溃残留临时文件；② 以**清单为目录**，仅对"清单无记录的会话"从存储整片重建；
   * ③ 落盘本次重建的片。清单齐备时零重建（对比整索引时代：每次启动读 403MB + `JSON.parse`）。
   */
  async rebuildIndex(): Promise<number> {
    const store = this.getStore();
    const engine = this.engine();

    await store.scanTmpResidue();
    const manifest = await store.readManifest();
    const sessions = await this.storage.listSessions();

    let indexedCount = 0;
    let pendingFlush = 0;
    for (const session of sessions) {
      // 已有片 ⇒ 跳过（不加载、不逐片校验：启动读盘量不随片数增长）
      if (manifest.shards[session.id]) continue;
      const messages = await this.storage.getMessages(session.id);
      if (messages.length === 0) continue;
      await engine.rebuildSession(
        session.id,
        messages.map((msg) => this.toDocument(session.id, msg))
      );
      indexedCount += messages.length;
      pendingFlush++;
      // 分批落盘：每批 flush 后干净片被压回缓存上限，避免"整索引同时驻留"（见常量注释）
      if (pendingFlush >= SessionGatewayFtsIndex.REBUILD_FLUSH_BATCH) {
        await engine.flush();
        pendingFlush = 0;
      }
    }

    if (indexedCount > 0) {
      logger.info('FTS5 分片索引已从存储重建', {
        indexedCount,
        sessions: sessions.length,
      });
    }
    await engine.flush();

    // P2-7（2026-09-25）：返回**本次重建写入的文档数**（供恢复编排层汇总；
    // 清单齐备时返回 0 —— 口径是"重建了多少"，不是"总共有多少"）
    return indexedCount;
  }

  /**
   * 迁移：为已有 session 计算 roundCount（幂等）
   * 仅当 metadata.roundCount 不存在时计算
   */
  async migrateRoundCount(): Promise<{
    migrated: number;
    error?: string;
  }> {
    try {
      const sessions = await this.storage.listSessions();
      let migratedCount = 0;

      for (const s of sessions) {
        const metadata = s.metadata as Record<string, unknown> | undefined;
        if (metadata && metadata.roundCount == null) {
          const messages = await this.storage.getMessages(s.id);
          const userMsgCount = messages.filter((m) => m.role === 'user').length;
          // L6：浅拷贝 metadata 再写 roundCount——原实现直接改共享引用，
          // 污染 listSessions 返回对象的 metadata，导致内存缓存会话被意外改写
          s.metadata = {
            ...s.metadata,
            roundCount: userMsgCount,
          } as SessionMetadata;
          // #15 修复：改用接口的 updateSession（原 (this.storage as any).saveSession?.()
          // 对 UnifiedSessionStorage 为 undefined，可选调用静默 no-op，迁移从未落盘）
          await this.storage.updateSession(s);
          migratedCount++;
        }
      }

      if (migratedCount > 0) {
        logger.info('roundCount 迁移完成', { migratedCount });
      }
      // P2-7（2026-09-25）：返回迁移计数 + 失败原因（供恢复编排层汇总；
      // 既有调用方 `initialize()` 忽略返回值 ⇒ 行为不变）
      return { migrated: migratedCount };
    } catch (err) {
      logger.warn('roundCount 迁移失败（非致命）', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        migrated: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 启动 FTS5 索引定期磁盘持久化
   */
  startPersistence(): void {
    // P2-4（2026-09-26）：重入守卫 —— 并发的懒 `initialize()` 会重复调用本方法，而
    // `saveInterval` 只保存**最后一个**句柄 ⇒ 前一个定时器永不被 clear（定时器泄漏）。
    if (this.saveInterval) return;

    this.saveInterval = setInterval(() => {
      // §8-4：仅落盘**脏片**（无脏片 ⇒ 不建目录、不写盘、不重写清单）；定时器回调不 await。
      void this.flush('interval');
    }, SessionGatewayFtsIndex.SAVE_INTERVAL_MS);
    // P1-14 修复：unref 避免进程被 FTS 定时器钉住（stopPersistence() 仍会 clear）
    this.saveInterval.unref();
  }

  /** 停止定期持久化（幂等；`close()` 期调用） */
  stopPersistence(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
  }

  /**
   * FTS 落盘（§8-4 驱动 + §8-6 损坏片重建）：先按会话重建损坏片，再落盘全部脏片。
   * 失败按 KB-FTS-SAVE-LOG 记录（静默丢索引不可接受）。
   */
  async flush(trigger: 'interval' | 'close'): Promise<void> {
    try {
      await this.repairCorruptShards();
      // 落盘字节数作为可核对证据（分片后单会话变更只写该片；整索引时代每次 60s 全量 403MB）
      const bytes = await this.engine().flush();
      if (bytes > 0) {
        logger.info('FTS 分片落盘', { trigger, bytes });
      }
    } catch (err) {
      logger.warn('FTS 索引落盘失败', {
        trigger,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 将消息索引到 FTS5 全文搜索引擎（分片：按 `sessionId` 归属片）
   */
  async indexMessage(
    sessionId: string,
    message: UnifiedMessage
  ): Promise<void> {
    try {
      await this.engine().index(this.toDocument(sessionId, message));
    } catch (err) {
      // KB-FTS-INDEX-LOG（2026-08-29）：单条消息索引失败静默 → 搜索漏索引无日志
      logger.warn('FTS 索引写入失败', {
        sessionId,
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 全文搜索消息（基于 FTS5SearchEngine）
   *
   * 分片重构 §11.3：改为**异步** —— 作用域已知 ⇒ 只读这些片（1 片或 N 片）；
   * 都不传 ⇒ 全局扇出（并发上限 + 总超时；超时返回已收集的部分结果并告警）。
   */
  async search(
    query: string,
    sessionId?: string,
    limit?: number,
    allowedSessionIds?: Set<string>
  ): Promise<FTSSearchResult[]> {
    // 片选择（作用域）与谓词（N-66 下推）各司其职：前者决定读哪些片，后者保证
    // 「命中先于 limit 截断」的语义与整索引时代一致
    const sessionIds = allowedSessionIds ?? (sessionId ? [sessionId] : null);
    const metadataFilter = allowedSessionIds
      ? (doc: { metadata?: Record<string, unknown> }) =>
          allowedSessionIds.has(String(doc.metadata?.sessionId ?? ''))
      : sessionId
        ? (doc: { metadata?: Record<string, unknown> }) =>
            doc.metadata?.sessionId === sessionId
        : undefined;
    return this.engine().search(query, {
      category: 'message',
      limit,
      sessionIds,
      metadataFilter,
    });
  }

  /**
   * §8-6 片级重建：消费 store 的"损坏待重建"登记，从会话消息**整片**重建。
   *
   * 只在落盘驱动 tick 中执行 —— **不在检索路径内重建**，避免搜索被全量重建阻塞
   * （损坏期间该片检索结果为缺失，属已知降级）。
   */
  private async repairCorruptShards(): Promise<void> {
    const corrupt = this.getStore().takeCorruptShardIds();
    if (corrupt.length === 0) return;

    let repaired = 0;
    for (const sessionId of corrupt) {
      try {
        const messages = await this.storage.getMessages(sessionId);
        await this.engine().rebuildSession(
          sessionId,
          messages.map((msg) => this.toDocument(sessionId, msg))
        );
        repaired++;
      } catch (err) {
        logger.warn('FTS 损坏片重建失败（下轮再试）', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info('FTS 损坏片已重建', { repaired, total: corrupt.length });
  }

  /**
   * 获取 FTS5 索引持久化目录
   *
   * 分片重构 §8-1：路径接口由「单文件路径」改为「目录」
   * （spec `fts-index-per-session-sharding.md`）。现状（过渡）目录内只有整索引
   * `fts-index.json`；分片落地后为 `manifest.json` + `shards/`。
   */
  private getIndexDir(): string {
    return join(resolveDataDir(), 'fts-index');
  }

  /** FTS 索引存储层（进程内单例；索引目录在此注入） */
  private getStore(): FTSIndexStore {
    this.store ??= new FTSIndexStore(this.getIndexDir());
    return this.store;
  }

  /** FTS 引擎（首次调用注入 store；引擎不持有索引数据，见 FTS5SearchEngine 类注释） */
  private engine(): FTS5SearchEngine {
    return getFTS5SearchEngine(this.getStore());
  }

  /** 消息 → FTS 文档（增量索引与片级重建共用同一映射，避免两处字段漂移） */
  private toDocument(sessionId: string, message: UnifiedMessage): FTSDocument {
    const content =
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content);
    return {
      id: `msg_${message.id}`,
      title: `会话 ${sessionId} 的消息`,
      content,
      category: 'message',
      timestamp: message.timestamp ?? Date.now(),
      metadata: {
        sessionId,
        messageId: message.id,
        type: message.type,
        role: message.role,
      },
    };
  }
}
