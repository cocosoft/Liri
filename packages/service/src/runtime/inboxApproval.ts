/**
 * inboxApproval — Inbox 审批的**唯一解析实现**（2026-10-21 从 HTTP handler 抽出）
 *
 * 为什么抽出：审批的"批准/拒绝"不止一个入口 —— HTTP 回复（`POST /v1/inbox/:id/reply`）、
 * IM 文本审批（`channels/bridge/TextApprovalParser`）、以及企业审批流（`execApprovalBridge`）。
 * 三条入口若各写一遍"CAS 抢锁 → 落 reply → 写放行缓存 → 白名单持久化 → 触发续跑"，
 * 必然漂移（实证：IM 文本审批此前**直接** `inboxManager.reply()`，漏写放行缓存 ⇒
 * 用户回了"同意"但 AI 重发同一命令仍被拦）。故收敛为**本模块单一实现**，
 * HTTP 侧只保留解析/状态码/响应等传输层关注点。
 *
 * 并发安全：`pending → processing` 的 CAS 抢锁保证"同一审批只有一方能真正落地"，
 * 其余调用方得到 `concurrent_conflict`（企业审批与 Inbox 同时批准即走此分支）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import {
  inboxManager,
  INBOX_STATUS_PENDING,
  INBOX_STATUS_PROCESSING,
  type InboxItem,
} from './InboxManager.js';
import {
  APPROVAL_REPLY_TO_DECISION,
  // P2-4（2026-11-07）：命令指纹档字面量（`'once'` 的真语义 = TTL 窗口内可复用）
  APPROVAL_SCOPE_COMMAND_TTL,
  getApprovedCommandRegistry,
  // P2（§3.3）：任务档审批 —— 活跃长程任务解析
  getActiveTaskId,
  resolveApprovalDecision,
  resolveRecordScope,
  type ApprovalScope,
  type ApprovalSnapshot,
} from '@openliri/infra/permission';

import {
  APPROVAL_RESUME_IDLE_POLL_MS,
  APPROVAL_RESUME_IDLE_WAIT_MS,
} from './defaults.js';
// N-17（2026-11-07）：审批续跑的同会话在飞合并（消除多卡连批时的互斥超时）
import { createResumeCoalescer } from './resumeCoalescer.js';
import { getRuntimeCoreApi } from './api/coreApiProvider.js';
import type { RuntimePdcaOrchestratorPort } from './api/coreApiProvider.js';
// 2026-11-07（隐藏缺陷 #3）：Inbox 与 CLI `/goal approve` 并发续跑时只跑一个循环
import { resumePdcaOnce } from './resumeSingleFlight.js';

const logger = getLogger('runtime:inboxApproval');

/** 审批解析结局（HTTP 层据此映射状态码/响应体） */
export type InboxApprovalOutcome =
  | { kind: 'ok'; item: InboxItem }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'already_processed'; previousReply?: string }
  | { kind: 'concurrent_conflict' }
  | { kind: 'update_failed' };

/** 审批落定后的旁路监听器（企业审批流据此取消镜像请求，避免两侧同时待批） */
type ResolvedListener = (inboxId: string, reply: string) => void;
const resolvedListeners = new Set<ResolvedListener>();

/**
 * 订阅"某条 Inbox 审批已被解析"（返回取消订阅函数）
 *
 * 只在**真正落地成功**后触发（`kind:'ok'`），不含冲突/过期等空转分支。
 */
export function onInboxApprovalResolved(
  listener: ResolvedListener
): () => void {
  resolvedListeners.add(listener);
  return () => resolvedListeners.delete(listener);
}

/**
 * 批准类回复
 *
 * PR-2（2026-10-23）四档：
 * - `approve`          允许本次（短 TTL 放行缓存）
 * - `approve_session`  本会话都允许（放行缓存不过期，随会话结束清理）
 * - `allowlist_call`   始终允许（持久化「工具 + 参数指纹」规则）
 * - `allowlist_tool` / `allowlist_command`：命令类的工具级 / 命令前缀级白名单
 *
 * P5-1（2026-10-28）：集合改由 `@openliri/infra/permission` 的 `APPROVAL_REPLY_TO_DECISION`
 * **派生**（审批四段的决策词表同源）⇒ 新增一档只改一处，受理与审计不会漂移。
 */
const APPROVAL_REPLIES = new Set(Object.keys(APPROVAL_REPLY_TO_DECISION));

function isApprovalReply(reply: string, selectedOption?: string): boolean {
  return (
    APPROVAL_REPLIES.has(reply) ||
    (selectedOption !== undefined && APPROVAL_REPLIES.has(selectedOption))
  );
}

function isAllowlistReply(reply: string, selectedOption?: string): boolean {
  return (
    reply === 'allowlist_tool' ||
    selectedOption === 'allowlist_tool' ||
    reply === 'allowlist_command' ||
    selectedOption === 'allowlist_command'
  );
}

/** PR-2：「本会话都允许」——放行缓存记录不过期，随会话生命周期清除 */
function isSessionScopeReply(reply: string, selectedOption?: string): boolean {
  return reply === 'approve_session' || selectedOption === 'approve_session';
}

/** PR-2：「始终允许」——持久化为「工具 + 参数指纹」规则（重启后仍生效） */
function isFingerprintAllowReply(
  reply: string,
  selectedOption?: string
): boolean {
  return reply === 'allowlist_call' || selectedOption === 'allowlist_call';
}

