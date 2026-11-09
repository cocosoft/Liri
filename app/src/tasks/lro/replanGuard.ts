// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * replan 前的「成本可见 + 现场可回溯」配套（方案 C，2026-11-09）。
 *
 * **背景（真机 `pdca_mw81e4z5`）**：escalate → replan 会**重建整份计划**（步骤 id 全变、
 * 全部 `pending`），已完成步骤随之被**重新执行**（实测 `a.txt` / `c.txt` 被重写、
 * 任务 token 151,544 → 293,080）。这是有意取舍（计划自洽优先），但此前对用户**完全静默**：
 * 既不知道"会重跑多少步"，也没有"重跑前长什么样"的对照物。
 *
 * 本模块负责三件事：
 * 1. 发一条回执：`计划已重建，复用 M 步 / 重跑 N 步`；
 * 2. 重跑前把工作区产物拍一份**清单快照**（路径 / 大小 / mtime / 小文件 sha256），落到 `data/replan-snapshots/`；
 * 3. **增量复用**（P0-2，2026-11-09）：`completed` 且产物与快照一致的步骤直接置回 `completed`，
 *    只重跑失败/受影响步骤（此前为全量重跑，已完成步骤的产物会被无谓重写）。
 *
 * 失败一律不阻断 replan（快照/回执/复用均属附加信息）——与 `persistPdcaCheckpoint` 同口径。
 */

