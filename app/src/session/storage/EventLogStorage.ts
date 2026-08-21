/**
 * 事件日志存储 — append-only + seq 单调性守卫
 *
 * 设计参考：deepseek-harness packages/client/runtime/src/client/sessions/session.ts
 *           的 appendLive 单调性守卫
 * 父方案：dev_docs/20260821/M1-事件溯源迁移-详细技术方案.md §2
 *
 * 存储路径：~/.pyapp/data/sessions/<worktreeHash>/<sessionId>/events.jsonl
 * 格式：每行一个 LiriEvent 的 JSON（JSONL）
 *
 * 守卫规则：
 *   1. append(event)：若 event.seq <= tailSeq，拒绝并返回 duplicate-seq/out-of-order
 *   2. 重复 seq 写入幂等（返回 duplicate-seq，文件不变）
 *   3. 乱序 seq（小于 tailSeq）拒绝
 *
 * 性能：
 *   - tailSeq 内存缓存（懒加载），避免每次 append 读盘
 *   - 追加写入用 fs.appendFile（O(1)）
 *   - 读取用 readline 流式逐行解析（避免一次性加载大文件）
 *
 * 并发：
 *   - 同一实例内 append 串行化（mutex queue），保证 seq 单调
 *   - 跨实例的并发由调用方（ChatManager）保证单一 EventLogStorage per session
 */

