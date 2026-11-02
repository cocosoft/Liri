/**
 * 驾驶舱端口实现（P39-b-2，2026-11-02）
 *
 * 为什么单列：`domainSnapshotOps.ts` 已 1983 行（R04-001 上限 2000）⇒ 新端口实现独立成文件，
 * 由 `getTaskOpsPort()` 以对象展开合并。
 *
 * 分层（R00-001）：本文件属 service 层（`runtime/api`），与其它端口实现一致，
 * 用**动态 import** 取用 app 侧纯聚合（`@modules/tasks/cockpit`），不写静态跨层依赖。
 */
import type {
  CockpitHistoryDto,
  CockpitSnapshotDto,
  CockpitTakeoverCandidateDto,
} from './taskOpsPorts';
import { getExecutionStore } from '@openliri/service/execution';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('runtime:cockpit');

/** 驾驶舱端口（并入 `TaskOpsPort`） */
export interface CockpitOpsPort {
  getCockpitSnapshot(): Promise<CockpitSnapshotDto>;
  getCockpitHistory(workItemId: string): Promise<CockpitHistoryDto | null>;
  getCockpitTakeoverCandidate(
    workItemId: string
  ): Promise<CockpitTakeoverCandidateDto>;
}

/** 构造端口实现（无状态；app 侧单例由 `@modules/tasks` 自身持有） */
export function createCockpitOps(): CockpitOpsPort {
  const tasksModule = async () => import('@modules/tasks');

  const findWorkItem = async (
    workItemId: string
  ): Promise<Record<string, unknown> | null> => {
    const tasks = await tasksModule();
    const rows = await tasks.listPdcaWorkItems();
    return rows.find((row) => String(row.id ?? '') === workItemId) ?? null;
  };

  return {
    async getCockpitSnapshot(): Promise<CockpitSnapshotDto> {
      const tasks = await tasksModule();
      const items = await tasks.loadCockpitItems({
        listWorkItems: () => tasks.listPdcaWorkItems(),
        listAssignments: (id) => tasks.listTicketAssignments(id),
        isEndedStatus: (status) => tasks.PDCA_TERMINAL_STATUSES.has(status),
      });

      // P37（2026-11-02）：面板四条件 —— 只有「未解决 + 仍是最新 + 未 dismiss +
      // Thread 不在排队/评估中」的工作项才进入 `person:answer`。
      // busy = 最新派工处于 pending/running（排队或执行中，不打断人）。
      const busyTicketIds = items
        .filter((item) => {
          const state = item.facts.latestAssignment?.state;
          return state ? tasks.isActiveAssignmentState(state) : false;
        })
        .map((item) => item.id);
      let actionable = new Set<string>();
      try {
        const { inboxManager } = await import('../InboxManager.js');
        actionable = new Set(
          await inboxManager.listActionableTicketIds(busyTicketIds)
        );
      } catch (error) {
        // 观测面失败 ⇒ 按"无待答提示"降级，不影响其余分组
        logger.warn('驾驶舱读取 Inbox attention 失败（按无提示处理）', {
          error: String(error),
        });
      }

      const snapshot = tasks.buildCockpitSnapshot(
        tasks.markActionableAttention(items, actionable),
        Date.now()
      );
      const effects = tasks.toEffectCountsSummary(
        await tasks.getEffectCounts()
      );
      return {
        generatedAt: snapshot.generatedAt,
        groups: snapshot.groups.map((group) => ({
          key: group.key,
          label: group.label,
          items: group.items.map((item) => ({ ...item })),
        })),
        metrics: { ...snapshot.metrics },
        effects,
      };
    },

    async getCockpitHistory(
      workItemId: string
    ): Promise<CockpitHistoryDto | null> {
      const row = await findWorkItem(workItemId);
      if (!row) return null;

      const tasks = await tasksModule();
      const [assignments, executions] = await Promise.all([
        tasks.listTicketAssignments(workItemId),
        getExecutionStore().listByWorkItem(workItemId),
      ]);

      const workItem = {
        id: workItemId,
        ...(typeof row.title === 'string' ? { title: row.title } : {}),
        status: String(row.status ?? ''),
        ...(typeof row.updatedAt === 'number'
          ? { updatedAt: row.updatedAt }
          : {}),
        ...(typeof row.workspaceDir === 'string'
          ? { workspaceDir: row.workspaceDir }
          : {}),
        ...(typeof row.sessionId === 'string'
          ? { sessionId: row.sessionId }
          : {}),
      };

      const history = tasks.buildCockpitHistory({
        workItem,
        assignments,
        executions: executions.map((execution) => ({
          executionId: String(execution.executionId),
          status: String(execution.status),
          startedAt: execution.startedAt,
          ...(execution.updatedAt ? { updatedAt: execution.updatedAt } : {}),
          ...(execution.sessionId ? { sessionId: execution.sessionId } : {}),
          ...(execution.workspaceDir
            ? { workspaceDir: execution.workspaceDir }
            : {}),
        })),
      });

      return {
        workItem: { ...history.workItem },
        assignments: history.assignments.map((a) => ({ ...a })),
        executions: history.executions.map((e) => ({ ...e })),
      };
    },

    async getCockpitTakeoverCandidate(
      workItemId: string
    ): Promise<CockpitTakeoverCandidateDto> {
      const row = await findWorkItem(workItemId);
      if (!row) return { itemFound: false };

      const tasks = await tasksModule();
      const assignments = await tasks.listTicketAssignments(workItemId);
      const sessionId = tasks.pickTakeoverSessionId({
        latestAssignmentSessionId: assignments.at(-1)?.sessionId,
        workItemSessionId:
          typeof row.sessionId === 'string' ? row.sessionId : undefined,
      });

      return {
        itemFound: true,
        ...(sessionId ? { sessionId } : {}),
      };
    },
  };
}