/**
 * PR-2：按回复值解析放行缓存档位（`approve_session` ⇒ 不过期；`approve_task` ⇒ 仅本任务）。
 *
 * P2-4（2026-11-07）：缺省档返回 `APPROVAL_SCOPE_COMMAND_TTL`（字面量 `'once'`）——
 * 其真语义是**同一命令指纹在 TTL 窗口（默认 5 分钟）内可复用**，不是"批准一次即失效"。
 */
export function resolveApprovalScopeKind(
  reply: string,
  selectedOption?: string
): typeof APPROVAL_SCOPE_COMMAND_TTL | 'session' | 'task' {
  if (isSessionScopeReply(reply, selectedOption)) return 'session';
  // P2（2026-11-04，§3.3）：「本任务都允许」—— 绑定当前活跃长程任务，任务结束即失效
  if (reply === 'approve_task' || selectedOption === 'approve_task') {
    return 'task';
  }
  return APPROVAL_SCOPE_COMMAND_TTL;
}

/**
 * PR-2：从 Inbox 元数据解析「始终允许」落点（纯函数，供持久化与测试复用）。
 *
 * 缺失工具名或指纹摘要 ⇒ 返回 `null`（**不**降级为工具级全放行）。
 */
export function parseFingerprintAllowTarget(
  metadata?: Record<string, unknown>
): { toolName: string; inputFingerprint: string } | null {
  const toolName = metadata?.toolName as string | undefined;
  const inputFingerprint = metadata?.approvalFingerprintHash as
    | string
    | undefined;
  if (!toolName || !inputFingerprint) return null;
  return { toolName, inputFingerprint };
}

/**
 * 解析一条 Inbox 审批（HTTP / IM / 企业审批流共用）
 *
 * @param id             Inbox 项 id
 * @param reply          回复值（`approve` / `reject` / `allowlist_tool` / `allowlist_command` …）
 * @param selectedOption 选项式回复（与 reply 同义，二者取或）
 */
export async function resolveInboxApproval(
  id: string,
  reply: string,
  selectedOption?: string,
  /**
   * P1-1（2026-11-06）：**延后续跑**。批量入口逐项落地时置真，最后由批量函数统一触发
   * 一次 `resumeStream`（否则 N 张卡会各触发一次续跑争同一把会话互斥）。
   */
  options?: { deferResume?: boolean }
): Promise<InboxApprovalOutcome> {
  const current = await inboxManager.get(id);
  if (!current) return { kind: 'not_found' };
  if (current.status !== INBOX_STATUS_PENDING) {
    return current.status === 'expired'
      ? { kind: 'expired' }
      : { kind: 'already_processed', previousReply: current.reply };
  }

  // 幂等保护：CAS 抢锁（同一审批只允许一方落地）
  const locked = await inboxManager.tryUpdateStatus(
    id,
    INBOX_STATUS_PENDING,
    INBOX_STATUS_PROCESSING
  );
  if (!locked) return { kind: 'concurrent_conflict' };

  const updated = await inboxManager.reply(id, reply, selectedOption);
  if (!updated) return { kind: 'update_failed' };

  await applyApprovalSideEffects(current, reply, selectedOption, options);
  await recordApprovalDecision(current, reply, selectedOption);
  await resumePdcaIfApplicable(current, reply, selectedOption);

  // 通知旁路（企业审批镜像据此取消自身请求）
  for (const listener of resolvedListeners) {
    try {
      listener(id, reply);
    } catch (error) {
      void handleError(error, {
        module: 'runtime:inboxApproval',
        action: 'notifyResolved',
        context: { id },
      });
    }
  }

  return { kind: 'ok', item: updated };
}

/** 批量审批结果（P1-1） */
export interface BatchApprovalOutcome {
  sessionId: string;
  /** 成功落地的 Inbox 项 id */
  resolved: string[];
  /** 未落地项及原因（`expired` / `already_processed` / `concurrent_conflict` …） */
  skipped: Array<{ id: string; kind: string }>;
  /** 是否触发了会话续跑（至少一项落地，且不是纯 PDCA 步骤卡） */
  resumed: boolean;
}

/**
 * P1-1（2026-11-06）：批量审批的**候选判定**（纯函数）。
 *
 * 口径：`status='pending'` + `type='approval'` + （可选）同工具名。
 * 抽成纯函数是为了在不触库的前提下锁定筛选契约（顺序保持入参顺序）。
 */
export function selectBatchApprovalTargets<
  T extends {
    status?: string;
    type?: string;
    metadata?: Record<string, unknown>;
  },
>(items: readonly T[], toolName?: string): T[] {
  return items.filter(
    (item) =>
      item.status === INBOX_STATUS_PENDING &&
      item.type === 'approval' &&
      (!toolName || item.metadata?.toolName === toolName)
  );
}

/**
 * P1-1（2026-11-06）：一次批准同一会话的**全部待审批卡**。
 *
 * **为什么必须在服务端做**：每张卡的 `resolveInboxApproval` 都会 fire-and-forget 触发
 * 一次 `resumeStream`；N 张卡 ⇒ N 次续跑争同一把会话互斥（后到的只会在
 * 「所有工具已完成」上空转，日志刷屏且时序不可控）。批量入口逐项落地时置
 * `deferResume`，**最后只触发一次**。
 *
 * 只处理 `type='approval'` 的 pending 项；`toolName` 可选（只批同一工具，用于"同工具同风险"收窄）。
 */
