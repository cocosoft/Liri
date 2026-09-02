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
import { sanitizeEvent } from './eventSanitize';
import {
  assertEventReadable,
  assertEventWritable,
} from '@modules/chat/types/knownEventTypes';
// 内存画像（2026-09-02 排查"会话中断/内存尖峰"用，MEM_PROFILE=1 才采样）
import { memProfile } from '../../monitoring/memProfile.js';

const logger = getLogger('session:event-log');

// ─── A-5 告警节流/熔断常量（2026-08-23）─────────────────────────────────────

/** 同类 append 失败告警节流窗口：1 分钟合并（方案 T-B#1，评审 v0.1#11） */
const APPEND_ALERT_COOLDOWN_MS = 60_000;
/** 连续 append 失败触发熔断的阈值（方案 T-B#1） */
const APPEND_FAIL_THRESHOLD = 5;
/** 熔断持续时长：暂停对账/重试 5 分钟，防风暴（方案 T-B#1，评审 v0.3#11） */
const APPEND_CIRCUIT_DURATION_MS = 5 * 60_000;

/**
 * P1-2（2026-08-30）：事件快照缓存默认上限。
 *
 * 超过则禁用快照（回落流式分页读取，保持既有 regex-skip 优化），
 * 防超长会话（40 万行量级）全量驻内存放大。事件不可变 + append-only
 * 使缓存可安全共享；上限仅约束"是否建快照"，不影响读取正确性。
 * 构造参数可覆盖（测试注入小上限，避免写 15 万行文件）。
 */
const SNAPSHOT_MAX_EVENTS = 150_000;
/**
 * B-2（2026-09-02，v4 §6.2 B-2 / D2 ①）：热层事件窗口动态收缩目标。
 *
 * 150K 固定上限在真实场景（12.4 万 tokens、单事件可达 MB 级）下形同虚设：
 * 字节上限（200MB）先到，窗口内仍可容纳海量小事件推高 RSS。热窗口按
 * "≤ SNAPSHOT_HOT_EVENTS" 收敛（与配置上限取 min），冷历史走 events.idx
 * 读盘（D7 已就绪），小会话（≤10K 事件）不受影响（全量覆盖）。
 */
const SNAPSHOT_HOT_EVENTS = 10_000;
/** P1-7（2026-08-30）：快照累计字节上限（buildSnapshot 扫描累计 line.length；append 增量按 JSON.stringify 长度近似） */
const SNAPSHOT_MAX_BYTES = 200 * 1024 * 1024;
/** P0-3/P1-5（2026-08-30）：stale/IO 失败后的重建冷却期，防跨实例持续写期间反复全量扫描 */
const SNAPSHOT_COOLDOWN_MS = 5_000;
/**
 * A-2（2026-09-02，v4 §5.2 选项①）：text 聚合缓冲安全阈值——调用方（流式路径）
 * 负责 64KB/2s 策略；本层仅在调用方异常路径下无限缓冲时兜底自动 flush。
 */
const TEXT_BUFFER_SAFETY_BYTES = 512 * 1024;

// ─── P3-8 事件字节索引（2026-09-02，v4 方案 B-1/D7 索引独立先行）───────
// 目标：read(fromSeq>1) 分页续读从"readline 从头逐行扫描（O(N)）"降为
// "idx 二分定位 → createReadStream(start=byteOffset) 段内读取"。
// 索引为派生物（可重建/可丢失降级），非第二真相源——见 §13 降级链。
/** 索引区间折叠粒度：每 256 个事件一个区间条目（区间内 ≤256 行流式扫，代价可控） */
const IDX_BATCH_SIZE = 256;
/** UTF-8 字节偏移累计基数（写事件前的文件起始偏移，append-only 下恒定） */
const IDX_INIT_OFFSET = 0;

/** 事件字节索引区间条目（持久化为 .idx 文件行） */
export interface EventIdxEntry {
  /** 区间起始 seq（包含） */
  fromSeq: number;
  /** 区间结束 seq（包含） */
  toSeq: number;
  /** 区间首行在 events.jsonl 中的 UTF-8 字节偏移（G-4：seek 偏移不允许近似） */
  byteOffset: number;
  /** 区间内事件数 */
  count: number;
}

// ─── 类型定义 ───────────────────────────────────────────────────────────────

/** 事件日志查询参数 */
export interface EventLogQuery {
  /** 起始 seq（包含），默认 1 */
  fromSeq?: number;
  /** 结束 seq（包含），默认 Infinity */
  toSeq?: number;
  /** 类型过滤（白名单），默认不过滤 */
  types?: LiriEventType[];
  /** 类型排除（黑名单，行级快速跳过，不 parse——用于载入跳过 thinking 等高频细节事件） */
  excludeTypes?: LiriEventType[];
  /** 最大返回数，默认 1000，上限 10000 */
  limit?: number;
}

