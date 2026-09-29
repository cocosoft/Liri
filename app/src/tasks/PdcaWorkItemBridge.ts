/**
 * PDCA ↔ WorkItem 状态桥接
 *
 * 共享模块，供 pdca-handlers（HTTP 层）和 LongRunningTaskOrchestrator（任务层）共同引用。
 * 避免 tasks → infrastructure/http/handlers 的反向依赖。
 */

import { join } from 'path';
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { resolveDataSubDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import {
  type PdcaPhase,
  PDCA_TO_WORKITEM,
  PDCA_TERMINAL_PHASES,
} from '@modules/core';
export type { PdcaPhase };
export { PDCA_TERMINAL_PHASES } from '@modules/core';

const logger = getLogger('tasks:pdcaBridge');

/**
 * PDCA 检查点目录（**惰性解析**，2026-09-29 台账「另案 ⑤」）。
 *
 * ⚠️ 原实现是**模块顶层常量** ⇒ 路径在模块求值时被冻结，测试设置 `LIRI_HOME` /
 * `LIRI_DATA_DIR` 后仍读写**真实**目录（详见 `infrastructure/http/handlers/pdca-handlers.ts`
 * 同名函数处的完整取证）。改为**调用时解析**。
 */
function pdcaCheckpointDir(): string {
  return resolveDataSubDir('pdca');
}

/** WorkItem 持久化目录（惰性解析，同上） */
function workitemDir(): string {
  return resolveDataSubDir('workitems');
}

// ──── 文件 I/O ────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    // KB-PDCA-READ-LOG（2026-08-29）：文件损坏/读取失败静默返回 null → 上层按
    // "无文件"处理，工作项丢失无提示
    logger.warn('PDCA/WorkItem 文件读取失败，按无文件处理', {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(join(filePath, '..'));
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/** 读取 PDCA 检查点 */
export function readPdcaCheckpoint(
  taskId: string
): Record<string, unknown> | null {
  return readJson(join(pdcaCheckpointDir(), `${taskId}.json`));
}

/** 写入 PDCA 检查点 */
export function writePdcaCheckpoint(
  taskId: string,
  data: Record<string, unknown>
): void {
  // Gap D（1-0a，2026-09-03）：合并式写模型（read-modify-write）。
  // 原实现整文件覆盖，_persistCheckpoint 等部分字段写入会把
  // workItemId/status/workspaceId/projectId/lastPdcaPhase 等归属字段整体抹掉，
  // 连锁导致 WorkItem 同步空转、幂等排除失效、项目过滤无数据。
  const existing = readPdcaCheckpoint(taskId) ?? {};
  writeJson(join(pdcaCheckpointDir(), `${taskId}.json`), {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * 检查点**文件级记忆**（2026-09-29 台账「另案 ⑥」）。
 *
 * **为什么需要**：`listPdcaCheckpoints()` 与 `handlePdcaList` 每次调用都对整个目录
 * `readdirSync` + **逐文件 `readFileSync`+`JSON.parse`**。真实目录实测 **3394** 个 json、
 * 3MB ⇒ 成本拆解（实测）：`readdir` **2ms** / 全量 `stat` **30ms** / 全量 `read+parse`
 * **1032ms** ⇒ **97% 的时间花在"重新解析未变的文件"上**，且该目录**只增不减** ⇒ 随时间持续劣化。
 *
 * **方案**：以 `(mtimeMs, size)` 为"内容未变"的判据，命中则复用已解析对象 ⇒ 每次调用只付
 * `readdir + stat`（实测 ≈32ms，**约 30× 提升**），仅在**变更过的文件**上重新解析。
 * 判据为 mtime+size：本模块**唯一写入路径**（`writePdcaCheckpoint`）每次都重写文件，
 * 二者必变 ⇒ 不会漏判。
 */
interface CkFileMemo {
  mtimeMs: number;
  size: number;
  data: Record<string, unknown> | null;
}

let ckFileMemo = new Map<string, CkFileMemo>();

/**
 * 扫描检查点目录并返回全部检查点数据（带**文件级记忆**；顺序同 `readdir`）。
 *
 * 每次调用都会**重建 memo 表**（只含当前仍存在的文件）⇒ 自动清理已删除文件的陈旧条目，
 * 不会无界增长。
 */
function scanCheckpoints(): Array<Record<string, unknown>> {
  const dir = pdcaCheckpointDir();
  if (!existsSync(dir)) {
    ckFileMemo = new Map();
    return [];
  }

  const names = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const nextMemo = new Map<string, CkFileMemo>();
  const out: Array<Record<string, unknown>> = [];

  for (const name of names) {
    const full = join(dir, name);
    let mtimeMs: number;
    let size: number;
    try {
      const st = statSync(full);
      mtimeMs = st.mtimeMs;
      size = st.size;
    } catch {
      // @ignore-catch: readdir 与 stat 之间文件被删除的竞态 ⇒ 跳过该文件
      continue;
    }

    const memo = ckFileMemo.get(full);
    if (memo && memo.mtimeMs === mtimeMs && memo.size === size) {
      nextMemo.set(full, memo);
      if (memo.data) out.push(memo.data);
      continue;
    }

    const data = readJson<Record<string, unknown>>(full);
    nextMemo.set(full, { mtimeMs, size, data });
    if (data) out.push(data);
  }

  ckFileMemo = nextMemo;
  return out;
}

/** P0(M9)：列出全部 PDCA checkpoint（含终态与非终态，供 /goal list 过滤） */
export function listPdcaCheckpoints(): Array<Record<string, unknown>> {
  return scanCheckpoints();
}

/**
 * 检查点**索引**（taskId → 检查点）—— 供 HTTP 层按 taskId 回填归属字段。
 *
 * 与 `listPdcaCheckpoints()` **共用同一次带记忆的扫描**（GR02 实现唯一性：原
 * `handlePdcaList` 内联了同一份扫描逻辑）。
 */
export function getPdcaCheckpointIndex(): Map<string, Record<string, unknown>> {
  const index = new Map<string, Record<string, unknown>>();
  for (const ck of scanCheckpoints()) {
    if (typeof ck.taskId === 'string') index.set(ck.taskId, ck);
  }
  return index;
}

/**
 * 检查点**终态 status** 集合（2026-09-29，另案 ⑥ 留存）。
 *
 * 与 [`pdca-handlers.findExistingTask`](../infrastructure/http/handlers/pdca-handlers.ts) 的
 * "非活跃"判据**同源**（原先该处内联 `status !== 'abort' && status !== 'failed' && !== 'completed'`）
 * ⇒ 收敛为单一事实源（GR02），并与 `core` 的 `PDCA_TERMINAL_PHASES`（按 **phase** 判定）互为补充：
 * 本仓检查点**两个字段并用**（`phase` 见 PhaseVocabulary，`status` 见各写入点）⇒ 二者任一为终态即算终态。
 */
export const PDCA_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'abort',
]);

/**
 * **活跃 status**（2026-09-29，另案 ⑥ 留存扩展）：这些状态视为"正在跑"，留存**一律保留**。
 * 与 `pdca-handlers.scanAndAbortStalePdcaTasks` 的命中判据同源。
 */
export const PDCA_ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'started',
  'running',
]);

/**
 * **待审批 phase**（同批）：等待用户/审批入口处理，留存**一律保留**。
 * 与 `pdca-handlers.scanAndAbortStalePdcaTasks` 的豁免判据同源（收敛为单一事实源，GR02）。
 */
export const PDCA_AWAITING_APPROVAL_PHASES: ReadonlySet<string> = new Set([
  'plan_pending',
  'stage_awaiting_approval',
]);

/**
 * 检查点留存天数（2026-09-29，另案 ⑥ · 留存策略）。
 *
 * **可删条件 = 超期 且 下列任一**：
 * 1. **终态**：`phase ∈ PDCA_TERMINAL_PHASES` **或** `status ∈ PDCA_TERMINAL_STATUSES`；
 * 2. **孤儿**（2026-09-29 扩展，用户裁定"纳入"）：非终态 **且** `status ∉ PDCA_ACTIVE_STATUSES`
 *    **且** `phase ∉ PDCA_AWAITING_APPROVAL_PHASES` —— 即"既没在跑、也不在等审批"的历史残留
 *    （实测真实目录里 8/16 的 `d2-test-*` / `d5-replan-*` 即此类：`phase=review/plan` 且 `status` 为空）。
 *
 * **一律保留**：`started`/`running`（可能在跑）、`plan_pending`/`stage_awaiting_approval`（待审批）、
 * 以及**未超期**的一切。
 *
 * 超期判据：`updatedAt`（缺失时回退文件 mtime）早于 `now - 天数`。
 */
export const PDCA_CHECKPOINT_RETENTION_DAYS = 30;

/** 留存清理结果（供日志与测试断言） */
export interface PdcaCheckpointPruneResult {
  /** 扫描到的检查点数 */
  scanned: number;
  /** 已删除总数（= prunedTerminal + prunedOrphan） */
  pruned: number;
  /** 其中：终态超期 */
  prunedTerminal: number;
  /** 其中：超期孤儿（非终态且非活跃、非待审批） */
  prunedOrphan: number;
  /** 保留：未超期 */
  keptFresh: number;
  /** 保留：未超期以外的不可删项（非终态且活跃/待审批，或无 taskId） */
  keptActive: number;
  /** 删除失败数 */
  errors: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 解析 ISO 时间戳；无法解析返回 null */
function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** 读取文件 mtime；失败返回 null */
function fileMtimeMs(filePath: string): number | null {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    // @ignore-catch: 竞态删除 ⇒ 视为无 mtime（上层会保留该文件，不做删除）
    return null;
  }
}

/**
 * **留存清理**：删除"终态 + 超期"的检查点（2026-09-29，另案 ⑥ 留存策略）。
 *
 * **调用时机**：DAEMON/CLI 启动时一次（`main.ts` 的启动链，**在启动扫描之后** —— 扫描刚把
 * 崩溃遗留的 `running` 标为 `abort` 并刷新 `updatedAt`，因而它们会因"新鲜"被保留，
 * 不会被"刚标完就删掉"）。参照既有范式 [`MemoryManager.cleanupExpiredMemories()`](../memory/MemoryManager.ts)
 *（启动时运行 + 日志计数），不再新建机制。
 *
 * **安全性**：只删终态且超期；`unlinkSync` 失败仅计数并 warn，不抛出；同时清理对应记忆条目
 * （`ckFileMemo`）以免陈旧条目残留。目录不存在时为空操作。
 *
 * @param maxAgeDays 保留天数（默认 {@link PDCA_CHECKPOINT_RETENTION_DAYS}）
 */
export function prunePdcaCheckpoints(
  maxAgeDays: number = PDCA_CHECKPOINT_RETENTION_DAYS
): PdcaCheckpointPruneResult {
  const result: PdcaCheckpointPruneResult = {
    scanned: 0,
    pruned: 0,
    prunedTerminal: 0,
    prunedOrphan: 0,
    keptFresh: 0,
    keptActive: 0,
    errors: 0,
  };

  const dir = pdcaCheckpointDir();
  if (!existsSync(dir)) return result;

  const cutoff = Date.now() - maxAgeDays * DAY_MS;

  // 复用带记忆的扫描：只对"内容未变"的文件免重复解析（无需为留存单独再读一遍目录）
  for (const ck of scanCheckpoints()) {
    result.scanned++;

    const taskId = typeof ck.taskId === 'string' ? ck.taskId : '';
    const phase = typeof ck.phase === 'string' ? ck.phase : '';
    const status = typeof ck.status === 'string' ? ck.status : '';

    const isTerminal =
      PDCA_TERMINAL_PHASES.has(phase) || PDCA_TERMINAL_STATUSES.has(status);
    // 孤儿：非终态、且"没在跑、也不在等审批" ⇒ 历史残留（判据说明见 PDCA_CHECKPOINT_RETENTION_DAYS）
    const isOrphan =
      !isTerminal &&
      !PDCA_ACTIVE_STATUSES.has(status) &&
      !PDCA_AWAITING_APPROVAL_PHASES.has(phase);

    if (!taskId || !(isTerminal || isOrphan)) {
      result.keptActive++;
      continue;
    }

    const filePath = join(dir, `${taskId}.json`);
    const at = parseTimestampMs(ck.updatedAt) ?? fileMtimeMs(filePath);
    if (at === null || at > cutoff) {
      result.keptFresh++;
      continue;
    }

    try {
      unlinkSync(filePath);
      ckFileMemo.delete(filePath);
      result.pruned++;
      if (isTerminal) result.prunedTerminal++;
      else result.prunedOrphan++;
    } catch (err) {
      result.errors++;
      logger.warn('PDCA 检查点留存删除失败（跳过）', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.pruned > 0 || result.errors > 0) {
    logger.info('PDCA 检查点留存清理完成', {
      maxAgeDays,
      ...result,
    });
  }
  return result;
}

/** 预热 Promise（幂等：并发调用复用同一次预热；见 `prewarmPdcaCheckpointIndex`） */
let prewarmPromise: Promise<void> | null = null;

/**
 * **启动异步预热**检查点索引（2026-09-29 台账「另案 ⑥」）。
 *
 * **为什么必须分批**：`scanCheckpoints()` 是**同步**实现（`statSync` + `readFileSync`），
 * 首次对 3394 个文件解析实测 ≈**1.1s**。若只把它丢进 `setImmediate`，只是把这段**同步阻塞**
 * 从"启动路径"挪到"首个 tick"，事件循环（含 HTTP 服务）照样被卡 1.1s。故此处按 `batchSize`
 * 分批解析，**每批之间 `await` 一个宏任务让出事件循环**（单批 ≈30ms）⇒ 启动与请求都不被卡。
 *
 * **不覆盖已有记忆**（只"补空缺"）：与并发进行的 `scanCheckpoints()` 互不干扰 ——
 * 后者每次整体重建 memo 表；预热只填空缺，且每条记忆都携带**读取当时的 `mtimeMs`**，
 * 若期间文件已变，下一次扫描会因 mtime 不匹配而**自动重读**（自愈，不会投毒）。
 *
 * **幂等**：重复调用复用同一 Promise。**失败不抛出**：下次读取自然回退到同步扫描。
 *
 * @param batchSize 每批文件数（默认 100 ⇒ 单批 ≈30ms 的事件循环占用）
 */
export function prewarmPdcaCheckpointIndex(batchSize = 100): Promise<void> {
  if (prewarmPromise) return prewarmPromise;

  prewarmPromise = (async () => {
    const startedAt = Date.now();
    try {
      const dir = pdcaCheckpointDir();
      if (!existsSync(dir)) return;

      const names = readdirSync(dir).filter((f) => f.endsWith('.json'));
      let filled = 0;

      for (let i = 0; i < names.length; i++) {
        const full = join(dir, names[i]);
        if (!ckFileMemo.has(full)) {
          try {
            const st = statSync(full);
            const data = readJson<Record<string, unknown>>(full);
            ckFileMemo.set(full, { mtimeMs: st.mtimeMs, size: st.size, data });
            filled++;
          } catch {
            // @ignore-catch: readdir 与 stat 之间文件被删除的竞态 ⇒ 跳过该文件
          }
        }
        if ((i + 1) % batchSize === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      logger.info('PDCA 检查点索引预热完成', {
        files: names.length,
        parsed: filled,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (err) {
      logger.warn('PDCA 检查点索引预热失败（下次读取回退同步扫描）', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return prewarmPromise;
}

/**
 * 同步 PDCA 阶段 → WorkItem 状态
 *
 * @param taskId PDCA 任务 ID
 * @param pdcaPhase 当前 PDCA 阶段
 */
export function syncPdcaWorkItemStatus(
  taskId: string,
  pdcaPhase: PdcaPhase
): void {
  const ck = readPdcaCheckpoint(taskId);
  if (!ck?.workItemId) return;

  const wiPath = join(workitemDir(), `${ck.workItemId}.json`);
  const wi = readJson<{
    status?: string;
    updatedAt?: string;
    completedAt?: string;
  }>(wiPath);
  if (!wi) return;

  const newStatus = PDCA_TO_WORKITEM[pdcaPhase] || 'running';
  if (wi.status === newStatus) return;

  wi.status = newStatus;
  wi.updatedAt = new Date().toISOString();
  if (newStatus === 'done' || newStatus === 'failed') {
    wi.completedAt = new Date().toISOString();
  }
  writeJson(wiPath, wi);

  // 更新检查点中的阶段信息
  writePdcaCheckpoint(taskId, { ...ck, lastPdcaPhase: pdcaPhase });
}
