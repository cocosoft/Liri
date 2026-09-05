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
} from 'fs';
import { resolveDataSubDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tasks:pdcaBridge');

const PDCA_CHECKPOINT_DIR = join(resolveDataSubDir('pdca'));
const WORKITEM_DIR = join(resolveDataSubDir('workitems'));

// ──── 类型 ────

type PdcaPhase =
  | 'plan'
  | 'plan_pending'
  | 'execute'
  | 'review'
  | 'decide'
  | 'completed'
  | 'abort'
  | 'failed'
  /** D1（M7，2026-08-13）：阶段审批挂起 */
  | 'stage_awaiting_approval';
type WorkItemStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'review'
  | 'done'
  | 'failed';

const PDCA_TO_WORKITEM: Record<PdcaPhase, WorkItemStatus> = {
  plan: 'pending',
  plan_pending: 'review',
  stage_awaiting_approval: 'review',
  execute: 'running',
  review: 'review',
  decide: 'running',
  completed: 'done',
  abort: 'failed',
  failed: 'failed',
};

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
  return readJson(join(PDCA_CHECKPOINT_DIR, `${taskId}.json`));
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
  writeJson(join(PDCA_CHECKPOINT_DIR, `${taskId}.json`), {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

/** P0(M9)：列出全部 PDCA checkpoint（含终态与非终态，供 /goal list 过滤） */
export function listPdcaCheckpoints(): Array<Record<string, unknown>> {
  if (!existsSync(PDCA_CHECKPOINT_DIR)) return [];
  const files = readdirSync(PDCA_CHECKPOINT_DIR).filter((f) =>
    f.endsWith('.json')
  );
  return files
    .map((f) => readJson<Record<string, unknown>>(join(PDCA_CHECKPOINT_DIR, f)))
    .filter((c): c is Record<string, unknown> => c != null);
}

/** P0(M9)：PDCA 终态阶段（list 时过滤掉） */
export const PDCA_TERMINAL_PHASES = new Set(['completed', 'failed', 'abort']);

/**
 * 阶段一 4.2-5（2026-09-05）：删除/清空会话联动终态化——
 * 将该会话所有非终态 PDCA checkpoint 置为 abort/cancelled（防止孤儿 running 任务实体
 * 残留；会话已删除后 launch 侧写入点另有"会话存在"守卫，不会复活）。终态条目跳过，
 * 无 sessionId 归属的条目不动。
 * @returns 本次被置为终态的 checkpoint 数
 */
export function cancelSessionPdcaCheckpoints(sessionId: string): number {
  let updated = 0;
  for (const ck of listPdcaCheckpoints()) {
    const ckTaskId = ck.taskId;
    if (ck.sessionId !== sessionId || typeof ckTaskId !== 'string') continue;
    const phase = ck.phase;
    if (typeof phase === 'string' && PDCA_TERMINAL_PHASES.has(phase)) continue;
    writePdcaCheckpoint(ckTaskId, {
      taskId: ckTaskId,
      sessionId,
      phase: 'abort',
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelledReason: 'session-deleted',
    });
    // 同步 WorkItem 为失败终态（PDCA_TO_WORKITEM[abort] = failed），失败不阻塞
    try {
      syncPdcaWorkItemStatus(ckTaskId, 'abort');
    } catch {
      /* @ignore-catch — workItem 同步失败不阻塞会话删除 */
    }
    updated++;
  }
  if (updated > 0) {
    logger.info('会话删除联动：PDCA checkpoint 置 cancelled 终态', {
      sessionId,
      updated,
    });
  }
  return updated;
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

  const wiPath = join(WORKITEM_DIR, `${ck.workItemId}.json`);
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