export async function resolveInboxApprovalsBatch(params: {
  sessionId: string;
  reply: string;
  selectedOption?: string;
  toolName?: string;
  limit?: number;
}): Promise<BatchApprovalOutcome> {
  const { sessionId, reply, selectedOption, toolName } = params;
  const outcome: BatchApprovalOutcome = {
    sessionId,
    resolved: [],
    skipped: [],
    resumed: false,
  };
  if (!sessionId) return outcome;

  const listed = await inboxManager.list({
    sessionId,
    status: INBOX_STATUS_PENDING,
    type: 'approval',
    limit: params.limit ?? 50,
    offset: 0,
  });
  const targets = selectBatchApprovalTargets(listed.items, toolName);

  let hasChatResumeTarget = false;
  // 2026-11-07（真机）：PDCA 步骤卡的续跑由 `resumePdcaIfApplicable` 触发（fire-and-forget），
  // 原实现只统计聊天续跑 ⇒ 纯 PDCA 批量审批返回 `resumed:false`（真机 `pdca_mw6e0e94`
  // 明明已从 stage_awaiting_approval 续跑）。此处一并统计，字段语义为"已触发续跑"。
  let hasPdcaResumeTarget = false;
  for (const item of targets) {
    const result = await resolveInboxApproval(item.id, reply, selectedOption, {
      deferResume: true,
    });
    if (result.kind !== 'ok') {
      outcome.skipped.push({ id: item.id, kind: result.kind });
      continue;
    }
    outcome.resolved.push(item.id);
    // PDCA 步骤卡由 `resumePdcaIfApplicable` 各自续跑 ⇒ 不再叠加聊天续跑
    if (typeof item.metadata?.pdcaTaskId === 'string') {
      hasPdcaResumeTarget = true;
    } else {
      hasChatResumeTarget = true;
    }
  }

  if (
    (hasChatResumeTarget || hasPdcaResumeTarget) &&
    isApprovalReply(reply, selectedOption)
  ) {
    outcome.resumed = true;
    if (hasChatResumeTarget) {
      void triggerResumeAfterApproval(sessionId).catch((resumeErr: unknown) => {
        logger.warn('批量审批后自动续跑失败（前端可兜底续跑）', {
          sessionId,
          error: String(resumeErr),
        });
      });
    }
  }

  logger.info('批量审批完成', {
    sessionId,
    reply,
    ...(toolName ? { toolName } : {}),
    candidateCount: targets.length,
    resolvedCount: outcome.resolved.length,
    skippedCount: outcome.skipped.length,
    resumed: outcome.resumed,
  });
  return outcome;
}

/**
 * P5-1（2026-10-28）：审批四段 —— ③ 决定 / ④ 留痕。
 *
 * 只在**能成链**时落：卡上必须带 `metadata.approvalId`（由提交侧写入）。
 * 卡片建于开关关闭期间 ⇒ 没有链起点 ⇒ 这里**不伪造** ③④（否则产生孤立事件）。
 *
 * ④ 的语义是"这次决定留下了什么"：批准 ⇒ 放行缓存键 + 范围；拒绝 ⇒ 无放行、范围记 `once`。
 * 事件落盘失败不影响审批结果（`emitApprovalAudit` 内部已降级）。
 */
