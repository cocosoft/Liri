// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * sendMessageFlow — 非流式消息编排阶段管线（ChatManager 拆分第 4 步）
 *
 * 从 ChatManager.sendMessage（~890 行）提取的阶段函数。
 * 每个阶段为纯函数，通过 SendMessageContext 共享数据，
 * 编排顺序由 ChatOrchestrator.sendMessage 控制。
 */

import { join, isAbsolute, resolve } from 'path';
import { existsSync } from 'fs';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { createSystemMessage } from '../types/message.js';
import { estimateMessagesTokens } from '../../ai/tokenizer/TokenEstimator';
import { resolveMaxContextTokens } from '../services/ChatHelper';
import {
  repairImageUrls,
  TOOL_RESULT_MAX_LENGTH,
  truncateToolResult,
} from '../services/ChatHelper';
import {
  ensureThinkResponseTags,
  stripThinkResponseTags,
  stripOrphanToolTags,
} from '../services/MessageContextPipeline';
import { stripBareExploration } from '../services/bareExplorationStripper';
import { StreamingToolCallScrubber } from '../../streaming/scrubbers/StreamingToolCallScrubber';
import { validatePathsInOutput } from '../services/PathGuardService';
import { trackUsage } from '@modules/ai';
import { getModelPricing } from '@modules/cost/ModelPricing.js';
// eslint-disable-next-line module-registry/no-direct-module-import
import { calculateTotalCost } from '@modules/cost/calculateCost.js';
import { compactionOrchestrator } from '../../context/compaction/CompactionOrchestrator';
import { resolveOutputDir } from '@modules/core/paths';
import { agentTelemetry } from '../../agent/AgentTelemetry.js';
import { trajectoryRecorder } from '../../agent/trajectory/TrajectoryRecorder';
import type { ToolAwareClient } from '@modules/ai';
import type { ChatMessage, ToolDefinition, ParsedToolCall } from '@modules/ai';
import type { Message, SendMessageOptions } from '../types/message.js';
import type { ChatSession } from '../types/session.js';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';

const logger = getLogger('chat:sendFlow');

/* ===================================================================
 *  编排上下文 — sendMessage 全流程共享
 * =================================================================== */

export interface SendMessageContext {
  host: ChatOrchestratorHost;
  content: string;
  options?: SendMessageOptions;
  session: ChatSession;
  sessionId: string;
  apiMessages: Record<string, unknown>[];
  toolDefinitions: ToolDefinition[];
}

/* ===================================================================
 *  阶段 1：构建 API 消息列表
 * =================================================================== */

