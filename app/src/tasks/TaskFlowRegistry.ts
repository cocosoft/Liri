/**
 * TaskFlowRegistry - 流程图级别编排器
 *
 * 职责：
 * 1. 流程图管理：注册、更新、删除 DAG 流程图
 * 2. 状态管理：维护流程状态（queued → running → completed/failed）
 * 3. 步骤协调：管理 currentStep、blockedTaskId、waitJson
 * 4. SQLite 持久化：通过 SqliteTaskStore 保存/加载流程记录
 *
 * 与 TaskOrchestrator 的区别：
 * - TaskOrchestrator → Plan 级别编排（步骤顺序、状态管理、进度追踪）
 *   适用场景：一次性多步骤工作流
 * - TaskFlowRegistry → 流程图级别编排（DAG、条件分支、并行、等待）
 *   适用场景：复杂流程图执行
 */

import { getLogger } from '@modules/monitoring';
import { TaskFlowStatus } from './types';
import type { TaskFlowRecord, TaskFlowSyncMode } from './types';
import type { SqliteTaskStore } from './db/SqliteTaskStore';

const logger = getLogger('tasks:flowRegistry');

export class TaskFlowRegistry {
  private flows: Map<string, TaskFlowRecord> = new Map();
  private store: SqliteTaskStore | null;

  constructor(store?: SqliteTaskStore | null) {
    this.store = store ?? null;
  }

  /** 从 SQLite 加载所有流记录到内存 */
  async loadFromStore(): Promise<void> {
    if (!this.store) return;
    try {
      const records = await this.store.loadTaskFlowRecords();
      for (const record of records) {
        this.flows.set(record.flowId, record);
      }
      logger.info('[TaskFlow] 从 SQLite 加载流', { count: records.length });
    } catch (error) {
      logger.warning('[TaskFlow] 从 SQLite 加载失败', { error });
    }
  }

  register(record: TaskFlowRecord): void {
    this.flows.set(record.flowId, { ...record });
    logger.info('[TaskFlow] 注册流', {
      flowId: record.flowId,
      status: record.status,
    });
    this.persist(record).catch((err) =>
      logger.warning('[TaskFlow] 持久化失败', {
        flowId: record.flowId,
        error: err,
      })
    );
  }

  getFlow(flowId: string): TaskFlowRecord | undefined {
    return this.flows.get(flowId);
  }

  getAllFlows(): TaskFlowRecord[] {
    return Array.from(this.flows.values());
  }

  getFlowsByOwner(ownerKey: string): TaskFlowRecord[] {
    return this.getAllFlows().filter((f) => f.ownerKey === ownerKey);
  }

  getFlowsByStatus(status: TaskFlowStatus): TaskFlowRecord[] {
    return this.getAllFlows().filter((f) => f.status === status);
  }

  getFlowsBySyncMode(mode: TaskFlowSyncMode): TaskFlowRecord[] {
    return this.getAllFlows().filter((f) => f.syncMode === mode);
  }

  updateStatus(flowId: string, status: TaskFlowStatus): boolean {
    const flow = this.flows.get(flowId);
    if (!flow) return false;
    flow.status = status;
    this.persist(flow).catch((err) =>
      logger.warning('[TaskFlow] updateStatus 持久化失败', {
        flowId,
        error: err,
      })
    );
    return true;
  }

  updateStep(flowId: string, stepId: string): boolean {
    const flow = this.flows.get(flowId);
    if (!flow) return false;
    flow.currentStep = stepId;
    this.persist(flow).catch((err) =>
      logger.warning('[TaskFlow] updateStep 持久化失败', { flowId, error: err })
    );
    return true;
  }

  setBlocked(flowId: string, taskId: string): boolean {
    const flow = this.flows.get(flowId);
    if (!flow) return false;
    flow.status = TaskFlowStatus.BLOCKED;
    flow.blockedTaskId = taskId;
    this.persist(flow).catch((err) =>
      logger.warning('[TaskFlow] setBlocked 持久化失败', { flowId, error: err })
    );
    return true;
  }

  unblock(flowId: string): boolean {
    const flow = this.flows.get(flowId);
    if (!flow) return false;
    flow.status = TaskFlowStatus.RUNNING;
    flow.blockedTaskId = undefined;
    this.persist(flow).catch((err) =>
      logger.warning('[TaskFlow] unblock 持久化失败', { flowId, error: err })
    );
    return true;
  }

  remove(flowId: string): boolean {
    const removed = this.flows.delete(flowId);
    if (removed && this.store) {
      this.store
        .deleteTaskFlowRecord(flowId)
        .catch((err) =>
          logger.warning('[TaskFlow] remove 持久化失败', { flowId, error: err })
        );
    }
    return removed;
  }

  getFlowCount(): number {
    return this.flows.size;
  }

  getStats(): { total: number; byStatus: Record<string, number> } {
    const byStatus: Record<string, number> = {};
    for (const flow of this.flows.values()) {
      const key = String(flow.status);
      byStatus[key] = (byStatus[key] || 0) + 1;
    }
    return { total: this.flows.size, byStatus };
  }

  /** 持久化单条流记录到 SQLite */
  private async persist(record: TaskFlowRecord): Promise<void> {
    if (!this.store) return;
    await this.store.saveTaskFlowRecord(record);
  }

  // ─── Owner Access Control ──────────────────────────

  /**
   * 按 flowId + 调用方 ownerKey 获取流记录。
   * 如果调用方不是该 flow 的 owner，返回 undefined。
   */
  getFlowByIdForOwner(
    flowId: string,
    callerOwnerKey: string
  ): TaskFlowRecord | undefined {
    const flow = this.flows.get(flowId);
    if (!flow) return undefined;
    if (flow.ownerKey !== callerOwnerKey) return undefined;
    return flow;
  }

  /**
   * 检查调用方是否有权限操作指定流。
   * 返回 { ok: true, flow } 或 { ok: false }。
   */
  ensureOwnerAccess(
    flowId: string,
    callerOwnerKey: string
  ): { ok: true; flow: TaskFlowRecord } | { ok: false } {
    const flow = this.getFlowByIdForOwner(flowId, callerOwnerKey);
    if (!flow) return { ok: false };
    return { ok: true, flow };
  }
}

export const taskFlowRegistry = new TaskFlowRegistry();
