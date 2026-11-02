/**
 * 消息归属判定（P36-b，2026-11-02）
 *
 * 方案：`dev_docs/20261102/消息归属与交还方案-20261102.md` §3/§4。
 *
 * 定位：**不是**新的所有权机制 —— `ExecutionManager.acquire()` 已保证同一 session
 * 最多一个 `RUNNING`（并发者 `QUEUED`）。本模块只回答"人发的消息在会话被持有时如何处置"，
 * 并把判定收敛成一个纯函数 + 闭集理由。
 *
 * 用户裁定（2026-11-02）：自主执行持有会话时，普通消息走 `queue`（不顶替执行器）；
 * "停止"复用既有控制面入口（`abortSessionStream`），**不**给消息加 intent 字段。
 *
 * 归属是**派生视图**：不新增状态词、不写状态位。
 *
 * 分层：本模块在 service 层（纯函数 + 事件发射），**不 import app**；
 * "谁是持有者"由宿主经 `setSessionOwnerLoader` 注入（与 `setExecutionEventSink` 同法）。
 */
import { emitExecutionEvent } from './eventSink';

/** 会话当前的持有者类别（由宿主 loader 从 `ticket_assignments` 派生） */
export type SessionOwnerKind = 'none' | 'autonomous' | 'manual';

/** 主循环对一条人工消息可采取的动作（当前策略只有两种） */
export type MainLoopAction = 'accept' | 'queue';

/** 判定理由（闭集；禁止自由文本判定，CS02） */
export type OwnershipReason =
  | 'session_free'
  | 'owner_autonomous'
  | 'owner_manual'
  | 'occupied_unknown';

/** 会话持有者（`ticketId` 仅在自主持有时有值） */
export interface SessionOwner {
  kind: SessionOwnerKind;
  ticketId?: string;
}

/** 宿主注入的持有者读取器（缺省/未注入 ⇒ 一律 `none`，行为等于改造前） */
export type SessionOwnerLoader = (sessionId: string) => Promise<SessionOwner>;

let ownerLoader: SessionOwnerLoader | null = null;

/** 注入持有者读取器（启动期一次；传 `null` 解除，测试用） */
export function setSessionOwnerLoader(loader: SessionOwnerLoader | null): void {
  ownerLoader = loader;
}

/**
 * 读会话持有者（只读投影）。
 *
 * 未注入 / 读取失败 ⇒ `{ kind: 'none' }`（如实"不可归属"，不猜；租约语义仍由
 * `ExecutionManager` 保证，不会出现两个 RUNNING）。
 */
export async function getSessionOwner(
  sessionId: string
): Promise<SessionOwner> {
  if (!sessionId || !ownerLoader) return { kind: 'none' };
  try {
    return await ownerLoader(sessionId);
  } catch {
    return { kind: 'none' };
  }
}

export interface OwnershipInput {
  /** 会话是否被占用（`ExecutionManager` 领取失败 = 被占） */
  occupied: boolean;
  /** 占用者类别（`occupied=false` 时忽略） */
  ownerKind: SessionOwnerKind;
}

export interface OwnershipDecision {
  action: MainLoopAction;
  reason: OwnershipReason;
}

/**
 * 判定（**纯函数**、唯一实现）。
 *
 * | occupied | ownerKind  | action | reason |
 * |----------|------------|--------|--------|
 * | false    | *          | accept | session_free |
 * | true     | autonomous | queue  | owner_autonomous |
 * | true     | manual     | queue  | owner_manual |
 * | true     | none       | queue  | occupied_unknown（外部/前进程执行，不可归属） |
 */
export function resolveMessageOwnership(
  input: OwnershipInput
): OwnershipDecision {
  if (!input.occupied) return { action: 'accept', reason: 'session_free' };
  if (input.ownerKind === 'autonomous') {
    return { action: 'queue', reason: 'owner_autonomous' };
  }
  if (input.ownerKind === 'manual') {
    return { action: 'queue', reason: 'owner_manual' };
  }
  return { action: 'queue', reason: 'occupied_unknown' };
}

export interface OwnershipEventInput {
  sessionId: string;
  executionId: string;
  decision: OwnershipDecision;
  ownerKind: SessionOwnerKind;
  ownerTicketId?: string;
  messageId?: string;
}

/**
 * 落一条 `execution/ownership_decision`（log-only 审计；失败只留痕，不回灌执行）。
 *
 * 与判定同文件 ⇒ 事件字段与判定理由**同源**，不会出现两处各写一套。
 */
export function emitOwnershipDecision(input: OwnershipEventInput): void {
  emitExecutionEvent(input.sessionId, 'execution/ownership_decision', {
    executionId: input.executionId,
    action: input.decision.action,
    reason: input.decision.reason,
    ownerKind: input.ownerKind,
    ...(input.ownerTicketId ? { ownerTicketId: input.ownerTicketId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
  });
}
