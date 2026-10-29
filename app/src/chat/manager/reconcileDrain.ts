// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * reconcileDrain — 「待对账会话」消费外移（issue #17 · D5，2026-10-29）
 *
 * 迁出来源：`ChatManager.runPendingReconciles` 的方法体（原 1491–1533，约 43 行）。
 *
 * 语义（与迁移前逐字一致）：
 * - 队列为空 ⇒ 直接返回；
 * - 队列**快照**后逐个 `reconcileSession`（只检测 + 告警 + 生成修复计划，不做自动修复）；
 * - 失败只 `handleError` 留痕（不中断其余会话）；
 * - TB-10：只删**已处理**项（不 `clear()`）——await 期间新入队的会话不得被静默丢弃。
 *
 * 队列本身由宿主持有（实例级），以端口传入。
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { ReconcileService } from '@modules/session';
import type { EventLogStorage, SessionGateway } from '@modules/session';

const logger = getLogger('chat:manager');

export interface ReconcileDrainPorts {
  /** 待对账会话（宿主实例字段；`_requestReconcile` 入队） */
  pendingReconcileSessions: Set<string>;
  getOrCreateEventLog: (sessionId: string) => EventLogStorage;
  sessionGateway: SessionGateway;
}

export async function runPendingReconciles(
  ports: ReconcileDrainPorts
): Promise<void> {
  if (ports.pendingReconcileSessions.size === 0) return;
  const service = new ReconcileService({
    getEventLog: (sid) => ports.getOrCreateEventLog(sid),
    getProjections: async (sid) => {
      const msgs = await ports.sessionGateway.getMessages(sid);
      return msgs.map((m) => ({
        id: m.id,
        role: m.role.toLowerCase(),
        content: typeof m.content === 'string' ? m.content : '',
        timestamp: m.timestamp,
        blocks: m.blocks as Array<Record<string, unknown>> | undefined,
        lastEventSeq: m.lastEventSeq,
      }));
    },
    getSessionMeta: async (sid) => {
      const session = await ports.sessionGateway.getSession(sid);
      return session?.metadata as Record<string, unknown> | undefined;
    },
  });
  const pending = [...ports.pendingReconcileSessions];
  for (const sid of pending) {
    try {
      const report = await service.reconcileSession(sid);
      if (!report.ok) {
        logger.warn('chat:manager 会话对账完成（有漂移）', {
          sessionId: sid,
          driftCount: report.drifts.length,
          repairPlan: report.repairPlan,
        });
      }
    } catch (e) {
      void handleError(e, {
        module: 'chat:manager',
        action: 'runPendingReconciles',
        context: { sessionId: sid },
      }).catch(() => {});
    }
  }
  // TB-10 修复（2026-09-23）：**只删已处理项**，不再 `clear()` ——
  // 上面的 await 循环期间可能又有新会话入队（同一次故障风暴），`clear()` 会把它们**静默丢弃**。
  for (const sid of pending) ports.pendingReconcileSessions.delete(sid);
}