import {
  mkdirSync,
  readdirSync,
  lstatSync,
  statSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { resolvePyappHome } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';
// R03-002：必须走模块出口（子路径直连会判违规）
import { resolveTaskWorkspace, toWorkspaceRelativePath } from '@modules/agent';
// 状态字面量唯一事实源（lint:state-ratchet：不得裸写 'completed'）
import {
  STEP_STATUS_COMPLETED,
  STEP_STATUS_PENDING,
  type Plan,
  type PlanStep,
} from '../TaskOrchestrator';
import type { PlanReview } from '../PlanReview';
import type { ToolOutcomeSummary } from './stepHelpers.js';
import { emitPdcaReceiptText } from './terminalReceipt.js';

const logger = getLogger('tasks:lro:replanGuard');

/** 单次快照最多记录的条目数（防超大工作区把清单写成日志级文件） */
const MAX_SNAPSHOT_ENTRIES = 2000;

/**
 * 哈希上限：单文件 1MB、单次快照累计 32MB。
 *
 * 超出预算的文件不存哈希 ⇒ 复用判定回退到 size+mtime（见 `artifactsUnchanged`）。
 * 上限的意义：快照发生在 replan 前，不能因为给所有产物算哈希而拖慢恢复。
 */
const HASH_MAX_FILE_BYTES = 1024 * 1024;
const HASH_TOTAL_BUDGET_BYTES = 32 * 1024 * 1024;

/** 产物清单条目（元数据 + 小文件内容哈希） */
export interface WorkspaceFileEntry {
  /** 相对工作区的路径（正斜杠） */
  path: string;
  size: number;
  modifiedAt: string;
  /**
   * 内容哈希（仅 ≤1MB 且未超累计预算的文件）。
   * 存在时复用判定以内容为准；缺失时回退 size+mtime。
   */
  sha256?: string;
}

export interface WorkspaceSnapshot {
  taskId: string;
  capturedAt: string;
  /** 工作区绝对路径 */
  workspace: string;
  /** 实际记录的条目数（可能被上限截断） */
  entries: number;
  /** 是否因上限被截断 */
  truncated: boolean;
  files: WorkspaceFileEntry[];
}

/** 快照落盘目录（与工作区分开：不让快照本身出现在 agent 的 glob 视野里） */
function snapshotDir(): string {
  return join(resolvePyappHome(), 'data', 'replan-snapshots');
}

/** 计算文件内容 sha256（调用方保证文件存在且已通过大小上限） */
function computeSha256(full: string): string {
  return createHash('sha256').update(readFileSync(full)).digest('hex');
}

/** 递归收集工作区文件元数据（跳过符号链接，避免环） */
function collectEntries(
  root: string,
  dir: string,
  out: WorkspaceFileEntry[],
  state: { hashedBytes: number }
): void {
  if (out.length >= MAX_SNAPSHOT_ENTRIES) return;
  for (const name of readdirSync(dir)) {
    if (out.length >= MAX_SNAPSHOT_ENTRIES) return;
    const full = join(dir, name);
    let st: ReturnType<typeof lstatSync>;
    try {
      // lstat：不跟随符号链接（statSync 的 isSymbolicLink() 恒为 false，会漏判并可能成环）
      st = lstatSync(full);
    } catch {
      continue; // @ignore-catch — 收集期文件消失（并发删改）不算错误
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      collectEntries(root, full, out, state);
      continue;
    }
    const entry: WorkspaceFileEntry = {
      path: full.slice(root.length + 1).replaceAll('\\', '/'),
      size: st.size,
      modifiedAt: new Date(st.mtimeMs).toISOString(),
    };
    // 哈希用于"内容未变"判定（size+mtime 无法识别同大小、mtime 还原的改写）
    if (
      st.size > 0 &&
      st.size <= HASH_MAX_FILE_BYTES &&
      state.hashedBytes + st.size <= HASH_TOTAL_BUDGET_BYTES
    ) {
      try {
        entry.sha256 = computeSha256(full);
        state.hashedBytes += st.size;
      } catch {
        // @ignore-catch — 读不出内容 ⇒ 无哈希，复用判定回退 size+mtime
      }
    }
    out.push(entry);
  }
}

/**
 * 拍工作区产物清单快照并落盘；工作区不存在 ⇒ 返回空快照（不是错误）。
 *
 * 快照文件：`<pyappHome>/data/replan-snapshots/<taskId>-<ISO>.json`（文件名去冒号，Windows 合法）。
 */
export function captureWorkspaceSnapshot(taskId: string): WorkspaceSnapshot {
  const workspace = resolveTaskWorkspace(taskId);
  const capturedAt = new Date().toISOString();
  const files: WorkspaceFileEntry[] = [];
  if (existsSync(workspace)) {
    try {
      collectEntries(workspace, workspace, files, { hashedBytes: 0 });
    } catch (err) {
      logger.warn('replan 产物快照收集失败（不阻断 replan）', {
        taskId,
        workspace,
        error: String(err),
      });
    }
  }
  const snapshot: WorkspaceSnapshot = {
    taskId,
    capturedAt,
    workspace,
    entries: files.length,
    truncated: files.length >= MAX_SNAPSHOT_ENTRIES,
    files,
  };
  // 工作区不存在（从未执行过步骤 / 已被清理）⇒ 没有"现场"可言，不落空文件
  if (!existsSync(workspace)) return snapshot;
  try {
    const dir = snapshotDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${taskId}-${capturedAt.replaceAll(':', '-')}.json`);
    writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf-8');
    logger.info('replan 产物快照已写入', {
      taskId,
      file,
      entries: files.length,
    });
  } catch (err) {
    // @ignore-catch — 快照属附加信息，写失败不得阻断 replan
    logger.warn('replan 产物快照写入失败（不阻断 replan）', {
      taskId,
      error: String(err),
    });
  }
  return snapshot;
}

/** checkpoint 快照中的旧步骤（复用判定输入） */
export interface PreviousStepSnapshot {
  description?: string;
  status?: string;
  result?: string;
  reviewResult?: unknown;
  artifacts?: string[];
  toolOutcomes?: unknown;
  terminationReason?: string;
}

/** 可复用步骤（按描述归一后与新计划同描述步骤匹配） */
export interface ReusableStep {
  description: string;
  result?: string;
  reviewResult?: unknown;
  artifacts: string[];
  toolOutcomes?: unknown;
  terminationReason?: string;
}

export interface ReplanPlanSummary {
  /** 旧计划步骤总数 */
  total: number;
  /** 其中已完成的步数 */
  previouslyCompleted: number;
  /** 产物未变、可复用的步骤（按旧计划描述） */
  reusable: ReusableStep[];
}

/** 描述归一（空白差异不阻断复用；不做语义归一，避免误配） */
function normalizeStepDescription(desc: string): string {
  return desc.replace(/\s+/g, ' ').trim();
}

/**
 * 产物是否与 replan **之前**的快照一致。
 *
 * 快照条目带 `sha256` ⇒ 以**内容哈希**为准（mtime 变化不影响复用）；
 * 无哈希（>1MB / 超累计预算 / 读取失败）⇒ 回退 `size + mtime` 全等。
 *
 * 任一路径缺失、被删除或无法证明未变 ⇒ 不复用（重新执行比复用过期产物更安全）。
 */
function artifactsUnchanged(
  workspace: string,
  artifacts: ReadonlyArray<string>,
  snapshotIndex: Map<string, WorkspaceFileEntry>
): boolean {
  for (const artifact of artifacts) {
    const rel = toWorkspaceRelativePath(workspace, artifact);
    if (!rel) return false;
    const entry = snapshotIndex.get(rel.toLowerCase());
    if (!entry) return false;
    const full = join(workspace, rel);
    try {
      const st = statSync(full);
      if (!st.isFile()) return false;
      if (st.size !== entry.size) return false;
      if (entry.sha256 !== undefined) {
        if (computeSha256(full) !== entry.sha256) return false;
        continue;
      }
      if (new Date(st.mtimeMs).toISOString() !== entry.modifiedAt) return false;
    } catch {
      // @ignore-catch — 读不到 = 无法证明"未变" ⇒ 不复用
      return false;
    }
  }
  return true;
}

/**
 * 选出可复用步骤（P0-2，2026-11-09）：
 *   `completed` + 产物台账非空 + 产物与 replan 前快照一致（内容哈希优先）+ 未在缺陷清单中。
 *
 * 产物台账为空（跑了但没写出产物 / 旧任务未采集）⇒ **不复用**：没有可核对的
 * "产物未变"证据，重跑是保守选择。描述重复的步骤无法可靠映射到新计划 ⇒ 也不复用。
 */
export function selectReusableSteps(input: {
  previousSteps: ReadonlyArray<PreviousStepSnapshot>;
  snapshot: WorkspaceSnapshot;
  defects?: ReadonlyArray<{ stepDescription: string }>;
}): ReusableStep[] {
  const counts = new Map<string, number>();
  for (const s of input.previousSteps) {
    const key = normalizeStepDescription(s.description ?? '');
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const defectKeys = new Set(
    (input.defects ?? [])
      .map((d) => normalizeStepDescription(d.stepDescription))
      .filter(Boolean)
  );
  const snapshotIndex = new Map(
    input.snapshot.files.map((f) => [f.path.toLowerCase(), f])
  );

  const reusable: ReusableStep[] = [];
  for (const s of input.previousSteps) {
    const key = normalizeStepDescription(s.description ?? '');
    if (!key || counts.get(key) !== 1) continue;
    if (s.status !== STEP_STATUS_COMPLETED) continue;
    if (defectKeys.has(key)) continue;
    const artifacts = [...(s.artifacts ?? [])].filter(Boolean);
    if (artifacts.length === 0) continue;
    if (
      !artifactsUnchanged(input.snapshot.workspace, artifacts, snapshotIndex)
    ) {
      continue;
    }
    reusable.push({
      description: key,
      result: s.result,
      reviewResult: s.reviewResult,
      artifacts,
      toolOutcomes: s.toolOutcomes,
      terminationReason: s.terminationReason,
    });
  }
  return reusable;
}

/**
 * 把可复用步骤落到**重建后的新计划**：同描述且仍为 `pending` 的步骤直接置 `completed`
 * 并回填原结果 / 审查 / 产物台账 ⇒ `executeAllSteps` 跳过它们，只重跑失败与受影响步骤。
 *
 * 返回实际复用步数（新计划描述被改写 / 步骤已非 pending ⇒ 不匹配）。
 */
export function applyReusableSteps(
  plan: Plan,
  reusable: ReadonlyArray<ReusableStep>
): number {
  if (reusable.length === 0) return 0;
  const remaining = new Map(
    reusable.map((r) => [normalizeStepDescription(r.description), r])
  );
  let applied = 0;
  for (const step of plan.steps) {
    if (step.status !== STEP_STATUS_PENDING) continue;
    const key = normalizeStepDescription(step.description);
    const source = remaining.get(key);
    if (!source) continue;
    step.status = STEP_STATUS_COMPLETED;
    step.result = source.result;
    step.reviewResult = source.reviewResult as PlanStep['reviewResult'];
    step.toolOutcomes = source.toolOutcomes as PlanStep['toolOutcomes'];
    step.terminationReason = source.terminationReason;
    step.artifacts = [...source.artifacts];
    remaining.delete(key);
    applied += 1;
  }
  return applied;
}

/**
 * replan 前统一配套：产物快照 + 成本回执 + 复用候选。返回旧计划的步数统计（供调用方记录）。
 *
 * 2026-11-09（P0-2）：不再"全量重跑"——`completed` 且产物未变的步骤会被 `applyReusableSteps`
 * 直接复用；本函数只负责**算出候选**并让代价可见，真正的复用落盘由调用方在计划重建后执行。
 */
export function prepareReplan(input: {
  taskId: string;
  sessionId?: string | null;
  previousSteps: ReadonlyArray<PreviousStepSnapshot>;
  /** 上轮缺陷清单（受影响步骤不复用） */
  defects?: ReadonlyArray<{ stepDescription: string }>;
  /** 注入点（测试用）；缺省走真实快照 */
  capture?: (taskId: string) => WorkspaceSnapshot;
}): ReplanPlanSummary {
  const total = input.previousSteps.length;
  const previouslyCompleted = input.previousSteps.filter(
    (s) => s.status === STEP_STATUS_COMPLETED
  ).length;
  let snapshot: WorkspaceSnapshot | undefined;
  try {
    snapshot = (input.capture ?? captureWorkspaceSnapshot)(input.taskId);
  } catch (err) {
    logger.warn('replan 产物快照异常（不阻断 replan）', {
      taskId: input.taskId,
      error: String(err),
    });
  }
  const reusable = snapshot
    ? selectReusableSteps({
        previousSteps: input.previousSteps,
        snapshot,
        defects: input.defects,
      })
    : [];
  const rerun = total - reusable.length;
  logger.info('replan 计划重建（增量复用）', {
    taskId: input.taskId,
    total,
    previouslyCompleted,
    reusable: reusable.length,
    rerun,
    snapshotEntries: snapshot?.entries ?? null,
  });

  const snapshotNote =
    snapshot === undefined
      ? ''
      : `。重跑前的产物清单已快照（${snapshot.entries} 个文件）`;
  const text =
    reusable.length > 0
      ? `♻️ 计划已重建：预计复用 ${reusable.length} 步（产物未变），重跑 ${rerun} 步` +
        (previouslyCompleted - reusable.length > 0
          ? `（其中 ${previouslyCompleted - reusable.length} 步此前已完成，产物会被重写）`
          : '') +
        snapshotNote
      : `♻️ 计划已重建：将重跑 ${total} 步` +
        (previouslyCompleted > 0
          ? `（其中 ${previouslyCompleted} 步此前已完成，产物会被重写）`
          : '') +
        snapshotNote;
  emitPdcaReceiptText({
    taskId: input.taskId,
    sessionId: input.sessionId,
    text,
  });
  return { total, previouslyCompleted, reusable };
}