export function prepareApiMessages(
  ctx: SendMessageContext
): Record<string, unknown>[] {
  const { session, options } = ctx;
  const messages = session.messages;

  // §5.3: 排除 isTaskMessage 消息
  let apiMessages = messages
    .filter((msg) => msg.metadata?.isTaskMessage !== true)
    .map((msg) => {
      let content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);

      if (
        msg.role === 'tool' &&
        typeof content === 'string' &&
        content.length > TOOL_RESULT_MAX_LENGTH
      ) {
        content = truncateToolResult(content);
      }

      const chatMessage: Record<string, unknown> = {
        role: msg.role,
        content,
      };

      if (msg.role === 'tool') {
        const tcId =
          msg.toolCallId ||
          (msg.metadata?.toolCallId as string) ||
          (msg.metadata?.tool_call_id as string);
        if (tcId) {
          chatMessage.tool_call_id = tcId;
        }
      }

      if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
        const toolCalls = msg.metadata.tool_calls as Record<string, unknown>[];
        chatMessage.tool_calls = toolCalls.map(
          (tc: Record<string, unknown>) => {
            if (tc.type && tc.function) return tc;
            return {
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name || 'unknown',
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            };
          }
        );
      }

      return chatMessage;
    });

  // 防止跨轮 tool_calls 污染
  let lastUserMsgIdx = -1;
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    if (apiMessages[i].role === 'user') {
      lastUserMsgIdx = i;
      break;
    }
  }
  for (let i = 0; i < lastUserMsgIdx; i++) {
    const msg = apiMessages[i];
    if (msg.role === 'assistant' && msg.tool_calls) {
      logger.info('清除旧轮次 assistant tool_calls，防止跨轮污染', {
        index: i,
        toolCallCount: (msg.tool_calls as unknown[]).length,
      });
      delete msg.tool_calls;
    }
  }

  // 附带图片路径 → 文本追加到用户消息
  if (options?.images && options.images.length > 0) {
    const imagesRoot = join(resolveOutputDir(), 'images');
    const lastUserMsg = [...apiMessages]
      .reverse()
      .find((m: Record<string, unknown>) => m.role === 'user');
    if (lastUserMsg && typeof lastUserMsg.content === 'string') {
      const imagePaths = options.images
        .map((img) => {
          const absolutePath = isAbsolute(img.path)
            ? img.path
            : resolve(imagesRoot, img.path);
          if (existsSync(absolutePath)) return absolutePath;
          return null;
        })
        .filter(Boolean) as string[];
      if (imagePaths.length > 0) {
        lastUserMsg.content =
          lastUserMsg.content +
          '\n\n[附带的图片路径]\n' +
          imagePaths.map((p) => `- ${p}`).join('\n');
      }
    }
    const absoluteImagePaths = options.images.map((img) =>
      isAbsolute(img.path) ? img.path : resolve(imagesRoot, img.path)
    );
    ctx.host.imageContextService.registerImagePaths(
      options.sessionId || '',
      absoluteImagePaths
    );
  }

  // 从用户消息文本提取文件路径
  {
    const lastUserMsgForPath = [...apiMessages]
      .reverse()
      .find(
        (m: Record<string, unknown>) =>
          m.role === 'user' && typeof m.content === 'string'
      );
    if (lastUserMsgForPath && options?.sessionId) {
      const textContent = lastUserMsgForPath.content as string;
      const extractedPaths = ctx.host.extractFilePathsFromText(textContent);
      if (extractedPaths.length > 0) {
        ctx.host.imageContextService.registerImagePaths(
          options.sessionId,
          extractedPaths
        );
        logger.info('从用户消息文本中提取并注册文件路径', {
          sessionId: options.sessionId,
          pathCount: extractedPaths.length,
        });
      }
    }
  }

  return apiMessages;
}

/* ===================================================================
 *  阶段 2：组装系统提示（无 system 消息时）
 * =================================================================== */

export async function assembleSystemPrompt(
  ctx: SendMessageContext
): Promise<Record<string, unknown>[]> {
  const { host, session, options, content } = ctx;
  const hasSystemMessage = ctx.apiMessages.some((m) => m.role === 'system');
  if (hasSystemMessage) return ctx.apiMessages;

  const assembled = await host.getOrAssembleSystemPrompt(session, content);
  const sysPrompt = options?.systemPrompt
    ? `${assembled}\n\n## 用户自定义系统提示\n${options.systemPrompt}`
    : assembled;
  ctx.apiMessages.unshift({ role: 'system', content: sysPrompt });
  return ctx.apiMessages;
}

/* ===================================================================
 *  阶段 3：共享上下文注入（CombinedSessionGateway）
 * =================================================================== */

export async function loadSharedContext(
  ctx: SendMessageContext
): Promise<Record<string, unknown>[]> {
  const { options, session } = ctx;
  if (!options?.useSharedContext) return ctx.apiMessages;
  try {
    const { getDIContainer } = await import('../../core/DIContainer.js');
    const container = getDIContainer();
    if (container.has('combinedSessionGateway')) {
      const combinedGateway = container.resolve<{ getMessages: Function }>(
        'combinedSessionGateway'
      );
      if (typeof combinedGateway.getMessages === 'function') {
        const sharedMessages = await combinedGateway.getMessages(
          'shared-context',
          { limit: 100 }
        );
        if (sharedMessages && sharedMessages.length > 0) {
          const sharedApiMessages = sharedMessages.map(
            (msg: { role: string; content: string | unknown[] }) => ({
              role: msg.role === 'user' ? 'user' : 'assistant',
              content:
                typeof msg.content === 'string'
                  ? msg.content
                  : JSON.stringify(msg.content),
            })
          );
          const sysMsgIndex = ctx.apiMessages.findIndex(
            (m: Record<string, unknown>) => m.role === 'system'
          );
          if (sysMsgIndex >= 0) {
            ctx.apiMessages.splice(sysMsgIndex + 1, 0, ...sharedApiMessages);
          } else {
            ctx.apiMessages.unshift(...sharedApiMessages);
          }
        }
      }
    }
  } catch (err) {
    await handleError(err, {
      module: 'chat:manager',
      action: 'sharedContext_load',
    });
  }
  return ctx.apiMessages;
}