import { promises as fs, existsSync, createReadStream } from 'fs';
import { join, dirname } from 'path';
import * as readline from 'readline';
import { resolveSessionsDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { handleError } from '@modules/error';
import type { LiriEvent, LiriEventType } from '@modules/chat/types/events';
import { isLiriEvent } from '@modules/chat/types/events';

const logger = getLogger('session:event-log');

// ─── 类型定义 ───────────────────────────────────────────────────────────────

/** 事件日志查询参数 */
export interface EventLogQuery {
  /** 起始 seq（包含），默认 1 */
  fromSeq?: number;
  /** 结束 seq（包含），默认 Infinity */
  toSeq?: number;
  /** 类型过滤（白名单），默认不过滤 */
  types?: LiriEventType[];
  /** 最大返回数，默认 1000，上限 10000 */
  limit?: number;
}

/** append 操作返回结果 */
export interface EventLogAppendResult {
  /** 是否成功 */
  ok: boolean;
  /** 失败原因 */
  reason?: 'duplicate-seq' | 'out-of-order' | 'write-error';
  /** 当前 tailSeq */
  tailSeq: number;
}

/** 批量 append 结果 */
export interface EventLogAppendBatchResult {
  /** 成功追加数 */
  appended: number;
  /** 拒绝数 */
  rejected: number;
  /** 当前 tailSeq */
  tailSeq: number;
  /** 第一条被拒绝的事件（若有） */
  firstRejected?: { seq: number; reason: EventLogAppendResult['reason'] };
}

// ─── EventLogStorage ────────────────────────────────────────────────────────

/**
 * 事件日志存储
 *
 * 一个实例对应一个会话的事件日志（per-session）。
 * 调用方（ChatManager）应缓存实例，避免重复初始化 tailSeq。
 */
export class EventLogStorage {
  private readonly sessionDir: string;
  private readonly filePath: string;
  private readonly backupFilePath: string;

  /** 当前 tailSeq（0 表示未初始化，需读盘） */
  private tailSeq: number = 0;
  /** tailSeq 是否已初始化 */
  private tailSeqInitialized: boolean = false;

  /**
   * 串行化 append 操作的 mutex queue
   *
   * 同一实例内并发 append 时，按调用顺序排队执行，保证 seq 单调。
   * 内部用 Promise 链实现，无需引入额外锁库。
   */
  private appendMutex: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly sessionId: string,
    private readonly worktreeHash: string = 'default'
  ) {
    this.sessionDir = this.buildSessionDir();
    this.filePath = join(this.sessionDir, 'events.jsonl');
    this.backupFilePath = join(this.sessionDir, 'events.jsonl.bak');
  }

  /**
   * 构建会话目录路径
   *
   * 路径：~/.pyapp/data/sessions/<worktreeHash>/<sessionId>
   *
   * 复用 resolveSessionsDir 的父目录（~/.pyapp/data/sessions），
   * 再拼接构造参数 worktreeHash 与 sessionId。
   *
   * 不直接调 resolveSessionsDir() 是因为它会从环境变量读 worktreeHash，
   * 而 EventLogStorage 实例化时 worktreeHash 已确定（构造参数）。
   * 通过 dirname(resolveSessionsDir(env)) 取 sessions 根，再拼 worktreeHash，
   * 避免与环境变量耦合，同时复用 data 目录解析逻辑（CS01 归一化）。
   */
  private buildSessionDir(): string {
    // resolveSessionsDir(env) 返回 ~/.pyapp/data/sessions/<env worktreeHash>
    // 传入空 env 让其走 'default' 分支，然后 dirname 取 sessions 根
    const env: NodeJS.ProcessEnv = { PYAPP_PROJECT_DIR: '' };
    const sessionsRoot = dirname(resolveSessionsDir(env));
    return join(sessionsRoot, this.worktreeHash, this.sessionId);
  }

  /** events.jsonl 的绝对路径 */
  getFilePath(): string {
    return this.filePath;
  }

  /** 备份文件路径（迁移后保留 30 天） */
  getBackupFilePath(): string {
    return this.backupFilePath;
  }

  /** 文件是否存在 */
  exists(): boolean {
    return existsSync(this.filePath);
  }

  /**
   * 获取当前 tailSeq
   *
   * - 首次调用：读盘扫描整个文件找最大 seq
   * - 后续调用：直接返回内存缓存
   *
   * 强制读盘：调用方需要校准时可传 force=true
   */
  async getTailSeq(force: boolean = false): Promise<number> {
    if (this.tailSeqInitialized && !force) {
      return this.tailSeq;
    }

    if (!this.exists()) {
      this.tailSeq = 0;
      this.tailSeqInitialized = true;
      return 0;
    }

    // 扫描文件找最大 seq
    let maxSeq = 0;
    try {
      const rl = this.createReadlineInterface();
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as LiriEvent;
          if (typeof event.seq === 'number' && event.seq > maxSeq) {
            maxSeq = event.seq;
          }
        } catch {
          // 损坏行跳过（不影响其他事件）
          logger.warn('event-log: 跳过损坏的 JSON 行', {
            sessionId: this.sessionId,
            linePreview: line.slice(0, 100),
          });
        }
      }
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'getTailSeq',
        context: { sessionId: this.sessionId, filePath: this.filePath },
      }).catch(() => {});
      // 读盘失败按 0 处理，后续 append 会校准
      maxSeq = 0;
    }

    this.tailSeq = maxSeq;
    this.tailSeqInitialized = true;
    return maxSeq;
  }

  /**
   * 追加一个事件
   *
   * 守卫：
   *   - seq <= tailSeq → 返回 duplicate-seq 或 out-of-order，文件不变
   *   - 写入失败 → 返回 write-error，不抛错
   *
   * 并发：
   *   - 通过 appendMutex 串行化，保证多调用者按到达顺序追加
   *
   * 不阻断主路径（CS03 回退策略最小化）：
   *   - 写入失败只记日志，调用方决定是否重试
   */
  async append(event: LiriEvent): Promise<EventLogAppendResult> {
    // 串行化：所有 append 调用排队执行
    return this.queueAppend(async () => {
      const tailSeq = await this.getTailSeq();

      // 守卫 1：seq 倒退或重复
      if (event.seq <= tailSeq) {
        const reason: EventLogAppendResult['reason'] =
          event.seq === tailSeq ? 'duplicate-seq' : 'out-of-order';
        logger.warn('event-log: 拒绝重复/倒退 seq', {
          sessionId: this.sessionId,
          eventSeq: event.seq,
          tailSeq,
          type: event.type,
          reason,
        });
        return { ok: false, reason, tailSeq };
      }

      // 写入
      try {
        await this.ensureSessionDir();
        const line = JSON.stringify(event) + '\n';
        await fs.appendFile(this.filePath, line, 'utf-8');
        this.tailSeq = event.seq;
        return { ok: true, tailSeq: this.tailSeq };
      } catch (e) {
        logger.error('event-log: 写入失败', {
          sessionId: this.sessionId,
          eventSeq: event.seq,
          type: event.type,
          error: String(e),
        });
        // 不抛错，返回失败结果
        await handleError(e, {
          module: 'session:event-log',
          action: 'append',
          context: {
            sessionId: this.sessionId,
            eventSeq: event.seq,
            eventType: event.type,
          },
        }).catch(() => {});
        return { ok: false, reason: 'write-error', tailSeq: this.tailSeq };
      }
    });
  }

  /**
   * 批量追加（用于迁移器一次写入多条）
   *
   * - 调用方应保证 events 已按 seq 升序排序
   * - 内部逐条校验，任一条 seq 违规则停止后续，返回已成功数
   * - 不抛错（CS03）
   */
  async appendBatch(events: LiriEvent[]): Promise<EventLogAppendBatchResult> {
    if (events.length === 0) {
      const tailSeq = await this.getTailSeq();
      return { appended: 0, rejected: 0, tailSeq };
    }

    let appended = 0;
    let rejected = 0;
    let firstRejected: EventLogAppendBatchResult['firstRejected'];

    for (const event of events) {
      const result = await this.append(event);
      if (result.ok) {
        appended++;
      } else {
        if (rejected === 0) {
          firstRejected = { seq: event.seq, reason: result.reason };
        }
        rejected++;
        // 批量写入遇违规立即停止，避免后续事件 seq 全部失败
        break;
      }
    }

    return {
      appended,
      rejected,
      tailSeq: this.tailSeq,
      firstRejected,
    };
  }

  /**
   * 读取事件流
   *
   * - 支持 fromSeq/toSeq/类型过滤/limit
   * - 用 readline 流式读取，避免大文件内存爆炸
   * - 返回有序数组（按 seq 升序）
   *
   * 不抛错：读盘失败返回空数组（CS03）
   */
  async read(query?: EventLogQuery): Promise<LiriEvent[]> {
    if (!this.exists()) {
      return [];
    }

    const fromSeq = query?.fromSeq ?? 1;
    const toSeq = query?.toSeq ?? Number.MAX_SAFE_INTEGER;
    const types = query?.types;
    const limit = Math.min(query?.limit ?? 1000, 10000);

    const results: LiriEvent[] = [];

    try {
      const rl = this.createReadlineInterface();
      for await (const line of rl) {
        if (!line.trim()) continue;
        if (results.length >= limit) break;

        try {
          const event = JSON.parse(line) as unknown;
          if (!isLiriEvent(event)) {
            logger.warn('event-log: read 跳过非事件行', {
              sessionId: this.sessionId,
              linePreview: line.slice(0, 100),
            });
            continue;
          }

          // 过滤
          if (event.seq < fromSeq || event.seq > toSeq) continue;
          if (types && !types.includes(event.type)) continue;

          results.push(event);
        } catch {
          logger.warn('event-log: read 跳过损坏行', {
            sessionId: this.sessionId,
            linePreview: line.slice(0, 100),
          });
        }
      }
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'read',
        context: { sessionId: this.sessionId, filePath: this.filePath },
      }).catch(() => {});
      return [];
    }

    // 按 seq 升序排序（文件应已有序，但防御性排序）
    results.sort((a, b) => a.seq - b.seq);
    return results;
  }

  /**
   * 读取单个 seq 的事件（用于工具结果配对）
   *
   * @returns 事件不存在或文件损坏时返回 null
   */
  async readBySeq(seq: number): Promise<LiriEvent | null> {
    if (!this.exists()) return null;

    try {
      const rl = this.createReadlineInterface();
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as unknown;
          if (isLiriEvent(event) && event.seq === seq) {
            return event;
          }
        } catch {
          // 损坏行跳过
        }
      }
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'readBySeq',
        context: { sessionId: this.sessionId, seq },
      }).catch(() => {});
    }

    return null;
  }

  /**
   * 备份现有 events.jsonl 为 events.jsonl.bak
   *
   * 用于迁移后保留原始数据，30 天内可恢复。
   */
  async backup(): Promise<void> {
    if (!this.exists()) {
      return;
    }
    try {
      await fs.copyFile(this.filePath, this.backupFilePath);
      logger.info('event-log: 已备份原文件', {
        sessionId: this.sessionId,
        backupPath: this.backupFilePath,
      });
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'backup',
        context: {
          sessionId: this.sessionId,
          filePath: this.filePath,
          backupPath: this.backupFilePath,
        },
      }).catch(() => {});
      // 备份失败不阻断主流程
    }
  }

  // ─── 内部方法 ───────────────────────────────────────────────────────────

  /**
   * 串行化 append 操作
   *
   * 用 Promise 链实现 mutex：每个 append 调用挂到链尾，
   * 等前一个完成后再执行。保证 seq 单调与文件 IO 顺序。
   */
  private queueAppend<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.appendMutex.then(fn, fn);
    // 把 next 链到 appendMutex 上，但忽略其 reject（错误已在 fn 内处理）
    this.appendMutex = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * 确保 sessionDir 存在
   *
   * recursive: true 模式下目录已存在不报错
   */
  private async ensureSessionDir(): Promise<void> {
    await fs.mkdir(this.sessionDir, { recursive: true });
  }

  /**
   * 创建 readline 接口
   *
   * 封装为内部方法便于测试 mock
   */
  private createReadlineInterface(): readline.Interface {
    const stream = createReadStream(this.filePath, { encoding: 'utf-8' });
    return readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });
  }
}
