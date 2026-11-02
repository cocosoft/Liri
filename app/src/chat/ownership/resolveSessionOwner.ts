/**
 * 会话持有者读侧投影（P36-b，2026-11-02）
 *
 * 方案：`dev_docs/20261102/消息归属与交还方案-20261102.md` §4。
 *
 * 事实来源 = `ticket_assignments`（P34）：该 session 上**最新一条 `state='running'`
 * 的派工**即当前持有者；其 `work_item_id` 即 `ownerTicketId`。
 *
 * 为什么读派工表而不是新增 `owner_ticket_id` 列：
 * - 派工本身已有 `session_id / executor / state`，再存一份 owner 必然双写漂移（CS01）；
 * - 交还 = 派工写 `ended`（`AlwaysOnBridge.report` 已如此）⇒ 读侧立即看到 `none`，
 *   天然满足"只交还一次"的幂等。
 */
import { getLogger } from '@openliri/infra/monitoring';
import {
  ASSIGNMENT_STATE_RUNNING,
  listTicketAssignmentsBySession,
} from '@modules/tasks';
import type { SessionOwner } from '@openliri/service/execution';

const logger = getLogger('chat:ownership');

export type { SessionOwner };

/** 判断持有者类别时依赖的最小派工面（测试可注入） */
export interface AssignmentLike {
  executor: string;
  state: string;
  workItemId: string;
  /** P34：派工 id（产物绑定用；缺省 ⇒ 产物只绑工作项） */
  assignmentId?: string;
}

/** 派工读取器（缺省走真实存储；测试注入假实现） */
export type AssignmentLoader = (
  sessionId: string
) => Promise<readonly AssignmentLike[]>;

const defaultLoader: AssignmentLoader = async (sessionId) =>
  listTicketAssignmentsBySession(sessionId);

/**
 * 解析会话的持有者（**只读**、无副作用）。
 *
 * - 无 `running` 派工 ⇒ `none`（普通对话 / 已交还）；
 * - `executor === 'manual'` ⇒ `manual`；其余（alwayson / cron / pdl …）⇒ `autonomous`；
 * - 读失败 ⇒ `none` 并留痕：租约语义仍由 `ExecutionManager` 保证（不会两个 RUNNING），
 *   本投影只用于**策略与审计**，故不把读失败升级为消息失败。
 */
export async function resolveSessionOwner(
  sessionId: string,
  load: AssignmentLoader = defaultLoader
): Promise<SessionOwner> {
  // 返回类型与 service 侧 `SessionOwner` 同源（宿主把它注入为 `setSessionOwnerLoader`）
  if (!sessionId) return { kind: 'none' };
  let rows: readonly AssignmentLike[];
  try {
    rows = await load(sessionId);
  } catch (err) {
    logger.warn('读取派工表失败（按无人持有处理，仅影响归属审计）', {
      sessionId,
      error: String(err),
    });
    return { kind: 'none' };
  }

  // 时间正序 ⇒ 从后往前找最新一条 running（避免"最新一条已 ended、更早的仍在跑"的误判）
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.state !== ASSIGNMENT_STATE_RUNNING) continue;
    return {
      kind: row.executor === 'manual' ? 'manual' : 'autonomous',
      ...(row.workItemId ? { ticketId: row.workItemId } : {}),
      ...(row.assignmentId ? { assignmentId: row.assignmentId } : {}),
    };
  }
  return { kind: 'none' };
}