/** append 操作返回结果 */
export interface EventLogAppendResult {
  /** 是否成功 */
  ok: boolean;
  /** 失败原因 */
  reason?: 'duplicate-seq' | 'out-of-order' | 'write-error' | 'invalid-event';
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

// ─── 损坏行拆分恢复（2026-08-24 根因修复）───────────────────────────────────

/**
 * 从可能损坏的 JSONL 行中提取完整的 JSON 对象数组
 *
 * 背景（2026-08-24 根因修复）：跨实例并发 append（多进程/多实例各自持有
 * per-session EventLogStorage，mutex 互不共享）可能把多个事件拼接/截断进同一
 * 物理行，如 {"type":"assistant/text",...,"content":"x{"type":"user/message",...}}
 * ——整行 JSON.parse 失败导致事件丢失、tailSeq 少算、投影兜底消息乱序置顶。
 *
 * 策略：
 *   - 快路径：整行即完整 JSON，直接返回（正常行零开销）
 *   - 慢路径：跳过行首无法解析的截断前缀，从每个 '{' 起点贪心匹配第一个
 *     闭合 '}' 并尝试解析；成功后提取并继续解析剩余部分（多段恢复）。
 *     行内字符串中的 '}' 不会误判边界（未闭合字符串 JSON.parse 天然失败）。
 *
 * 防护：超大损坏行（> 64KB）与候选起点过多（> 64）时放弃恢复，防 O(n²)
 * 解析拖垮读取路径（损坏行为罕见路径，正常行不受影响）。
 */
export function splitJsonLine(line: string): unknown[] {
  const rest = line.trim();
  if (!rest) return [];
  // 快路径：整行即为完整 JSON
  try {
    return [JSON.parse(rest)];
  } catch {
    // 进入慢路径
  }
  const MAX_REPAIR_LINE_LEN = 64 * 1024;
  if (rest.length > MAX_REPAIR_LINE_LEN) return [];
  const results: unknown[] = [];
  let cursor = 0;
  let guard = 0;
  const MAX_CANDIDATES = 64;
  while (cursor < rest.length && guard++ < MAX_CANDIDATES) {
    let recovered: unknown | undefined;
    let consumedTo = -1;
    for (let start = cursor; start < rest.length; start++) {
      if (rest[start] !== '{') continue;
      for (let end = start + 1; end < rest.length; end++) {
        if (rest[end] !== '}') continue;
        const candidate = rest.slice(start, end + 1);
        try {
          recovered = JSON.parse(candidate);
          consumedTo = end;
          break;
        } catch {
          // 边界未到（含嵌套 '}' 或字符串内 '}'），继续找下一个 '}'
        }
      }
      if (recovered !== undefined) break;
    }
    if (recovered === undefined || consumedTo < 0) break;
    results.push(recovered);
    cursor = consumedTo + 1;
  }
  return results;
}

/**
 * P1-2（2026-08-30）：从事件快照内存过滤（对齐 read() 的过滤语义）
 *
 * 快照内事件已深冻结（D1），直接共享引用；返回新数组（浅拷贝事件引用），
 * 调用方对其排序/修改不影响缓存。顺序保持快照 seq 升序。
 */
export function filterSnapshotEvents(
  snapshot: LiriEvent[],
  q: {
    fromSeq: number;
    toSeq: number;
    types?: LiriEventType[];
    excludeTypes?: LiriEventType[];
    limit: number;
  }
): LiriEvent[] {
  const results: LiriEvent[] = [];
  for (const ev of snapshot) {
    if (results.length >= q.limit) break;
    if (ev.seq < q.fromSeq || ev.seq > q.toSeq) continue;
    if (q.types && !q.types.includes(ev.type)) continue;
    if (q.excludeTypes && q.excludeTypes.includes(ev.type)) continue;
    results.push(ev);
  }
  return results;
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
  /** P3-8：事件字节索引文件路径（events.jsonl 派生物） */
  private readonly idxFilePath: string;
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
   * P1-2（2026-08-30）：全量事件快照缓存（对齐 deepseek-harness eventsSnapshot）。
   *
   * 事件不可变（D1 深冻结）+ append-only 使缓存可安全共享：命中时免重复
   * 磁盘扫描 + 行级 JSON 解析（长会话分页读取的核心开销）。有序数组的
   * **尾元素 seq 即快照覆盖范围**（snapshotTail，新鲜度判定基准之一）。
   * 超限（条数/字节）置 snapshotIneligible 防内存放大。
   */
  private eventsSnapshot: LiriEvent[] | null = null;
  /** P1-2：快照不可建标记（超上限后置位——事件只会更多，永久禁用；trimEvents 后重置） */
  private snapshotIneligible = false;
  /** P1-2：快照累计字节（buildSnapshot 按 line.length 累计；append 增量按 JSON.stringify 近似） */
  private snapshotBytes = 0;
  /** P0-3（2026-08-30）：stale/IO 失败后的重建冷却截止时间戳（0=不在冷却） */
  private snapshotCooldownUntil = 0;
  /**
   * B0（2026-09-02，v4 方案 §6.2）：滑动窗口快照。
   *
   * 超限时保留最近事件、丢弃更早（滑动窗口），而非整体清空 + 永久 ineligible
   * （消除"超限 → 全量重建尖峰"）。snapshotMinSeq = 窗口首事件 seq
   * （0 = 快照覆盖全量，未丢头）。读取侧查询 fromSeq < snapshotMinSeq 时窗口
   * 无法覆盖 → 回退磁盘路径（events.jsonl 本身全量保留，语义不变，T4 不破坏）。
   */
  private snapshotMinSeq = 0;
  /**
   * B0：快照内每事件的行字节成本（UTF-16 line.length，与 snapshotBytes 同单位）。
   * 与 eventsSnapshot 严格并行（同 push/同裁剪），供窗口裁剪 O(窗口) 一次完成，
   * 免每次裁剪对整批事件 JSON.stringify 重算成本。
   */
  private snapshotCosts: number[] = [];

  // ─── A-2①（2026-09-02，v4 §5.2 选项①）：text 聚合缓冲（下沉存储层） ───
  /** messageId → 已缓冲 text chunk（未落盘；flush 时聚合为一条 assistant/text-batch） */
  private textChunkBuffer: Map<string, { chunks: string[]; bytes: number }> =
    new Map();
  /** 缓冲总字节（UTF-16 近似，安全阈值判定用） */
  private textChunkBufferBytes = 0;

  // ─── P3-8 事件字节索引（2026-09-02）──────────────────────────────────
  /** 索引区间内存视图（按 fromSeq 升序；与磁盘 .idx 同源） */
  private idxEntries: EventIdxEntry[] = [];
  /** 索引是否已从磁盘加载（惰性，首次 read/append 前） */
  private idxLoaded = false;
  /** 索引累积已解析到的文件末尾 seq（.idx 与 events.jsonl 的同步锚点） */
  private idxTailSeq = 0;
  /** append-only 写路径的 UTF-8 字节累计（= 下一条事件行的起始偏移，G-4 精确 seek 依据） */
  private idxBytesTotal = IDX_INIT_OFFSET;
  /** 当前待折叠批的起始 seq（0=无在途批） */
  private idxBatchStartSeq = 0;
  /** 当前待折叠批的起始字节偏移 */
  private idxBatchStartOffset = IDX_INIT_OFFSET;
  /** 当前待折叠批内已累计事件数 */
  private idxBatchCount = 0;
  /** 快照条数上限（构造可注入，测试用小值避免写大文件） */
  private readonly maxSnapshotEvents: number;
  /** 快照字节上限（构造可注入） */
  private readonly maxSnapshotBytes: number;
  /**
   * P2-E（2026-08-30）：buildSnapshot"扫描后-提交前"挂起点。
   * 生产为空；测试注入用于构造"扫描期间 append"并发竞态。
   */
  private readonly snapshotPreCommitHook?: () => Promise<void>;

  /**
   * D4-4（2026-08-24）：崩溃修复已检查标记——首次 read 时自动执行 torn-tail 截断
   * + 合成 closers；内存标记防重复扫描（每次进程生命周期仅一次）。
   */
  private _repairChecked = false;

  /**
   * 串行化 append 操作的 mutex queue
   *
   * 同一实例内并发 append 时，按调用顺序排队执行，保证 seq 单调。
   * 内部用 Promise 链实现，无需引入额外锁库。
   */
  private appendMutex: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly sessionId: string,
    private readonly worktreeHash: string = 'default',
    /**
     * D3（2026-08-24）：sessions 根目录覆盖（对齐 FileSystemUnifiedStorage.basePath 语义）
     *
     * 默认走 buildSessionDir（固定 ~/.pyapp/data/sessions）。传入时路径 =
     * join(sessionsRoot, worktreeHash, sessionId)，用于与存储层 basePath 统一
     * （fork 场景：源/子会话事件与 session.json 同目录）及测试隔离。
     */
    private readonly sessionsRoot?: string,
    /**
     * P1-6（2026-08-30）：快照条数上限可注入（测试用小值，避免写 15 万行文件）；
     * 默认 SNAPSHOT_MAX_EVENTS。
     */
    maxSnapshotEvents: number = SNAPSHOT_MAX_EVENTS,
    /**
     * P1-7（2026-08-30）：快照字节上限可注入；默认 SNAPSHOT_MAX_BYTES。
     */
    maxSnapshotBytes: number = SNAPSHOT_MAX_BYTES,
    /**
     * P2-E（2026-08-30）：buildSnapshot"扫描后-提交前"挂起点（测试构造并发竞态用）。
     */
    snapshotPreCommitHook?: () => Promise<void>
  ) {
    this.maxSnapshotEvents = maxSnapshotEvents;
    this.maxSnapshotBytes = maxSnapshotBytes;
    this.snapshotPreCommitHook = snapshotPreCommitHook;
    this.sessionDir = sessionsRoot
      ? join(sessionsRoot, worktreeHash, sessionId)
      : this.buildSessionDir();
    this.filePath = join(this.sessionDir, 'events.jsonl');
    this.backupFilePath = join(this.sessionDir, 'events.jsonl.bak');
    this.tailSeqMetaPath = join(this.sessionDir, 'events.tail');
    /** P3-8：事件字节索引文件（派生物，可重建/丢失降级） */
    this.idxFilePath = join(this.sessionDir, 'events.idx');
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
    // A-2①：先 flush 缓冲正文（其 seq 在落盘时分配），返回的逻辑尾部才含缓冲内容
    if (this.textChunkBufferBytes > 0) {
      await this.flushTextBuffer();
    }
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
          // 损坏行：拆分恢复 seq（防 tailSeq 少算，2026-08-24 根因修复）
          for (const obj of splitJsonLine(line)) {
            if (
              typeof (obj as { seq?: unknown }).seq === 'number' &&
              (obj as { seq: number }).seq > maxSeq
            ) {
              maxSeq = (obj as { seq: number }).seq;
            }
          }
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
        } catch (parseErr) {
          // KB-EVENTLOG-BADLINE（2026-08-29）：损坏行静默跳过 → 数据损坏不可感知
          logger.warn('事件日志损坏行跳过（getMaxTurn）', {
            sessionId: this.sessionId,
            error:
              parseErr instanceof Error ? parseErr.message : String(parseErr),
          });
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
   * A-2①（2026-09-02，v4 §5.2 选项①）：缓冲一条 text chunk（不落盘、不分配 seq）。
   *
   * 聚合/flush 策略（64KB/2s）由调用方（streamMessageFlow）驱动；本层保证
   * read/getTailSeq/append 前自动 flush（所有权闭环）——读路径永远看到已入缓冲
   * 的正文，打破"流进行中读到不完整 text"的竞态。seq 在 flush 落盘时原子分配。
   * 安全阈值（512KB）超限自动 flush：防调用方异常路径无限缓冲（CS03 兜底）。
   */
  async bufferTextChunk(
    messageId: string,
    content: string
  ): Promise<{ ok: boolean }> {
    if (!content) return { ok: true };
    let entry = this.textChunkBuffer.get(messageId);
    if (!entry) {
      entry = { chunks: [], bytes: 0 };
      this.textChunkBuffer.set(messageId, entry);
    }
    entry.chunks.push(content);
    const bytes = content.length; // UTF-16 近似（与 snapshotBytes 口径一致）
    entry.bytes += bytes;
    this.textChunkBufferBytes += bytes;
    if (this.textChunkBufferBytes >= TEXT_BUFFER_SAFETY_BYTES) {
      await this.flushTextBuffer();
    }
    return { ok: true };
  }

  /**
   * A-2①：flush 全部缓冲 text —— 每 messageId 聚合一条 `assistant/text-batch`
   * 落盘（F-2 schema；seq 由 append 原子分配，P3-7a）。批量 append 失败 → 回退
   * 逐 chunk 为 `assistant/text` 落盘（A-1：丢失窗口不放大到整批，M1-INV① 可观测）。
   * 失败不抛错（CS03）。
   *
   * @returns 实际 flush 的 chunk 数（含回退路径）
   */
  async flushTextBuffer(): Promise<number> {
    if (this.textChunkBuffer.size === 0) return 0;
    const pending = this.textChunkBuffer;
    this.textChunkBuffer = new Map();
    this.textChunkBufferBytes = 0;
    let flushed = 0;
    for (const [messageId, entry] of pending) {
      const joined = entry.chunks.join('');
      const joinedResult = await this.append({
        type: 'assistant/text-batch',
        schemaVersion: 1,
        seq: 0,
        time: Date.now(),
        sessionId: this.sessionId,
        data: { content: joined, messageId },
      });
      if (!joinedResult.ok) {
        // A-1：单批失败 → 回退逐 chunk（避免"一次失败丢整批"）
        logger.warn('event-log: text-batch 聚合落盘失败，回退逐 chunk（A-1）', {
          sessionId: this.sessionId,
          messageId,
          chunkCount: entry.chunks.length,
          reason: joinedResult.reason,
        });
        for (const chunkContent of entry.chunks) {
          const r = await this.append({
            type: 'assistant/text',
            schemaVersion: 1,
            seq: 0,
            time: Date.now(),
            sessionId: this.sessionId,
            data: { content: chunkContent, messageId },
          });
          if (!r.ok) {
            logger.warn('event-log: assistant/text 回退落盘失败', {
              sessionId: this.sessionId,
              messageId,
              contentLength: chunkContent.length,
              reason: r.reason,
            });
          }
        }
      }
      flushed += entry.chunks.length;
    }
    // 内存画像（MEM_PROFILE=1）：text-batch 聚合落盘完成（join 大字符串的驻留窗口）
    memProfile('eventlog:flush-text', { sessionId: this.sessionId, flushed });
    return flushed;
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
    // A-2①：直接 append 前先 flush 缓冲正文——保证 seq 顺序（缓冲正文先落盘，
    // 后续 tool/status 等事件 seq 在其后，不破坏事件流单调与消息内顺序）
    if (this.textChunkBufferBytes > 0) {
      await this.flushTextBuffer();
    }
    // 串行化：所有 append 调用排队执行
    return this.queueAppend(async () => {
      // D1（2026-08-24）：落盘前单遍无损 JSON 校验 + 深冻结——
      // ① 拒绝 BigInt/undefined/循环引用等非 JSON 值（不写盘，避免 JSON.stringify 静默丢字段）
      // ② 冻结对象与落盘对象一致，杜绝内存/磁盘不一致（数出同源）
      const sanitized = sanitizeEvent(event);
      if (!sanitized.ok) {
        logger.warn('event-log: 事件未通过无损 JSON 校验，拒绝写入', {
          sessionId: this.sessionId,
          eventSeq: event.seq,
          eventType: event.type,
          reason: sanitized.reason,
        });
        const tailSeq = await this.getTailSeq();
        return { ok: false, reason: 'invalid-event', tailSeq };
      }
      const frozen = sanitized.event!;

      // D2（2026-08-24）：写入端防御——运行时未知类型且非 ignorable 拒绝
      // （TS 层已保证类型，此处防御运行时动态构造的事件）
      const writable = assertEventWritable(frozen);
      if (!writable.ok) {
        logger.warn('event-log: 写入未知事件类型，拒绝写入', {
          sessionId: this.sessionId,
          eventSeq: frozen.seq,
          eventType: frozen.type,
          reason: writable.reason,
        });
        const tailSeq = await this.getTailSeq();
        return { ok: false, reason: 'invalid-event', tailSeq };
      }

      // 跨实例 seq 对齐（2026-08-24 根因修复）：
      // 写入前读磁盘 lastKnown（events.tail meta）——多进程/多实例各自持有
      // per-session EventLogStorage（mutex 互不共享）时，内存 tailSeq 可能落后
      // 于磁盘，直接写入会产生重复/乱序 seq。先对齐再走守卫。
      // KB-EVENT-TAIL-INIT（2026-08-29）：meta 缺失/未初始化时（A-6 之前旧文件、
      // meta 写失败、meta 被清理）append 不自我初始化——tailSeq=0 会绕过 seq
      // 守卫写入与盘上重复的 seq。文件存在时先扫描真实最大 seq 再走守卫。
      if (!this.tailSeqInitialized && this.exists()) {
        await this.getTailSeq();
      }
      const persisted = await this.readPersistedTailSeq();
      if (persisted > this.tailSeq) {
        logger.warn('event-log: 内存 tailSeq 落后磁盘 lastKnown，对齐后写入', {
          sessionId: this.sessionId,
          memoryTailSeq: this.tailSeq,
          persistedTailSeq: persisted,
          eventSeq: frozen.seq,
          eventType: frozen.type,
        });
        this.tailSeq = persisted;
        this.tailSeqInitialized = true;
      }
      const tailSeq = this.tailSeq;

      // P3-7a（2026-09-02）：seq<=0 → mutex 内原子分配。根治"getTailSeq + 1"两步
      // 非原子竞争（多个生产者并发读到同一 tailSeq 分配相同 seq → duplicate-seq 纠正）。
      // append 由 queueAppend 串行化，此处 tailSeq 是队列内最新值，分配 tailSeq+1 即唯一；
      // data.callSeq 为 0/-1（未指定）时同步填分配值（A1 闭环：tool/result 与 tool_call
      // 的 callSeq 必须等于事件 seq，前端按 callSeq 配对）。
      let toWrite = frozen;
      if (frozen.seq <= 0) {
        const allocated = tailSeq + 1;
        const rawData = frozen.data as { callSeq?: number } | undefined;
        const curCallSeq =
          typeof rawData?.callSeq === 'number' ? rawData.callSeq : -1;
        const finalCallSeq = curCallSeq > 0 ? curCallSeq : allocated;
        toWrite =
          finalCallSeq === curCallSeq
            ? (Object.freeze({ ...frozen, seq: allocated }) as LiriEvent)
            : (Object.freeze({
                ...frozen,
                seq: allocated,
                data: Object.freeze({ ...(frozen.data ?? {}), callSeq: finalCallSeq }),
              }) as LiriEvent);
      } else if (frozen.seq <= tailSeq) {
        // 守卫 1：seq 冲突 → 自动纠正（跨实例并发下重分配，而非拒绝丢弃事件，
        // 避免事件丢失导致投影兜底消息乱序置顶 / 事件溯源断层）
        const correctedSeq = tailSeq + 1;
        // P1-2：seq 纠正新建对象需浅冻结（data 与 frozen 共享，已深冻结），
        // 维持"落盘对象冻结"契约（D1），快照缓存可直接共享安全引用
        toWrite = Object.freeze({ ...frozen, seq: correctedSeq }) as LiriEvent;
        logger.warn('event-log: seq 冲突自动纠正', {
          sessionId: this.sessionId,
          fromSeq: frozen.seq,
          toSeq: correctedSeq,
          tailSeq,
          type: frozen.type,
          reason: frozen.seq === tailSeq ? 'duplicate-seq' : 'out-of-order',
        });
      }

      // 写入
      try {
        await this.ensureIdxLoaded();
        await this.ensureSessionDir();
        const line = JSON.stringify(toWrite) + '\n';
        await fs.appendFile(this.filePath, line, 'utf-8');
        this.tailSeq = toWrite.seq as number;
        // A-6（2026-08-23）：持久化 lastKnown tailSeq（meta 写失败不影响本次写入）
        await this.writePersistedTailSeq(toWrite.seq as number);
        // A-5（2026-08-23）：写入成功 → 连续失败计数清零（熔断自动解除）
        this.appendFailCount = 0;
        // P1-2：快照增量扩展（toWrite 已冻结，与落盘对象一致，直接共享引用）
        // B0（2026-09-02）：超限不再"清空 + ineligible"——改为滑动窗口裁剪
        // （保留最近、丢弃更早），消除超限后的全量重建尖峰。line.length 已在此
        // 序列化产物上可用（免二次序列化），成本入并行数组 snapshotCosts 备用。
        if (this.eventsSnapshot) {
          this.eventsSnapshot.push(toWrite);
          const lineLen = line.length;
          this.snapshotCosts.push(lineLen);
          this.snapshotBytes += lineLen;
          if (
            this.eventsSnapshot.length > this.snapshotEventBudget() ||
            this.snapshotBytes > this.maxSnapshotBytes
          ) {
            // B-3：冷却期节流——裁剪 O(窗口) 有成本，防"超限→裁剪→再超限"逐条反复；
            // 冷却内先容忍越界增长，2× 硬上限兜底（极端巨事件流下仍受控）。
            if (
              Date.now() >= this.snapshotCooldownUntil ||
              this.eventsSnapshot.length > this.snapshotEventBudget() * 2 ||
              this.snapshotBytes > this.maxSnapshotBytes * 2
            ) {
              this.trimSnapshotToFit();
            }
          }
        }
        // P3-8（2026-09-02）：事件字节索引——append 写路径增量维护区间。
        // G-4：行字节用 Buffer.byteLength(line,'utf-8')——seek 偏移是 UTF-8 字节数，
        // 不可复用 line.length（UTF-16 code unit，中文差 1.5~3 倍会系统性偏斜）。
        // 每 IDX_BATCH_SIZE 个事件折叠一个区间条目落盘 .idx；区间起点偏移 =
        // idxBytesTotal（本批开始前已索引字节，即本行在文件中的真实起始偏移）。
        // 索引派生物：折叠/落盘失败不阻断主路径（CS03），读路径回退逐行扫描。
        const lineBytes = Buffer.byteLength(line, 'utf-8');
        if (this.idxBatchCount === 0) {
          this.idxBatchStartSeq = toWrite.seq as number;
          this.idxBatchStartOffset = this.idxBytesTotal;
        }
        this.idxBatchCount++;
        this.idxBytesTotal += lineBytes;
        if (this.idxBatchCount >= IDX_BATCH_SIZE) {
          await this.persistIdxEntry({
            fromSeq: this.idxBatchStartSeq,
            toSeq: toWrite.seq as number,
            byteOffset: this.idxBatchStartOffset,
            count: this.idxBatchCount,
          });
          this.idxBatchCount = 0;
        }
        return { ok: true, tailSeq: this.tailSeq };
      } catch (e) {
        // A-5（2026-08-23）：append 失败 → 节流告警 + 熔断（结构化告警由 handleError 发布）
        this.recordAppendFailure(frozen, e);
        return { ok: false, reason: 'write-error', tailSeq: this.tailSeq };
      }
    });
  }

  // ─── P3-8 事件字节索引（2026-09-02，v4 方案 B-1/D7）─────────────────────

  /**
   * 惰性加载 .idx 索引 + 写路径字节偏移对齐（append/read 前各调一次）。
   *
   * 对齐语义：
   *   - idx 文件存在 → 逐行解析区间条目入 idxEntries，idxTailSeq = 末区间 toSeq；
   *     idxBytesTotal = 事件文件当前实际大小（对齐），尾部未索引区域（G-2 落后）
   *     由 read 的"超出 idx 覆盖回退逐行"兜底，后续 append 从对齐值正确累计偏移。
   *   - idx 文件缺失（重启后尚未折叠/从未落盘）→ idxBytesTotal 对齐事件文件大小，
   *     idxTailSeq = tailSeq（语义：全部视为未索引尾部，读路径回退逐行直至新索引折叠）。
   *
   * 失败（读 idx 损坏）→ idxEntries 置空 + idxLoaded=true，读路径回退逐行（§13 降级）。
   */
  private async ensureIdxLoaded(): Promise<void> {
    if (this.idxLoaded) return;
    this.idxLoaded = true;
    try {
      if (existsSync(this.filePath)) {
        const st = await fs.stat(this.filePath);
        this.idxBytesTotal = st.size;
        this.idxTailSeq = await this.getTailSeq().catch(() => 0);
      }
      if (!existsSync(this.idxFilePath)) return;
      const rl = this.createReadlineInterface(this.idxFilePath);
      let parsed = 0;
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Partial<EventIdxEntry>;
          if (
            typeof entry?.fromSeq === 'number' &&
            typeof entry?.toSeq === 'number' &&
            typeof entry?.byteOffset === 'number' &&
            typeof entry?.count === 'number'
          ) {
            this.idxEntries.push(entry as EventIdxEntry);
            this.idxTailSeq = entry.toSeq;
            parsed++;
          }
        } catch {
          // 单行损坏跳过（可重建派生物，非第二真相源）
        }
      }
      if (parsed > 0) {
        logger.debug('event-log: 事件字节索引已加载', {
          sessionId: this.sessionId,
          entries: this.idxEntries.length,
          idxTailSeq: this.idxTailSeq,
        });
      }
    } catch (e) {
      // 索引损坏/IO 失败 → 降级（读路径回退逐行扫描），不阻断（CS03）
      logger.warn('event-log: 索引加载失败，回退逐行扫描', {
        sessionId: this.sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
      this.idxEntries = [];
    }
  }

  /**
   * 折叠一个区间条目：入内存 + 落盘 .idx（append-only 一行）。
   * 落盘失败不阻断主路径（CS03）——内存条目照常可用，重启后 idx 落后由降级兜底。
   */
  private async persistIdxEntry(entry: EventIdxEntry): Promise<void> {
    this.idxEntries.push(entry);
    this.idxTailSeq = entry.toSeq;
    try {
      await this.ensureSessionDir();
      await fs.appendFile(this.idxFilePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (e) {
      logger.warn('event-log: 索引条目落盘失败（内存索引仍可用）', {
        sessionId: this.sessionId,
        entry,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * 二分定位覆盖 fromSeq 的区间起始偏移。
   *
   * @returns 若 fromSeq 已被索引覆盖 → 区间首行 UTF-8 字节偏移（可 seek）；
   *          else null（回退逐行扫描：重启后未索引区域 / idx 落后 G-2）。
   * 命中区间可能起始于 fromSeq 之前（≤IDX_BATCH_SIZE 行），读侧以现有
   * seq 正则跳过逻辑处理（不改变语义，仅减少扫描行数）。
   */
  private findIdxStartOffset(fromSeq: number): number | null {
    if (this.idxEntries.length === 0) return null;
    // 二分：最后一个 fromSeq <= 目标 的区间
    let lo = 0;
    let hi = this.idxEntries.length - 1;
    let hit: EventIdxEntry | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.idxEntries[mid].fromSeq <= fromSeq) {
        hit = this.idxEntries[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (!hit) return null;
    // 目标超出该区间覆盖（在末区间之后）→ 未索引，回退逐行
    if (fromSeq > hit.toSeq) return null;
    return hit.byteOffset;
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
    // D4-4（2026-08-24）：首次读取前自动崩溃修复（torn-tail 截断 + 合成 closers）。
    // 置于 exists 检查之前——即使文件损坏也需要先尝试修复再读取。
    await this.ensureRepairChecked();

    // 内存画像（MEM_PROFILE=1）：读取入口采样（快照/全量扫描可能瞬时膨胀）
    memProfile('eventlog-read:start', { sessionId: this.sessionId });

    // A-2①：read 前 flush 缓冲正文——流进行中读路径也看到已入缓冲的正文
    //（所见即所存；缓冲正文 seq 在 flush 时分配，先于任何后续直接 append）
    if (this.textChunkBufferBytes > 0) {
      await this.flushTextBuffer();
    }

    if (!this.exists()) {
      return [];
    }

    const fromSeq = query?.fromSeq ?? 1;
    const toSeq = query?.toSeq ?? Number.MAX_SAFE_INTEGER;
    const types = query?.types;
    const excludeTypes = query?.excludeTypes;
    const limit = Math.min(query?.limit ?? 1000, 10000);

    // P1-2（2026-08-30）：事件快照缓存（对齐 deepseek-harness eventsSnapshot）。
    // append-only + 深冻结事件使内存快照可安全共享：
    //   ① 命中 → 内存过滤直接返回（免磁盘扫描 + 行级 JSON 解析）
    //   ② 未命中且从头读（fromSeq<=1）→ 全量扫描建快照；超上限/失败置
    //      snapshotIneligible 回落到原路径，防每次重复全量扫描
    //   ③ 其余（分页续读 / 不可建快照）→ 原磁盘流式路径
    // B0（2026-09-02）：快照可能为"最近窗口"（超限裁剪），仅覆盖
    // [snapshotMinSeq, tail]——查询需要更早事件（fromSeq < snapshotMinSeq）时
    // 窗口无法完整回答，回退磁盘路径（events.jsonl 本身全量保留，语义不变）。
    const snapshot = await this.getFreshSnapshot();
    const snapshotCovers =
      snapshot !== null &&
      (this.snapshotMinSeq === 0 || fromSeq >= this.snapshotMinSeq);
    if (snapshotCovers) {
      return filterSnapshotEvents(snapshot, {
        fromSeq,
        toSeq,
        types,
        excludeTypes,
        limit,
      });
    }
    if (
      snapshot === null &&
      fromSeq <= 1 &&
      !this.snapshotIneligible &&
      Date.now() >= this.snapshotCooldownUntil
    ) {
      const built = await this.buildSnapshot();
      // 内存画像（MEM_PROFILE=1）：快照构建完成（深冻结事件常驻内存的真实成本点）
      memProfile('eventlog:snapshot-built', {
        sessionId: this.sessionId,
        events: built?.length ?? 0,
      });
      if (built) {
        this.eventsSnapshot = built;
        // B0：build 结果可能是"最近窗口"（内存峰值受控）——若查询需要窗口
        // 之外（更早）的事件，本次不返回，落入下方磁盘路径补全
        if (this.snapshotMinSeq === 0 || fromSeq >= this.snapshotMinSeq) {
          return filterSnapshotEvents(built, {
            fromSeq,
            toSeq,
            types,
            excludeTypes,
            limit,
          });
        }
      }
    }

    const results: LiriEvent[] = [];

    try {
      // P3-8（2026-09-02）：分页续读（fromSeq>1）优先用字节索引定位——
      // O(N) 逐行扫描 → O(log N) 定位 + seek 段读。索引未覆盖（重启后未
      // 折叠 / idx 落后 G-2）时 findIdxStartOffset 返回 null，回退从头逐行
      // （既有 KB-EVENT-READ regex-skip 路径，语义不变）。
      await this.ensureIdxLoaded();
      const idxStart = fromSeq > 1 ? this.findIdxStartOffset(fromSeq) : null;
      const rl = this.createReadlineInterface(
        this.filePath,
        idxStart ?? 0
      );
      for await (const line of rl) {
        if (!line.trim()) continue;
        if (results.length >= limit) break;

        // KB-EVENT-READ（2026-08-29）：fromSeq 之前行快速跳过——分页读取
        // （getMessages/ChatManager 循环 read）原对每行 JSON.parse 全量解析，
        // 40 万行事件（thinking 写放大）下 O(N²) 卡死（"重启后打不开"）。
        // JSON 中 "seq" 紧跟行首，正则提取即可跳过范围外行，仅范围内行完整解析。
        if (fromSeq > 1) {
          const seqMatch = line.match(/"seq":(\d+)/);
          // 能提取 seq 且小于 fromSeq 才快速跳过；提取失败（损坏行/拼接行）不跳过，
          // 交下方 try 走 splitJsonLine 拆分恢复（2026-08-24 根因修复）。
          // 原实现 continue 使分页读取（fromSeq>1，40 万行会话常态路径）下损坏行
          // 不参与恢复，行内可恢复事件（含跨实例并发拼接场景）静默丢失。
          if (seqMatch && parseInt(seqMatch[1], 10) < fromSeq) continue;
        }
        // KB-EVENT-READ-EXCL（2026-08-29）：excludeTypes 行级快速跳过——
        // 载入长会话时排除 assistant/thinking 等高频细节事件，不 parse 直接跳过。
        if (excludeTypes && excludeTypes.length > 0) {
          const typeMatch = line.match(/"type":"([^"]+)"/);
          if (
            typeMatch &&
            excludeTypes.includes(typeMatch[1] as LiriEventType)
          ) {
            continue;
          }
        }

        try {
          const event = JSON.parse(line) as unknown;
          if (!isLiriEvent(event)) {
            logger.warn('event-log: read 跳过非事件行', {
              sessionId: this.sessionId,
              linePreview: line.slice(0, 100),
            });
            continue;
          }

          // D2（2026-08-24）：版本校验 + 未知类型处理——超前版本/未知非 ignorable 跳过并告警
          const readable = assertEventReadable(event);
          if (!readable.ok) {
            logger.warn('event-log: read 跳过不可读事件', {
              sessionId: this.sessionId,
              eventSeq: event.seq,
              eventType: event.type,
              reason: readable.reason,
            });
            continue;
          }

          // D1（2026-08-24）：读取路径同步冻结——"读取返回冻结对象"契约
          // （sanitizeEvent 对已冻结对象幂等跳过，历史未冻结事件在此补齐冻结）
          sanitizeEvent(event);

          // 过滤
          if (event.seq < fromSeq || event.seq > toSeq) continue;
          if (types && !types.includes(event.type)) continue;

          results.push(event);
        } catch {
          // 损坏行（跨实例并发拼接/截断）→ 按 JSON 边界拆分恢复（2026-08-24 根因修复）
          let recovered = 0;
          for (const obj of splitJsonLine(line)) {
            if (!isLiriEvent(obj)) continue;
            const readable = assertEventReadable(obj);
            if (!readable.ok) continue;
            sanitizeEvent(obj);
            if (obj.seq < fromSeq || obj.seq > toSeq) continue;
            if (types && !types.includes(obj.type)) continue;
            // T7/P0-4（2026-08-30）：既有 bug 修复——损坏行恢复的事件此前漏查
            // excludeTypes，与正常行/快照路径语义不一致（恢复出的 thinking 会被多返回）
            if (excludeTypes && excludeTypes.includes(obj.type)) continue;
            results.push(obj);
            recovered++;
          }
          if (recovered > 0) {
            logger.warn('event-log: read 损坏行拆分恢复', {
              sessionId: this.sessionId,
              recoveredCount: recovered,
              linePreview: line.slice(0, 100),
            });
          } else {
            logger.warn('event-log: read 跳过损坏行（无法恢复）', {
              sessionId: this.sessionId,
              linePreview: line.slice(0, 100),
            });
          }
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
      // P1-2：物理裁剪后事件集合已变，快照失效（并允许重新评估快照资格）
      this.clearSnapshotCache();
      // P3-8（2026-09-02）：字节索引作废（F-1）——trim 物理重写文件，旧偏移
      // 全部失效。idxLoaded 置 false 使下次 ensureIdxLoaded 重新对齐
      // idxBytesTotal = trim 后文件实际大小（append-only 偏移累计自此处续）。
      this.idxEntries = [];
      this.idxTailSeq = 0;
      this.idxBatchCount = 0;
      this.idxBatchStartSeq = 0;
      this.idxBatchStartOffset = 0;
      this.idxBytesTotal = 0;
      this.idxLoaded = false;
      await fs.rm(this.idxFilePath, { force: true }).catch(() => {});
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
   * D3（2026-08-24）：事件级 fork——复制本会话 [1..boundary] 前缀事件到目标存储
   *
   * - 保留原始 seq（子会话继承祖先 seq 空间，不做重映射；当前无跨会话 seq 引用）
   * - 复制前先 ensureRepairChecked（复用 D4 崩溃修复，保证复制的是完整前缀）
   * - 流式读取源文件，直接写原始行（避免 JSON 重序列化导致的格式漂移）
   * - 目标必须为空（fork 目标 = 新建会话），已存在事件则拒绝 target-not-empty
   * - 原子写入（tmp + rename，参照 trimEvents），同步更新目标 tailSeq + 持久化 meta
   *
   * @param target 目标 EventLogStorage（子会话）
   * @param boundary fork 边界 seq（包含）；> 源 tailSeq 时复制全量
   */
  async copyPrefixTo(
    target: EventLogStorage,
    boundary: number
  ): Promise<{ ok: boolean; copied: number; reason?: string }> {
    if (boundary <= 0) {
      return { ok: true, copied: 0 };
    }
    // 先修复源（torn-tail 截断 + 未闭合 turn 合成），保证复制的是完整前缀
    await this.ensureRepairChecked();
    if (!this.exists()) {
      return { ok: true, copied: 0 };
    }
    // fork 目标必须是新会话（空事件文件）
    const targetTail = await target.getTailSeq();
    if (targetTail > 0) {
      return { ok: false, copied: 0, reason: 'target-not-empty' };
    }

    try {
      const lines: string[] = [];
      let maxCopiedSeq = 0;
      const rl = this.createReadlineInterface();
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as LiriEvent;
          if (typeof event.seq === 'number' && event.seq <= boundary) {
            lines.push(line);
            if (event.seq > maxCopiedSeq) maxCopiedSeq = event.seq;
          }
        } catch {
          // 损坏行：repair 已处理 torn-tail，此处保守跳过（不复制损坏行）
          logger.warn('event-log: copyPrefix 跳过损坏行', {
            sessionId: this.sessionId,
            linePreview: line.slice(0, 100),
          });
        }
      }
      if (lines.length === 0) {
        return { ok: true, copied: 0 };
      }

      // 原子写入目标（tmp + rename，避免半写文件）
      // 基于 target.filePath 创建目录（而非 target.sessionDir），与写入位置保持一致
      await fs.mkdir(dirname(target.filePath), { recursive: true });
      const tmpPath = `${target.filePath}.fork`;
      await fs.writeFile(tmpPath, lines.join('\n') + '\n', 'utf-8');
      await fs.rename(tmpPath, target.filePath);
      // 同步目标 tailSeq（内存缓存 + 持久化），后续 append 在此基础继续
      target.tailSeq = maxCopiedSeq;
      target.tailSeqInitialized = true;
      await target.writePersistedTailSeq(maxCopiedSeq);
      // P1-2：目标文件被整体覆盖（原子写），其快照失效
      target.clearSnapshotCache();

      logger.info('event-log: copyPrefix 完成', {
        sessionId: this.sessionId,
        targetSessionId: target.sessionId,
        boundary,
        copied: lines.length,
        maxCopiedSeq,
      });
      return { ok: true, copied: lines.length };
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'copyPrefixTo',
        context: {
          sessionId: this.sessionId,
          targetSessionId: target.sessionId,
          boundary,
        },
      }).catch(() => {});
      return { ok: false, copied: 0, reason: 'copy-error' };
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
            // D2（2026-08-24）：版本校验 + 未知类型处理——不可读则视为未命中
            const readable = assertEventReadable(event);
            if (!readable.ok) {
              logger.warn('event-log: readBySeq 跳过不可读事件', {
                sessionId: this.sessionId,
                seq,
                eventType: event.type,
                reason: readable.reason,
              });
              return null;
            }
            // D1（2026-08-24）：与 read() 契约一致——返回冻结对象
            // （sanitizeEvent 对已冻结对象幂等跳过）
            sanitizeEvent(event);
            return event;
          }
        } catch (badLineErr) {
          // KB-EVENTLOG-BADLINE2（2026-08-29）：损坏行静默跳过 → 数据损坏不可感知
          logger.warn('事件日志损坏行跳过（readBySeq）', {
            sessionId: this.sessionId,
            seq,
            error:
              badLineErr instanceof Error
                ? badLineErr.message
                : String(badLineErr),
          });
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
   * P1-2：清空快照缓存（各失效点统一入口）。
   *
   * B0（2026-09-02）新增：同步重置窗口元数据（snapshotMinSeq / snapshotCosts），
   * 保证"快照非空 ⇒ 元数据一致"的不变量。
   */
  private clearSnapshotCache(): void {
    this.eventsSnapshot = null;
    this.snapshotIneligible = false;
    this.snapshotBytes = 0;
    this.snapshotCooldownUntil = 0;
    this.snapshotMinSeq = 0;
    this.snapshotCosts = [];
  }

  /**
   * B-2（2026-09-02，v4 §6.2 / D2 ①）：热层事件窗口预算 = min(配置上限, HOT=10K)。
   * 小会话（≤10K 事件）全量覆盖；大会话热窗口收敛至 ≤10K，更早历史走 events.idx。
   */
  private snapshotEventBudget(): number {
    return Math.min(this.maxSnapshotEvents, SNAPSHOT_HOT_EVENTS);
  }

  /**
   * B0（2026-09-02，v4 方案 §6.2）：滑动窗口裁剪——超限时保留最近事件、
   * 丢弃更早，而非整体清空。
   *
   * 自尾向前按成本数组累计，直到（字节 或 条数）预算内；至少保留 1 条
   * （单事件超预算的极端场景退化为"仅最近一条"，不会死循环清空）。
   * 裁剪后置冷却（B-3），防"超限→裁剪→再写入→再超限"逐条反复。
   */
  private trimSnapshotToFit(): void {
    const arr = this.eventsSnapshot;
    if (!arr) return;
    const costs = this.snapshotCosts;
    // 防御：成本数组与快照严格并行（push/裁剪/清空同点），万一失配按全量重算
    if (costs.length !== arr.length) {
      let bytes = 0;
      for (let i = 0; i < arr.length; i++) {
        const c = JSON.stringify(arr[i]).length + 1;
        if (costs.length === i) costs.push(c);
        else costs[i] = c;
        bytes += c;
      }
      costs.length = arr.length;
      this.snapshotBytes = bytes;
    }
    let keepBytes = 0;
    let keep = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const c = costs[i];
      if (
        keep > 0 &&
        (keepBytes + c > this.maxSnapshotBytes ||
          keep >= this.snapshotEventBudget())
      ) {
        break;
      }
      keepBytes += c;
      keep++;
    }
    keep = Math.max(keep, 1);
    if (keep >= arr.length) return; // 未超限（理论上不会到此处）
    const start = arr.length - keep;
    const droppedHead = arr[start] as LiriEvent;
    this.eventsSnapshot = arr.slice(start);
    this.snapshotCosts = costs.slice(start);
    this.snapshotBytes = keepBytes;
    this.snapshotMinSeq = droppedHead.seq;
    this.snapshotCooldownUntil = Date.now() + SNAPSHOT_COOLDOWN_MS;
  }

  /**
   * P1-2（2026-08-30）：读取事件快照（新鲜度校验通过才返回）
   *
   * 新鲜度判定（P0-2 + P1-A 修正，v3）：
   *   fresh = (diskTail === memoryTailSeq) && (snapshotTail === memoryTailSeq)
   * - diskTail：O(1) 读文件尾（scanTailForMaxSeq，读末尾 64KB）——跨实例追加即使
   *   对方 meta 写失败也能探测（diskTail 更大 → stale，消除 P1-A 盲区）
   * - snapshotTail：快照尾元素 seq（有序数组天然携带覆盖范围）
   * - memoryTailSeq：本实例已确认落盘的日志末尾（append 同步更新）
   * persisted（events.tail meta）降级为日志参考，不再参与判定。
   *
   * 失效场景：trimEvents / commitTornRepair / copyPrefixTo（目标）已显式清空；
   * 此处探测到 stale 时置冷却（P0-3），避免跨实例持续写期间反复全量重建。
   */
  private async getFreshSnapshot(): Promise<LiriEvent[] | null> {
    if (!this.eventsSnapshot) return null;
    const snapshotTail =
      this.eventsSnapshot[this.eventsSnapshot.length - 1]?.seq ?? 0;
    const staleReason = await this.snapshotStaleReason(snapshotTail);
    if (staleReason) {
      logger.warn('event-log: 事件快照过期，失效并回退磁盘读取', {
        sessionId: this.sessionId,
        snapshotTailSeq: snapshotTail,
        memoryTailSeq: this.tailSeq,
        staleReason,
      });
      this.eventsSnapshot = null;
      this.snapshotBytes = 0;
      this.snapshotIneligible = false;
      this.snapshotMinSeq = 0;
      this.snapshotCosts = [];
      this.snapshotCooldownUntil = Date.now() + SNAPSHOT_COOLDOWN_MS;
      return null;
    }
    return this.eventsSnapshot;
  }

  /**
   * P0-2/P1-A（2026-08-30）：快照失效原因判定（返回 null = fresh）
   *
   * - 'memory-not-init'：内存 tailSeq 未初始化，无法判定（本实例重启后首次读）
   * - 'snapshot-behind-memory'：快照覆盖 < 内存 tailSeq（buildSnapshot 扫描期间
   *   append 竞态 / 增量丢失）
   * - 'disk-ahead'：磁盘尾 > 内存 tailSeq（跨实例追加；含对方 meta 写失败场景，
   *   因为判定不依赖 meta）
   * - 'disk-behind'：磁盘尾 < 内存 tailSeq（文件被外部截断/回滚，罕见；保守失效）
   * - 'disk-read-error'：读文件尾失败（保守失效，回退磁盘路径）
   */
  private async snapshotStaleReason(
    snapshotTail: number
  ): Promise<string | null> {
    if (!this.tailSeqInitialized) return 'memory-not-init';
    if (snapshotTail !== this.tailSeq) return 'snapshot-behind-memory';
    let diskTail: number;
    try {
      diskTail = await this.scanTailForMaxSeq();
    } catch {
      return 'disk-read-error';
    }
    if (diskTail !== this.tailSeq) {
      return diskTail > this.tailSeq ? 'disk-ahead' : 'disk-behind';
    }
    return null;
  }

  /**
   * P1-2（2026-08-30）：全量扫描建快照（对齐 read() 的解析/校验/冻结语义，不递归调 read）
   *
   * - 双上限（P1-7/B0 2026-09-02）：事件条数 or 累计字节超限 → 滑动窗口保留最近、
   *   丢弃更早（快照非空；内存峰值 ≈ 预算内）。不再整体清空 + 永久 ineligible。
   * - tailSeq 只前进不回退（P0-1）
   * - 扫描期间 append 竞态（P1-A）→ 本次快照作废 + 冷却，由下次 read 重建
   * - IO 失败 → 冷却重试，不永久禁用（P1-5）
   * - snapshotPreCommitHook（P2-E）：扫描后-提交前可注入挂起点（测试构造竞态用）
   * - 失败不抛错（CS03）
   */
  private async buildSnapshot(): Promise<LiriEvent[] | null> {
    try {
      // B0（2026-09-02，v4 §6.2）：环形窗口——大会话事件总量可远超预算，若先
      // 全量收集再裁剪会先撑爆内存（P3-7f 单会话 3.4GB 场景）。解析过程中即时
      // 从头部淘汰，内存峰值 ≈ 预算内，超限会话仍保留"最近 N"热窗口（而非
      // 旧实现的永久 ineligible + 整体清空，后续读全部回退全量磁盘扫描）。
      const events: LiriEvent[] = [];
      const costs: number[] = []; // 与 events 严格并行（line.length，UTF-16）
      let head = 0; // 窗口起点（events[head..] 为有效区）
      let bytes = 0; // 窗口内累计字节
      let windowed = false;
      const push = (event: LiriEvent, cost: number): void => {
        events.push(event);
        costs.push(cost);
        bytes += cost;
        // 至少保留 1 条（单事件超预算不空窗）
        while (
          events.length - head > 1 &&
          (events.length - head > this.snapshotEventBudget() ||
            bytes > this.maxSnapshotBytes)
        ) {
          bytes -= costs[head];
          head++;
          windowed = true;
        }
      };
      const rl = this.createReadlineInterface();
      for await (const line of rl) {
        if (!line.trim()) continue;
        const lineLen = line.length;
        try {
          const event = JSON.parse(line) as unknown;
          if (!isLiriEvent(event)) continue;
          const readable = assertEventReadable(event);
          if (!readable.ok) continue;
          sanitizeEvent(event);
          push(event, lineLen);
        } catch {
          // 损坏行：按 JSON 边界拆分恢复（与 read() 原路径一致）
          for (const obj of splitJsonLine(line)) {
            if (!isLiriEvent(obj)) continue;
            const readable = assertEventReadable(obj);
            if (!readable.ok) continue;
            sanitizeEvent(obj);
            push(obj, lineLen);
          }
        }
      }
      if (head >= events.length) return null;
      // 窗口/全量取活跃区，events 与 costs 同步裁剪保持并行
      const active = windowed ? events.slice(head) : events;
      const activeCosts = windowed ? costs.slice(head) : costs;
      if (active.length === 0) return null;
      // 稳定排序（append-only 下文件序 ≈ seq 序；防御乱序行），成本数组随动
      const order = active.map((_, i) => i);
      order.sort(
        (a, b) => (active[a].seq - active[b].seq) || (a - b)
      );
      const sorted = order.every((v, i) => v === i);
      const finalEvents = sorted
        ? active
        : order.map((i) => active[i]);
      const finalCosts = sorted
        ? activeCosts
        : order.map((i) => activeCosts[i]);
      const snapTail = finalEvents[finalEvents.length - 1].seq;
      // P2-E：可注入挂起点（扫描后-提交前），测试构造"扫描期间 append"竞态
      if (this.snapshotPreCommitHook) {
        await this.snapshotPreCommitHook();
      }
      // P1-A：扫描期间 append 已推进 tailSeq → 快照不完整，本次作废 + 冷却
      if (this.tailSeqInitialized && this.tailSeq > snapTail) {
        logger.debug('event-log: 扫描期间有增量 append，本次快照作废', {
          sessionId: this.sessionId,
          snapTail,
          tailSeq: this.tailSeq,
        });
        this.snapshotCooldownUntil = Date.now() + SNAPSHOT_COOLDOWN_MS;
        return null;
      }
      // P0-1：tailSeq 只前进不回退
      if (snapTail > this.tailSeq) {
        this.tailSeq = snapTail;
        this.tailSeqInitialized = true;
      }
      this.snapshotBytes = bytes;
      this.snapshotCosts = finalCosts;
      // B0：窗口化时记录窗口首事件 seq（0 = 覆盖全量）；下次增量超限可 O(1) 裁剪
      this.snapshotMinSeq = windowed ? (finalEvents[0] as LiriEvent).seq : 0;
      return finalEvents;
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'buildSnapshot',
        context: { sessionId: this.sessionId },
      }).catch(() => {});
      // P1-5：IO 失败走冷却重试，不永久禁用
      this.snapshotCooldownUntil = Date.now() + SNAPSHOT_COOLDOWN_MS;
      return null;
    }
  }

  /**
   * 创建 readline 接口
   *
   * 封装为内部方法便于测试 mock
   *
   * P3-8（2026-09-02）：支持 seek 起点——read 分页续读命中字节索引时从
   * `byteOffset` 起流式读（跳过文件头 O(N) 行扫描）；默认从头读（start=0）。
   * 文件参数化以支持 .idx 索引文件解析。
   */
  private createReadlineInterface(
    file: string = this.filePath,
    start: number = 0
  ): readline.Interface {
    const stream = createReadStream(file, {
      encoding: 'utf-8',
      ...(start > 0 ? { start } : {}),
    });
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
        // 损坏行：拆分恢复 seq（2026-08-24 根因修复）
        for (const obj of splitJsonLine(line)) {
          if (
            typeof (obj as { seq?: unknown }).seq === 'number' &&
            (obj as { seq: number }).seq > maxSeq
          ) {
            maxSeq = (obj as { seq: number }).seq;
          }
        }
      }
    }
    return maxSeq;
  }

  // ─── D4 torn-tail 崩溃修复（2026-08-24，对齐 deepseek-harness SessionLogScanner） ───

  /**
   * D4-1：检测 events.jsonl 末尾是否存在半写行（torn tail）
   *
   * 应用崩溃时 fs.appendFile 可能中断，末尾残留半写 JSON 行。判定规则：
   *   1. 文件末尾无换行符（\n 结尾）→ 最后一条记录可能不完整
   *   2. 或最后一条记录 JSON.parse 失败 → 半写
   * 双重判定（对齐 deepseek-harness finish()："ignoring a final record without
   * a newline as a torn tail"），避免误判正常文件。
   *
   * @returns { offset: number, torn: boolean }——offset 为安全截断位置（= 最后一个
   *   完整记录末尾字节数，含换行），torn=true 表示存在需要截断的半写行
   */
  async scanForTornTail(): Promise<{ offset: number; torn: boolean }> {
    if (!this.exists()) return { offset: 0, torn: false };
    try {
      const stat = await fs.stat(this.filePath);
      if (stat.size === 0) return { offset: 0, torn: false };

      // 读末尾 64KB（足够覆盖典型半写；超大单行理论上可能超限，但事件行通常 < 10KB）
      const tailSize = Math.min(64 * 1024, stat.size);
      const buf = Buffer.alloc(tailSize);
      const fd = await fs.open(this.filePath, 'r');
      try {
        await fd.read(buf, 0, tailSize, stat.size - tailSize);
      } finally {
        await fd.close();
      }

      const text = buf.toString('utf-8');
      // 逐行解析，最后一条完整行的结束字节偏移
      let lastCompleteEnd = 0;
      let lineStart = 0;
      let sawTorn = false;

      // KB-TORN-CUT（2026-09-02 根因修复，P3-8 测试暴露）：读的是"文件末尾 64KB
      // 块"（stat.size-64KB 起），块起点可能切在多字节 UTF-8 字符**中间** → 块首
      // "行"是上一行内容的尾部残片，JSON.parse 必失败——若参与 torn 判定会把正常
      // 文件误报 torn，导致 commitTornRepair 截断删除末尾完整事件（实测中文长文件
      // 600 行被误删 29 行，newTailSeq 回退到 571）。块起点非文件开头时，跳过
      // 首残缺行（推进到第一个 \n 之后）再开始判定。
      if (stat.size > tailSize) {
        const firstNl = text.indexOf('\n');
        if (firstNl >= 0) {
          lineStart = firstNl + 1;
        }
      }

      for (let i = lineStart; i < text.length; i++) {
        if (text[i] === '\n') {
          const line = text.slice(lineStart, i);
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            try {
              JSON.parse(trimmed);
              lastCompleteEnd = i + 1; // 完整行（含换行）
            } catch {
              // 中间损坏行（非末尾）——保守视为 torn（可能是崩溃点）
              sawTorn = true;
            }
          }
          lineStart = i + 1;
        }
      }

      // 剩余无换行的尾行：若 trim 非空且 JSON 不可解析 → torn
      const lastLine = text.slice(lineStart);
      const lastTrimmed = lastLine.trim();
      if (lastTrimmed.length > 0) {
        try {
          JSON.parse(lastTrimmed);
          // KB-TORN-PRESERVE（2026-08-29）：可解析尾行 = JSON 内容完整（半写内容
          // 不可能 parse 成功），无换行仅缺 '\n' 终止符，非数据损坏。原实现把
          // "可解析但无换行"判为 torn 并截断（lastCompleteEnd 停在倒数第二行），
          // 丢弃了完整事件（外部工具/异常落盘的假阳性）。改为整条保留。
          lastCompleteEnd = text.length;
        } catch {
          // 尾行不可解析 → 明确的半写 torn
          sawTorn = true;
        }
      }

      // 全局偏移：读的是末尾 64KB，需加上文件头偏移
      const baseOffset = stat.size - tailSize;
      return {
        offset: baseOffset + lastCompleteEnd,
        torn: sawTorn,
      };
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'scanForTornTail',
        context: { sessionId: this.sessionId },
      }).catch(() => {});
      return { offset: 0, torn: false };
    }
  }

