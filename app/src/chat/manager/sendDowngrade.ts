// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * sendDowngrade — 非流式「TAORLoop 失败后的降级路径」外移（issue #17 · D1，2026-10-29）
 *
 * 迁出来源：`ChatManager._sendMessageDowngradePath` 的方法体（原 2061–2150，90 行）。
 *
 * 语义（与迁移前逐字一致）：
 * - 进入即先过**日预算闸门**（`assertEntryBudget('chat-downgrade')`）——整轮被拒时连工具副作用也不做；
 * - 逐个执行 `toolCalls` 并把结果回填为 `role:'tool'` 消息（非幂等失败附「不要盲目重试」告诫）；
 * - 发送前经 `messageProjector.project` 修复 tool 配对（防 provider 拒收）；
 * - 降级完全失败时返回固定文案的 assistant 消息（不抛）。
 *
 * 行为不变红线：不新增配置项、不改默认值、不改事件名；日志模块名仍为 `chat:manager`。
 */

import { estimateMessagesTokens } from '@modules/ai';
import type { ChatMessage, ParsedToolCall, ToolAwareClient } from '@modules/ai';
import type { ToolCall, ToolResult } from '@modules/session/types/tool';
import type { ChatSession } from '@modules/session/types/session';
import type {
  ContentBlock,
  Message,
  SendMessageOptions,
} from '@modules/session/types/message';
import { messageProjector } from '@modules/context';
import { handleError } from '@modules/error';
import { resolveToolEffect } from '@modules/tools';
import { assertEntryBudget } from '../../query/dailyBudgetGate';
import { stripThinkResponseTags } from '../services/MessageContextPipeline';

export interface SendDowngradePorts {
  /** 工具执行（宿主既有实现；`useErrorHandler: true`） */
  executeTool(
    toolCall: ToolCall,
    opts?: {
      useErrorHandler?: boolean;
      onProgress?: (progress: {
        toolUseID: string;
        data: Record<string, unknown>;
      }) => void;
    }
  ): Promise<ToolResult>;
  /** 构造 assistant 消息（宿主 `messageService.createAssistantMessage`） */
  createAssistantMessage(
    content: string | ContentBlock[],
    options?: {
      sessionId?: string;
      metadata?: Record<string, unknown>;
      id?: string;
    }
  ): Message;
  /** 追加并持久化（宿主 `_addAndPersistMessage`；原调用未 await，保持 fire-and-forget） */
  addAndPersistMessage(sessionId: string, message: Message): Promise<void>;
}

/**
 * 降级路径主函数（`activeClient.sendMessage` 直调 + 工具执行 + 消息落盘）。
 */
export async function sendMessageDowngradePath(
  ports: SendDowngradePorts,
  session: ChatSession,
  toolCalls: ParsedToolCall[],
  apiMessages: Record<string, unknown>[],
  activeClient: ToolAwareClient,
  options?: SendMessageOptions
): Promise<Message> {
  // G-2（2026-10-11，Spec `daily-budget-over-limit-ux.md` §1.2 G-2 / §5-D-1）：**降级路径补闸门**。
  //
  // 本路径**直调** `activeClient.sendMessage`（不经 `sendMessageFlow.invokeLlm` 的闸门）⇒ 此前
  // TAORLoop 一失败就换条路再烧一遍额度（G-2 的绕过路径）。判定放在**最前**：整轮被拒时
  // **连工具副作用也不做**，避免"工具已执行、模型却没调"的半成品。
  // 载体：抛带真实业务码的业务异常 —— 由调用方 `ChatOrchestrator.sendMessage` 的 catch **放行上抛**
  //（见该处预算例外）⇒ 最终经 `llmChatOps.chat` 保真为 `errorCode`（HTTP 429 + 放行入口，同 T8 契约）。
  assertEntryBudget({
    entry: 'chat-downgrade',
    estimatedTokens: estimateMessagesTokens(apiMessages),
  });

  try {
    for (const tc of toolCalls) {
      const toolResult = await ports.executeTool(
        {
          id: tc.id,
          name: tc.name,
          arguments:
            typeof tc.arguments === 'string'
              ? JSON.parse(tc.arguments)
              : tc.arguments,
          sessionId: session.id,
        },
        { useErrorHandler: true }
      );
      // 13-P1-2（2026-10-05）：非幂等工具失败 ⇒ 明确告知模型**不要盲目重试**
      // （模型是实际的"重试方"，此处是唯一能约束它的位置；策略事实源 = tools/toolEffects.ts）
      const effect = resolveToolEffect(tc.name);
      const retryCaution =
        toolResult.error && effect && effect.idempotent === false
          ? `\n\n[重试注意] 该工具已声明为**非幂等**（sideEffect=${effect.sideEffect}）：` +
            '重复执行可能导致副作用重复。请先确认上一次调用的实际影响，再决定是否重试；' +
            '必要时改为向用户确认或执行补偿，禁止直接原样重试。'
          : '';
      apiMessages.push({
        role: 'tool',
        content:
          JSON.stringify(toolResult.result ?? toolResult.error ?? '') +
          retryCaution,
        tool_call_id: tc.id,
      });
    }

    // A1（2026-08-31 对标 PilotDeck P1-1）：发送前投影——修复 tool 配对，
    // 防 provider 拒收（降级路径 tool 结果可能缺配对 assistant.tool_calls）
    const projected = messageProjector.project(
      apiMessages as unknown as ChatMessage[]
    );
    const fallbackResponse = await activeClient.sendMessage(
      projected.messages,
      options
    );
    const fallbackContent =
      typeof fallbackResponse.content === 'string'
        ? fallbackResponse.content
        : JSON.stringify(fallbackResponse.content);
    const msg = ports.createAssistantMessage(
      stripThinkResponseTags(fallbackContent),
      {
        sessionId: session.id,
      }
    );
    msg.sessionId = session.id;
    ports.addAndPersistMessage(session.id, msg);
    options?.onProgress?.({
      stage: 'completed',
      message: '处理完成（降级路径）',
    });
    return msg;
  } catch (fallbackErr) {
    await handleError(fallbackErr, {
      module: 'chat:manager',
      action: 'TAORLoop降级路径也失败',
    });
    options?.onProgress?.({
      stage: 'completed',
      message: '处理异常，请重试',
    });
    // 降级完全失败，返回错误提示消息
    return ports.createAssistantMessage('处理异常，请重试', {
      sessionId: session.id,
    });
  }
}
