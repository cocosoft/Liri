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
import {
  handleError,
  AppError,
  ErrorCategory,
  ErrorSeverity,
} from '@modules/error';
import type { LiriEvent, LiriEventType } from '@modules/chat/types/events';
import { isLiriEvent } from '@modules/chat/types/events';

const logger = getLogger('session:event-log');

// ─── A-5 告警节流/熔断常量（2026-08-23）─────────────────────────────────────

/** 同类 append 失败告警节流窗口：1 分钟合并（方案 T-B#1，评审 v0.1#11） */
const APPEND_ALERT_COOLDOWN_MS = 60_000;
/** 连续 append 失败触发熔断的阈值（方案 T-B#1） */
const APPEND_FAIL_THRESHOLD = 5;
/** 熔断持续时长：暂停对账/重试 5 分钟，防风暴（方案 T-B#1，评审 v0.3#11） */
const APPEND_CIRCUIT_DURATION_MS = 5 * 60_000;

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
  /** A-6（2026-08-23）：lastKnown tailSeq 持久化文件（getTailSeq 失败平滑降级用） */
  private readonly tailSeqMetaPath: string;
  /** A-5（2026-08-23）：连续 append 失败计数（成功时清零） */
  private appendFailCount = 0;
  /** A-5（2026-08-23）：上次告警时间戳（节流窗口用） */
  private lastAlertAt = 0;
  /** A-5（2026-08-23）：熔断截止时间戳（0=未熔断） */
  private circuitOpenUntil = 0;

  /** 当前 tailSeq（0 表示未初始化，需读盘） */
  private tailSeq: number = 0;
  /** tailSeq 是否已初始化 */
  private tailSeqInitialized: boolean = false;
  /** 最大 turn 编号（null 表示未初始化，需读盘；重启后恢复计数用） */
  private maxTurn: number | null = null;

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
    this.tailSeqMetaPath = join(this.sessionDir, 'events.tail');
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
      // A-6（2026-08-23）：读盘失败 → 平滑降级链（持久化 lastKnown → 尾部扫描 → lastKnown+1 兜底），
      // 不抛错、不归零，避免真实 tailSeq 丢失导致后续 append 的 duplicate-seq 全拒。
      maxSeq = await this.recoverTailSeq();
    }

    this.tailSeq = maxSeq;
    this.tailSeqInitialized = true;
    return maxSeq;
  }

  /**
   * M1 事件溯源：获取当前会话已有事件中的最大 turn 编号（用于重启后恢复 turn 计数）
   *
   * 背景：turn 编号由内存计数器 _toolRoundCount 生成，后端重启后归零，
   * 导致 events.jsonl 中出现重复 turn 号（如 turn=1 出现多次），
   * 前端回放时无法区分"重复回放"与"重启后的新对话"。
   *
   * 修复：写入 turn/start 前调用本方法，从事件日志恢复该会话最大 turn，
   * 使重启后 turn 编号继续递增而非从 1 重新开始。
   *
   * 实现：流式读盘扫描 turn/start / turn/end 事件的 data.turn，取最大值。
   * 性能：仅首次调用读盘（turn/start 写入频率低，每轮一次，可接受）。
   */
  async getMaxTurn(force: boolean = false): Promise<number> {
    if (this.maxTurn !== null && !force) {
      return this.maxTurn;
    }
    if (!this.exists()) {
      this.maxTurn = 0;
      return 0;
    }
    let maxTurn = 0;
    try {
      const rl = this.createReadlineInterface();
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as LiriEvent;
          if (event.type === 'turn/start' || event.type === 'turn/end') {
            const data = event.data as { turn?: unknown } | undefined;
            const turn = data?.turn;
            if (
              typeof turn === 'number' &&
              Number.isFinite(turn) &&
              turn > maxTurn
            ) {
              maxTurn = turn;
            }
          }
        } catch {
          // 损坏行跳过（不影响其他事件）
        }
      }
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'getMaxTurn',
        context: { sessionId: this.sessionId, filePath: this.filePath },
      }).catch(() => {});
      maxTurn = 0;
    }
    this.maxTurn = maxTurn;
    return maxTurn;
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
        // A-6（2026-08-23）：持久化 lastKnown tailSeq（meta 写失败不影响本次写入）
        await this.writePersistedTailSeq(event.seq);
        // A-5（2026-08-23）：写入成功 → 连续失败计数清零（熔断自动解除）
        this.appendFailCount = 0;
        return { ok: true, tailSeq: this.tailSeq };
      } catch (e) {
        // A-5（2026-08-23）：append 失败 → 节流告警 + 熔断（结构化告警由 handleError 发布）
        this.recordAppendFailure(event, e);
        return { ok: false, reason: 'write-error', tailSeq: this.tailSeq };
      }
    });
  }

  // ─── A-5 告警节流/熔断（2026-08-23）──────────────────────────────────────

  /**
   * A-5：append 失败处理（不抛错，返回失败结果）
   *
   * 告警链路：构造 HIGH 级 AppError → handleError（内置 logger + 内存追踪 +
   * OTel Span + EventBus `error:occurred` 发布，AlertBridge 消费）。
   * 节流：1 分钟窗口合并同类告警，避免失败风暴刷爆告警端。
   * 熔断：连续失败 ≥ N 次 → 打开熔断（暂停对账/重试 N 分钟，防风暴），
   *       写入成功自动解除。
   */
  private recordAppendFailure(event: LiriEvent, error: unknown): void {
    this.appendFailCount++;
    const now = Date.now();

    // 节流：1 分钟窗口内同类告警合并（仅计数，不再触发告警链路）
    if (now - this.lastAlertAt < APPEND_ALERT_COOLDOWN_MS) {
      logger.debug('event-log: append 失败（节流窗口内合并）', {
        sessionId: this.sessionId,
        eventSeq: event.seq,
        failCount: this.appendFailCount,
      });
      return;
    }
    this.lastAlertAt = now;

    // 熔断：连续失败达到阈值 → 打开熔断并发布升级告警
    if (this.appendFailCount >= APPEND_FAIL_THRESHOLD) {
      this.circuitOpenUntil = now + APPEND_CIRCUIT_DURATION_MS;
      logger.error('event-log: 连续 append 失败，触发熔断（暂停对账/重试）', {
        sessionId: this.sessionId,
        failCount: this.appendFailCount,
        circuitOpenMs: APPEND_CIRCUIT_DURATION_MS,
      });
    }

    const appError = new AppError(
      `事件日志写入失败：${String(error)}`,
      ErrorCategory.FILESYSTEM,
      ErrorSeverity.HIGH,
      this.appendFailCount >= APPEND_FAIL_THRESHOLD
        ? 'EVENT_APPEND_CIRCUIT_OPEN'
        : 'EVENT_APPEND_FAILED',
      {
        sessionId: this.sessionId,
        eventSeq: event.seq,
        eventType: event.type,
        failCount: this.appendFailCount,
      }
    );
    void handleError(appError, {
      module: 'session:event-log',
      action: 'append',
      context: { sessionId: this.sessionId, eventSeq: event.seq },
    }).catch(() => {});
  }

  /**
   * A-5：是否处于 append 熔断期
   *
   * 上层（对账/重试）据此暂停 N 分钟，防失败风暴。
   */
  isAppendCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
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
   * D-3（2026-08-23）：物理裁剪事件日志（保留 seq >= beforeSeq 的事件）
   *
   * 用于事件修剪（T-E）：清理旧事件的同时把 tailSeq 重置为剩余最大 seq，
   * 避免 tailSeq 停在旧值导致新 append 的 duplicate-seq 误判。
   *
   * 注意：调用方（修剪消息时）须把裁剪区间 {startSeq, endSeq} 持久化到
   * `session.metadata.trajectoryTrims`，供 T-D 对账排除合法 seq 缺口（评审 v0.3#3）。
   *
   * @param beforeSeq 保留区间的起始 seq（包含）
   * @returns 新 tailSeq（失败返回当前值，不抛错）
   */
  async trimEvents(beforeSeq: number): Promise<{ newTailSeq: number }> {
    if (!this.exists()) return { newTailSeq: 0 };
    try {
      // 流式过滤保留区间（避免大文件一次性加载 + read limit 截断）
      const keptLines: string[] = [];
      let maxSeq = 0;
      const rl = this.createReadlineInterface();
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as LiriEvent;
          if (typeof event.seq === 'number' && event.seq >= beforeSeq) {
            keptLines.push(line);
            if (event.seq > maxSeq) maxSeq = event.seq;
          }
        } catch {
          // 损坏行：裁剪场景保守保留原样（避免数据丢失），不参与 maxSeq 计算
          keptLines.push(line);
        }
      }
      // 原子替换（临时文件 + rename，避免半写）
      const tmpPath = `${this.filePath}.trim`;
      await fs.writeFile(
        tmpPath,
        keptLines.join('\n') + (keptLines.length > 0 ? '\n' : ''),
        'utf-8'
      );
      await fs.rename(tmpPath, this.filePath);
      // 重置 tailSeq（内存 + 持久化同步）
      this.tailSeq = maxSeq;
      await this.writePersistedTailSeq(maxSeq);
      logger.info('event-log: 事件日志物理裁剪完成', {
        sessionId: this.sessionId,
        beforeSeq,
        newTailSeq: maxSeq,
        keptLines: keptLines.length,
      });
      return { newTailSeq: maxSeq };
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'trimEvents',
        context: { sessionId: this.sessionId, beforeSeq },
      }).catch(() => {});
      return { newTailSeq: this.tailSeq };
    }
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

  // ─── A-6 平滑降级（2026-08-23）────────────────────────────────────────────

  /**
   * A-6：读盘失败时恢复 tailSeq（平滑降级链，不抛错、不归零）
   *
   * 降级链（保证消息写入不中断，又不静默，又不归零误拒）：
   *   1. 持久化 lastKnown（events.tail meta 文件）→ 有效则恢复（重启后从持久值恢复）
   *   2. 持久值失效（首次/文件损坏）→ 扫描文件尾部恢复真实 tailSeq（兜底，优先真实数据）
   *   3. 全部失效 → 内存缓存 lastKnown + 1 继续 append + 结构化告警
   *
   * 真实 tailSeq 丢失的后果（归零误拒）：新写入的 seq 可能与文件中旧 seq
   * 冲突或乱序，破坏事件流单调性；用 lastKnown 逼近真实值可避免大部分冲突。
   */
  private async recoverTailSeq(): Promise<number> {
    // 1. 持久化 lastKnown
    const persisted = await this.readPersistedTailSeq();
    if (persisted > 0) {
      logger.warn('event-log: 读盘失败，用持久化 lastKnown 恢复 tailSeq', {
        sessionId: this.sessionId,
        lastKnown: persisted,
      });
      return persisted;
    }
    // 2. 扫描文件尾部恢复真实 tailSeq
    try {
      const tailMax = await this.scanTailForMaxSeq();
      if (tailMax > 0) {
        logger.warn('event-log: 读盘失败且无持久值，扫描文件尾部恢复 tailSeq', {
          sessionId: this.sessionId,
          tailMax,
        });
        return tailMax;
      }
    } catch {
      // 尾部扫描失败，继续降级
    }
    // 3. 最终兜底：内存缓存 lastKnown + 1（不归零、不中断消息写入）
    const fallback = Math.max(this.tailSeq, 0) + 1;
    logger.error(
      'event-log: tailSeq 完全恢复失败，使用 lastKnown+1 兜底（消息写入不中断）',
      {
        sessionId: this.sessionId,
        fallbackSeq: fallback,
      }
    );
    // A-5（2026-08-23）：结构化告警（HIGH → handleError 发布 OTel + EventBus）
    void handleError(
      new AppError(
        '事件日志 tailSeq 恢复失败，使用 lastKnown+1 兜底',
        ErrorCategory.FILESYSTEM,
        ErrorSeverity.HIGH,
        'EVENT_TAILSEQ_RECOVERY_FAILED',
        { sessionId: this.sessionId, fallbackSeq: fallback }
      ),
      {
        module: 'session:event-log',
        action: 'getTailSeq',
        context: { sessionId: this.sessionId },
      }
    ).catch(() => {});
    return fallback;
  }

  /** A-6：持久化 lastKnown tailSeq 到 events.tail（写失败仅 debug，不阻断主路径） */
  private async writePersistedTailSeq(seq: number): Promise<void> {
    try {
      await fs.writeFile(this.tailSeqMetaPath, String(seq), 'utf-8');
    } catch (e) {
      logger.debug('event-log: 持久化 tailSeq 失败（不影响本次写入）', {
        sessionId: this.sessionId,
        seq,
        error: String(e),
      });
    }
  }

  /** A-6：读取持久化 lastKnown tailSeq（不存在/无效返回 0） */
  private async readPersistedTailSeq(): Promise<number> {
    try {
      const raw = await fs.readFile(this.tailSeqMetaPath, 'utf-8');
      const seq = Number.parseInt(raw.trim(), 10);
      return Number.isFinite(seq) && seq > 0 ? seq : 0;
    } catch {
      return 0;
    }
  }

  /** A-6：扫描文件尾部恢复真实 tailSeq（读末尾 64KB，流式主扫描失败的兜底） */
  private async scanTailForMaxSeq(): Promise<number> {
    const stat = await fs.stat(this.filePath);
    if (stat.size === 0) return 0;
    const tailSize = Math.min(64 * 1024, stat.size);
    const buf = Buffer.alloc(tailSize);
    const fd = await fs.open(this.filePath, 'r');
    try {
      await fd.read(buf, 0, tailSize, stat.size - tailSize);
    } finally {
      await fd.close();
    }
    let maxSeq = 0;
    for (const line of buf.toString('utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as LiriEvent;
        if (typeof event.seq === 'number' && event.seq > maxSeq)
          maxSeq = event.seq;
      } catch {
        // 损坏行跳过
      }
    }
    return maxSeq;
  }
}
