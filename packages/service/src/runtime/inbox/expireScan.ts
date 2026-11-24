/**
 * 审批过期扫描（2026-11-24 从 `InboxManager._expireOnDb` 逐字外迁，FSZ-006 拆分步骤 ②）
 *
 * 行为零变更：判据（工具审批 30min / 工作区申请 24h / processing 10min 兜底）、审计落点、
 * 按行归属身份投递、卡片块回填、关联表清理，全部逐字保留。
 *
 * 端口注入：宿主给 `syncBlockStatuses`（会话卡片回填依赖 SessionGateway，属宿主私有能力），
 * 其余（行映射 / 终态监听 / 状态审计 / 策略常量）走同目录模块的单一实现。
 */

import { getLogger } from '@openliri/infra/monitoring';
import type { Database } from '@openliri/infra/external';
import {
  principalFromKey,
  runWithPrincipal,
} from '@openliri/kernel/identity/requestScope.js';
import { broadcastEvent } from '@modules/infrastructure/http/handlers/handler-utils';
import type { InboxItem, InboxItemStatus } from '../InboxManager.js';
import { mapInboxRow } from './rowMapper.js';
import { notifyInboxTerminal } from './terminalListeners.js';
import { auditInboxStatusChange } from './stateAudit.js';
import {
  PROCESSING_STALE_TIMEOUT_MS,
  WORKSPACE_SCOPE_PREDICATE,
} from './expirePolicy.js';

const logger = getLogger('runtime:inbox');

/** 宿主端口：把终态写回会话卡片块（实现留在宿主；失败只留痕，不影响过期主流程） */
export interface ExpireScanPorts {
  syncBlockStatuses(
    sessionId: string,
    updates: ReadonlyArray<{ inboxId: string; status: InboxItemStatus }>
  ): Promise<void>;
}

/** 过期清理的单一实现（连接由调用方给，避免再走 `getDb()` 的当前身份语义） */
export async function expireOnDb(
  db: Database,
  maxAgeMs: number,
  workspaceMaxAgeMs: number | undefined,
  ports: ExpireScanPorts
): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  // 工作区访问申请用**独立**（更长）的 TTL；未显式给出时与工具审批同口径（向后兼容）。
  const workspaceCutoff = Date.now() - (workspaceMaxAgeMs ?? maxAgeMs);
  // 两种 TTL 合成一条 WHERE：工作区申请看 workspaceCutoff，其余看 cutoff。
  // 2026-11-24（批次 1 / A1）：额外覆盖"抢锁后卡死"的 `processing`（按 updated_at 判龄），
  // 否则 `reply` 写失败/进程中断留下的卡既不可回复也不会被回收。
  const processingCutoff = Date.now() - PROCESSING_STALE_TIMEOUT_MS;
  const expireWhere = `(
        (status = 'pending' AND (
          (${WORKSPACE_SCOPE_PREDICATE} AND created_at < ?)
          OR (NOT (${WORKSPACE_SCOPE_PREDICATE}) AND created_at < ?)
        ))
        OR (status = 'processing' AND updated_at < ?)
      )`;
  const expireParams = [workspaceCutoff, cutoff, processingCutoff];

  // 先查询将要过期的项（获取 channelSessionId 用于通知）+ 归属键（用于事件投递身份）
  const expired = await new Promise<
    Array<{ item: InboxItem; ownerKey?: string }>
  >((resolve, reject) => {
    db.all(
      `SELECT * FROM inbox_items WHERE ${expireWhere}`,
      expireParams,
      (err: Error | null, rows: Record<string, unknown>[]) => {
        if (err) reject(err);
        else
          resolve(
            (rows ?? []).map((r) => ({
              item: mapInboxRow(r),
              ownerKey:
                typeof r.owner_key === 'string' ? r.owner_key : undefined,
            }))
          );
      }
    );
  });

  const count = await new Promise<number>((resolve, reject) => {
    db.run(
      `UPDATE inbox_items SET status = 'expired', updated_at = ?
          WHERE ${expireWhere}`,
      [Date.now(), ...expireParams],
      function (this: { changes: number }, err: Error | null) {
        if (err) reject(err);
        else {
          if (this.changes > 0)
            logger.info('Expired inbox items', {
              count: this.changes,
              ttlMs: maxAgeMs,
              workspaceTtlMs: workspaceMaxAgeMs ?? maxAgeMs,
            });
          resolve(this.changes);
        }
      }
    );
  });

  // 通知渠道：已过期的审批项（按行归属身份投递，租户库下不会串到别人）
  for (const { item, ownerKey } of expired) {
    // P2-1（R09-013）：批量过期按条落审计 —— 仅当**选中行数与生效行数一致**才逐条落，
    // 否则无法确定哪几行真的过期（并发改态）⇒ 不猜，只留痕（CS06）。
    if (count === expired.length) {
      auditInboxStatusChange(
        item.sessionId,
        item.id,
        item.status,
        'expired',
        'inbox_expired_ttl'
      );
    } else if (count > 0) {
      logger.warn('审批 TTL 过期存在并发变更，跳过本条转移审计', {
        selected: expired.length,
        changed: count,
      });
    }
    const emit = async (): Promise<void> => {
      // SSE 推送过期状态到前端
      void broadcastEvent('inbox:update', {
        id: item.id,
        status: 'expired',
        sessionId: item.sessionId,
      });

      if (item.channelSessionId) {
        try {
          const { notifyExpired } =
            await import('@modules/channels/bridge/inboxChannelReply.js');
          await notifyExpired(item);
        } catch (err) {
          logger.warn('Expired notification failed', {
            inboxId: item.id,
            channelSessionId: item.channelSessionId,
            error: String(err),
          });
        }
      }
    };

    const principal = ownerKey ? principalFromKey(ownerKey) : null;
    if (principal) await runWithPrincipal(principal, emit);
    else await emit();

    // 2026-11-07：旁路监听（入口层据此收口 PDCA 等依赖"卡可回复"的状态机）
    notifyInboxTerminal(item);
  }

  // P3-1（2026-11-06）：把 expired 写回会话卡片块（全历史可追溯）。
  // 按「归属身份 + 会话」归组：同一会话只读一次消息，避免逐条回填放大 I/O。
  const expiredGroups = new Map<
    string,
    { ownerKey?: string; sessionId: string; inboxIds: string[] }
  >();
  for (const { item, ownerKey } of expired) {
    if (!item.sessionId) continue;
    const key = `${ownerKey ?? ''}|${item.sessionId}`;
    const group = expiredGroups.get(key) ?? {
      ownerKey,
      sessionId: item.sessionId,
      inboxIds: [],
    };
    group.inboxIds.push(item.id);
    expiredGroups.set(key, group);
  }
  for (const group of expiredGroups.values()) {
    const sync = (): Promise<void> =>
      ports.syncBlockStatuses(
        group.sessionId,
        group.inboxIds.map((inboxId) => ({ inboxId, status: 'expired' }))
      );
    const principal = group.ownerKey
      ? principalFromKey(group.ownerKey)
      : null;
    if (principal) await runWithPrincipal(principal, sync);
    else await sync();
  }

  // 清理已过期项的关联记录
  try {
    await new Promise<void>((resolve, reject) => {
      db.run(
        `DELETE FROM session_inbox_map WHERE inbox_item_id IN (SELECT id FROM inbox_items WHERE status = 'expired')`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  } catch (err) {
    logger.warn('session_inbox_map cleanup failed', { error: String(err) });
  }

  return count;
}
