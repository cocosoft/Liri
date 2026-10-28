/**
 * approvalAuditSink — 审批四段事件的**落盘出口**（P5-1，2026-10-28）
 *
 * 为什么单独一个文件：`permission`（infra）不能静态依赖 `chat`（service，R00-001 上行依赖）。
 * 故由入口（`entrypoints/init.ts`）把本模块的 sink 注入给
 * `@modules/permission/approvalAudit`（与 2026-09-30 D-126 的 `PermissionRuntimeDeps`
 * 同一手法）。
 *
 * 落盘口径：写**会话事件日志**（`appendStreamEvent`，`seq: 0` ⇒ 由存储层原子分配），
 * 与 `session/title` / `agent/recovery` 同一条通道、同为 log-only（不进消息 surface）。
 *
 * 串行化：同一会话的四段必须**按序**落盘，故按 `sessionId` 串一条 Promise 链
 * （`appendStreamEvent` 内部虽有 mutex，但两次并发调用的先后由调用顺序决定，
 * 不保证与 emit 顺序一致）。
 */

import { getLogger } from '@modules/monitoring';
import type { LiriEvent } from '@modules/session/types/events';
import type {
  ApprovalAuditEvent,
  ApprovalAuditSink,
} from '@modules/permission';

const logger = getLogger('runtime:approvalAuditSink');

/** 每会话一条串行链（值 = 链尾 Promise；失败已就地吞掉，不会污染后续） */
const sessionQueues = new Map<string, Promise<void>>();

/** 审批段事件 → 会话事件（payload 逐字段镜像 `eventPayloads.ts` 的 `approval/*`） */
export function toSessionEvent(
  sessionId: string,
  event: ApprovalAuditEvent
): LiriEvent {
  const base = {
    seq: 0,
    time: Date.now(),
    sessionId,
    schemaVersion: 1 as const,
  };
  switch (event.stage) {
    case 'requested':
      return {
        ...base,
        type: 'approval/requested',
        data: {
          approvalId: event.approvalId,
          toolName: event.toolName,
          risk: event.risk,
          ...(event.inputPreview !== undefined
            ? { inputPreview: event.inputPreview }
            : {}),
          ...(event.executionId !== undefined
            ? { executionId: event.executionId }
            : {}),
        },
      };
    case 'presented':
      return {
        ...base,
        type: 'approval/presented',
        data: {
          approvalId: event.approvalId,
          toolName: event.toolName,
          risk: event.risk,
          options: event.options,
          ...(event.fingerprintHash !== undefined
            ? { fingerprintHash: event.fingerprintHash }
            : {}),
          ...(event.inboxItemId !== undefined
            ? { inboxItemId: event.inboxItemId }
            : {}),
        },
      };
    case 'decided':
      return {
        ...base,
        type: 'approval/decided',
        data: {
          approvalId: event.approvalId,
          decision: event.decision,
          by: event.by,
          ...(event.reply !== undefined ? { reply: event.reply } : {}),
        },
      };
    case 'recorded':
      return {
        ...base,
        type: 'approval/recorded',
        data: {
          approvalId: event.approvalId,
          decision: event.decision,
          ...(event.commandHash !== undefined
            ? { commandHash: event.commandHash }
            : {}),
          scopeKind: event.scopeKind,
        },
      };
  }
}

async function appendOne(
  sessionId: string,
  event: ApprovalAuditEvent
): Promise<void> {
  const { getCoreAPI } = await import('./CoreAPIImpl.js');
  const chatManager = getCoreAPI().chatManager;
  if (!chatManager || typeof chatManager.appendStreamEvent !== 'function') {
    return;
  }
  const result = await chatManager.appendStreamEvent(
    sessionId,
    toSessionEvent(sessionId, event)
  );
  if (!result?.ok) {
    logger.warn('审批四段事件落盘被拒（不影响审批主流程）', {
      sessionId,
      stage: event.stage,
      approvalId: event.approvalId,
      reason: result?.reason,
    });
  }
}

/** 按会话串行入队（不抛错；失败只留痕） */
function enqueue(sessionId: string, event: ApprovalAuditEvent): void {
  const prev = sessionQueues.get(sessionId) ?? Promise.resolve();
  const next = prev
    .then(() => appendOne(sessionId, event))
    .catch((e) => {
      logger.warn('审批四段事件写入异常（不影响审批主流程）', {
        sessionId,
        stage: event.stage,
        approvalId: event.approvalId,
        error: e instanceof Error ? e.message : String(e),
      });
    })
    .finally(() => {
      // 链尾回收：避免会话结束后 Map 持有已 settled 的 Promise
      if (sessionQueues.get(sessionId) === next) {
        sessionQueues.delete(sessionId);
      }
    });
  sessionQueues.set(sessionId, next);
}

/**
 * 安装 sink（幂等；入口启动时调用一次）。
 *
 * 返回 Promise 仅为与入口其余异步注入保持一致的调用形态（内部装配本身是同步的）。
 */
export async function installApprovalAuditSink(): Promise<void> {
  const { setApprovalAuditSink } = await import('@modules/permission');
  const sink: ApprovalAuditSink = (sessionId, event) => {
    enqueue(sessionId, event);
  };
  setApprovalAuditSink(sink);
}