/* ===================================================================
 *  阶段 4：上下文压缩（CompactionOrchestrator 三级渐进）
 * =================================================================== */

export async function compactContext(
  ctx: SendMessageContext
): Promise<Record<string, unknown>[]> {
  const { options, session, host } = ctx;
  const beforeCompact = estimateMessagesTokens(ctx.apiMessages);
  const compResult = await compactionOrchestrator.compact(
    ctx.apiMessages as unknown as ChatMessage[],
    { model: options?.model || '', sessionId: session.id }
  );
  if (compResult.applied) {
    ctx.apiMessages = compResult.messages as unknown as Record<
      string,
      unknown
    >[];
  } else {
    const maxCtx = resolveMaxContextTokens(options?.model);
    await host.truncateApiMessages(
      ctx.apiMessages,
      maxCtx,
      session.id,
      options?.maxTokens
    );
  }

  const afterTokens = estimateMessagesTokens(ctx.apiMessages);
  const savedPercent =
    afterTokens > 0 ? Math.round((1 - afterTokens / beforeCompact) * 100) : 0;
  if (savedPercent > 0) {
    const displayMsg = `上下文已压缩: ${beforeCompact} → ${afterTokens} tokens（节省 ${savedPercent}%）`;
    logger.info('compaction:completed', {
      sessionId: session.id,
      before: beforeCompact,
      after: afterTokens,
      savedPercent,
    });
    options?.onProgress?.({
      stage: 'generating',
      message: displayMsg,
    });
    const sysMsg = createSystemMessage(
      `[上下文压缩] ${beforeCompact} → ${afterTokens} tokens（节省 ${savedPercent}%）, 策略: tiered`,
      { sessionId: session.id }
    );
    host.addAndPersistMessage(session.id, sysMsg);
    host.unifiedTracker.recordCompaction(beforeCompact, afterTokens);
  }

  // 校准：压缩后 checkBeforeRequest 设定 baselineInputTokens
  if (options?.model) {
    host.unifiedTracker.checkBeforeRequest(
      ctx.apiMessages as unknown as {
        role?: string;
        content?: string | unknown;
      }[],
      options.model,
      options?.maxTokens
    );
  }

  return ctx.apiMessages;
}

/* ===================================================================
 *  阶段 5：调用 LLM（非流式）
 * =================================================================== */

