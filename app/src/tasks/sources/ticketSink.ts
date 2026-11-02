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

/** 读/写工作项（生产注入 `readPdcaWorkItem` / `writePdcaWorkItem`） */
export interface TicketSinkDeps {
  read: (workItemId: string) => Promise<Record<string, unknown> | null>;
  write: (record: Record<string, unknown>) => Promise<void>;
  /** 可注入时钟（测试用） */
  now?: () => number;
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
      await deps.write({
        id,
        title: ticketTitle(trigger),
        description: ticketDescription(trigger),
        // 由 Trigger 产生、尚未被执行侧领取（执行侧随后推进到 active/completed/failed）
        status: 'queued',
        sourceId: trigger.sourceId,
        origin: { threadId: trigger.threadKey },
        triggerId: trigger.triggerId,
        payload: trigger.payload,
        createdAt,
        updatedAt: new Date(now()).toISOString(),
        lastAction: 'trigger_received',
        ...(extra ?? {}),
      });
    }
  };
}
