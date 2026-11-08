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
 * 本模块只做两件事，**不改 replan 的执行语义**：
 * 1. 发一条回执：`计划已重建，将重跑 N 步（其中 M 步此前已完成）`；
 * 2. 重跑前把工作区产物拍一份**清单快照**（路径 / 大小 / mtime），落到 `data/replan-snapshots/`。
 *
 * 失败一律不阻断 replan（快照/回执属附加信息）——与 `persistPdcaCheckpoint` 同口径。
 */

import {
  mkdirSync,
  readdirSync,
  lstatSync,
  writeFileSync,
  existsSync,
} from 'fs';
import { join } from 'path';
import { resolvePyappHome } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';
// R03-002：必须走模块出口（子路径直连会判违规）
import { resolveTaskWorkspace } from '@modules/agent';
// 状态字面量唯一事实源（lint:state-ratchet：不得裸写 'completed'）
import { STEP_STATUS_COMPLETED } from '../TaskOrchestrator';
import { emitPdcaReceiptText } from './terminalReceipt.js';

const logger = getLogger('tasks:lro:replanGuard');

/** 单次快照最多记录的条目数（防超大工作区把清单写成日志级文件） */
const MAX_SNAPSHOT_ENTRIES = 2000;

/** 产物清单条目（仅元数据，不复制内容） */
export interface WorkspaceFileEntry {
  /** 相对工作区的路径（正斜杠） */
  path: string;
  size: number;
  modifiedAt: string;
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

/** 递归收集工作区文件元数据（跳过符号链接，避免环） */
function collectEntries(
  root: string,
  dir: string,
  out: WorkspaceFileEntry[]
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
      collectEntries(root, full, out);
      continue;
    }
    out.push({
      path: full.slice(root.length + 1).replaceAll('\\', '/'),
      size: st.size,
      modifiedAt: new Date(st.mtimeMs).toISOString(),
    });
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
      collectEntries(workspace, workspace, files);
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

export interface ReplanPlanSummary {
  /** 旧计划步骤总数 */
  total: number;
  /** 其中已完成的步数（即将被重跑） */
  previouslyCompleted: number;
}

/**
 * replan 前统一配套：产物快照 + 成本回执。返回旧计划的步数统计（供调用方记录）。
 *
 * 注意：**不改变** replan 的执行语义（仍是全量重跑），只让代价可见、现场可回溯。
 */
export function prepareReplan(input: {
  taskId: string;
  sessionId?: string | null;
  previousSteps: ReadonlyArray<{ status?: string; description?: string }>;
  /** 注入点（测试用）；缺省走真实快照 */
  capture?: (taskId: string) => WorkspaceSnapshot;
}): ReplanPlanSummary {
  const total = input.previousSteps.length;
  const previouslyCompleted = input.previousSteps.filter(
    (s) => s.status === STEP_STATUS_COMPLETED
  ).length;
  let snapshotEntries: number | null = null;
  try {
    const snapshot = (input.capture ?? captureWorkspaceSnapshot)(input.taskId);
    snapshotEntries = snapshot.entries;
  } catch (err) {
    logger.warn('replan 产物快照异常（不阻断 replan）', {
      taskId: input.taskId,
      error: String(err),
    });
  }
  logger.info('replan 计划重建（全量重跑）', {
    taskId: input.taskId,
    total,
    previouslyCompleted,
    snapshotEntries,
  });
  emitPdcaReceiptText({
    taskId: input.taskId,
    sessionId: input.sessionId,
    text:
      `♻️ 计划已重建：将重跑 ${total} 步` +
      (previouslyCompleted > 0
        ? `（其中 ${previouslyCompleted} 步此前已完成，产物会被重写）`
        : '') +
      (snapshotEntries === null
        ? ''
        : `。重跑前的产物清单已快照（${snapshotEntries} 个文件）`),
  });
  return { total, previouslyCompleted };
}