async function recordApprovalDecision(
  current: InboxItem,
  reply: string,
  selectedOption?: string
): Promise<void> {
  if (current.type !== 'approval' || current.source !== 'permission') return;
  const approvalId = current.metadata?.approvalId as string | undefined;
  const sessionId = current.sessionId;
  if (!approvalId || !sessionId) return;

  try {
    const { emitApprovalAudit } = await import('@openliri/infra/permission');
    const decision = resolveApprovalDecision(reply, selectedOption);
    const commandHash = current.metadata?.commandHash as string | undefined;

    emitApprovalAudit(sessionId, {
      stage: 'decided',
      approvalId,
      decision,
      by: 'user',
      reply,
    });
    emitApprovalAudit(sessionId, {
      stage: 'recorded',
      approvalId,
      decision,
      ...(commandHash ? { commandHash } : {}),
      scopeKind: resolveRecordScope(decision),
    });
  } catch (e) {
    logger.warn('审批四段事件打点失败（不影响审批结果）', {
      sessionId,
      approvalId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * 审批落定后的副作用（**批准语义的唯一实现**）
 *
 * 1. 写"已批准命令"放行缓存（工具重放时命中即跳过安全拦截）；
 * 2. 白名单类回复额外持久化 allow 规则；
 * 3. fire-and-forget 触发会话续跑（重放 pendingApproval 工具）。
 */
async function applyApprovalSideEffects(
  current: InboxItem,
  reply: string,
  selectedOption?: string,
  options?: { deferResume?: boolean }
): Promise<void> {
  if (current.type !== 'approval' || current.source !== 'permission') return;
  // B1（2026-10-30，issue #35）：工作区访问申请走独立副作用（加根 + 续跑），
  // 它**没有** commandHash（不写命令放行缓存），必须在放行缓存分支之前分流。
  if (current.metadata?.kind === 'workspace-scope') {
    await applyWorkspaceScopeApproval(current, reply, selectedOption, options);
    return;
  }
  if (!isApprovalReply(reply, selectedOption)) return;

  const commandHash = current.metadata?.commandHash as string | undefined;
  const command = current.metadata?.command as string | undefined;
  const approvalScope = current.metadata?.approvalScope as
    | ApprovalScope
    | undefined;
  const approvalSnapshot = current.metadata?.approvalSnapshot as
    | ApprovalSnapshot
    | undefined;
  if (!commandHash || !current.sessionId) return;

  // PR-2：按档写入 —— 「本会话都允许」不过期（随 clearSession / 进程退出失效）；
  // P2（§3.3）：「本任务都允许」绑定当前活跃长程任务（缺活跃任务 ⇒ approve() 内部降级 once）
  const scopeKind = resolveApprovalScopeKind(reply, selectedOption);
  const taskId =
    scopeKind === 'task'
      ? ((current.metadata?.taskId as string | undefined) ??
        getActiveTaskId(current.sessionId))
      : undefined;
  if (scopeKind === 'task' && !taskId) {
    logger.warn('「本任务都允许」缺少活跃任务，审批降级为 once', {
      sessionId: current.sessionId,
    });
  }
  getApprovedCommandRegistry().approve(
    current.sessionId,
    commandHash,
    command,
    approvalScope || approvalSnapshot || scopeKind !== 'once'
      ? { scope: approvalScope, snapshot: approvalSnapshot, scopeKind, taskId }
      : undefined
  );
  logger.info('工具审批已批准，写入命令放行缓存', {
    sessionId: current.sessionId,
    commandHash,
    scopeKind,
    hasCommand: !!command,
    scopeBound: !!approvalScope,
    hasSnapshot: !!approvalSnapshot,
  });

  if (isAllowlistReply(reply, selectedOption)) {
    const commandLevel =
      reply === 'allowlist_command' || selectedOption === 'allowlist_command';
    await persistAllowlistRule(current, commandLevel);
  }
  // PR-2：「始终允许」= 工具 + 参数指纹（只落摘要，不落明文参数）
  if (isFingerprintAllowReply(reply, selectedOption)) {
    await persistFingerprintRule(current);
  }

  // PR-5：PDCA 步骤级审批卡由 `resumePdcaIfApplicable` 负责续跑 ——
  // 此处**不再**触发聊天续跑，避免两条恢复路径同时开跑（同一次批准只应有一个赢家）。
  if (typeof current.metadata?.pdcaTaskId === 'string') {
    logger.info('PDCA 步骤审批已批准，续跑交由 PDCA 恢复处理', {
      taskId: current.metadata.pdcaTaskId,
      sessionId: current.sessionId,
    });
    return;
  }

  // P1-1：批量入口 `deferResume` ⇒ 由 `resolveInboxApprovalsBatch` 统一触发一次续跑
  if (options?.deferResume) return;
  void triggerResumeAfterApproval(current.sessionId).catch(
    (resumeErr: unknown) => {
      logger.warn('审批后自动续跑失败（前端可兜底续跑）', {
        sessionId: current.sessionId,
        error: String(resumeErr),
      });
    }
  );
}

/**
 * 把 `root` 并入既有的工作区根列表（**父子折叠**，2026-11-04 P0-1）。
 *
 * 规则：
 * - `root` 已被某个既有根覆盖（相同或位于其下）⇒ 不新增（`changed: false`）；
 * - `root` 覆盖了某些既有根（`root` 是它们的父）⇒ 用 `root` 替换掉那些子根，
 *   被替换的写进 `dropped` 供日志留痕。
 *
 * 比较口径：Windows 路径不区分大小写，结尾分隔符与 `/` `\` 差异忽略 —— 与
 * `ToolExecutionService._requestWorkspaceScopeApproval` 的在途去重键同一口径。
 */
export function mergeWorkspaceRoot(
  existing: readonly string[],
  root: string
): { roots: string[]; changed: boolean; dropped: string[] } {
  const trimmed = root.trim();
  if (!trimmed) return { roots: [...existing], changed: false, dropped: [] };
  const normalize = (p: string): string =>
    p
      .replace(/[\\/]+$/, '')
      .replace(/\//g, '\\')
      .toLowerCase();
  const covers = (parent: string, child: string): boolean => {
    const p = normalize(parent);
    const c = normalize(child);
    return c === p || c.startsWith(`${p}\\`);
  };

  if (existing.some((r) => covers(r, trimmed))) {
    return { roots: [...existing], changed: false, dropped: [] };
  }
  const dropped = existing.filter((r) => covers(trimmed, r));
  const kept = existing.filter((r) => !covers(trimmed, r));
  return { roots: [...kept, trimmed], changed: true, dropped };
}

/**
 * B1（2026-10-30，issue #35）：「允许本会话访问 `<root>`」申请获批 ⇒ 把该路径追加到
 * 会话 `metadata.workspaceRoots`，然后走既有"批准后续跑"（重放被拒的工具调用）。
 *
 * 只追加**这一条**被用户看到的路径（不扩大到父目录），避免批准一次等于放开整盘；
 * 但与已有根做父子折叠（见 `mergeWorkspaceRoot`），避免同一链路上逐层各批一次。
 * 存储侧与内存态都要更新（`loadSession` 只读内存 Map ⇒ 冷会话走 gateway）。
 */
async function applyWorkspaceScopeApproval(
  current: InboxItem,
  reply: string,
  selectedOption?: string,
  options?: { deferResume?: boolean }
): Promise<void> {
  const sessionId = current.sessionId;
  const root = current.metadata?.workspaceScopeRoot;
  if (!sessionId || typeof root !== 'string' || !root.trim()) return;
  if (!isApprovalReply(reply, selectedOption)) {
    logger.info('工作区访问申请被拒绝（保持原工作区根）', { sessionId, root });
    return;
  }

  type SessionLike = { metadata?: Record<string, unknown> };
  type ChatManagerLike = {
    loadSession?: (id: string) => Promise<SessionLike | undefined>;
    saveSession?: (session: SessionLike) => Promise<void>;
    persistSessionMetadata?: (session: SessionLike) => Promise<void>;
    getSessionGateway?: () =>
      | {
          getSession(id: string): Promise<SessionLike | undefined>;
          updateSession(session: SessionLike): Promise<void>;
        }
      | undefined;
  };

  /**
   * 把新根并入会话的 `workspaceRoots`（**父子折叠**，2026-11-04 P0-1）。
   *
   * 实测问题：同一会话里 `E:\PY\...\app`、`E:\PY\...\app\src\ai\router`、`E:\PY\...\app\src\tasks`
   * 各自弹卡、各批一次 —— 用户以为「批一次就够了」。收敛规则见 `mergeWorkspaceRoot`。
   */
  const mergeRoot = (session: SessionLike): void => {
    const metadata = session.metadata ?? {};
    const existing = Array.isArray(metadata['workspaceRoots'])
      ? (metadata['workspaceRoots'] as unknown[]).filter(
          (r): r is string => typeof r === 'string'
        )
      : [];
    const merged = mergeWorkspaceRoot(existing, root);
    if (!merged.changed) return;
    if (merged.dropped.length > 0) {
      logger.info('工作区根已父子折叠（新根覆盖既有子根）', {
        root,
        dropped: merged.dropped,
      });
    }
    session.metadata = { ...metadata, workspaceRoots: merged.roots };
  };

  try {
    const chatManager = getRuntimeCoreApi()?.chatManager as unknown as
      | ChatManagerLike
      | undefined;

    const cached = await chatManager?.loadSession?.(sessionId);
    if (cached && chatManager) {
      mergeRoot(cached);
      await chatManager.saveSession?.(cached);
      await chatManager.persistSessionMetadata?.(cached);
    } else {
      const gateway = chatManager?.getSessionGateway?.();
      const stored = await gateway?.getSession(sessionId);
      if (stored) {
        mergeRoot(stored);
        await gateway?.updateSession(stored);
      }
    }

    logger.info('工作区根已追加（越界申请获批）', { sessionId, root });
    // P0-3：续跑可能需等待原回合结束（有界 120s），不得拖住审批的 HTTP 响应 ⇒
    // 与工具审批路径同口径 fire-and-forget，完成后由 `session:continued` 广播驱动前端刷新。
    // P1-1：批量入口 `deferResume` ⇒ 统一由批量函数触发一次。
    if (options?.deferResume) return;
    void triggerResumeAfterApproval(sessionId).catch((resumeErr: unknown) => {
      logger.warn('工作区加根后自动续跑失败', {
        sessionId,
        error: String(resumeErr),
      });
    });
  } catch (error) {
    // 加根失败不应影响审批结果本身：如实记录，用户可重发（此时仍会被拒）
    logger.warn('工作区根追加失败（不影响审批结果）', {
      sessionId,
      root,
      error: String(error),
    });
  }
}

/**
 * 2026-11-07（真机 `pdca_mw6eclut`）：审批可能**早于**挂起落定 —— 卡片在步骤执行中提交，
 * 而编排器要到批次结束才进入 `stage_awaiting_approval`。此时 `resumeAfterApproval` 抛
 * `PDCA_NOT_PENDING`；原实现只记 warn ⇒ 任务随后挂起且**无人续跑**（卡已是 replied，永久卡死）。
 *
 * 处置：可恢复类失败按**有界退避**重试（≈1 分钟窗口），等编排器落定后再续跑；
 * 仍失败才记 warn（调用方早已返回，不阻塞 HTTP）。
 */
const PDCA_RESUME_RETRY_DELAYS_MS = [
  1000, 2000, 4000, 8000, 15000, 15000, 15000,
] as const;

/** 「编排器还没进入可恢复阶段」类错误（可重试）；其余错误直接放弃 */
function isResumeNotReady(err: unknown): boolean {
  const text = String(err);
  return (
    text.includes('PDCA_NOT_PENDING') ||
    text.includes('not in plan_pending') ||
    text.includes('not awaiting step approval')
  );
}

async function resumePdcaWithRetry(
  orchestrator: RuntimePdcaOrchestratorPort,
  sessionId: string,
  taskId: string
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await resumePdcaOnce(orchestrator, () =>
        orchestrator.resumeAfterApproval(sessionId)
      );
      logger.info('PDCA resumed after Inbox approval', {
        taskId,
        phase: result.phase,
        attempt: attempt + 1,
      });
      return;
    } catch (resumeErr) {
      const delay = PDCA_RESUME_RETRY_DELAYS_MS[attempt];
      if (!isResumeNotReady(resumeErr) || delay === undefined) {
        logger.warn('PDCA resume after Inbox approval failed', {
          taskId,
          attempt: attempt + 1,
          error: String(resumeErr),
        });
        return;
      }
      logger.info('PDCA 尚未落定到可恢复阶段，稍后重试续跑', {
        taskId,
        attempt: attempt + 1,
        retryInMs: delay,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** 在飞续跑（按 taskId 合并）：同一批里同任务的 N 张卡只应触发**一次** resume */
const inFlightPdcaResume = new Map<string, Promise<void>>();

function schedulePdcaResume(
  orchestrator: RuntimePdcaOrchestratorPort,
  sessionId: string,
  taskId: string
): void {
  if (inFlightPdcaResume.has(taskId)) {
    logger.info('PDCA 续跑已在进行中，跳过重复触发', { taskId });
    return;
  }
  const task = resumePdcaWithRetry(orchestrator, sessionId, taskId).finally(
    () => {
      inFlightPdcaResume.delete(taskId);
    }
  );
  inFlightPdcaResume.set(taskId, task);
}

/**
 * 2026-11-07（隐藏缺陷 #4）：同一步骤的**其他待批卡**在续跑后置为过期。
 *
 * 同一步骤可能因"命令不同"挂多张卡；批准其一并续跑后，其余卡已无意义
 * （再批只会重复续跑、卡片堆积）。仅清理同 `(pdcaTaskId, stepId)` 的 pending 行。
 */
async function expireSiblingStepCards(item: InboxItem): Promise<void> {
  const taskId = item.metadata?.pdcaTaskId;
  const stepId = item.metadata?.stepId;
  if (typeof taskId !== 'string' || typeof stepId !== 'string') return;
  try {
    const listed = await inboxManager.list({
      sessionId: item.sessionId,
      status: INBOX_STATUS_PENDING,
      type: 'approval',
      limit: 50,
      offset: 0,
    });
    const ids = listed.items
      .filter(
        (i) =>
          i.id !== item.id &&
          i.metadata?.pdcaTaskId === taskId &&
          i.metadata?.stepId === stepId
      )
      .map((i) => i.id);
    if (ids.length === 0) return;
    const expired = await inboxManager.expireByIds(ids);
    logger.info('同一步骤的旧审批卡已置过期', { taskId, stepId, expired });
  } catch (err) {
    logger.warn('清理同一步骤旧审批卡失败', {
      taskId,
      stepId,
      error: String(err),
    });
  }
}

/**
 * 2026-11-07（隐藏缺陷 #1）：审批卡**过期** ⇒ 终止其对应的 PDCA 任务。
 *
 * 卡已不可回复，任务却停在 `stage_awaiting_approval`（`pendingApproval>0`）⇒
 * `findExistingTask` 只按"非终态 status"判定 ⇒ **该会话的幂等键永久锁死**
 * （同会话新任务恒返回旧 taskId，与已修的 deny 死锁同型）。
 * 由入口层（`main.ts`）注册到 `onInboxItemsExpired`。
 */
export async function abortPdcaAfterExpiry(item: InboxItem): Promise<void> {
  const taskId =
    item.source === 'pdca'
      ? (item.metadata?.taskId as string | undefined)
      : typeof item.metadata?.pdcaTaskId === 'string'
        ? item.metadata.pdcaTaskId
        : undefined;
  if (!taskId) return;
  try {
    const coreApi = getRuntimeCoreApi();
    const port = await coreApi?.getTaskOpsPort?.();
    const orchestrator = await port?.getOrCreatePdcaOrchestrator(taskId);
    logger.warn('审批卡过期 ⇒ 终止 PDCA 任务（释放会话幂等键）', {
      taskId,
      inboxId: item.id,
    });
    await orchestrator?.abort?.();
  } catch (err) {
    logger.warn('审批卡过期后终止 PDCA 失败', {
      taskId,
      inboxId: item.id,
      error: String(err),
    });
  }
}

/**
 * PDCA 审批恢复（原 `inbox-handlers` 内联逻辑，随解析实现一并下沉）
 *
 * - 批准 ⇒ `resumeAfterApproval(sessionId)` 让计划继续推进；
 * - 拒绝 ⇒ 仅记录（任务停在待处理，由用户决定下一步）；
 * - 失败**不阻塞** Inbox 回复。
 */
async function resumePdcaIfApplicable(
  item: InboxItem,
  reply: string,
  selectedOption?: string
): Promise<void> {
  if (!item.metadata) return;
  // PR-5（2026-10-23）：两类 PDCA 审批都走本恢复：
  // - 计划审批（`source='pdca'`，`metadata.taskId`）；
  // - **步骤级工具审批**（`source='permission'`，`metadata.pdcaTaskId`，由 LRO 提交）。
  const taskId =
    item.source === 'pdca'
      ? (item.metadata.taskId as string | undefined)
      : typeof item.metadata.pdcaTaskId === 'string'
        ? item.metadata.pdcaTaskId
        : undefined;
  const sessionId = item.sessionId;
  if (!taskId || !sessionId) return;

  try {
    // 2026-11-07 真机：此前把方法**取出后再调用**（`const getTaskOpsPort = coreApi?.getTaskOpsPort;
    // getTaskOpsPort()`）⇒ `this` 丢失 ⇒ `TypeError: undefined is not an object
    // (evaluating 'this.domainSnapshotOps')` ⇒ 批准 PDCA 步骤后**续跑从未发生**（任务停在挂起）。
    // 现保留接收者调用（`coreApi.getTaskOpsPort()`）。
    const coreApi = getRuntimeCoreApi();
    if (!coreApi) return;
    const port = await coreApi.getTaskOpsPort?.();
    if (!port) return;
    const orchestrator = await port.getOrCreatePdcaOrchestrator(taskId);
    if (!orchestrator) return;
    // 批准类回复（本次 / 本会话 / 始终允许）都应续跑；拒绝只记录
    if (isApprovalReply(reply, selectedOption)) {
      // 2026-11-08（真机 `pdca_mw6m1mg8`）：**先解除该命令的「不可执行」台账结论**。
      // LRO-13 的阻塞台账在 `security_analyzer_ask` 时就已入账；只写放行缓存不清台账
      // ⇒ 续跑第一步仍被 `[BLOCKED_REPLAY]` 短路（实测批准后 step_1 连续 3 轮被短路、
      // 任务最终 failed）。批准的是这条命令本身 ⇒ 按命令文本移除对应条目。
      const approvedCommand = item.metadata?.command;
      if (typeof approvedCommand === 'string' && approvedCommand.trim()) {
        try {
          orchestrator.clearBlockedCommand?.(approvedCommand);
        } catch (clearErr) {
          logger.warn('审批通过后解除阻塞台账失败（续跑可能仍短路）', {
            taskId,
            error: String(clearErr),
          });
        }
      }
      // 2026-11-07：同一步骤的其余旧卡已无意义（续跑后统一清理，防重复续跑/堆积）
      void expireSiblingStepCards(item);
      schedulePdcaResume(orchestrator, sessionId, taskId);
    } else {
      // 2026-11-07（真机）：拒绝后既无续跑入口、也无 abort 入口 ⇒ 任务永久停在挂起，
      // 且 `findExistingTask` 把该会话的幂等键锁死（同会话新任务永远返回旧 taskId，
      // 真机 `pdca_mw6bpgs5`：deny 后 start 返回 `existing: true` 而任务永不推进）。
      // 拒绝即终止：写 abort 终态释放会话幂等键，用户可重新发起任务。
      logger.info('PDCA rejected via Inbox, aborting task', { taskId });
      void orchestrator.abort?.().catch((abortErr) => {
        logger.warn('PDCA abort after Inbox rejection failed', {
          taskId,
          error: String(abortErr),
        });
      });
    }
  } catch (pdcaErr) {
    logger.warn('PDCA resume after Inbox approval failed', {
      taskId,
      error: String(pdcaErr),
    });
  }
}

/**
 * P0-3（2026-11-05，`dev_docs/20261105/运行时问题清单`）：审批续跑的**在飞串行化**。
 *
 * 实证（旧 daemon 日志）：`13:20:50` 审批已批准 → `13:21:19` 原回合仍在写文件
 * （`reactToolLoop:file_write_loop_detected`）→ `13:21:20` 记录
 * 「审批后自动续跑失败」/ `SimpleMutex: acquire timeout after 30000ms`。
 * 原因是 `resumeStream` 直接 `mutex.acquire()`，与会话级互斥正面相撞：
 * 等满 30s 后只留一条 warn，用户侧表现为「批了但没继续」。
 *
 * 处置：起续跑流前先**等原回合结束**（有界轮询 `isSessionStreaming`）；超过上界则
 * 明确延后并记录原因（放行缓存已写入，后续回合/前端兜底可继续），
 * 不再把互斥超时伪装成「续跑失败」。
 *
 * 上界取 120s（≈4× 会话互斥的 30s）：实测事故里原回合在批准后约 29s 才结束，
 * 若与互斥同额（30s）仍会踩线；120s 覆盖常见长回合，超界则如实延后而非空等。
 *
 * 等待会话流结束（返回是否已空闲）；`isStreaming` 与 `now` 均可注入，便于回归。
 */
export async function waitForSessionIdle(
  isStreaming: (sessionId: string) => boolean,
  sessionId: string,
  waitMs: number = APPROVAL_RESUME_IDLE_WAIT_MS,
  now: () => number = Date.now
): Promise<boolean> {
  const deadline = now() + waitMs;
  while (isStreaming(sessionId)) {
    if (now() >= deadline) return false;
    await new Promise((resolve) =>
      setTimeout(resolve, APPROVAL_RESUME_IDLE_POLL_MS)
    );
  }
  return true;
}

/**
 * 批准后后端直接触发会话续跑（复用 checkpoint/resume 机制）
 *
 * 不依赖前端发消息触发 LLM 自发重发：`resumeStream` 会重放 pendingApproval 工具
 *（此时放行缓存已写入，直接执行），并继续 LLM 循环直至完成。
 * fire-and-forget：无可恢复检查点或恢复失败时静默返回，由前端 sendMessage 兜底。
 *
 * N-17（2026-11-07 真机）：同一会话**在飞合并**，实现见 `./resumeCoalescer`。
 */
const triggerResumeAfterApproval = createResumeCoalescer((sid) =>
  runResumeOnce(sid)
);

/** 单轮续跑（原有实现；合并由 `resumeCoalescer` 负责） */
async function runResumeOnce(sessionId: string): Promise<void> {
  let resumed = false;
  try {
    const chatManager = getRuntimeCoreApi()?.chatManager;
    if (!chatManager || typeof chatManager.resumeStream !== 'function') {
      logger.warn('审批后自动续跑跳过：ChatManager 不可用', { sessionId });
      return;
    }

    // P0-3 在飞守卫：原回合仍在运行时先等它结束，避免与会话互斥正面相撞。
    const idle = await waitForSessionIdle(
      (sid) => chatManager.isSessionStreaming?.(sid) ?? false,
      sessionId
    );
    if (!idle) {
      logger.info('审批后自动续跑延后：原回合仍在运行（放行缓存已生效）', {
        sessionId,
        waitedMs: APPROVAL_RESUME_IDLE_WAIT_MS,
      });
      return;
    }

    // checkpointId 由 resumeStream 内部取最新自动检查点（参数仅兼容保留）
    const gen = chatManager.resumeStream(sessionId, '');
    for await (const _chunk of gen) {
      if (!resumed) {
        resumed = true;
        logger.info('审批后自动续跑已启动', { sessionId });
      }
    }
    logger.info('审批后自动续跑完成', { sessionId, resumed });
  } finally {
    // U-06-4（2026-10-19）：续跑结束（成功/异常）广播 `session:continued`，
    // 前端据此刷新当前会话 —— 取代原先「固定 sleep 3s + 全量 getMessages」的时序猜测。
    try {
      const { broadcastEvent } =
        await import('@modules/infrastructure/http/handlers/handler-utils');
      await broadcastEvent('session:continued', { id: sessionId, ok: resumed });
    } catch (e) {
      logger.warn('审批后续跑 SSE 广播失败', {
        sessionId,
        error: (e as Error)?.message ?? String(e),
      });
    }
  }
}

/**
 * PR-2：「始终允许」—— 持久化「工具 + 参数指纹」allow 规则。
 *
 * 只写 `metadata.approvalFingerprintHash`（提交审批时算好的摘要），**不落明文参数**；
 * 匹配由 `isRuleMatch` 的 `inputFingerprint` 分支按摘要等值完成（键序/空白无关）。
 * 缺失摘要 ⇒ 跳过并告警（不降级为工具级全放行 —— 那会放大授权范围）。
 */
async function persistFingerprintRule(current: {
  metadata?: Record<string, unknown>;
  sessionId?: string;
}): Promise<void> {
  const target = parseFingerprintAllowTarget(current.metadata);
  if (!target) {
    logger.warn('「始终允许」持久化跳过：缺少工具名或参数指纹', {
      sessionId: current.sessionId,
      hasToolName: !!current.metadata?.toolName,
      hasFingerprint: !!current.metadata?.approvalFingerprintHash,
    });
    return;
  }
  const { toolName, inputFingerprint } = target;

  const { PermissionManager } =
    await import('@openliri/infra/permission/PermissionManager');
  // LRO-07（2026-10-26）：落盘来源标注为规则库（此前默认 userSettings ⇒ deny 文案指错地方）
  const { createPermissionRule, PermissionBehavior, PermissionRuleSource } =
    await import('@openliri/infra/permission/types/PermissionRule');

  const ruleManager = PermissionManager.getInstance().getRuleManager();
  ruleManager.addRule(
    createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName,
      inputFingerprint,
      source: PermissionRuleSource.RULE_STORE,
    })
  );
  logger.info('「始终允许」规则已持久化（工具 + 参数指纹）', {
    toolName,
    inputFingerprint,
    preview: current.metadata?.approvalFingerprintPreview,
    sessionId: current.sessionId,
  });
}

/**
 * P2-4: 持久化白名单规则到 tool_rules.json（behavior: allow）
 * - 工具级（commandLevel=false）：`{behavior: allow, toolName}` → 该工具整体免审批
 * - 命令前缀级（commandLevel=true）：`{behavior: allow, toolName, contentPattern}` → 仅匹配命令免审批
 */
async function persistAllowlistRule(
  current: { metadata?: Record<string, unknown>; sessionId?: string },
  commandLevel: boolean
): Promise<void> {
  const toolName = current.metadata?.toolName as string | undefined;
  if (!toolName) {
    logger.warn('白名单持久化跳过：缺少 toolName', {
      sessionId: current.sessionId,
    });
    return;
  }
  const command =
    typeof current.metadata?.command === 'string'
      ? (current.metadata.command as string)
      : '';
  const contentPattern =
    commandLevel && command ? buildCommandContentPattern(command) : undefined;

  const { PermissionManager } =
    await import('@openliri/infra/permission/PermissionManager');
  // LRO-07（2026-10-26）：落盘来源标注为规则库（此前默认 userSettings ⇒ deny 文案指错地方）
  const { createPermissionRule, PermissionBehavior, PermissionRuleSource } =
    await import('@openliri/infra/permission/types/PermissionRule');

  const ruleManager = PermissionManager.getInstance().getRuleManager();
  ruleManager.addRule(
    createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName,
      contentPattern,
      source: PermissionRuleSource.RULE_STORE,
    })
  );
  logger.info('白名单规则已持久化', {
    toolName,
    commandLevel,
    contentPattern,
    sessionId: current.sessionId,
  });
}

/**
 * P2-4: 生成命令前缀正则 —— 取命令前 2 个 token 拼接、转义正则特殊字符、尾部 `.*`。
 * 例：`net user %username%` → `^net user.*`；单 token 命令 `dir` → `^dir.*`。
 */
function buildCommandContentPattern(command: string): string {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  const prefix = tokens.slice(0, 2).join(' ');
  return `^${escapeRegExp(prefix)}.*`;
}

/** 转义正则特殊字符，保证命令文本按字面匹配 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
