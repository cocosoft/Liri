// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * toolApproval — 工具审批「放行缓存查询」与「审批卡片提交」外移
 * （issue #17 · D8，2026-10-29）
 *
 * 迁出来源：`ChatManager._isCommandApproved`（原 35 行）与 `_submitToolApproval`（原 137 行）。
 *
 * ⚠️ 属**审批路径**（`code-deletion.md` CD07 关键模块）⇒ 迁移为**逐字搬迁**、零语义改动；
 * 回归由既有 `tests/chat/ChatManagerPermission.test.ts`（ask/deny/allow/放行缓存命中）
 * 与 `tests/chat` 全量用例兜底。
 *
 * 依赖照旧走**动态 import**（`@modules/permission` / `InboxManager`）—— 刻意不提到静态图，
 * 以免改变启动期 eager 依赖（与迁移前一致）。
 */

import { getLogger } from '@modules/monitoring';
import { isShellToolName } from '@modules/utils/toolContract/toolRoles';
import type { ToolRegistry } from '@modules/tools';
import type { ApprovalScope, ApprovalSnapshot } from '@modules/permission';

const logger = getLogger('chat:manager');

export interface ToolApprovalPorts {
  /** 工具注册表（审批指纹解析/风险分级用；未初始化 ⇒ `null`） */
  toolRegistry: ToolRegistry | null;
}

/**
 * 检查命令是否已批准放行（P0-6 放行缓存）
 *
 * 命中 ApprovedCommandRegistry（session 隔离 + 规范化 hash 精确匹配）视为已授权，
 * 仅对命令类工具生效（bash/shell/command）。批准后 LLM 重发同一命令时跳过 ask，
 * 避免重复弹审批卡片。
 */
export async function isCommandApproved(
  toolName: string,
  input: Record<string, unknown>,
  sessionId: string | undefined,
  /** PR-2：工具声明的授权维度（缺省 = 全参数稳定 JSON，零行为变更） */
  approvalFingerprint?: string
): Promise<boolean> {
  try {
    // A-4（2026-10-18）：命令类工具名判定收敛到角色集合（含历史别名）
    // PR-1（2026-10-23）：非 shell 工具改用**工具调用键**查放行缓存 —— 原实现
    // `if (!isShellToolName(toolName)) return false;` 使非命令工具的批准**永远查不到**，
    // 于是「点了批准、下一轮同一调用照样弹」。
    if (!isShellToolName(toolName)) {
      const { isToolCallApproved } = await import('@modules/permission');
      return (
        !!sessionId &&
        isToolCallApproved(sessionId, toolName, input, approvalFingerprint)
      );
    }
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command || !sessionId) return false;
    // P0-2: 统一 hashCommandForExecution，与提交审批端（PermissionChecker）hash 一致
    // P0-3: 精确 hash 命中 或 命令名级放行命中（非危险命令，安全层仍兜底）→ 跳过 ask 弹卡
    const { getApprovedCommandRegistry, hashCommandForExecution } =
      await import('@modules/permission');
    const registry = getApprovedCommandRegistry();
    return (
      registry.isApproved(sessionId, hashCommandForExecution(command)) ||
      registry.isCommandNameApproved(sessionId, command)
    );
  } catch {
    // registry 不可用时按未批准处理，不影响安全底线（ask 仍会提交卡片）
    return false;
  }
}

/**
 * 提交工具审批卡片到 Inbox（P0-2 工具执行审批链路）
 *
 * ask 决策 → 会话内审批卡片（InboxBlock）→ 用户批准后：
 * - inbox-handlers 将 metadata.commandHash 写入 ApprovedCommandRegistry（放行缓存）
 * - 前端 InboxBlock 向会话发送批准消息，触发 LLM 重新发起
 *
 * @returns 已提交的 Inbox 项 id（提交失败/Inbox 不可用时返回 null，上层降级为 ask 文本）
 */