export async function invokeLlm(
  ctx: SendMessageContext,
  activeClient: ToolAwareClient
): Promise<{
  response: import('@modules/ai').ChatResponse;
  llmStartTime: number;
}> {
  const { options, session, host } = ctx;
  const llmStartTime = Date.now();

  if (host.ENABLE_TELEMETRY) {
    try {
      agentTelemetry.startTurn(
        session.id,
        options?.model ?? '',
        host.toolRoundCount + 1
      );
    } catch (err) {
      logger.debug('Telemetry recording skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
      // @ignore-catch — handleError已处理，telemetry非关键路径
      handleError(err, {
        module: 'chat:ChatManager',
        action: 'telemetry',
      }).catch(() => {});
    }
  }
  if (host.ENABLE_TRAJECTORY) {
    try {
      trajectoryRecorder.recordStep(session.id, {
        phase: 'thinking',
        input: ctx.content.slice(0, 500),
        modelName: options?.model,
      });
    } catch (err) {
      logger.debug('Telemetry recording skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.debug('准备调用 activeClient.sendMessage', {
    constructor: activeClient?.constructor?.name as string,
    providerId: activeClient?.getProviderId(),
  });

  const response = await activeClient.sendMessage(
    ctx.apiMessages as unknown as ChatMessage[],
    {
      ...options,
      tools:
        ctx.toolDefinitions.length > 0
          ? (ctx.toolDefinitions as unknown as ToolDefinition[])
          : undefined,
    }
  );

  host.recordChatResponseUsage(session.id, response.usage);

  // 异步记录使用量
  trackUsage(response, {
    model: options?.model || 'unknown',
    providerId: activeClient.getProviderId(),
    latencyMs: 0,
    isStreaming: false,
    sessionId: session.id,
  }).catch((err) => {
    logger.warn('用量记录失败', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return { response, llmStartTime };
}

/* ===================================================================
 *  阶段 6：构建助手消息 + 持久化
 * =================================================================== */

export function buildAssistantMessage(
  ctx: SendMessageContext,
  response: import('@modules/ai').ChatResponse
): Message {
  const { session, host } = ctx;
  const rawContent =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

  let assistantMessageContent = repairImageUrls(rawContent);
  // AB-12 修复：非流式与流式管线对齐（StreamPipeline.repairContent 同款 5 步）——
  // 此前非流式缺 ensureThinkResponseTags/裸探索剥离/scrubber/orphan 清理，
  // 同一模型输出走两条路径落盘内容不一致。
  assistantMessageContent = stripThinkResponseTags(
    ensureThinkResponseTags(assistantMessageContent)
  );
  const explorationStripped = stripBareExploration(assistantMessageContent);
  const scrubber = new StreamingToolCallScrubber();
  const scrubbed = scrubber.scrub({
    content: explorationStripped,
    isComplete: true,
  });
  const residual = scrubber.flush();
  assistantMessageContent = stripOrphanToolTags(scrubbed.content + residual);

  const assistantMsg = host.messageService.createAssistantMessage(
    assistantMessageContent,
    { sessionId: session.id }
  );
  assistantMsg.sessionId = session.id;
  if (response.tool_calls && response.tool_calls.length > 0) {
    const toolCallsData = response.tool_calls.map((tc: ParsedToolCall) => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments:
          typeof tc.arguments === 'string'
            ? tc.arguments
            : JSON.stringify(tc.arguments || {}),
      },
    }));
    assistantMsg.metadata = {
      ...assistantMsg.metadata,
      tool_calls: toolCallsData,
    };
  }
  host.addAndPersistMessage(session.id, assistantMsg);
  return assistantMsg;
}

/* ===================================================================
 *  阶段 7：通知 LLM 用量（onUsage 回调 + telemetry 收尾）
 * =================================================================== */

export function notifyUsage(
  ctx: SendMessageContext,
  response: import('@modules/ai').ChatResponse,
  llmDuration: number
): void {
  const { options, session, host } = ctx;
  if (options?.onUsage && response.usage) {
    const u = response.usage;
    const inputTokens = u.prompt_tokens ?? 0;
    const outputTokens = u.completion_tokens ?? 0;
    options.onUsage({
      inputTokens,
      outputTokens,
      cacheReadInputTokens: u.cache_read_input_tokens,
      cacheCreationInputTokens: u.cache_creation_input_tokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: (() => {
        try {
          return calculateTotalCost(
            getModelPricing(response.model ?? ''),
            inputTokens,
            outputTokens,
            u.cache_creation_input_tokens ?? 0,
            u.cache_read_input_tokens ?? 0
          );
        } catch {
          return 0;
        }
      })(),
    });
  }

  if (host.ENABLE_TELEMETRY) {
    try {
      agentTelemetry.recordTokens(
        session.id,
        response.usage?.prompt_tokens ?? 0,
        response.usage?.completion_tokens ?? 0
      );
    } catch (err) {
      logger.debug('Telemetry recording skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (host.ENABLE_TRAJECTORY) {
    try {
      trajectoryRecorder.recordStep(session.id, {
        phase: 'response',
        output:
          typeof response.content === 'string'
            ? response.content.slice(0, 500)
            : '',
        tokensUsed:
          (response.usage?.prompt_tokens ?? 0) +
          (response.usage?.completion_tokens ?? 0),
        durationMs: llmDuration,
      });
    } catch (err) {
      logger.debug('Telemetry recording skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/* ===================================================================
 *  阶段 8：路径幻觉校验（dry-run）
 * =================================================================== */

export async function validateOutputPaths(
  ctx: SendMessageContext,
  content: string
): Promise<void> {
  const result = await validatePathsInOutput(
    content,
    ctx.host.imageContextService.confirmedPaths
  );
  if (result.corrections.length > 0) {
    // 当前 dry-run 模式，只记录不修改文本
  }
}

/* ===================================================================
 *  阶段 9：隐式 PDCA / 计划编排
 * =================================================================== */

export function shouldRunPlan(
  ctx: SendMessageContext,
  response: import('@modules/ai').ChatResponse
): boolean {
  return (
    !ctx.host.executingPlan &&
    (response.tool_calls?.some((tc) => tc.name === 'create_task_list') ?? false)
  );
}