  /**
   * D4-2：截断 torn tail 至最后一个完整记录，并同步 tailSeq/持久化值
   *
   * 调用方（D4-4 启动钩子 / 首次 read）先 scanForTornTail 确认 torn=true 后再调本方法。
   * 截断失败不抛错（CS03）：返回 false 由调用方决定是否继续降级。
   *
   * @returns 截断后是否成功（false = 无 torn 或截断失败）
   */
  async commitTornRepair(): Promise<boolean> {
    const { offset, torn } = await this.scanForTornTail();
    if (!torn) return false;
    try {
      await fs.truncate(this.filePath, offset);
      // 重置 tailSeq：截断后重新扫描真实最大 seq
      this.tailSeq = 0;
      this.tailSeqInitialized = false;
      this.maxTurn = null;
      // P1-2：文件被截断，快照失效
      this.clearSnapshotCache();
      const realTail = await this.getTailSeq(true);
      logger.warn('event-log: torn tail 已截断修复', {
        sessionId: this.sessionId,
        truncatedOffset: offset,
        newTailSeq: realTail,
      });
      await this.writePersistedTailSeq(realTail);
      return true;
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'commitTornRepair',
        context: { sessionId: this.sessionId, offset },
      }).catch(() => {});
      return false;
    }
  }

  /**
   * D4-3：检测未闭合轮次并生成合成 turn/end（interruptedTurnClosers）
   *
   * 应用崩溃可能留下 turn/start 无配对 turn/end 的残缺轮次。扫描事件日志，
   * 对每个"已 start 未 end"的 turn 合成 `turn/end { finishReason: 'canceled' }`
   * （对齐 B 方案"未完成=已中断"语义，前端已有 canceled 终态处理）。
   *
   * 对齐 deepseek-harness `interruptedTurnClosers`：崩溃恢复仅合成缺失的 closers，
   * 不修改已存在事件。
   *
   * @returns 合成的 turn/end 事件数组（seq 从当前 tailSeq+1 连续分配，未落盘）
   *   与需要合成的未闭合 turn 号列表
   */
  async interruptedTurnClosers(): Promise<{
    closers: LiriEvent[];
    openTurns: number[];
  }> {
    // 直接流式扫描文件（不调 read()）——read() 会触发 ensureRepairChecked（D4-4），
    // 首次调用即抢先合成 closers 落盘，导致本方法二次扫描时 turn 已闭合返回空。
    // 本方法作为"原始状态查询"应只看文件真实内容（repair 闭环由 ensureRepairChecked 驱动）。
    const openTurns = new Set<number>();
    if (this.exists()) {
      try {
        const rl = this.createReadlineInterface();
        for await (const line of rl) {
          if (!line.trim()) continue;
          // 2026-08-24 根因修复：损坏行（半写/拼接）用 splitJsonLine 恢复——
          // 裸 JSON.parse 会跳过拼接行，行内真实的 turn/end 丢失 → turn 误判
          // 未闭合 → 每次启动都重复合成 canceled closers（前端全部回复显示中断）。
          for (const obj of splitJsonLine(line)) {
            const event = obj as LiriEvent;
            if (event.type === 'turn/start') {
              openTurns.add((event.data as { turn: number }).turn);
            } else if (event.type === 'turn/end') {
              openTurns.delete((event.data as { turn: number }).turn);
            }
          }
        }
      } catch (e) {
        await handleError(e, {
          module: 'session:event-log',
          action: 'interruptedTurnClosers',
          context: { sessionId: this.sessionId },
        }).catch(() => {});
      }
    }
    const sorted = [...openTurns].sort((a, b) => a - b);
    const tailSeq = await this.getTailSeq();
    const time = Date.now();
    const closers: LiriEvent[] = sorted.map((turn, i) => ({
      type: 'turn/end',
      seq: tailSeq + i + 1,
      time,
      sessionId: this.sessionId,
      data: { turn, finishReason: 'canceled' as const },
    }));
    return { closers, openTurns: sorted };
  }

  /**
   * D4-3：将合成的 turn/end closers 落盘（崩溃恢复收尾）
   *
   * 调用方先 interruptedTurnClosers() 获取 closers，确认非空后调本方法。
   * 逐条 append（append 内含 sanitize + 版本校验 + seq 单调守卫）。
   *
   * @returns 成功写入的 closers 数量（0 = 无未闭合轮次或写入失败）
   */
  async commitInterruptedRepair(): Promise<number> {
    const { closers } = await this.interruptedTurnClosers();
    if (closers.length === 0) return 0;
    let written = 0;
    for (const closer of closers) {
      const result = await this.append(closer);
      if (result.ok) written++;
    }
    if (written > 0) {
      logger.warn('event-log: 崩溃恢复合成 turn/end closers', {
        sessionId: this.sessionId,
        openTurns: closers.map((c) => (c.data as { turn: number }).turn),
        written,
      });
    }
    return written;
  }

  /**
   * D4-4：首次读取前自动崩溃修复（内存标记防重复 + 防递归）
   *
   * 修复链（对齐 deepseek-harness load-time repair）：
   *   1. torn-tail 截断（半写行清理）——见 commitTornRepair
   *   2. 未闭合轮次合成 turn/end closers——见 commitInterruptedRepair
   *
   * 防递归：commitInterruptedRepair → interruptedTurnClosers → read()
   * 会再次进入本方法，靠 `_repairChecked` 在真正执行前已置 true 短路。
   * 失败不抛错（CS03）：修复失败仅告警，读取照常降级（损坏行跳过）。
   */
  private async ensureRepairChecked(): Promise<void> {
    if (this._repairChecked) return;
    // 先置标记再执行——防递归（修复内部 read() 再次进入）
    this._repairChecked = true;
    try {
      const tornRepaired = await this.commitTornRepair();
      const closersWritten = await this.commitInterruptedRepair();
      if (tornRepaired || closersWritten > 0) {
        logger.info('event-log: 首次读取触发崩溃修复', {
          sessionId: this.sessionId,
          tornRepaired,
          closersWritten,
        });
      }
    } catch (e) {
      await handleError(e, {
        module: 'session:event-log',
        action: 'ensureRepairChecked',
        context: { sessionId: this.sessionId },
      }).catch(() => {});
    }
  }
}
