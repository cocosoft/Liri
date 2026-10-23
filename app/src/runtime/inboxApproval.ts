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

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import {
  inboxManager,
  INBOX_STATUS_PENDING,
  INBOX_STATUS_PROCESSING,
  type InboxItem,
} from '@modules/runtime/InboxManager.js';
import {
  getApprovedCommandRegistry,
  type ApprovalScope,
  type ApprovalSnapshot,
} from '@modules/permission';

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
 */
const APPROVAL_REPLIES = new Set([
  'approve',
  'approve_session',
  'allowlist_call',
  'allowlist_tool',
  'allowlist_command',
]);

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

/** PR-2：按回复值解析放行缓存档位（`approve_session` ⇒ 不过期） */
export function resolveApprovalScopeKind(
  reply: string,
  selectedOption?: string
): 'once' | 'session' {
  return isSessionScopeReply(reply, selectedOption) ? 'session' : 'once';
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
  selectedOption?: string
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

  await applyApprovalSideEffects(current, reply, selectedOption);
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
  selectedOption?: string
): Promise<void> {
  if (current.type !== 'approval' || current.source !== 'permission') return;
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

  // PR-2：按档写入 —— 「本会话都允许」不过期（随 clearSession / 进程退出失效）
  const scopeKind = resolveApprovalScopeKind(reply, selectedOption);
  getApprovedCommandRegistry().approve(
    current.sessionId,
    commandHash,
    command,
    approvalScope || approvalSnapshot || scopeKind === 'session'
      ? { scope: approvalScope, snapshot: approvalSnapshot, scopeKind }
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
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    const orchestrator = await getCoreAPI()
      .getTaskOpsPort()
      .then((port) => port.getOrCreatePdcaOrchestrator(taskId));
    if (!orchestrator) return;
    // 批准类回复（本次 / 本会话 / 始终允许）都应续跑；拒绝只记录
    if (isApprovalReply(reply, selectedOption)) {
      const result = await orchestrator.resumeAfterApproval(sessionId);
      logger.info('PDCA resumed after Inbox approval', {
        taskId,
        source: item.source,
        phase: result.phase,
      });
    } else {
      logger.info('PDCA plan rejected via Inbox', { taskId });
    }
  } catch (pdcaErr) {
    logger.warn('PDCA resume after Inbox approval failed', {
      taskId,
      error: String(pdcaErr),
    });
  }
}

/**
 * 批准后后端直接触发会话续跑（复用 checkpoint/resume 机制）
 *
 * 不依赖前端发消息触发 LLM 自发重发：`resumeStream` 会重放 pendingApproval 工具
 *（此时放行缓存已写入，直接执行），并继续 LLM 循环直至完成。
 * fire-and-forget：无可恢复检查点或恢复失败时静默返回，由前端 sendMessage 兜底。
 */
async function triggerResumeAfterApproval(sessionId: string): Promise<void> {
  let resumed = false;
  try {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    const chatManager = getCoreAPI().chatManager;
    if (!chatManager || typeof chatManager.resumeStream !== 'function') {
      logger.warn('审批后自动续跑跳过：ChatManager 不可用', { sessionId });
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
      const { broadcastEvent } = await import('@modules/infrastructure');
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
    await import('@modules/permission/PermissionManager.js');
  const { createPermissionRule, PermissionBehavior } =
    await import('@modules/permission/types/PermissionRule.js');

  const ruleManager = PermissionManager.getInstance().getRuleManager();
  ruleManager.addRule(
    createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName,
      inputFingerprint,
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
    await import('@modules/permission/PermissionManager.js');
  const { createPermissionRule, PermissionBehavior } =
    await import('@modules/permission/types/PermissionRule.js');

  const ruleManager = PermissionManager.getInstance().getRuleManager();
  ruleManager.addRule(
    createPermissionRule({
      behavior: PermissionBehavior.ALLOW,
      toolName,
      contentPattern,
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
