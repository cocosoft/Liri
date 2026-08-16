// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 聊天辅助工具类
 * 从 ChatManager 拆分出的纯函数和轻量依赖方法，不依赖 ChatManager 的 this 上下文
 */
import { getLogger } from '@modules/monitoring';
import type { SessionConfirmedPaths } from './SessionConfirmedPaths';
import type { Message, UsageInfo } from '../types/message.js';
import { MessageRole } from '../types/message.js';
import { DataSessionStatus } from '@modules/core/data-models';
import type { ChatSession } from '../types/session.js';
import type { ToolResult } from '../types/tool.js';
import type { TodoBlockData } from '@modules/runtime/api/todo-types.js';
import { MessageType as SessionMessageType } from '@modules/session/types/Message';
import { MessageRole as SessionMessageRole } from '@modules/session/types/Message';
import type {
  UnifiedMessage,
  FrontendMessageBlock,
  MessageMetadata,
} from '@modules/session/types/Message';
import type { SessionGateway } from '@modules/session/SessionGateway';
import { SessionStateMachine } from '../../state/session/SessionStateMachine.js';
import { getAIModelManager } from '@modules/ai';

const logger = getLogger('chat:helper');

/** 工具结果默认最大字符数（Bug Fix: 从 2000 提升至 8000，防止截断丢失关键上下文导致 LLM 误判任务完成） */
export const TOOL_RESULT_MAX_LENGTH = 8000;

/**
 * AB-10 修复：Provider 原始 usage（prompt_tokens 等）→ 标准 UsageInfo。
 * 流式主回复（StreamPipeline）与工具轮次（streamMessageFlow onToolUsage）共用，
 * 保证 usage SSE 事件的字段口径一致。
 */
export function toUsageInfo(
  usage: Record<string, unknown>
): UsageInfo | undefined {
  const u = usage as Record<string, number>;
  const inputTokens = u.prompt_tokens ?? u.inputTokens ?? 0;
  const outputTokens = u.completion_tokens ?? u.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    estimatedCostUsd: u.estimated_cost_usd ?? u.estimatedCostUsd,
  };
}

/**
 * 将 Message 角色映射为 SessionMessageType
 */
export function toSessionMsgType(message: Message): SessionMessageType {
  if (message.role === MessageRole.USER) return SessionMessageType.USER;
  if (message.role === MessageRole.ASSISTANT)
    return SessionMessageType.ASSISTANT;
  if (message.role === MessageRole.TOOL) return SessionMessageType.TOOL_RESULT;
  return SessionMessageType.SYSTEM;
}

/**
 * 单轮清理：从后往前遍历，移除 tool_calls 未得到完整响应的 assistant 消息
 */
export function sanitizePass(apiMessages: Record<string, unknown>[]): void {
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    const msg = apiMessages[i];

    if (
      msg.role === 'assistant' &&
      Array.isArray(msg.tool_calls) &&
      (msg.tool_calls as Array<{ id?: string }>).length > 0
    ) {
      const pendingIds = new Set<string>();
      for (const tc of msg.tool_calls as Array<{ id?: string }>) {
        if (tc.id) pendingIds.add(tc.id);
      }

      if (pendingIds.size === 0) continue;

      let j = i + 1;
      while (j < apiMessages.length && apiMessages[j]?.role === 'tool') {
        const toolMsg = apiMessages[j];
        if (toolMsg.tool_call_id) {
          pendingIds.delete(toolMsg.tool_call_id as string);
        }
        j++;
      }

      if (pendingIds.size > 0) {
        // 有未响应的 tool_call_id：删除此 assistant 及紧随其后的 tool 消息
        apiMessages.splice(i, 1);
        while (i < apiMessages.length && apiMessages[i]?.role === 'tool') {
          apiMessages.splice(i, 1);
        }
      }
    }
  }
}

/**
 * 将会话状态字符串映射为统一 DataSessionStatus 枚举
 */
