/**
 * Trigger → Ticket 生产 sink（P35，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P35。
 *
 * 职责边界：
 * - **只负责创建** Ticket（`workitems` 行，`status='queued'`）；
 * - 幂等：Ticket id = `trigger:<triggerId>`；已存在 ⇒ **跳过**（执行侧可能已把它推进到
 *   `completed/failed`，不得写回 `queued`）；
 * - 不负责执行、不消费 Trigger 台账（幂等/位点/串行由 `SourceRegistry` 保证）。
 *
 * 分层：本文件属 `tasks`（app），只依赖注入的读写函数 ⇒ 可单测、不直接碰 DB。
 */
import type { ThreadKey, Trigger } from './types';

/** P35：Ticket 由谁执行（`external` = 来源自身已执行，如 cron；`ticket` = 交给消费者） */
export type TicketExecutionMode = 'ticket' | 'external';

/** 读/写工作项（生产注入 `readPdcaWorkItem` / `writePdcaWorkItem`） */
export interface TicketSinkDeps {
  read: (workItemId: string) => Promise<Record<string, unknown> | null>;
  write: (record: Record<string, unknown>) => Promise<void>;
  /** 可注入时钟（测试用） */
  now?: () => number;
  /** 执行归属（缺省 `external`；fs 等无外部执行器的来源传 `ticket`） */
  execution?: TicketExecutionMode | ((trigger: Trigger) => TicketExecutionMode);
  /**
   * P34 收尾：单个 Ticket 的预算上限（缺省 `{}` = 不设上限）。
   *
   * 在**建单时求值**（配置可热更新）；只写 `budget_max_*` 供面板/审计，不做闸门。
   */
  budget?: () => { maxTokens?: number; maxUsd?: number };
  /**
   * P33-a：按 Trigger 追加字段（如 `policyId` / `mandate`）。
   *
   * 返回 `undefined` ⇒ 不追加；追加字段参与同一次写入，避免"先建后补"的可见空窗。
   */
  annotate?: (trigger: Trigger) => Record<string, unknown> | undefined;
}

/** Trigger 对应的稳定 Ticket id（唯一组装点） */
export function triggerTicketId(triggerId: string): string {
  return `trigger:${triggerId}`;
}

/** 从 Trigger 载荷取展示标题（缺省退回来源名；不解释业务语义） */
function ticketTitle(trigger: Trigger): string {
  const name = trigger.payload.name;
  return typeof name === 'string' && name
    ? `${trigger.sourceId} · ${name}`
    : `Trigger · ${trigger.sourceId}`;
}

/** 从 Trigger 载荷取描述（只做截断，不做关键词判断） */
function ticketDescription(trigger: Trigger): string {
  const message = trigger.payload.message;
  if (typeof message === 'string') return message.slice(0, 2000);
  try {
    return JSON.stringify(trigger.payload).slice(0, 2000);
  } catch {
    return '';
  }
}

/**
 * 构造 `SourceRegistry.handleTriggers`：
 *
 * 同一批次内逐条创建；已存在则跳过（**create-if-absent**，不是 upsert）。
 * 失败向上抛 ⇒ 由 Registry 记录日志（不自动重投，台账保留）。
 */
export function createTriggerTicketSink(
  deps: TicketSinkDeps
): (threadKey: ThreadKey, triggers: readonly Trigger[]) => Promise<void> {
  const now = deps.now ?? Date.now;

  return async (_threadKey, triggers) => {
    for (const trigger of triggers) {
      const id = triggerTicketId(trigger.triggerId);
      const existing = await deps.read(id);
      if (existing) continue;

      const createdAt = new Date(trigger.receivedAt).toISOString();
      const extra = deps.annotate?.(trigger);
      const budget = deps.budget?.() ?? {};
      await deps.write({
        id,
        title: ticketTitle(trigger),
        description: ticketDescription(trigger),
        // 由 Trigger 产生、尚未被执行侧领取（执行侧随后推进到 active/completed/failed）
        status: 'queued',
        execution:
          typeof deps.execution === 'function'
            ? deps.execution(trigger)
            : (deps.execution ?? 'external'),
        sourceId: trigger.sourceId,
        origin: { threadId: trigger.threadKey },
        triggerId: trigger.triggerId,
        payload: trigger.payload,
        // P34：触发即"输入 + 订阅"（后续执行/唤醒按这两个事实回放上下文）
        inputs: [
          {
            kind: 'trigger',
            triggerId: trigger.triggerId,
            type: trigger.type,
            at: trigger.receivedAt,
            payload: trigger.payload,
          },
        ],
        subscriptions: [
          { source: trigger.sourceId, threadId: trigger.threadKey },
        ],
        // P34 收尾：预算上限随建单落列（缺省不写，保持"无上限"语义）
        ...(budget.maxTokens !== undefined
          ? { budgetMaxTokens: budget.maxTokens }
          : {}),
        ...(budget.maxUsd !== undefined ? { budgetMaxUsd: budget.maxUsd } : {}),
        createdAt,
        updatedAt: new Date(now()).toISOString(),
        lastAction: 'trigger_received',
        ...(extra ?? {}),
      });
    }
  };
}
