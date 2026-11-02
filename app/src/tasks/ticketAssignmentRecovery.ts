/**
 * 启动期收尾（P36-b，2026-11-02）
 *
 * 方案：`dev_docs/20261102/消息归属与交还方案-20261102.md` §7「重启恢复」。
 *
 * 要治的病：进程崩溃时 `AlwaysOnBridge.report` 不会执行 ⇒ `ticket_assignments` 里留下
 * `state='running'` 的派工；而 ownership 读侧（`resolveSessionOwner`）以"最新 running 派工"
 * 判定持有者 ⇒ 重启后该会话被**永久**判为自主持有（`MESSAGE_OWNERSHIP` 开启时消息只会排队、
 * 30s 后 `SESSION_BUSY`，永远拿不到所有权）。
 *
 * 为什么放在宿主装配期（而不是读侧兜底）：单进程 + SQLite 是既有上限（方案 §9.1）⇒ 装配瞬间
 * 不可能有本进程的执行在跑，所有 `running` 行必属上一进程；读侧隐式改写会让"谁持有什么时候变"
 * 变得不可预测（CS03：不做没有真实场景的兜底）。
 *
 * 调用点：`chat/manager/hostWiring.ts` 注入持有者读取端口之后（同一次装配，先清理再读）。
 * 失败只留痕、不阻断启动（最坏情况与修复前相同：读侧继续误判，由下一轮 report 兜底）。
 */
import { getLogger } from '@openliri/infra/monitoring';

import { closeOrphanRunningAssignments } from './ticketAssignmentStore';

const logger = getLogger('tasks:ticket-assignment-recovery');

/**
 * 收尾上一进程遗留的 `running` 派工（幂等；正常关机的常态是 0 行）。
 *
 * @returns 本次收尾的行数
 */
export async function sweepOrphanAssignments(): Promise<number> {
  try {
    const closed = await closeOrphanRunningAssignments();
    if (closed > 0) {
      logger.warn('启动期收尾遗留派工（上次进程未交还）', {
        closed,
        reportState: 'dropped',
      });
    }
    return closed;
  } catch (error) {
    // @ignore-catch — 收尾失败不阻断启动（与修复前行为一致，不把观测面失败升级为启动失败）
    logger.warn('启动期派工收尾失败（不阻断启动）', {
      error: String(error),
    });
    return 0;
  }
}
