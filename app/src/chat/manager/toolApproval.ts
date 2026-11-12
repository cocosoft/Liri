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
 * 依赖照旧走**动态 import**（`@openliri/infra/permission` / `InboxManager`）—— 刻意不提到静态图，
 * 以免改变启动期 eager 依赖（与迁移前一致）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { isShellToolName } from '@openliri/infra/utils/toolContract/toolRoles';
import type { ToolRegistry } from '@modules/tools';
import type {
  ApprovalScope,
  ApprovalSnapshot,
} from '@openliri/infra/permission';

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
      const { isToolCallApproved, getActiveTaskId } =
        await import('@openliri/infra/permission');
      // P2（§3.3）：任务档条目只有带上"当前活跃任务"才命中（不传 ⇒ 任务档一律不命中）
      const taskId = getActiveTaskId(sessionId);
      return (
        !!sessionId &&
        isToolCallApproved(
          sessionId,
          toolName,
          input,
          approvalFingerprint,
          taskId
        )
      );
    }
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command || !sessionId) return false;
    // P0-2: 统一 hashCommandForExecution，与提交审批端（PermissionChecker）hash 一致
    // P0-3: 精确 hash 命中 或 命令名级放行命中（非危险命令，安全层仍兜底）→ 跳过 ask 弹卡
    const {
      getApprovedCommandRegistry,
      hashCommandForExecution,
      getActiveTaskId,
    } = await import('@openliri/infra/permission');
    const registry = getApprovedCommandRegistry();
    const taskId = getActiveTaskId(sessionId);
    return (
      registry.isApproved(
        sessionId,
        hashCommandForExecution(command),
        undefined,
        taskId
      ) || registry.isCommandNameApproved(sessionId, command, taskId)
    );
  } catch {
    // registry 不可用时按未批准处理，不影响安全底线（ask 仍会提交卡片）
    return false;
  }
}

/**
 * 2026-11-12：该调用是否**仍在等用户审批**（有未处理的审批卡且放行缓存未写入）。
 *
 * 用途：`resumeStream` 重放 `awaiting_approval` 调用前的前置判定。重放的前提是"审批已落定"；
 * 卡还没处理就重放 ⇒ 再执行一次 + 同指纹复用同一 Inbox 项 + 再写一条 `awaiting_approval`
 * tool/result（新 messageId）⇒ 前端重复审批卡（真机 `session_mwd5mp8jd5fe8bce9c` /
 * `session_mwcyhmmpd44e93b602`）。
 *
 * 为什么不用"messages 里的 awaiting 标记"：检查点（`checkpoint.messages`）可能只含
 * user + assistant，**不含**那条 `awaiting_approval` 的 tool 结果 ⇒ 标记不可靠；而 Inbox 的
 * 待审批项是用户可见、可操作的唯一事实源。
 *
 * 判据顺序：① 放行缓存命中 ⇒ 已落定（不是等待）；② 同指纹待审批项存在 ⇒ 等待中。
 */
export async function isAwaitingUserApproval(
  ports: ToolApprovalPorts,
  toolName: string,
  input: Record<string, unknown>,
  sessionId: string | undefined,
  toolCallId?: string
): Promise<boolean> {
  const sid = sessionId || 'default';
  try {
    const tool = ports.toolRegistry?.getTool(toolName);
    // 权限层沿用本模块的**动态 import** 约定（不把 permission/Inbox 提到启动期静态图）
    const {
      buildToolApprovalCard,
      findPendingApprovalId,
      resolveApprovalFingerprint,
    } = await import('@openliri/infra/permission');
    // ① 已批准（或"本会话/本任务都允许"命中）⇒ 审批已落定，续跑必须重放
    if (
      await isCommandApproved(
        toolName,
        input,
        sid,
        resolveApprovalFingerprint(tool ?? toolName, input)
      )
    ) {
      return false;
    }
    // ② 与建卡同一构造点算 commandHash，再查同指纹的待审批项
    const { inboxManager } =
      await import('@openliri/service/runtime/InboxManager');
    const card = buildToolApprovalCard({
      toolOrName: tool ?? toolName,
      input,
      sessionId: sid,
      toolCallId: toolCallId ?? '',
      // 与 `submitToolApproval` 同源（`_orphan` 判定只要求非空）
      sourceModule: 'chat-tool-approval',
    });
    const pendingId = await findPendingApprovalId(inboxManager, {
      sessionId: sid,
      toolName,
      approvalHash: card.commandHash,
    });
    return !!pendingId;
  } catch (e) {
    // 审批链路不可用（Inbox 库/迁移未就绪）⇒ 按"未在等待"处理，续跑保持既有重放行为（不静默丢调用）
    logger.warn('等待审批判定失败，按未等待处理', {
      toolName,
      sessionId: sid,
      error: String(e),
    });
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
    const { inboxManager } =
      await import('@openliri/service/runtime/InboxManager');
    // P1（2026-11-04）：审批卡构造收敛到 infra 的**唯一构造点**（与判定前路径同一实现，
    // 见 `packages/infra/src/permission/toolApprovalSubmission.ts`）。此前两处各拼一份，
    // 导致执行后路径缺 `metadata.risk`、`EXTERNAL` 类工具仍给永久放行选项。
    const { buildToolApprovalCard, emitApprovalAudit, findPendingApprovalId } =
      await import('@openliri/infra/permission');
    const tool = ports.toolRegistry?.getTool(toolName);
    const sid = sessionId || 'default';

    const card = buildToolApprovalCard({
      toolOrName: tool ?? toolName,
      input,
      sessionId: sid,
      approvalReason,
      toolCallId,
      // 来源模块沿用本路径的历史值（`_orphan` 判定只要求非空，故仍可分辨来源）
      sourceModule: 'chat-tool-approval',
      approvalScope,
      approvalSnapshot,
    });

    // PR-1（2026-10-23）：同指纹的待审批项已存在 ⇒ 复用，不重复建卡（也不重复开审批链）
    const existingId = await findPendingApprovalId(inboxManager, {
      sessionId: sid,
      toolName,
      approvalHash: card.commandHash,
    });
    if (existingId) {
      logger.info('同指纹审批卡已存在，复用而非新建（工具级审批）', {
        toolName,
        sessionId: sid,
        inboxItemId: existingId,
      });
      return existingId;
    }

    // P5-1：① 申请（只在新卡真正要建时开链）
    emitApprovalAudit(sid, {
      stage: 'requested',
      approvalId: card.approvalId,
      toolName,
      risk: card.risk,
      inputPreview: JSON.stringify(input).slice(0, 200),
    });

    const submitted = await inboxManager.submit(
      {
        sessionId: sid,
        type: 'approval',
        title: card.title,
        message: card.message,
        options: card.options,
        offlineCapable: true,
        source: 'permission',
        metadata: card.metadata,
      },
      // 第二参数沿用本路径既有语义：把 inbox block 注入该会话的聊天消息流
      // （判定前路径不注入，故仍由调用方各自决定 —— 合并的只是**卡片内容**）
      sid
    );

    // U-06-5：把 Inbox 项 id 回传，供工具卡片就地审批
    const inboxItemId = (submitted as { id?: string } | null | undefined)?.id;
    // P5-1：② 呈现
    emitApprovalAudit(sid, {
      stage: 'presented',
      approvalId: card.approvalId,
      toolName,
      risk: card.risk,
      options: card.options,
      fingerprintHash: card.fingerprintHash,
      ...(inboxItemId ? { inboxItemId } : {}),
    });
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
