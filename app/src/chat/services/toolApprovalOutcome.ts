// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具「需要审批」结果整形（2026-11-17，T3 复杂度清理 stage 7）。
 *
 * 从 `ToolExecutionService._executeInternal` **原样搬出**「工具返回需要审批」整段：
 *  ① 已批准过同一指纹 ⇒ 直接复跑一次（不再建卡）；
 *  ② 否则提交审批卡 ⇒ 返回 `awaiting_approval`（含 Inbox 项 id）；
 *  ③ 提交失败 ⇒ 如实回传工具自身错误/输出（不伪造成"等待审批"）。
 *
 * 语义约定：返回 `null` ⇒ 工具**不是**审批路径，调用方继续常规结果处理。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { ToolExecutionStatus } from '@openliri/infra/utils/toolContract/ToolResult';
import { resolveApprovalFingerprint } from '@openliri/infra/permission';
// P2-1（2026-11-24，R09-013）：工具执行瞬态转移落 `state/transition` 审计
import { emitStateTransitionAudit } from '@openliri/infra/state/engine/stateTransitionAudit';
// 转移起点走 toolCall 机唯一事实源常量（不在业务文件裸写 'running'）
import { TOOL_CALL_INITIAL_STATUS } from '@openliri/service/execution';
import type {
  ApprovalScope,
  ApprovalSnapshot,
} from '@openliri/infra/permission';
import type { ToolResult } from '@modules/session/types/tool.js';
import type { Tool } from '../../tools/types/Tool';

const logger = getLogger('chat:toolExecution');

/** 工具注册表返回的最小结构（只声明本段用到的字段） */
export interface ToolExecutionRawResult {
  data?: unknown;
  error?: unknown;
  metadata?: {
    error?: unknown;
    approvalScope?: ApprovalScope;
    approvalSnapshot?: ApprovalSnapshot;
  };
  output?: string;
  status?: string;
  requireApproval?: boolean;
  approvalReason?: string;
}

export interface ToolApprovalOutcomeDeps {
  isCommandApproved(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
    approvalFingerprint?: string
  ): Promise<boolean>;
  submitToolApproval(
    toolName: string,
    input: Record<string, unknown>,
    sessionId: string | undefined,
    toolCallId: string,
    approvalReason?: string,
    approvalScope?: ApprovalScope,
    approvalSnapshot?: ApprovalSnapshot
  ): Promise<string | null>;
  resolveRegisteredTool(name: string): Tool | undefined;
  /** 瞬态「等待审批」状态值（唯一事实源仍在 ToolExecutionService 常量） */
  awaitingApprovalStatus: string;
}

export interface ToolApprovalOutcomeParams {
  toolCall: { id: string; name: string; sessionId?: string };
  args: Record<string, unknown>;
  toolResult: ToolExecutionRawResult;
  /** 已批准命中时复跑一次（仅重试一次，避免递归） */
  executeAgain: () => Promise<{
    data?: unknown;
    output?: string;
    error?: unknown;
  }>;
  deps: ToolApprovalOutcomeDeps;
}

export async function resolveToolApprovalOutcome(
  params: ToolApprovalOutcomeParams
): Promise<ToolResult | null> {
  const { toolCall, args, toolResult, executeAgain, deps } = params;

  const needsApproval =
    (toolResult as { requireApproval?: boolean }).requireApproval === true ||
    (toolResult as { status?: string }).status ===
      (ToolExecutionStatus.REQUIRES_APPROVAL as string);
  if (!needsApproval) return null;

  // P2-1（R09-013）：瞬态机第一次转移（running → requires_approval）。
  // 取值走枚举成员 / 注入常量（`stateMachineHygiene` 禁止裸字面量）。
  emitStateTransitionAudit(toolCall.sessionId, {
    machine: 'toolExecutionTransient',
    from: TOOL_CALL_INITIAL_STATUS,
    to: String(ToolExecutionStatus.REQUIRES_APPROVAL),
    reason: 'tool_require_approval',
    subjectId: toolCall.id,
  });

  const approvalReason = (toolResult as { approvalReason?: string })
    .approvalReason;
  // S1-1：若工具在结果 metadata 中声明了审批作用域（如 BashTool 的 cwd/env/平台），
  // 随卡片提交 ⇒ 批准时写入放行缓存 ⇒ 执行端作用域不一致即不命中（fail-closed）。
  const approvalScope = (
    toolResult as { metadata?: { approvalScope?: ApprovalScope } }
  ).metadata?.approvalScope;
  const approvalSnapshot = (
    toolResult as { metadata?: { approvalSnapshot?: ApprovalSnapshot } }
  ).metadata?.approvalSnapshot;

  // PR-1（2026-10-23）：已批准过**同一指纹** ⇒ 不再建卡，直接复跑一次
  // （工具内部会命中 `isToolCallApproved` 并真正执行；仅重试一次，避免递归）。
  if (
    await deps.isCommandApproved(
      toolCall.name,
      args,
      toolCall.sessionId,
      resolveApprovalFingerprint(
        deps.resolveRegisteredTool(toolCall.name) ?? toolCall.name,
        args
      )
    )
  ) {
    logger.info('工具级审批已命中放行缓存，直接复跑（不再建卡）', {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
    });
    const retried = await executeAgain();
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: retried.data ?? retried.output,
      error: typeof retried.error === 'string' ? retried.error : undefined,
    };
  }

  const submitted = await deps.submitToolApproval(
    toolCall.name,
    args,
    toolCall.sessionId,
    toolCall.id,
    approvalReason,
    approvalScope,
    approvalSnapshot
  );
  if (submitted) {
    // P2-1（R09-013）：第二次转移（requires_approval → awaiting_approval，审批卡已落成）。
    emitStateTransitionAudit(toolCall.sessionId, {
      machine: 'toolExecutionTransient',
      from: String(ToolExecutionStatus.REQUIRES_APPROVAL),
      to: deps.awaitingApprovalStatus,
      reason: 'approval_card_submitted',
      subjectId: toolCall.id,
    });
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: {
        status: deps.awaitingApprovalStatus,
        message: `工具 '${toolCall.name}' 需要审批（${
          approvalReason || '高风险操作'
        }），已提交审批卡片等待用户批准。用户批准后可继续执行，请勿编造替代方案。`,
        pendingApproval: true,
        // U-06-5：Inbox 项 id —— 前端工具卡片就地审批
        inboxId: submitted,
      },
      error: undefined,
    };
  }

  const rawError =
    typeof toolResult.error === 'string'
      ? toolResult.error
      : toolResult.metadata?.error
        ? String(toolResult.metadata.error)
        : undefined;
  return {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    result: (toolResult as { output?: string }).output || toolResult.data,
    error: rawError,
  };
}