export async function submitToolApproval(
  ports: ToolApprovalPorts,
  toolName: string,
  input: Record<string, unknown>,
  sessionId: string | undefined,
  toolCallId: string,
  approvalReason?: string,
  /** S1-1：工具声明的执行作用域（cwd/env 摘要/平台）——随卡片记录，执行时须一致 */
  approvalScope?: ApprovalScope,
  /** S1-1：审批快照（原始 / 规范化 / 改写项）——随卡片记录，供审批与执行对账 */
  approvalSnapshot?: ApprovalSnapshot
): Promise<string | null> {
  try {
    const { inboxManager } = await import('@modules/runtime/InboxManager.js');
    // P0-2: 统一 hashCommandForExecution，与执行端 BashTool hash 一致
    const {
      hashCommandForExecution,
      hashApprovalFingerprint,
      resolveApprovalFingerprint,
      previewApprovalFingerprint,
      resolveRiskClass,
      findPendingApprovalId,
    } = await import('@modules/permission');
    const command = typeof input.command === 'string' ? input.command : '';
    // N1：非命令类工具（media:delete 等）改用工具调用键（toolName:稳定JSON）作为放行
    // 哈希——审批后 LLM 重发时工具内 isToolCallApproved 命中才真正执行；bash 类工具
    // toolCallApprovalKey 返回 command 原值，哈希与既有命令级审批完全一致（零行为变化）。
    // PR-2：改为工具可声明的授权维度（如 `file_write` 只按路径），未声明 ⇒ 全参数 JSON。
    const tool = ports.toolRegistry?.getTool(toolName);
    const approvalFingerprint = resolveApprovalFingerprint(
      tool ?? toolName,
      input
    );
    const approvalHash = hashCommandForExecution(approvalFingerprint);
    const sid = sessionId || 'default';

    // PR-1（2026-10-23）：同指纹的待审批项已存在 ⇒ 复用，不重复建卡。
    const existingId = await findPendingApprovalId(inboxManager, {
      sessionId: sid,
      toolName,
      approvalHash,
    });
    if (existingId) {
      logger.info('同指纹审批卡已存在，复用而非新建（工具级审批）', {
        toolName,
        sessionId: sid,
        inboxItemId: existingId,
      });
      return existingId;
    }

    // PR-2（2026-10-23）四档：允许本次 / 本会话都允许 / 始终允许（工具+指纹）/ 拒绝
    const options = command
      ? ['approve', 'approve_session', 'allowlist_command', 'deny']
      : ['approve', 'approve_session', 'allowlist_call', 'deny'];

    // P5-1（2026-10-28）：审批四段打点 —— ① 申请 / ② 呈现（③④ 在审批解析侧）。
    // 只在新卡真正要建时开链（复用既有卡的那条链已在更早的提交里落过 ①②）。
    // 开关默认关（`config.json → approvalFourStage`）⇒ 关闭时以下调用为空操作。
    const { emitApprovalAudit, newApprovalId } =
      await import('@modules/permission');
    const approvalId = newApprovalId();
    const risk = resolveRiskClass(tool ?? toolName, input);
    if (sessionId) {
      emitApprovalAudit(sessionId, {
        stage: 'requested',
        approvalId,
        toolName,
        risk,
        inputPreview: JSON.stringify(input).slice(0, 200),
      });
    }

    const submitted = await inboxManager.submit(
      {
        sessionId: sid,
        type: 'approval',
        title: `工具审批: ${toolName}`,
        message:
          (approvalReason ? `${approvalReason}\n` : '') +
          `工具 '${toolName}' 请求执行（需人工确认）\n${
            command
              ? `命令: ${command}`
              : `参数: ${JSON.stringify(input).slice(0, 300)}`
          }`,
        // PR-2（2026-10-23）四档：允许本次 / 本会话都允许 / 始终允许（工具+指纹）/ 拒绝
        options,
        offlineCapable: true,
        source: 'permission',
        metadata: {
          toolName,
          sessionId: sid,
          toolCallId,
          // P5-1（2026-10-28）：审批链 id —— 审批解析侧据此把决定与申请串成一条链
          approvalId,
          // PR-1（2026-10-23）：**一律**写入审批指纹（非 shell 也要有），否则
          // `applyApprovalSideEffects` 因缺 hash 直接 return ⇒ 批准从不落盘。
          commandHash: approvalHash,
          // PR-2：「始终允许」持久化用（只落摘要 + 截断预览，不落明文参数）
          approvalFingerprintHash: hashApprovalFingerprint(approvalFingerprint),
          approvalFingerprintPreview:
            previewApprovalFingerprint(approvalFingerprint),
          approvalScopeKind: 'once',
          // P0-3: 携带原始命令，批准后写入放行缓存时提取命令名供命令名级放行
          command: command || undefined,
          // S1-1: 携带执行作用域 —— inbox 批准时写入放行缓存，执行端作用域不一致即不命中
          approvalScope: approvalScope ?? undefined,
          // S1-1: 携带审批快照 —— 批准时一并记录（原始命令 / 规范化命令 / 改写项）
          approvalSnapshot: approvalSnapshot ?? undefined,
          // B0-3（2026-10-30）：补来源模块 —— 缺它时 `InboxManager.submit` 会记
          // `Inbox item missing source reference` 并给卡片打 `_orphan`
          // （72h 真机 5 次；审批卡与来源工具调用脱钩后无法关联）。
          sourceModule: 'chat-tool-approval',
          inputPreview: JSON.stringify(input).slice(0, 300),
        },
      },
      sid
    );
    // U-06-5：把 Inbox 项 id 回传，供工具卡片就地审批
    const inboxItemId = (submitted as { id?: string } | null | undefined)?.id;
    if (sessionId) {
      emitApprovalAudit(sessionId, {
        stage: 'presented',
        approvalId,
        toolName,
        risk,
        options,
        fingerprintHash: hashApprovalFingerprint(approvalFingerprint),
        ...(inboxItemId ? { inboxItemId } : {}),
      });
    }
    return inboxItemId ?? null;
  } catch (err) {
    // P1-3：Inbox 提交失败降级为普通 ask 文本，不静默
    logger.warn('工具审批提交失败，降级为 ask 文本', {
      toolName,
      error: String(err),
    });
    return null;
  }
}