export function mapSessionStatusToState(status: string): DataSessionStatus {
  switch (status) {
    case 'active':
    case 'running':
      return DataSessionStatus.ACTIVE;
    case 'paused':
      return DataSessionStatus.PAUSED;
    case 'ended':
    case 'completed':
    case 'aborted':
      return DataSessionStatus.ENDED;
    case 'archived':
      return DataSessionStatus.ARCHIVED;
    default:
      return DataSessionStatus.ACTIVE;
  }
}

/**
 * 从工具执行结果中提取 TodoBlockData
 */
export function extractTodoData(toolResult: ToolResult): TodoBlockData | null {
  const result = toolResult as unknown as {
    metadata?: Record<string, unknown>;
  };
  const metadata = result.metadata;
  if (!metadata?._todoData) return null;

  const raw = metadata._todoData as Record<string, unknown>;

  if (Array.isArray(raw.tasks)) {
    return {
      title: (raw.title as string) || '任务计划',
      tasks: raw.tasks as TodoBlockData['tasks'],
      phase: (raw.phase as TodoBlockData['phase']) || 'planning',
      createdAt: Date.now(),
    };
  }
  return null;
}

import { ImageUrlHelper } from '../../tools/ImageUrlHelper';

/**
 * 修复 AI 响应中错误的图片 URL
 *
 * 委托给 ImageUrlHelper.repairAll，统一处理：
 * - Markdown 图片语法 ![alt](错误路径)
 * - 磁盘绝对路径 E:\...\filename.png
 * - 各种错误 URL 格式
 */
export function repairImageUrls(content: string): string {
  return ImageUrlHelper.repairAll(content);
}
export function resolveMaxContextTokens(model?: string): number {
  if (model) {
    try {
      const {
        resolveContextWindow,
      } = require('../../context/window/ContextWindowResolver');
      const ctx = resolveContextWindow(model);
      if (ctx.tokens > 0) return ctx.tokens;
    } catch {
      // 回退到 AIModelManager
    }
    try {
      const ctx = getAIModelManager().getContextWindow(model);
      if (ctx > 0) return ctx;
    } catch {
      // 模型未注册等情况
    }
  }
  return 128_000;
}

/**
 * 截断工具结果，保留前后关键信息
 * 策略：前 500 字符（上下文） + 后 1500 字符（file_path 等关键信息）
 * 并在截断提示中列出工具结果中包含的文件路径，避免路径幻觉
 */
export function truncateToolResult(
  content: string,
  maxLen: number = TOOL_RESULT_MAX_LENGTH,
  confirmedPaths?: SessionConfirmedPaths
): string {
  const sizeKB = Math.round(content.length / 1024);
  if (content.length <= maxLen) return content;

  const headLen = 500;
  const tailLen = maxLen - headLen;
  const omitted = content.length - headLen - tailLen;

  // 从原始内容中提取文件路径（优先保留，减少路径幻觉）
  const filePathRegex =
    /[a-zA-Z]:\\(?:[^\\\n\r]+\\)*[^\\\n\r]*\.[a-zA-Z0-9]+|\/(?:[^/\n\r]+\/)*[^/\n\r]*\.[a-zA-Z0-9]+/g;
  const matchedPaths = content.match(filePathRegex);
  const uniquePaths = matchedPaths
    ? [...new Set(matchedPaths)].slice(0, 5).join('\n  ')
    : '';

  // 将截断保留的路径注册到 SessionConfirmedPaths（方案 4 联动）
  if (confirmedPaths && matchedPaths) {
    for (const p of new Set(matchedPaths)) {
      confirmedPaths.add(p);
    }
  }

  const header = uniquePaths
    ? `[工具结果已截断，原始大小 ${sizeKB}KB，保留首尾关键信息]\n涉及的路径:\n  ${uniquePaths}\n`
    : `[工具结果已截断，原始大小 ${sizeKB}KB，保留首尾关键信息]\n`;

  return (
    header +
    content.slice(0, headLen) +
    `\n\n... [中间省略 ${omitted} 字符] ...\n\n` +
    content.slice(content.length - tailLen)
  );
}

