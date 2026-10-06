/**
 * lro/portResolvers.ts — 长程任务编排的惰性端口解析器与阈值
 *
 * 由 `tasks/LongRunningTaskOrchestrator.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §45）：**只搬不改**（含全部原注释）。
 * 依赖方向：本模块**零依赖宿主** ⇒ 无循环；logger/handleError 的 module 名沿用
 * `tasks:longRunning` ⇒ 日志与错误留痕不变。
 */

import { configManager } from '@modules/config';
import { resolveDbPath } from '@modules/core/paths';
import { handleError } from '@modules/error';

/**
 * 1-3（2026-09-03）：task_audit_log 写入面（复用 SqliteTaskStore.writeAuditLog，TaskRegistry 同模式）
 *
 * ⚠️ 命名（2026-10-06，spec §45）：原名 `AuditLogEntry`，但该名在
 * `knowledge/KnowledgeAuditLogger.ts` 与
 * `security/permission/logging/PermissionAuditLogger.ts` 已有同名**导出**接口 ⇒
 * 导出后触发门禁 **R02-002**（同一名在 ≥3 模块定义）。本处属**任务生命周期审计**语义、
 * 与上述两者无契约关系 ⇒ 改名为 `TaskAuditLogEntry` 消歧（**不**合并，避免错误统一）。
 */
export interface TaskAuditLogEntry {
  taskId: string;
  eventType: string;
  oldStatus: string | null;
  newStatus: string;
  timestamp: number;
}

export type AuditStoreLike = {
  writeAuditLog(entry: TaskAuditLogEntry): Promise<void>;
};

/**
 * 1-3（2026-09-03）：审计存储惰性单例（动态加载避免启动期循环依赖）。
 * 复用 SqliteTaskStore 与 goalMetricsService 同款独立实例模式，不侵入 TaskRegistry。
 * 注：曾用"每次短连接"（开→写→关），但每 lifecycle 事件都全量建表 DDL 开销过大，
 * 改回单例长连接；Windows 测试清理 EBUSY 由测试 afterEach 容错处理。
 */
let _auditStorePromise: Promise<AuditStoreLike | null> | null = null;
export async function resolveAuditStore(): Promise<AuditStoreLike | null> {
  _auditStorePromise ??= (async () => {
    try {
      const { createSqliteTaskStore } =
        await import('../db/SqliteTaskStore.js');
      const store = createSqliteTaskStore(resolveDbPath());
      await store.init();
      return store;
    } catch (err) {
      await handleError(err, {
        module: 'tasks:longRunning',
        action: 'resolveAuditStore',
      });
      return null;
    }
  })();
  return _auditStorePromise;
}

/** 记忆写回的最小接口（评审 1 修复：复用共享 manager，避免多实例索引竞态） */
export interface MemoryWritebackManager {
  createMemory(args: { content: string; metadata: unknown }): Promise<unknown>;
}

/**
 * 3-1 加固（评审 1，2026-09-03）：记忆写回 manager 惰性单例。
 * 原实现每次 PDCA 终态 new MemoryManagerImpl()——多实例各自持 store/retriever 检索索引与
 * 关系图，异步加载下 saveIndex/saveRelationGraph 整体覆写可能互相覆盖；且每次构造触发全量
 * refreshSummaryCache 扫描。改为共享单例（T-①07 T1-5 起统一走 `@modules/memory`
 * `getMemoryManager()` 进程内共享工厂）。
 */
let _memoryWritebackManager: MemoryWritebackManager | null = null;
export async function resolveMemoryWritebackManager(): Promise<MemoryWritebackManager | null> {
  if (!_memoryWritebackManager) {
    try {
      const { getMemoryManager } = await import('@modules/memory');
      _memoryWritebackManager = getMemoryManager();
    } catch (err) {
      await handleError(err, {
        module: 'tasks:longRunning',
        action: 'resolveMemoryWriteback',
      });
    }
  }
  return _memoryWritebackManager;
}

/**
 * PR5（#6/决策 7）：replan 连续失败收敛阈值——达上限终态 failed 转人工介入。
 * env `PDCA_REPLAN_MAX_RETRIES` 可调（默认 3）。
 */
export function replanMaxRetries(): number {
  const v = Number(configManager.env('PDCA_REPLAN_MAX_RETRIES'));
  return Number.isFinite(v) && v > 0 ? v : 3;
}
