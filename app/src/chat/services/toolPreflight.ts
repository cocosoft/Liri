// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具执行**预检守卫**（2026-11-17，T3 复杂度清理 stage 2）。
 *
 * 从 `ToolExecutionService._executeInternal` **原样搬出**两段入口拒绝逻辑（均先于权限链）：
 *  ① T25-07：渠道来源（不可信输入）会话 ⇒ 拒绝有副作用的工具；
 *  ② 2026-11-12：用户在审批卡上点了「拒绝」⇒ 该调用为终态（如实返回失败，不执行、不重提卡）。
 *
 * 为什么独立成模块：`_executeInternal` 圈复杂度 132+，这两段只依赖工具名/调用 id 与会话标记，
 * 抽成不依赖 `this` 的函数即可直接单测（见 `app/tests/chat/toolPreflight.test.ts`）。
 *
 * 契约：返回非 `null` ⇒ 调用方**立即返回**该结果（不进入权限/执行链）；`null` ⇒ 放行。
 * `isUntrustedSession` 以**惰性 getter** 传入 —— 与搬出前的 `&&` 短路同口径：
 * 仅当 `CHANNEL_UNTRUSTED_TAINT` 开关打开时才读取会话标记。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { feature } from '@openliri/kernel';
import { isBlockedForUntrustedOrigin } from '@modules/tools';
import { isToolCallDenied } from '@openliri/infra/permission';
import type { ToolResult } from '@modules/session/types/tool.js';

const logger = getLogger('chat:toolExecution');

export interface ToolPreflightParams {
  toolCall: { id: string; name: string; sessionId?: string };
  /** 惰性：仅开关命中时才调用（同搬出前 `&&` 短路） */
  isUntrustedSession: () => boolean;
}

export function evaluateToolPreflight(
  params: ToolPreflightParams
): ToolResult | null {
  const { toolCall, isUntrustedSession } = params;

  // ── T25-07（2026-10-25 用户裁定）：渠道来源 Taint（不可信输入）──
  // 会话由外部通道入站驱动 ⇒ `sideEffect !== 'none'` 的工具一律拒绝（external + local）。
  // 判定复用 `tools/toolEffects.ts`（唯一事实源，不按工具名硬编码）；未声明效果（MCP/插件）fail-closed。
  if (
    feature('CHANNEL_UNTRUSTED_TAINT') &&
    isUntrustedSession() &&
    isBlockedForUntrustedOrigin(toolCall.name)
  ) {
    logger.warn('chat:untrusted_origin_blocked — 渠道来源会话拒绝副作用工具', {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      sessionId: toolCall.sessionId,
    });
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: { blocked: true, reason: 'UNTRUSTED_ORIGIN' },
      error:
        `该会话由外部通道入站驱动（不可信来源），已拒绝执行有副作用的工具「${toolCall.name}」。` +
        '如需执行，请在桌面端 / REPL 继续该会话。',
    };
  }

  // ── 2026-11-12：用户在审批卡上点了「拒绝」──
  // 拒绝是**该调用**的终态：如实返回失败（不执行、不重提卡），由重新续跑的循环把这条结果
  // 交给模型改道；否则模型永远收不到"被拒"这一事实，会话停在等待审批。
  if (isToolCallDenied(toolCall.sessionId, toolCall.id)) {
    logger.info('工具调用已被用户拒绝，返回终止态', {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      sessionId: toolCall.sessionId,
    });
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: { denied: true, reason: 'USER_DENIED' },
      error:
        `用户拒绝执行该工具调用（${toolCall.name}）。` +
        '请勿重试同一命令或用等价写法绕过；如需继续，请改用其他方式（如 file_write）或向用户说明后等待指示。',
      failureKind: 'permission_denied',
      metadata: { userDenied: true },
    };
  }

  return null;
}