/**
 * 从会话缓存中获取会话
 * @param sessions 会话缓存 Map
 * @param sessionId 会话 ID
 */
export function getLocalSession(
  sessions: Map<string, ChatSession>,
  sessionId: string | null | undefined
): ChatSession | undefined {
  if (!sessionId) return undefined;
  const session = sessions.get(sessionId);
  if (!session) {
    logger.warn('缓存未命中', { sessionId });
  }
  return session;
}

/**
 * 获取或创建会话状态机
 * @param machines 状态机缓存 Map
 * @param sessionId 会话 ID
 */
export function getOrCreateSessionMachine(
  machines: Map<string, SessionStateMachine>,
  sessionId: string
): SessionStateMachine {
  let machine = machines.get(sessionId);
  if (!machine) {
    machine = new SessionStateMachine(sessionId);
    machines.set(sessionId, machine);
  }
  return machine;
}

/**
 * 将 chat Message 转换为 UnifiedMessage 并持久化到 SessionGateway
 * @param gateway 会话持久化网关
 * @param sessionId 会话 ID
 * @param message 聊天消息
 */
export async function persistChatMessage(
  gateway: SessionGateway,
  sessionId: string,
  message: Message
): Promise<void> {
  const toolCalls =
    message.tool_calls ||
    (message.metadata?.tool_calls as
      | Array<Record<string, unknown>>
      | undefined);
  const metadataObj: MessageMetadata = {
    ...(message.metadata as MessageMetadata | undefined),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(toolCalls ? { tool_calls: toolCalls } : {}),
  };
  const unifiedMessage: UnifiedMessage = {
    id: message.id,
    sessionId,
    type: toSessionMsgType(message),
    role: message.role as unknown as SessionMessageRole,
    content:
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
    timestamp: message.createdAt?.getTime() ?? Date.now(),
    // 1.6：流式开始时间随消息落盘（与 timestamp 完成时间区分）
    startedAt: message.startedAt?.getTime(),
    metadata: metadataObj,
    blocks: message.blocks as unknown as FrontendMessageBlock[] | undefined,
    // AB-11 修复：finishReason 随消息落盘，全量刷新后前端可区分截断/错误/正常
    finishReason: message.finishReason,
  };
  try {
    await gateway.sendMessage(sessionId, unifiedMessage);
  } catch (err) {
    // 持久化失败不应影响主消息流，已由 Proxy 的 .catch 记录日志
  }
}

/**
 * 判断 LLM 端点是否为本地服务（llama.cpp / Ollama 等）。
 * /tokenize 端点仅本地服务提供；对远程 API（OpenAI/DeepSeek 等）发起
 * /tokenize 会得到 401/404（无鉴权或端点不存在）——2026-08-13 日志排查发现
 * 每次流式回复前对 api.deepseek.com 的探测产生 20+ 次 status=401 噪音并
 * 误判"端点不可用"。远程 baseUrl 直接跳过（R 修复 2026-08-13）。
 */
export function isLocalLlmEndpoint(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    const isLocal =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1';
    // 端点识别排查日志：baseUrl → hostname → 判定结果。
    // 决策链路：本地 → 走 llama.cpp 精确截断；远程 → 跳过 /tokenize（避免 401 噪音）
    logger.info('isLocalLlmEndpoint 判定', {
      baseUrl,
      hostname,
      isLocal,
    });
    return isLocal;
  } catch {
    // 非法 URL 按远程处理（跳过 /tokenize），不抛错中断主流程
    logger.warn('isLocalLlmEndpoint 解析失败（非法 URL，按远程处理）', {
      baseUrl,
    });
    return false;
  }
}
