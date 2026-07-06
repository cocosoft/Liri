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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { repairModelJson } from '@modules/utils/json';
import { containsComplexKeywords } from '@modules/workspace/CouncilOrchestrator';

const logger = new Logger({ module: 'chat:manager', level: LogLevel.INFO });

/** 系统提示词中的上下文保持 + 行为约束规则 */
const MEMORY_CONTEXT_RULES = `## 上下文保持规则
你是当前会话的持续参与者。用户已提供的个人信息（姓名、背景、经历、偏好等）不会因上下文压缩而消失。若需要回顾用户信息，请使用 recall_memory 工具查询。**禁止**在已知用户信息的情况下重新询问姓名、联系方式、经历等基础问题。

## 输出行为约束
1. **语言统一**：始终使用与用户上一条消息相同的语言回答。
2. **思考过程分离**：所有内部推理、计划、工具调用前的思考必须放在 \\\`\\\` 标签内（例如 \\\`让我分析一下...\\\`）。标签内的内容不会展示给用户。不要在最终回答中泄漏内部思考。
3. **承诺-落地**：当你向用户承诺"我会出报告/做分析/调用工具"时，必须在同一回复中真正完成该动作。仅描述"准备做"而未实际输出结果，视为违反此约束。
4. **先分析再提问，区分开放式/封闭式问题**：使用 ask_user_question 工具前，必须先输出实质性分析/方案/计划让用户了解当前进展。禁止在未输出任何实质性内容的情况下直接调用 ask_user_question 向用户提问。选项中不应包含"继续"等暗示已有方案的模糊标签。**开放性问题（无法穷举选项的，如"你想做什么？""目标是什么？"）不要用 ask_user_question 工具，直接在正文中以自然语言提问即可。**
5. **失败透明**：当工具调用失败时，明确告诉用户失败原因和影响，不要默默切换方案继续。
6. **直接行动，禁止反复确认**：用户给出任务后直接执行或回答，禁止问"要不要我继续？""你确认要执行吗？""需要我进一步分析吗？"等确认性问题，也禁止用 ask_user_question 工具以"是否继续推进"等形式变相确认。做完后直接输出结果即可。`;

/** 图像工具链式操作指南 */
const IMAGE_CHAIN_RULES = `## 图像工具链式操作
当用户请求涉及多个图像操作时（如"生成一张图，然后编辑它，再分析一下"），你可以在单次回复中**依次调用多个工具**组成链式操作。规则如下：

1. **识别链式意图**：用户消息中包含"然后""再""接着""并且"等连接词，通常表示多个操作意图。
2. **顺序执行**：按用户描述的顺序依次调用工具，**前一个工具的输出路径作为后一个工具的 inputPath**。
3. **路径传递**：
   - image_generate 返回 images[0].filePath → 作为后续 image/image_analysis 的 inputPath
   - image 返回 outputPath → 作为后续工具的 inputPath
   - canvas export 返回 outputPath → 作为后续工具的 inputPath
4. **常见链式模式**：
   - 生成 → 编辑：先 image_generate 生成图片，再 image 进行裁剪/调色/加水印等
   - 生成 → 分析：先 image_generate 生成图片，再 image_analysis 分析内容
   - 编辑 → 分析：先 image 编辑图片，再 image_analysis 分析结果
   - 生成 → 画布标注：先 image_generate 生成底图，再 canvas import 后在画布上标注
5. **错误处理**：如果链中某一步失败，报告失败原因并停止后续步骤。不要默默跳过失败继续。`;

import type { ChatManager } from './ChatManagerInterface.js';

/**
 * 聊天管理器
 * 聊天功能的核心管理类，负责整合所有聊天相关的功能
 */
import type {
  Message,
  SendMessageOptions,
  StreamMessageOptions,
  ChatResponse,
} from './types/message.js';
import { MessageRole } from './types/message.js';
import type { ChatSession, CreateSessionParams } from './types/session.js';
import { SessionState } from './types/session.js';
import type { ToolCall, ToolResult, ToolIntegration } from './types/tool.js';
import { getToolCallName } from './types/tool.js';
import {
  MessageService,
  createMessageService,
} from './services/MessageService.js';
import {
  StreamService,
  createStreamService,
} from './services/StreamService.js';
import { SessionStateMachine } from '../state/session/SessionStateMachine.js';
import { sessionMetadataService } from './services/SessionMetadataService.js';
import { eventNotificationService } from './services/EventNotificationService.js';
import { messageProcessingService } from './services/MessageProcessingService.js';
import { permissionModeIntegrationService } from './services/PermissionModeIntegrationService.js';
import { performanceOptimizationService } from './services/PerformanceOptimizationService.js';
import { securityService } from './services/SecurityService.js';
import { getCheckpointService } from './services/SessionCheckpointService.js';
import { HookChainManager } from '@modules/hooks/core/HookChainManager.js';
import {
  recursivelySanitizeUnicode,
  sanitizeHTML,
  validateInput,
} from '@modules/utils/sanitization.js';
import { toolResultRegistry } from '../tool/ToolResultRegistry.js';
import { ToolAwareClient } from '@modules/ai';
import { getAIModelManager } from '@modules/ai';
import { providerRegistry } from '@modules/ai';
import { trackUsage } from '@modules/ai';
import type { IToolExecutor } from '@modules/ai';
import type { ToolRegistry } from '@modules/tools/ToolRegistry';
import type { ChatMessage, ParsedToolCall, ToolDefinition } from '@modules/ai';
import type { ThinkingProviderChunk } from '@modules/ai';
import type {
  ChatStreamChunk,
  QuestionData,
} from '@modules/runtime/api/CoreAPI.js';
import type { TodoBlockData } from '@modules/runtime/api/todo-types.js';
import { assembleSystemPrompt } from '@modules/services/prompt/PromptAssembler';
import { setCurrentKnowledgeQuery } from '@modules/services/prompt/KnowledgePromptProvider';
import type { SessionContext } from '@modules/memory/types/SessionContext';
import {
  QueryEngine,
  createQueryEngine,
  type QueryEngineConfig,
} from '../query/QueryEngine.js';
import {
  CompactServiceImpl,
  type CompactBoundary,
  type CompactArtifact,
} from '../services/compact/CompactService.js';
import type { SessionMessage } from '@modules/session/models/SessionMessage';
import { SessionTokenTracker } from '@modules/session/TokenTracker';
import {
  SessionGateway,
  createSessionGateway,
} from '@modules/session/SessionGateway';
import type {
  UnifiedMessage,
  FrontendMessageBlock,
  MessageMetadata,
} from '@modules/session/types/Message';
import { MessageType as SessionMessageType } from '@modules/session/types/Message';
import { MessageRole as SessionMessageRole } from '@modules/session/types/Message';
import { resolveProjectRoot } from '@modules/core';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { roughTokenCountForMessages } from '../services/tokenManagement/TokenCounter.js';
import { ContextCompressor } from '@modules/agent/ContextCompressor';

import { TaskStatus } from '@modules/tasks/types';

import { RollbackIntegration, SensitiveErrorType } from '@modules/security';
import type { FileOperation } from '@modules/security';
import { FILE_WRITE_TOOL_NAME, FILE_EDIT_TOOL_NAME } from '@modules/constants';
import { taskRegistry } from '@modules/tasks/TaskRegistry';
import { taskOrchestrator } from '@modules/tasks/TaskOrchestrator';
import { getSessionActivityTracker } from '../session/bootstrap/SessionSystemBootstrap';
import { getSessionMemoryManager } from '../session/bootstrap/SessionSystemBootstrap';
import { getSessionStateHydrator } from '../session/bootstrap/SessionSystemBootstrap';
import { SessionMemoryExtractor } from '../session/memory/SessionMemoryExtractor';
import { MEMORY_TEMPLATE } from '../session/memory/memoryTemplate';

/** 非流式路径中待恢复的工具循环状态 */
interface InteractionSavedState {
  currentRoundMessages: Record<string, unknown>[];
  currentToolCalls: ParsedToolCall[];
  processedResults: Array<{
    normalizedToolCall: ToolCall;
    result: ToolResult;
  }>;
  interactionIdx: number;
  roundAssistantMsg: Message;
  toolDefinitions: Record<string, unknown>[];
  sessionId: string;
  questionData: QuestionData;
}

/**
 * 聊天管理器实现
 */
export class ChatManagerImpl implements ChatManager {
  /**
   * 工具结果最大字符数，超过此长度的工具结果将被截断
   * 防止大的工具执行结果在后续轮次中主导 LLM 上下文
   */
  private static readonly TOOL_RESULT_MAX_LENGTH = 2000;

  /**
   * 截断工具结果，保留前后关键信息
   * 策略：前 500 字符（上下文） + 后 1500 字符（file_path 等关键信息）
   * 并在截断提示中列出工具结果中包含的文件路径，避免路径幻觉（BUG #9）
   */
  private static truncateToolResult(
    content: string,
    maxLen: number = ChatManagerImpl.TOOL_RESULT_MAX_LENGTH
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
   * 消息服务
   */
  private messageService: MessageService;

  /**
   * 流服务
   */
  private streamService: StreamService;

  /**
   * 当前会话ID（本地缓存）
   */
  private _currentSessionId: string | null = null;
  /** 记录每个会话的离开时间戳，用于回切召回检测 */
  private _sessionLeaveTimes = new Map<string, number>();

  /**
   * 会话内存缓存
   */
  private _chatSessions: Map<string, ChatSession> = new Map();

  /**
   * 检查点服务
   */
  private _checkpointService: ReturnType<typeof getCheckpointService>;

  /**
   * LLM客户端
   */
  private llmClient: ToolAwareClient | undefined;

  /**
   * 工具集成
   */
  private toolIntegration: ToolIntegration | undefined;

  /**
   * 工具注册表
   */
  private toolRegistry: ToolRegistry | null = null;

  /**
   * 权限管理器
   */
  private permissionManager: unknown = null;

  /**
   * 工具执行器
   */
  private toolExecutor: IToolExecutor | null = null;

  /**
   * 子Agent管理器
   */
  private subAgentManager: unknown = null;

  /**
   * 会话持久化网关
   */
  private sessionGateway: SessionGateway;

  /**
   * HookChain 管理器
   */
  private hookChainManager: HookChainManager;
  private _executingPlan = false;

  /**
   * 待处理的用户交互（工具暂停/恢复机制）
   * 当工具需要用户输入时，streamMessage 会 yield question 分块，
   * 然后 await 此 Promise，直到 UI 层调用 resolveInteraction() 解析
   */
  private _pendingInteraction: {
    questionId: string;
    promise: Promise<string[]>;
    resolve: (answers: string[]) => void;
  } | null = null;

  /**
   * 非流式路径中待恢复的工具循环状态
   * 当 sendMessage 遇到需要用户交互的工具时，将循环状态保存至此 Map，
   * 等待 continueInteraction() 恢复执行
   */
  private pendingInteractions: Map<string, InteractionSavedState> = new Map();

  /**
   * 查询引擎
   */
  private queryEngine: QueryEngine | undefined;

  /**
   * 查询引擎配置
   */
  private queryEngineConfig: QueryEngineConfig | undefined;

  /**
   * 回滚集成（按会话 ID 索引）
   */
  private rollbackIntegrations: Map<string, RollbackIntegration> = new Map();

  /**
   * 会话级已知图片路径集合（用于执行工具前校验 inputPath）
   * key: sessionId, value: 已知的图片文件绝对路径集合
   */
  private _sessionImagePaths: Map<string, Set<string>> = new Map();

  /**
   * 会话级图像上下文（用于跨轮对话中 AI 引用图片）
   * key: sessionId, value: 最近图像操作记录
   */
  private _sessionImageContext: Map<
    string,
    {
      lastGeneratedImage?: { filePath: string; prompt: string };
      lastEditedImage?: { filePath: string; action: string };
      lastAnalyzedImage?: { filePath: string; action: string };
    }
  > = new Map();

  /**
   * 压缩服务
   */
  private compactService: CompactServiceImpl;

  /**
   * AI 上下文压缩器（智能摘要压缩，超限时优先使用）
   */
  private _contextCompressor: ContextCompressor;

  /**
   * 令牌追踪器
   */
  private tokenTracker: SessionTokenTracker | null = null;

  /**
   * 会话状态机映射
   */
  private sessionMachines: Map<string, SessionStateMachine> = new Map();

  /**
   * 获取或创建会话状态机
   */
  private getSessionMachine(sessionId: string): SessionStateMachine {
    let machine = this.sessionMachines.get(sessionId);
    if (!machine) {
      machine = new SessionStateMachine(sessionId);
      this.sessionMachines.set(sessionId, machine);
    }
    return machine;
  }

  /**
   * 构造函数
   */
  constructor() {
    this.messageService = createMessageService();
    this.streamService = createStreamService();
    this.sessionGateway = createSessionGateway();
    this.compactService = new CompactServiceImpl();
    this._contextCompressor = new ContextCompressor();
    this.hookChainManager = HookChainManager.getInstance();
    this._checkpointService = getCheckpointService();
  }

  /**
   * 注册会话的已知图片路径（工具调用前校验用）
   */
  private _registerImagePaths(sessionId: string, paths: string[]): void {
    if (!sessionId || paths.length === 0) return;
    let imagePaths = this._sessionImagePaths.get(sessionId);
    if (!imagePaths) {
      imagePaths = new Set<string>();
      this._sessionImagePaths.set(sessionId, imagePaths);
    }
    for (const p of paths) {
      if (p) imagePaths.add(p);
    }
  }

  /**
   * 获取会话的已知图片路径集合
   */
  private _getKnownImagePaths(sessionId: string): string[] {
    const paths = this._sessionImagePaths.get(sessionId);
    return paths ? Array.from(paths) : [];
  }

  /**
   * 在已知路径集合中查找最接近的路径
   * 使用文件名匹配：如果 AI 编造的路径中文件名与已知路径中的文件名一致，则返回已知路径
   */
  private _findClosestPath(
    inputPath: string,
    knownPaths: string[]
  ): string | null {
    if (knownPaths.length === 0) return null;

    const inputBasename = path.basename(inputPath);
    for (const known of knownPaths) {
      if (path.basename(known) === inputBasename) {
        return known;
      }
    }

    return null;
  }

  /**
   * 从工具执行结果中提取图片文件路径
   * 支持 image_generate (images[].filePath)、image (outputPath)、image_analysis (无输出)
   */
  private _extractImagePathsFromResult(
    toolName: string,
    result: Record<string, unknown>
  ): string[] {
    const paths: string[] = [];

    if (toolName === 'image_generate') {
      const images = result.images as
        | Array<{ filePath?: string; localUrl?: string }>
        | undefined;
      if (Array.isArray(images)) {
        for (const img of images) {
          if (img.filePath) paths.push(img.filePath);
          if (img.localUrl) paths.push(img.localUrl);
        }
      }
    }

    if (toolName === 'image') {
      const outputPath = result.outputPath as string | undefined;
      if (outputPath) paths.push(outputPath);
    }

    if (toolName === 'image_svg_generate') {
      const savePath = result.savePath as string | undefined;
      if (savePath) paths.push(savePath);
    }

    if (toolName === 'canvas') {
      const outputPath = result.outputPath as string | undefined;
      if (outputPath) paths.push(outputPath);
    }

    return paths;
  }

  /**
   * 更新会话级图像上下文
   */
  private _updateImageContext(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    result: Record<string, unknown>
  ): void {
    let ctx = this._sessionImageContext.get(sessionId);
    if (!ctx) {
      ctx = {};
      this._sessionImageContext.set(sessionId, ctx);
    }

    if (toolName === 'image_generate') {
      const images = result.images as Array<{ filePath?: string }> | undefined;
      if (Array.isArray(images) && images.length > 0 && images[0].filePath) {
        ctx.lastGeneratedImage = {
          filePath: images[0].filePath,
          prompt: (args.prompt as string) || '',
        };
      }
    }

    if (toolName === 'image') {
      const outputPath = result.outputPath as string | undefined;
      if (outputPath) {
        ctx.lastEditedImage = {
          filePath: outputPath,
          action: (args.action as string) || '',
        };
      }
    }

    if (toolName === 'image_analysis') {
      const inputPath = args.inputPath as string | undefined;
      if (inputPath) {
        ctx.lastAnalyzedImage = {
          filePath: inputPath,
          action: (args.action as string) || '',
        };
      }
    }

    if (toolName === 'canvas') {
      const outputPath = result.outputPath as string | undefined;
      if (outputPath) {
        ctx.lastEditedImage = {
          filePath: outputPath,
          action: (args.action as string) || 'export',
        };
      }
    }
  }

  /**
   * 构建图像上下文提示词（注入到系统提示词中）
   */
  private _buildImageContextPrompt(sessionId: string): string {
    const ctx = this._sessionImageContext.get(sessionId);
    if (!ctx) return '';

    const parts: string[] = [];

    if (ctx.lastGeneratedImage) {
      parts.push(
        `- 最近生成的图片: ${ctx.lastGeneratedImage.filePath} (提示词: ${ctx.lastGeneratedImage.prompt.slice(0, 100)})`
      );
    }
    if (ctx.lastEditedImage) {
      parts.push(
        `- 最近编辑的图片: ${ctx.lastEditedImage.filePath} (操作: ${ctx.lastEditedImage.action})`
      );
    }
    if (ctx.lastAnalyzedImage) {
      parts.push(
        `- 最近分析的图片: ${ctx.lastAnalyzedImage.filePath} (操作: ${ctx.lastAnalyzedImage.action})`
      );
    }

    if (parts.length === 0) return '';

    return (
      `\n## 当前会话图像上下文\n以下是本会话中最近操作的图片，用户可能用"这张图""刚才那张图"等指代：\n` +
      parts.join('\n') +
      `\n调用图像工具时，请使用上述真实路径作为 inputPath，不要编造路径。\n`
    );
  }

  /**
   * 添加消息到本地缓存并持久化
   */
  private _addAndPersistMessage(sessionId: string, message: Message): void {
    const session = this._chatSessions.get(sessionId);
    if (session) {
      session.messages.push(message);
      session.updatedAt = new Date();
      session.metadata.lastActivityAt = new Date();
      session.metadata.totalMessages = session.messages.length;
    }
    this.persistMessage(sessionId, message).catch((e) => {
      logger.error('Failed to persist message', {
        sessionId,
        error: String(e),
      });
    });
  }

  /**
   * 从本地缓存获取会话
   */
  private _getLocalSession(
    sessionId: string | null | undefined
  ): ChatSession | undefined {
    if (!sessionId) return undefined;
    const session = this._chatSessions.get(sessionId);
    if (!session) {
      logger.warn('缓存未命中', { sessionId });
    }
    return session;
  }

  /**
   * 更新消息的 blocks 结构并持久化
   * 使用 storage.updateMessage 按 ID 替换，避免重复追加
   */
  public async updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>
  ): Promise<void> {
    const session = this._chatSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    let message = session.messages.find((m) => m.id === messageId);

    if (!message) {
      message = session.messages.filter((m) => m.role === 'assistant').pop();
    }

    if (!message) {
      message = this.messageService.createAssistantMessage('', {
        sessionId,
      });
      message.id = messageId;
      message.blocks = blocks;
      message.createdAt = new Date();
      message.updatedAt = new Date();
      session.messages.push(message);
      await this.persistMessage(sessionId, message);
      return;
    }

    message.blocks = blocks;
    session.updatedAt = new Date();
    session.metadata.lastActivityAt = new Date();

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
      type: this.toSessionMsgType(message),
      role: message.role as unknown as SessionMessageRole,
      content:
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content),
      timestamp: message.createdAt?.getTime() ?? Date.now(),
      metadata: metadataObj,
      blocks: message.blocks as unknown as FrontendMessageBlock[] | undefined,
    };
    try {
      await this.sessionGateway.updateMessage(
        sessionId,
        messageId,
        unifiedMessage
      );
    } catch {
      // 更新失败不应影响主消息流
    }
  }

  /**
   * 将 chat Message 持久化到 SessionGateway（FileSystemUnifiedStorage）
   */
  private async persistMessage(
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
      type: this.toSessionMsgType(message),
      role: message.role as unknown as SessionMessageRole,
      content:
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content),
      timestamp: message.createdAt?.getTime() ?? Date.now(),
      metadata: metadataObj,
      blocks: message.blocks as unknown as FrontendMessageBlock[] | undefined,
    };
    try {
      await this.sessionGateway.sendMessage(sessionId, unifiedMessage);
    } catch {
      // 持久化失败不应影响主消息流，已由 Proxy 的 .catch 记录日志
    }
  }

  private toSessionMsgType(message: Message): SessionMessageType {
    if (message.role === MessageRole.USER) return SessionMessageType.USER;
    if (message.role === MessageRole.ASSISTANT)
      return SessionMessageType.ASSISTANT;
    if (message.role === MessageRole.TOOL)
      return SessionMessageType.TOOL_RESULT;
    return SessionMessageType.SYSTEM;
  }

  /**
   * 获取 HookChain 管理器
   * @returns HookChain 管理器实例
   */
  public getHookChainManager(): HookChainManager {
    return this.hookChainManager;
  }

  /**
   * 获取或组装系统提示词
   * 每次根据当前会话状态重新组装（包含动态段落如 sessionContext）
   */
  private async getOrAssembleSystemPrompt(
    session: ChatSession,
    currentMessage?: string
  ): Promise<string> {
    const providerId = this.llmClient?.getProviderId() || 'deepseek';
    const sessionContext: SessionContext = {
      sessionId: session.id,
      turnCount: session.messages.length,
      duration: Date.now() - (session.createdAt?.getTime() ?? Date.now()),
      startedAt: session.createdAt?.getTime() ?? Date.now(),
      tags: session.metadata?.tags,
    };

    if (currentMessage) {
      setCurrentKnowledgeQuery(currentMessage);
    }

    const prompt = await assembleSystemPrompt({
      providerId,
      sessionContext,
      mode: 'conversation',
    });

    // 注入当前会话目标，防止上下文截断后 LLM 丢失当前任务
    const currentGoal = this._extractCurrentGoal(session, currentMessage);
    const imageContext = this._buildImageContextPrompt(session.id);
    const basePrompt = currentGoal
      ? prompt +
        `\n\n## 当前会话目标\n你正在协助用户完成以下任务。对话中可能包含较早的无关话题，请以当前目标为准：\n\n${currentGoal}` +
        `\n\n${MEMORY_CONTEXT_RULES}${imageContext}\n\n${IMAGE_CHAIN_RULES}`
      : prompt +
        `\n\n${MEMORY_CONTEXT_RULES}${imageContext}\n\n${IMAGE_CHAIN_RULES}`;

    return basePrompt;
  }

  /**
   * 从会话中提取当前对话目标（最近一条实质性用户消息）
   * 过滤掉短回答、BUG 报告等非任务描述消息
   */
  private _extractCurrentGoal(
    session: ChatSession,
    currentMessage?: string
  ): string | null {
    // 优先使用当前消息（如果足够长）
    const candidate = currentMessage?.trim();
    if (candidate && candidate.length > 30) {
      return candidate;
    }

    // 回溯最近的用户消息，找到最近的实质性消息
    const userMessages = session.messages
      .filter((m) => m.role === 'user')
      .slice(-8);

    for (let i = userMessages.length - 1; i >= 0; i--) {
      const rawContent = userMessages[i].content;
      const content = typeof rawContent === 'string' ? rawContent.trim() : '';
      // 跳过短消息（< 30 字符的通常是选择、确认、BUG 报告等）
      if (content.length < 30) continue;
      // 跳过纯 BUG 报告
      if (/^(出?BUG|又出BUG|报错|又有BUG|出问题了)/.test(content)) continue;
      return content;
    }

    return null;
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    this.llmClient?.initialize();
    await this.sessionGateway.initialize();
    await this._loadSessionsFromGateway();

    // 启动会话活跃度追踪（心跳 + 并发控制）
    getSessionActivityTracker();

    // Worktree 存储隔离：迁移旧版会话到 worktree 路径
    try {
      const { migrateSessionsToWorktree } = await import('../core/paths.js');
      migrateSessionsToWorktree();
    } catch {
      // 非阻塞
    }

    // 连线 SessionLifecycle 事件 → 记忆/心跳自动化
    try {
      const { getGlobalEventBus } =
        await import('../session/lifecycle/SessionLifecycleEventBus.js');
      const { connectSessionHandlers } =
        await import('../session/lifecycle/SessionEventHandlers.js');
      connectSessionHandlers(getGlobalEventBus());
    } catch {
      // 非阻塞：事件连线失败不影响主流程
    }

    // 启动回滚系统：清理中断轮次 + 配额管理
    await RollbackIntegration.onAppStart().catch((err) => {
      logger.warn('回滚系统初始化失败', { error: String(err) });
      handleError(err, {
        module: 'chat:ChatManager',
        action: 'rollback:onAppStart',
      }).catch(() => {});
    });
  }

  private async _loadSessionsFromGateway(): Promise<void> {
    try {
      const storedSessions = await this.sessionGateway.listSessions();
      for (const stored of storedSessions) {
        if (this._chatSessions.has(stored.id)) continue;
        try {
          const storedMessages = await this.sessionGateway.getMessages(
            stored.id
          );
          const messages: Message[] = storedMessages.map((m) => {
            let content: string;
            if (typeof m.content === 'string') {
              content = m.content;
            } else if (Array.isArray(m.content)) {
              const textBlocks = m.content.filter((b) => b.type === 'text');
              if (textBlocks.length > 0) {
                content = textBlocks
                  .map((b) => (b as { type: 'text'; text: string }).text)
                  .join('');
              } else {
                const toolResultBlock = m.content.find(
                  (b) => b.type === 'tool_result'
                );
                content = toolResultBlock
                  ? (
                      toolResultBlock as {
                        type: 'tool_result';
                        content: string;
                      }
                    ).content || ''
                  : '';
              }
            } else {
              content = '';
            }
            return {
              id: m.id,
              role: m.role,
              content,
              createdAt: new Date(m.timestamp),
              updatedAt: new Date(m.timestamp),
              sessionId: stored.id,
              toolCallId: m.metadata?.toolCallId,
              metadata: m.metadata as Record<string, unknown> | undefined,
              blocks: m.blocks as unknown as
                | Record<string, unknown>[]
                | undefined,
              tool_calls: m.metadata?.tool_calls,
            } as Message;
          });
          // 按消息 ID 去重（保留最后一份，它包含 blocks）
          const dedupMap = new Map<string, Message>();
          for (const msg of messages) {
            dedupMap.set(msg.id, msg);
          }
          const dedupedMessages = Array.from(dedupMap.values());
          const chatSession: ChatSession = {
            id: stored.id,
            title: stored.title,
            state: this._mapSessionStatusToState(stored.status),
            metadata: {
              title: stored.title || '',
              ...stored.metadata,
              totalMessages: dedupedMessages.length,
              lastActivityAt: new Date(stored.lastActivityAt),
            },
            messages: dedupedMessages,
            createdAt: new Date(stored.createdAt),
            updatedAt: new Date(stored.updatedAt),
          };
          this._chatSessions.set(stored.id, chatSession);

          // Session State Hydration: 从 transcript 恢复衍生状态
          try {
            const hydrated = getSessionStateHydrator().hydrate(chatSession);
            if (hydrated.todos || hydrated.recentFiles.length > 0) {
              chatSession.metadata = {
                ...chatSession.metadata,
                hydratedTodos: hydrated.todos,
                hydratedRecentFiles: hydrated.recentFiles,
                hydratedDecisions: hydrated.recentDecisions,
              };
            }
          } catch {
            // 回灌失败不影响会话加载
          }
        } catch (e) {
          logger.warn('加载单个会话失败，跳过', {
            sessionId: stored.id,
            error: String(e),
          });
          continue;
        }
      }
    } catch (e) {
      logger.error('Failed to load sessions from gateway', {
        error: String(e),
      });
    }
  }

  /**
   * 清理 API 消息列表中的孤立 tool_calls 和 tool 消息。
   *
   * DeepSeek API 要求：每个 assistant 含 tool_calls 之后，
   * 紧随其后的 tool 消息必须响应其所有 tool_call_id，
   * 中间不能插入非 tool 消息。
   *
   * 此方法从后往前遍历所有 assistant 含 tool_calls，
   * 逐条检查紧随其后的 tool 消息是否全部响应。
   */
  private _sanitizeApiMessages(apiMessages: Record<string, unknown>[]): void {
    // 第一轮清理：移除 tool 响应不完整的 assistant
    this._sanitizePass(apiMessages);

    // 末尾孤立 tool 消息（没有 preceding assistant 含 tool_calls）
    while (
      apiMessages.length > 0 &&
      apiMessages[apiMessages.length - 1].role === 'tool'
    ) {
      apiMessages.pop();
    }

    // 中间孤立 tool 消息清理：
    // 1) 没有 tool_call_id 的 tool 消息（API 无法处理）
    // 2) tool_call_id 不在任何前置 assistant 的 tool_calls 中
    const knownToolCallIds = new Set<string>();
    for (let i = 0; i < apiMessages.length; i++) {
      const msg = apiMessages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls as Array<{ id?: string }>) {
          if (tc.id) knownToolCallIds.add(tc.id);
        }
      }
    }
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === 'tool') {
        const tcId = apiMessages[i].tool_call_id as string | undefined;
        if (!tcId || !knownToolCallIds.has(tcId)) {
          apiMessages.splice(i, 1);
        }
      }
    }

    // 第二轮清理：末尾 pop 和中间清理可能移除了有效 assistant 的 tool 消息，
    // 导致 assistant 变为孤立，需要再次清理
    this._sanitizePass(apiMessages);
  }

  /**
   * 单轮清理：从后往前遍历，移除 tool_calls 未得到完整响应的 assistant 消息
   * 及其紧随的 tool 消息
   */
  private _sanitizePass(apiMessages: Record<string, unknown>[]): void {
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      const msg = apiMessages[i];

      if (
        msg.role === 'assistant' &&
        Array.isArray(msg.tool_calls) &&
        (msg.tool_calls as Array<{ id?: string }>).length > 0
      ) {
        // 收集此 assistant 的所有 tool_call_id
        const pendingIds = new Set<string>();
        for (const tc of msg.tool_calls as Array<{ id?: string }>) {
          if (tc.id) pendingIds.add(tc.id);
        }

        if (pendingIds.size === 0) continue;

        // 检查紧随其后的 tool 消息是否响应了所有 tool_call_id
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
   * 上下文长度保护：估算 apiMessages 的 Token 数，超限则优先使用 AI 摘要压缩，
   * 压缩失败或压缩不足时退化为截断旧消息（保留 system prompt + 最近 N 条消息）。
   * 截断后重新 sanitize 以修复 tool/tool_calls 配对完整性。
   *
   * @param apiMessages - 待发送的消息列表（会被原地修改）
   * @param maxContextTokens - 模型上下文窗口上限（如 1_000_000），
   *       如果传入 0 或负数，则跳过滤检
   */
  private async _truncateApiMessages(
    apiMessages: Record<string, unknown>[],
    maxContextTokens: number,
    sessionId?: string
  ): Promise<void> {
    if (maxContextTokens <= 0) return;

    const RESPONSE_BUFFER_TOKENS = Math.round(maxContextTokens * 0.15);
    const SAFE_LIMIT = maxContextTokens - RESPONSE_BUFFER_TOKENS;

    const estimatedTokens = roughTokenCountForMessages(
      apiMessages as { content?: string | unknown; role?: string }[]
    );
    if (estimatedTokens <= SAFE_LIMIT) return;

    logger.warn(
      `上下文超限: 估算 ${estimatedTokens} tokens (上限 ${SAFE_LIMIT})，尝试 AI 摘要压缩`
    );

    // ── 优先尝试 AI 摘要压缩 ──
    const compressibleMessages = apiMessages.map((msg, idx) => ({
      role: msg.role as 'system' | 'user' | 'assistant' | 'tool',
      content:
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      tokenCount: roughTokenCountForMessages([
        msg as { content?: string | unknown; role?: string },
      ]),
      timestamp: Date.now() + idx,
      id: `msg_${idx}_${Date.now()}`,
      // 保留原始 metadata，确保 tool_call_id / toolCallId 不丢失
      metadata: { ...(msg as Record<string, unknown>) },
    }));
    try {
      // 通知前端：开始压缩
      eventNotificationService.emitCustomEvent('agent:context:compressing', {
        status: 'start',
        sessionId,
      });

      const compressResult =
        await this._contextCompressor.compress(compressibleMessages);
      if (
        compressResult.compressionRatio < 0.9 &&
        compressResult.messages.length > 0
      ) {
        // AI 压缩有效：将压缩结果转回 apiMessages 格式
        apiMessages.length = 0;
        for (const cm of compressResult.messages) {
          const entry: Record<string, unknown> = {
            role: cm.role,
            content: cm.content,
          };
          if (cm.metadata?.tool_calls)
            entry.tool_calls = cm.metadata.tool_calls;
          if (cm.metadata?.tool_call_id)
            entry.tool_call_id = cm.metadata.tool_call_id;
          else if (cm.metadata?.toolCallId)
            entry.tool_call_id = cm.metadata.toolCallId;
          apiMessages.push(entry);
        }
        logger.warn(
          `AI 摘要压缩完成: ${compressResult.originalTokenCount} → ${compressResult.compressedTokenCount} tokens (ratio=${compressResult.compressionRatio.toFixed(2)})`
        );

        // 通知前端：压缩完成
        eventNotificationService.emitCustomEvent('agent:context:compressed', {
          status: 'completed',
          sessionId,
          originalTokens: compressResult.originalTokenCount,
          compressedTokens: compressResult.compressedTokenCount,
        });

        // 压缩后重新 sanitize，修复可能被破坏的 tool/tool_calls 配对
        this._sanitizeApiMessages(apiMessages);
        return;
      }
    } catch (err) {
      logger.warn('AI 摘要压缩失败，退化为截断模式', { error: String(err) });
    }

    // ── AI 压缩失败/不足，退化为截断删除 ──
    logger.warn(
      `退化为截断模式: 估算 ${estimatedTokens} tokens (上限 ${SAFE_LIMIT})，将截断旧消息`
    );

    // 保护系统消息和最近的 N 条消息，移除中间的旧消息
    const systemMsg = apiMessages.find(
      (m: Record<string, unknown>) => m.role === 'system'
    );
    const nonSystemMessages = apiMessages.filter(
      (m: Record<string, unknown>) => m.role !== 'system'
    );
    // N = 总消息数 × 30%，下限 20，上限 100（修复 BUG #10 protectedCount 动态化）
    const protectedCount = Math.max(
      20,
      Math.min(100, Math.round(nonSystemMessages.length * 0.3))
    );

    // 循环截断：可能一次截断不足以降到安全线以下
    // Layer 3: 短 user 消息（通常是决策消息，如"方案B"、"C"）优先保留
    const SHORT_USER_MSG_THRESHOLD = 200;
    let currentTokens = estimatedTokens;
    let dropCount = 0;
    const toDrop = new Set<number>();

    for (let i = 0; i < nonSystemMessages.length - protectedCount; i++) {
      if (currentTokens <= SAFE_LIMIT) break;

      // Layer 3: 短 user 消息是关键决策，跳过不删
      const msg = nonSystemMessages[i] as Record<string, unknown>;
      const isShortUserMsg =
        msg.role === 'user' &&
        typeof msg.content === 'string' &&
        msg.content.length < SHORT_USER_MSG_THRESHOLD;
      if (isShortUserMsg) continue;

      const msgTokens = roughTokenCountForMessages([
        msg as { content?: string | unknown; role?: string },
      ]);
      currentTokens -= msgTokens;
      toDrop.add(i);
      dropCount++;
    }

    // 重建 apiMessages（原地替换）
    const keptNonSystem = nonSystemMessages.filter(
      (_: unknown, i: number) => !toDrop.has(i)
    );
    apiMessages.length = 0;
    if (systemMsg) apiMessages.push(systemMsg);
    for (const msg of keptNonSystem) apiMessages.push(msg);

    logger.warn(
      `上下文截断完成: 移除 ${dropCount} 条旧消息，估算剩余 ${currentTokens} tokens` +
        (currentTokens > SAFE_LIMIT
          ? `（仍超限 ${currentTokens - SAFE_LIMIT} tokens，将在 API 层被截断）`
          : '')
    );

    // 截断后重新 sanitize，修复可能被破坏的 tool/tool_calls 配对
    this._sanitizeApiMessages(apiMessages);

    // ── Layer 2: 注入跨轮对话摘要 ──
    // 摘要必须在截断之后注入，确保即使上下文逼近上限也能保留决策信息
    if (sessionId) {
      const session = this._chatSessions.get(sessionId);
      if (session?.metadata?.contextSummary) {
        const summaryContent = session.metadata.contextSummary as string;
        const insertIdx =
          apiMessages.length > 0 && apiMessages[0].role === 'system' ? 1 : 0;
        apiMessages.splice(insertIdx, 0, {
          role: 'system',
          content: `[跨轮决策摘要 — 以下为之前对话中用户已做出的关键决策]\n${summaryContent}`,
        });
        logger.debug('跨轮对话摘要已注入 LLM 请求', {
          sessionId,
          summaryLength: summaryContent.length,
        });
      }
    }
  }

  /**
   * 压缩工具循环历史消息，用注册表中的压缩摘要替代冗长的累积消息
   *
   * 架构目的：
   * - 工具循环每轮都会累积 assistant(tool_calls) + tool(results) 消息，
   *   导致上下文线性膨胀。此方法在进入下一轮前，将之前的工具循环消息
   *   替换为压缩摘要，仅保留当前轮的完整消息。
   * - 保留 system 消息（index 0）和第一条 user 消息（index 1）作为上下文基础。
   *
   * @param currentRoundMessages 当前累积的循环消息
   * @param sessionId 会话 ID，用于从注册表获取压缩摘要
   * @param assistantMsg 当前轮的 assistant 消息（含 tool_calls）
   * @param toolResults 当前轮的 tool 结果消息
   * @returns 压缩后的消息数组
   */
  private _compressToolHistory(
    currentRoundMessages: Record<string, unknown>[],
    sessionId: string,
    assistantMsg: Record<string, unknown>,
    toolResults: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    // 获取该会话的已执行工具结果，少于 2 个时不压缩（无意义）
    const storedCalls = toolResultRegistry.listBySession(sessionId);
    if (storedCalls.length < 2) {
      return [...currentRoundMessages, assistantMsg, ...toolResults];
    }

    // 生成压缩摘要
    const compressedHistory =
      toolResultRegistry.getCompressedHistory(sessionId);

    // 构建压缩后的消息列表：
    // 1. 保留非工具循环的上下文消息（system, 第一轮 user 等）
    // 2. 插入压缩摘要作为 user 消息
    // 3. 追加当前轮的 assistant + tool 消息
    const preservedMessages: Record<string, unknown>[] = [];

    // 保留系统消息和第一条用户消息作为上下文
    if (currentRoundMessages.length > 0) {
      preservedMessages.push(currentRoundMessages[0]); // system 消息
    }
    if (currentRoundMessages.length > 1) {
      preservedMessages.push(currentRoundMessages[1]); // 首条 user 消息
    }

    // 插入压缩摘要
    preservedMessages.push({
      role: 'user',
      content: `以下是此前工具执行的压缩摘要，如需完整详情请使用 get_tool_result 工具按工具调用 ID 查询。\n\n${compressedHistory}`,
    });

    // 追加当前轮完整消息
    preservedMessages.push(assistantMsg, ...toolResults);

    return preservedMessages;
  }

  /**
   * 跨轮对话摘要持久化
   * 在每个对话轮次完成后，从最近的 user 消息中提取关键决策，
   * 保存到会话元数据中。此摘要会在下一轮 LLM 请求时被注入，
   * 防止早期决策被后续长上下文挤走。
   */
  private _persistTurnSummary(session: ChatSession): void {
    if (!session || session.messages.length < 3) return;

    // 取最近 4 轮 user 消息（短消息通常是决策，如"方案B"）
    const userMessages = session.messages
      .filter((m) => m.role === 'user')
      .slice(-4);
    if (userMessages.length === 0) return;

    const decisionPoints = userMessages
      .map((m) => {
        const content = typeof m.content === 'string' ? m.content : '';
        if (content.length < 200) return `用户选择: ${content}`;
        const firstLine = content.split('\n')[0].slice(0, 100);
        return `用户意图: ${firstLine}...`;
      })
      .join('\n');

    session.metadata = {
      ...session.metadata,
      contextSummary: `此前对话决策摘要:\n${decisionPoints}`,
    };

    logger.debug('跨轮对话摘要已更新', {
      sessionId: session.id,
      summaryLength: decisionPoints.length,
    });
  }

  /**
   * 根据模型名称动态获取上下文窗口大小，如无法获取则返回保守默认值
   */
  private _resolveMaxContextTokens(model?: string): number {
    if (model) {
      try {
        const ctx = getAIModelManager().getContextWindow(model);
        if (ctx > 0) return ctx;
      } catch {
        // 模型未注册等情况，使用默认值
      }
    }
    return 128_000; // 保守默认值
  }

  private _mapSessionStatusToState(status: string): SessionState {
    switch (status) {
      case 'active':
      case 'running':
        return SessionState.ACTIVE;
      case 'paused':
        return SessionState.PAUSED;
      case 'ended':
      case 'completed':
      case 'aborted':
        return SessionState.ENDED;
      case 'archived':
        return SessionState.ARCHIVED;
      default:
        return SessionState.ACTIVE;
    }
  }

  /**
   * 清理
   */
  cleanup(): void {
    taskOrchestrator.abortAll().catch(() => {});
    for (const task of taskRegistry.getRunningTasks()) {
      task.kill().catch(() => {});
    }
    taskRegistry.shutdown().catch(() => {});
    this.streamService.reset();
  }

  /**
   * 发送消息
   * @param content 消息内容
   * @param options 选项
   * @returns 消息对象
   */
  async sendMessage(
    content: string,
    options?: SendMessageOptions
  ): Promise<Message> {
    // 清理用户输入，防止XSS和隐藏字符攻击
    content = recursivelySanitizeUnicode(content) as string;

    // 验证输入安全性 — 检测到敏感数据时脱敏后继续，而非阻断
    const validationResult = securityService.validateInput(content);
    if (!validationResult.valid) {
      logger.warn('用户输入包含敏感数据，已自动脱敏处理', {
        module: 'chat:manager',
        action: 'sendMessage',
      });
      content = securityService.sanitize(content);
      securityService.logSecurityError({
        type: SensitiveErrorType.SENSITIVE_DATA_DETECTED,
        message: '用户输入包含敏感数据，已自动脱敏处理',
      });
    }

    // 检查是否是命令
    if (content.startsWith('/')) {
      // 先获取或创建会话，以便将历史消息传入命令上下文
      const cmdSessionId = options?.sessionId || this._currentSessionId;
      const cmdSession = cmdSessionId
        ? await this._getOrLoadSession(cmdSessionId, options?.metadata)
        : undefined;

      const parts = content.slice(1).split(' ');
      const [commandName, ...args] = parts;

      let commandResult = '';
      const { commandExecutor } = await import('../commands/index.js');
      const result = await commandExecutor.execute(
        `/${commandName} ${args.join(' ')}`,
        {
          sessionId: options?.sessionId || 'chat-session',
          cwd: resolveProjectRoot(),
          messages: cmdSession?.messages || [],
        }
      );
      commandResult = result.message || result.value || '';

      // 创建命令执行结果消息
      const commandMessage = this.messageService.createAssistantMessage(
        commandResult,
        {
          sessionId: options?.sessionId,
          metadata: {
            isCommand: true,
            command: commandName,
          },
        }
      );

      // 添加到会话
      const resultSession = cmdSessionId
        ? await this._getOrLoadSession(cmdSessionId, options?.metadata)
        : undefined;

      if (resultSession) {
        this._addAndPersistMessage(resultSession.id, commandMessage);
      }

      return commandMessage;
    }

    // 获取或创建会话（统一 Gateway 降级加载）
    const sessionId = options?.sessionId || this._currentSessionId;
    if (!sessionId) {
      throw new AppError(
        'No session id provided',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    const session = await this._getOrLoadSession(sessionId, options?.metadata);
    if (!session) {
      throw new AppError(
        'No session found or created',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 触发 ChatPreMessage Hook
    const preMsgResult = await this.hookChainManager.execute('chat', {
      event: 'chat.pre-message',
      data: { message: content, sessionId: session.id },
      sessionId: session.id,
    });
    for (const hr of preMsgResult.before) {
      if (
        hr.data &&
        typeof hr.data === 'object' &&
        'message' in (hr.data as Record<string, unknown>)
      ) {
        content = (hr.data as Record<string, string>).message;
      }
    }

    // 创建用户消息
    const userMessage = this.messageService.createUserMessage(content, {
      sessionId: session.id,
      metadata: options?.metadata,
    });

    // 添加消息到会话
    this._addAndPersistMessage(session.id, userMessage);

    // 通知会话状态变化为运行状态
    this.getSessionMachine(session.id).start('sendMessage');

    // 准备消息列表
    const messages = session.messages;

    // 调用LLM客户端
    if (!this.llmClient) {
      throw new AppError(
        'LLM client not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const activeClient = this.getClientForModel(options?.model);

    // 准备消息列表（用于API调用）
    let apiMessages = messages.map((msg) => {
      // 对工具结果消息，若内容过大则截断，避免旧数据主导 LLM 上下文
      let content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);

      if (
        msg.role === 'tool' &&
        typeof content === 'string' &&
        content.length > ChatManagerImpl.TOOL_RESULT_MAX_LENGTH
      ) {
        content = ChatManagerImpl.truncateToolResult(content);
      }

      const chatMessage: Record<string, unknown> = {
        role: msg.role,
        content,
      };

      // 对于工具结果消息，确保添加 tool_call_id
      // 优先使用 msg.toolCallId，其次从 metadata 中查找
      // 只有在确实存在 tool_call_id 时才设置该字段，避免向 API 发送空值
      if (msg.role === 'tool') {
        const tcId =
          msg.toolCallId ||
          (msg.metadata?.toolCallId as string) ||
          (msg.metadata?.tool_call_id as string);
        if (tcId) {
          chatMessage.tool_call_id = tcId;
        }
      }

      // 对于助手消息，添加tool_calls（从metadata中读取）
      if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
        const toolCalls = msg.metadata.tool_calls as Record<string, unknown>[];
        chatMessage.tool_calls = toolCalls.map(
          (tc: Record<string, unknown>) => {
            if (tc.type && tc.function) {
              return tc;
            }
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

    // 将附带的图片转换为多模态 content 数组
    if (options?.images && options.images.length > 0) {
      const lastUserMsg = [...apiMessages]
        .reverse()
        .find((m: Record<string, unknown>) => m.role === 'user');
      if (lastUserMsg && typeof lastUserMsg.content === 'string') {
        const contentBlocks: Array<Record<string, unknown>> = [
          { type: 'text', text: lastUserMsg.content },
        ];
        for (const img of options.images) {
          try {
            const imageData = fs.readFileSync(img.path);
            const base64 = imageData.toString('base64');
            const ext =
              path.extname(img.filename).slice(1).toLowerCase() || 'png';
            const mimeType = ext === 'jpg' ? 'jpeg' : ext;
            contentBlocks.push({
              type: 'image_url',
              image_url: { url: `data:image/${mimeType};base64,${base64}` },
            });
          } catch (err) {
            logger.warn('图片文件读取失败，跳过该图片', {
              path: img.path,
              error: String(err),
            });
          }
        }
        lastUserMsg.content = contentBlocks;
      }

      // 注册图片路径到会话已知路径集合
      this._registerImagePaths(
        options.sessionId || '',
        options.images.map((img) => img.path)
      );
    }

    // 过滤孤立的 tool 消息（没有前置 tool_calls 的 assistant 消息）
    this._sanitizeApiMessages(apiMessages);

    // 准备工具定义

    // 获取工具定义
    let toolDefinitions: Record<string, unknown>[] = [];
    if (this.toolRegistry) {
      const registry = this.toolRegistry as unknown as {
        getToolSchemas: () => Array<Record<string, unknown>>;
      };
      const schemas = registry.getToolSchemas?.() || [];
      for (const schema of schemas) {
        toolDefinitions.push({
          type: 'function',
          function: {
            name: schema.name as string,
            description: schema.description as string,
            parameters: {
              type: 'object',
              properties:
                (
                  schema.input_schema as {
                    properties?: unknown;
                    required?: string[];
                  }
                )?.properties || {},
              required:
                (
                  schema.input_schema as {
                    properties?: unknown;
                    required?: string[];
                  }
                )?.required || [],
            },
          },
        });
      }
    }

    // 注入注册表查询工具（仅在当前会话有工具执行记录时）
    if (toolResultRegistry.getRoundCount(session.id) > 0) {
      toolDefinitions.push(
        ChatManagerImpl.QUERY_TOOL_GET_RESULT,
        ChatManagerImpl.QUERY_TOOL_LIST_CALLS
      );
    }

    const hasSystemMessage = apiMessages.some(
      (m: Record<string, unknown>) => m.role === 'system'
    );

    if (!hasSystemMessage) {
      const sysPrompt = await this.getOrAssembleSystemPrompt(session, content);
      apiMessages.unshift({ role: 'system', content: sysPrompt });
    }

    // 共享上下文：从 CombinedSessionGateway 加载所有通道的历史消息
    if (options?.useSharedContext) {
      try {
        const { getDIContainer } = await import('../core/DIContainer.js');
        const container = getDIContainer();
        if (container.has('combinedSessionGateway')) {
          const combinedGateway = container.resolve<any>(
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
              // 在系统消息之后、当前会话消息之前插入共享上下文
              const sysMsgIndex = apiMessages.findIndex(
                (m: Record<string, unknown>) => m.role === 'system'
              );
              if (sysMsgIndex >= 0) {
                apiMessages.splice(sysMsgIndex + 1, 0, ...sharedApiMessages);
              } else {
                apiMessages.unshift(...sharedApiMessages);
              }
            }
          }
        }
      } catch {
        // 共享上下文加载失败不影响主流程
      }
    }

    // ─────────────────────────────────────────────────────────
    // 上下文长度保护：超限则尝试 AI 压缩，失败则截断旧消息
    // ─────────────────────────────────────────────────────────
    const maxCtx = this._resolveMaxContextTokens(options?.model);
    await this._truncateApiMessages(apiMessages, maxCtx, session.id);

    // 通知进度：开始 LLM 分析
    options?.onProgress?.({ stage: 'analyzing', message: '正在分析问题...' });

    logger.debug('准备调用 activeClient.sendMessage', {
      constructor: (activeClient as any)?.constructor?.name,
      providerId: activeClient?.getProviderId(),
    });

    const response = await activeClient.sendMessage(
      apiMessages as unknown as ChatMessage[],
      {
        ...options,
        tools:
          toolDefinitions.length > 0
            ? (toolDefinitions as unknown as ToolDefinition[])
            : undefined,
      }
    );

    this.recordChatResponseUsage(session.id, response.usage);

    // 异步记录使用量到 UsageStatsService + CostTracker + LLMTracker
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

    // 通知外部：本次 LLM 响应的词元用量
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
        estimatedCostUsd:
          (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
      });
    }

    const assistantMessageContent =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    const assistantMsg = this.messageService.createAssistantMessage(
      assistantMessageContent,
      {
        sessionId: session.id,
      }
    );
    let assistantMessage = assistantMsg;
    assistantMessage.sessionId = session.id;
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
      assistantMessage.metadata = {
        ...assistantMessage.metadata,
        tool_calls: toolCallsData,
      };
    }
    this._addAndPersistMessage(session.id, assistantMessage);

    // 响应后自动提取记忆
    await this.extractMemoryFromChat(
      content,
      assistantMessageContent,
      session.id
    );

    // 触发 ChatPostMessage Hook
    await this.hookChainManager.execute('chat', {
      event: 'chat.post-message',
      data: { message: content, response, sessionId: session.id },
      sessionId: session.id,
    });

    // 处理工具调用 — 使用 while 循环支持多轮递归工具调用
    if (response.tool_calls && response.tool_calls.length > 0) {
      let currentRoundMessages = [...apiMessages];
      let currentToolCalls: ParsedToolCall[] = [...response.tool_calls];
      let roundAssistantMsg = assistantMessage;

      // 注册表：进入工具循环第一轮
      const rollbackRoundId = toolResultRegistry.nextRound(session.id);

      // 回滚：开始轮次追踪
      await this._startRollbackRound(session.id, rollbackRoundId).catch(
        (err) => {
          logger.warn('回滚轮次启动失败', { error: String(err) });
          handleError(err, {
            module: 'chat:ChatManager',
            action: 'rollback:startRound',
          }).catch(() => {});
        }
      );

      while (currentToolCalls.length > 0) {
        const processedResults: Array<{
          normalizedToolCall: ToolCall;
          result: ToolResult;
        }> = [];

        for (const toolCall of currentToolCalls) {
          // 转换为 ToolCall 类型
          const normalizedToolCall: ToolCall = {
            id: toolCall.id,
            name: toolCall.name || 'unknown',
            arguments: toolCall.arguments || {},
          };

          // 触发 ChatPreToolCall Hook
          const preToolResult = await this.hookChainManager.execute('chat', {
            event: 'chat.pre-tool-call',
            data: {
              toolCall: {
                id: normalizedToolCall.id,
                name: normalizedToolCall.name,
                arguments: normalizedToolCall.arguments,
              },
              sessionId: session.id,
            },
            sessionId: session.id,
          });
          if (preToolResult.before.some((r) => r.preventContinuation)) {
            throw new AppError(
              `Tool ${normalizedToolCall.name} execution denied by hook`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          }

          // 解析工具参数（arguments 可能是 JSON 字符串）
          let parsedArguments: Record<string, unknown>;
          if (typeof normalizedToolCall.arguments === 'string') {
            try {
              // 使用 repairModelJson 修复可能的 Windows 路径反斜杠问题
              const repaired = repairModelJson(normalizedToolCall.arguments);
              parsedArguments = JSON.parse(repaired);
            } catch (error) {
              logger.warn('工具调用参数 JSON 解析失败，使用空参数兜底', {
                toolName: normalizedToolCall.name,
                rawArguments: (normalizedToolCall.arguments as string).slice(
                  0,
                  500
                ),
              });
              parsedArguments = {};
            }
          } else {
            parsedArguments = normalizedToolCall.arguments as Record<
              string,
              unknown
            >;
          }

          logger.debug('Executing tool', {
            toolName: normalizedToolCall.name,
            arguments: parsedArguments,
          });

          // 通知外部：工具开始执行
          const argsStr = JSON.stringify(parsedArguments).slice(0, 200);
          options?.onToolCall?.(
            'start',
            normalizedToolCall.name,
            normalizedToolCall.id,
            argsStr
          );

          // ---- 检查工具是否需要用户交互（如 ask_user_question） ----
          // sendMessage 是非流式路径，无法 yield question 分块到 SSE，
          // 因此采用"保存状态 + 提前返回"机制，由外部在用户回答后通过
          // continueInteraction() 恢复工具循环
          const sendMsgToolObj = (
            this.toolRegistry as unknown as {
              getTool: (name: string) =>
                | {
                    requiresUserInteraction?: () => boolean;
                  }
                | undefined;
            }
          ).getTool?.(normalizedToolCall.name);

          if (sendMsgToolObj?.requiresUserInteraction?.()) {
            logger.info('sendMessage 检测到需要用户交互的工具', {
              toolName: normalizedToolCall.name,
            });

            // 提取界面显示数据
            const questionId =
              (parsedArguments.questionId as string) || crypto.randomUUID();
            const question = (parsedArguments.question as string) || '请选择';
            const header = (parsedArguments.header as string) || '提问';
            const rawOptions =
              (parsedArguments.options as Array<{
                label: string;
                description?: string;
              }>) || [];
            const multiSelect = parsedArguments.multiSelect as
              | boolean
              | undefined;

            const questionData: QuestionData = {
              questionId,
              question,
              header,
              options: rawOptions.map((opt) => ({
                label: opt.label,
                description: opt.description || '',
              })),
              multiSelect,
            };

            // 获取当前交互工具在 currentToolCalls 中的索引
            const interactionIdx = currentToolCalls.findIndex(
              (tc) => tc.id === toolCall.id
            );

            // 保存工具循环的完整状态
            const savedState: InteractionSavedState = {
              currentRoundMessages: [...currentRoundMessages],
              currentToolCalls: [...currentToolCalls],
              processedResults: [...processedResults],
              interactionIdx: interactionIdx >= 0 ? interactionIdx : 0,
              roundAssistantMsg,
              toolDefinitions: [...toolDefinitions],
              sessionId: session.id,
              questionData,
            };
            this.pendingInteractions.set(session.id, savedState);

            // 将 pendingInteraction 标记写入 assistant 消息元数据
            roundAssistantMsg.metadata = {
              ...roundAssistantMsg.metadata,
              pendingInteraction: questionData,
            };

            // 更新持久化消息（添加 pendingInteraction 标记）
            // 使用 messageService 重新保存
            try {
              this._addAndPersistMessage(session.id, roundAssistantMsg);
            } catch {
              // 重复保存失败不影响主流程
            }

            logger.info('sendMessage 已保存交互状态并提前返回', {
              sessionId: session.id,
              questionId,
            });

            // 提前返回，工具循环暂停，等待 continueInteraction 恢复
            return roundAssistantMsg;
          }
          // ---- 结束用户交互检查 ----

          // 通知进度：正在执行工具
          options?.onProgress?.({
            stage: 'tool_executing',
            message: `正在执行 ${normalizedToolCall.name}...`,
            toolName: normalizedToolCall.name,
          });

          const toolResult = await this.executeTool({
            id: normalizedToolCall.id,
            name: normalizedToolCall.name,
            arguments: parsedArguments,
            sessionId: session.id,
          });

          logger.debug('Tool execution result', { result: toolResult });

          // 通知外部：工具执行完成
          const resultDetail = toolResult.error
            ? `失败: ${toolResult.error.slice(0, 200)}`
            : `成功: ${(JSON.stringify(toolResult.result) ?? '').slice(0, 200)}`;
          options?.onToolCall?.(
            'end',
            normalizedToolCall.name,
            normalizedToolCall.id,
            resultDetail
          );

          // 触发 ChatPostToolCall Hook
          await this.hookChainManager.execute('chat', {
            event: 'chat.post-tool-call',
            data: {
              toolCallId: normalizedToolCall.id,
              toolName: normalizedToolCall.name,
              result: toolResult.result,
              error: toolResult.error,
              sessionId: session.id,
            },
            sessionId: session.id,
          });

          // 注册表：存储工具执行结果
          toolResultRegistry.storeResult(
            session.id,
            normalizedToolCall.id,
            normalizedToolCall.name,
            parsedArguments,
            { result: toolResult.result, error: toolResult.error },
            toolResultRegistry.getCurrentRound(session.id)
          );

          const toolResultMessage = this.messageService.createToolResultMessage(
            toolResult,
            {
              sessionId: session.id,
            }
          );
          this._addAndPersistMessage(session.id, toolResultMessage);

          processedResults.push({ normalizedToolCall, result: toolResult });
        }

        // 构建完整请求：基础消息 + 带有全部 tool_calls 的 assistant + 全部工具结果
        const updatedMessages: Record<string, unknown>[] = [
          ...currentRoundMessages,
          {
            role: 'assistant',
            content:
              typeof roundAssistantMsg.content === 'string'
                ? roundAssistantMsg.content
                : JSON.stringify(roundAssistantMsg.content),
            tool_calls: currentToolCalls.map((tc: ParsedToolCall) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            })),
          },
          ...processedResults.map((pr) => {
            const toolResultContent = pr.result.result
              ? typeof pr.result.result === 'string'
                ? pr.result.result
                : JSON.stringify(pr.result.result)
              : pr.result.error || '{}';
            return {
              role: 'tool' as const,
              content: toolResultContent,
              tool_call_id: pr.normalizedToolCall.id,
            };
          }),
        ];

        logger.debug('Updated messages for tool results', {
          messages: updatedMessages,
        });

        // 通知进度：工具执行完成，正在生成回答
        options?.onProgress?.({
          stage: 'generating',
          message: '正在生成回答...',
        });

        const toolResultResponse = await activeClient.sendMessage(
          updatedMessages as unknown as ChatMessage[],
          {
            ...options,
            tools:
              toolDefinitions.length > 0
                ? (toolDefinitions as unknown as ToolDefinition[])
                : undefined,
          }
        );

        this.recordChatResponseUsage(session.id, toolResultResponse.usage);

        // 异步记录使用量
        trackUsage(toolResultResponse, {
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

        // 通知外部：本次工具结果 LLM 响应的词元用量
        if (options?.onUsage && toolResultResponse.usage) {
          const u = toolResultResponse.usage;
          const inputTokens = u.prompt_tokens ?? 0;
          const outputTokens = u.completion_tokens ?? 0;
          options.onUsage({
            inputTokens,
            outputTokens,
            cacheReadInputTokens: u.cache_read_input_tokens,
            cacheCreationInputTokens: u.cache_creation_input_tokens,
            totalTokens: inputTokens + outputTokens,
            estimatedCostUsd:
              (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
          });
        }

        logger.debug('Tool result response', {
          response: toolResultResponse,
        });

        const toolResultAssistantContent =
          typeof toolResultResponse.content === 'string'
            ? toolResultResponse.content
            : JSON.stringify(toolResultResponse.content);

        const toolResultAssistantMsg =
          this.messageService.createAssistantMessage(
            toolResultAssistantContent,
            {
              sessionId: session.id,
            }
          );
        const toolResultAssistantMessage = toolResultAssistantMsg;
        toolResultAssistantMessage.sessionId = session.id;
        if (
          toolResultResponse.tool_calls &&
          toolResultResponse.tool_calls.length > 0
        ) {
          const toolCallsData = toolResultResponse.tool_calls.map(
            (tc: ParsedToolCall) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            })
          );
          toolResultAssistantMessage.metadata = {
            ...toolResultAssistantMessage.metadata,
            tool_calls: toolCallsData,
          };
        }
        this._addAndPersistMessage(session.id, toolResultAssistantMessage);

        // 检查是否有新的工具调用，有则继续下一轮
        if (
          toolResultResponse.tool_calls &&
          toolResultResponse.tool_calls.length > 0
        ) {
          // 注册表：进入下一轮
          toolResultRegistry.nextRound(session.id);
          // 压缩历史消息，避免上下文线性膨胀
          const assistantMsgForCompress = updatedMessages[
            currentRoundMessages.length
          ] as Record<string, unknown>;
          const toolResultsForCompress = updatedMessages.slice(
            currentRoundMessages.length + 1
          ) as Record<string, unknown>[];
          currentRoundMessages = this._compressToolHistory(
            currentRoundMessages,
            session.id,
            assistantMsgForCompress,
            toolResultsForCompress
          );
          currentToolCalls = [...toolResultResponse.tool_calls];
          roundAssistantMsg = toolResultAssistantMessage;
          assistantMessage = toolResultAssistantMessage;
        } else {
          assistantMessage = toolResultAssistantMessage;
          currentToolCalls = [];
        }
      }

      // 回滚：结束轮次追踪并创建快照
      await this._endRollbackRound(session.id, content).catch((err) => {
        logger.warn('回滚轮次结束失败', { error: String(err) });
        handleError(err, {
          module: 'chat:ChatManager',
          action: 'rollback:endRound',
        }).catch(() => {});
      });
    }

    // 检测是否存在 create_task_list 工具调用，进入计划编排模式
    if (
      !this._executingPlan &&
      response.tool_calls?.some((tc) => tc.name === 'create_task_list')
    ) {
      this._executingPlan = true;
      try {
        await this.executePlanSteps(session, options);
      } finally {
        this._executingPlan = false;
      }
    }

    // 通知进度：处理完成
    options?.onProgress?.({ stage: 'completed', message: '处理完成' });

    // 通知会话状态变化为空闲状态（使用 finish 回到 IDLE，允许下一轮 start）
    this.getSessionMachine(session.id).finish('sendMessage完成');

    // 跨轮对话摘要：保存关键决策
    this._persistTurnSummary(session);

    // Session Memory: 累计本轮 token + 工具调用，达到阈值则触发提炼
    this._accumulateSessionMemory(
      session.id,
      content,
      typeof assistantMessage.content === 'string'
        ? assistantMessage.content
        : '',
      response.usage?.prompt_tokens || 0,
      response.tool_calls?.length || 0
    );

    // 检查是否需要触发 Council 辩论
    const shouldTriggerCouncil =
      session.metadata?.is_ultraplan_mode ||
      containsComplexKeywords(content) ||
      options?.metadata?.councilTriggeredManually;

    if (shouldTriggerCouncil) {
      // 异步启动 Council 辩论（不阻塞主流程）
      this.triggerCouncilDebate(
        session.metadata?.workspaceId || 'default',
        content,
        session.metadata?.context || ''
      ).catch((err) => {
        logger.error('Council 辩论执行失败', { error: String(err) });
      });

      // 将辩论通知追加到 AI 回复末尾
      assistantMessage.content += `\n\n> 🏛️ 理事会正在讨论此议题，请切换到"理事会"标签页查看辩论过程。`;
    }

    return assistantMessage;
  }

  /**
   * 响应后自动提取记忆
   */

  /**
   * 触发 Council 辩论（异步，不阻塞主流程）
   */
  private async triggerCouncilDebate(
    workspaceId: string,
    topic: string,
    context: string
  ): Promise<void> {
    const { getCouncilEngine } =
      await import('@modules/workspace/CouncilEngine');
    const { CouncilOrchestrator } =
      await import('@modules/workspace/CouncilOrchestrator');

    const engine = getCouncilEngine();
    const orchestrator = new CouncilOrchestrator(engine);

    await orchestrator.startCouncil(workspaceId, topic, context);
  }

  private async extractMemoryFromChat(
    userContent: string,
    assistantContent: string,
    sessionId: string
  ): Promise<void> {
    try {
      const { MemoryManagerImpl } =
        await import('@modules/memory/MemoryManager');
      const mm = new MemoryManagerImpl();
      const memorableContent = `用户: ${userContent}\n助手: ${assistantContent}`;
      await mm.createMemory({
        content: memorableContent,
        metadata: {
          name: `会话 ${sessionId.slice(0, 8)} 对话`,
          description: '从对话中自动提取',
          type: 'conversation',
          tags: ['auto-extracted', sessionId],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch {
      // 记忆提取失败不影响主流程
    }
  }

  /**
   * 记录 LLM 响应的令牌用量到 TokenTracker
   * 支持 ai/models/types.ChatResponse.usage 和 chat/types/message.ChatResponse.usage 两种格式
   */
  private recordChatResponseUsage(
    sessionId: string,
    usage: Record<string, number> | null | undefined
  ): void {
    if (!this.tokenTracker || !usage) return;
    const inputTokens = usage.prompt_tokens ?? usage.inputTokens ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.outputTokens ?? 0;
    if (inputTokens === 0 && outputTokens === 0) return;
    this.tokenTracker.recordUsage(sessionId, {
      inputTokens,
      outputTokens,
      cacheReadInputTokens:
        usage.prompt_cache_hit_tokens ??
        usage.cache_read_input_tokens ??
        usage.cacheReadInputTokens ??
        0,
      cacheCreationInputTokens:
        usage.prompt_cache_miss_tokens ??
        usage.cache_creation_input_tokens ??
        usage.cacheCreationInputTokens ??
        0,
    });
  }

  /**
   * 执行单步提示（LLM 调用 + 工具执行循环）
   */
  private async executeStepPrompt(
    prompt: string,
    session: ChatSession,
    options?: SendMessageOptions
  ): Promise<void> {
    const activeClient = this.getClientForModel(options?.model);

    const messages = session.messages;
    let apiMessages = messages.map((msg: Message) => {
      const chatMessage: Record<string, unknown> = {
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
      };
      // 对于工具结果消息，确保添加 tool_call_id
      // 优先使用 msg.toolCallId，其次从 metadata 中查找
      // 只有在确实存在 tool_call_id 时才设置该字段，避免向 API 发送空值
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
        chatMessage.tool_calls = msg.metadata.tool_calls;
      }
      return chatMessage;
    });
    apiMessages.push({ role: 'user', content: prompt });
    this._sanitizeApiMessages(apiMessages);

    const hasSystemMessage = apiMessages.some(
      (m: Record<string, unknown>) => m.role === 'system'
    );
    if (!hasSystemMessage) {
      const sysPrompt = await this.getOrAssembleSystemPrompt(session, prompt);
      apiMessages.unshift({ role: 'system', content: sysPrompt });
    }

    const toolDefinitions = this.buildToolDefinitions(session.id);

    // 上下文长度保护：超限则尝试 AI 压缩，失败则截断旧消息
    const maxCtx = this._resolveMaxContextTokens(options?.model);
    await this._truncateApiMessages(apiMessages, maxCtx, session.id);

    // 通知进度：开始 LLM 分析
    options?.onProgress?.({
      stage: 'analyzing',
      message: '正在分析计划步骤...',
    });

    let response = await activeClient.sendMessage(
      apiMessages as unknown as ChatMessage[],
      {
        ...options,
        tools:
          toolDefinitions.length > 0
            ? (toolDefinitions as unknown as ToolDefinition[])
            : undefined,
      }
    );

    this.recordChatResponseUsage(session.id, response.usage);

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

    let currentMessages = [...apiMessages];
    let currentCalls = response.tool_calls ? [...response.tool_calls] : [];

    // 存储首轮助手消息
    const content =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    const assistantMsg = this.messageService.createAssistantMessage(content, {
      sessionId: session.id,
    });
    assistantMsg.sessionId = session.id;
    if (response.tool_calls?.length) {
      assistantMsg.metadata = {
        ...assistantMsg.metadata,
        tool_calls: response.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments || {}),
          },
        })),
      };
    }
    this._addAndPersistMessage(session.id, assistantMsg);

    // 工具调用循环
    const rollbackRoundId = toolResultRegistry.nextRound(session.id);

    // 回滚：开始轮次追踪
    await this._startRollbackRound(session.id, rollbackRoundId).catch((err) => {
      logger.warn('回滚轮次启动失败', { error: String(err) });
      handleError(err, {
        module: 'chat:ChatManager',
        action: 'rollback:startRound',
      }).catch(() => {});
    });

    while (currentCalls.length > 0) {
      const processedResults: Array<{
        normalizedToolCall: {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        };
        result: ToolResult;
      }> = [];

      for (const toolCall of currentCalls) {
        const toolCallId =
          toolCall.id ||
          `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const toolName = toolCall.name || 'unknown';

        // ---- 检查工具是否需要用户交互（如 ask_user_question） ----
        // 旧版工具循环是非流式路径，无法 yield question 分块，
        // 因此对需要交互的工具，跳过执行，返回空结果
        const legacyToolObj = (
          this.toolRegistry as unknown as {
            getTool: (name: string) =>
              | {
                  requiresUserInteraction?: () => boolean;
                }
              | undefined;
          }
        ).getTool?.(toolName);

        if (legacyToolObj?.requiresUserInteraction?.()) {
          logger.warn('旧版工具循环跳过需要用户交互的工具', {
            toolName,
          });
          const toolResult: ToolResult = {
            toolCallId,
            toolName,
            result: { skipped: true, reason: 'user_interaction_required' },
            error: undefined,
          };
          const toolResultMessage = this.messageService.createToolResultMessage(
            toolResult,
            {
              sessionId: session.id,
            }
          );
          this._addAndPersistMessage(session.id, toolResultMessage);
          processedResults.push({
            normalizedToolCall: {
              id: toolCallId,
              name: toolName,
              arguments: toolCall.arguments || {},
            },
            result: toolResult,
          });
          // 注册表：存储被跳过的工具结果
          toolResultRegistry.storeResult(
            session.id,
            toolCallId,
            toolName,
            toolCall.arguments || {},
            { result: toolResult.result, error: toolResult.error },
            toolResultRegistry.getCurrentRound(session.id)
          );
          continue;
        }
        // ---- 结束用户交互检查 ----

        // 通知进度：正在执行工具
        options?.onProgress?.({
          stage: 'tool_executing',
          message: `正在执行 ${toolName}...`,
          toolName,
        });

        const toolResult = await this.executeTool({
          id: toolCallId,
          name: toolName,
          arguments: toolCall.arguments || {},
          sessionId: session.id,
        });

        const toolResultMessage = this.messageService.createToolResultMessage(
          toolResult,
          { sessionId: session.id }
        );
        this._addAndPersistMessage(session.id, toolResultMessage);
        // 注册表：存储工具执行结果
        toolResultRegistry.storeResult(
          session.id,
          toolCallId,
          toolName,
          toolCall.arguments || {},
          { result: toolResult.result, error: toolResult.error },
          toolResultRegistry.getCurrentRound(session.id)
        );
        processedResults.push({
          normalizedToolCall: {
            id: toolCallId,
            name: toolName,
            arguments: toolCall.arguments || {},
          },
          result: toolResult,
        });
      }

      // 构建下一轮消息
      const updatedMessages = [
        ...currentMessages,
        {
          role: 'assistant',
          content: null,
          tool_calls: currentCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        },
        ...processedResults.map((pr) => ({
          role: 'tool',
          tool_call_id: pr.normalizedToolCall.id,
          content:
            pr.result.result !== undefined
              ? JSON.stringify(pr.result.result)
              : '',
        })),
      ];

      // 通知进度：工具执行完成，正在生成最终回答
      options?.onProgress?.({
        stage: 'generating',
        message: '正在生成最终回答...',
      });

      const toolResultResponse = await activeClient.sendMessage(
        updatedMessages as unknown as ChatMessage[],
        {
          tools:
            toolDefinitions.length > 0
              ? (toolDefinitions as unknown as ToolDefinition[])
              : undefined,
        }
      );

      this.recordChatResponseUsage(session.id, toolResultResponse.usage);

      // 异步记录使用量
      trackUsage(toolResultResponse, {
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

      // 通知外部：本次工具结果 LLM 响应的词元用量
      if (options?.onUsage && toolResultResponse.usage) {
        const u = toolResultResponse.usage;
        const inputTokens = u.prompt_tokens ?? 0;
        const outputTokens = u.completion_tokens ?? 0;
        options.onUsage({
          inputTokens,
          outputTokens,
          cacheReadInputTokens: u.cache_read_input_tokens,
          cacheCreationInputTokens: u.cache_creation_input_tokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUsd:
            (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
        });
      }

      const resultContent =
        typeof toolResultResponse.content === 'string'
          ? toolResultResponse.content
          : JSON.stringify(toolResultResponse.content);
      const resultAssistantMsg = this.messageService.createAssistantMessage(
        resultContent,
        { sessionId: session.id }
      );
      resultAssistantMsg.sessionId = session.id;

      if (toolResultResponse.tool_calls?.length) {
        resultAssistantMsg.metadata = {
          ...resultAssistantMsg.metadata,
          tool_calls: toolResultResponse.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        };
      }
      this._addAndPersistMessage(session.id, resultAssistantMsg);

      if (toolResultResponse.tool_calls?.length) {
        // 注册表：进入下一轮
        toolResultRegistry.nextRound(session.id);
        const assistantMsgForCompress = updatedMessages[
          currentMessages.length
        ] as Record<string, unknown>;
        const toolResultsForCompress = updatedMessages.slice(
          currentMessages.length + 1
        ) as Record<string, unknown>[];
        currentMessages = this._compressToolHistory(
          currentMessages,
          session.id,
          assistantMsgForCompress,
          toolResultsForCompress
        );
        currentCalls = [...toolResultResponse.tool_calls];
      } else {
        currentCalls = [];
      }
    }

    // 回滚：结束轮次追踪并创建快照
    await this._endRollbackRound(session.id, content).catch((err) => {
      logger.warn('回滚轮次结束失败', { error: String(err) });
      handleError(err, {
        module: 'chat:ChatManager',
        action: 'rollback:endRound',
      }).catch(() => {});
    });

    // 通知进度：处理完成
    options?.onProgress?.({ stage: 'completed', message: '处理完成' });
  }

  /**
   * 执行所有计划步骤（通过 TaskOrchestrator 管理 Plan 生命周期）
   */
  private async executePlanSteps(
    session: ChatSession,
    options?: SendMessageOptions
  ): Promise<void> {
    const pendingTasks = taskRegistry
      .getAllTaskInfos()
      .filter((t) => t.displayStatus === 'pending');

    if (pendingTasks.length === 0) return;

    // 用 TaskOrchestrator 包装已有待执行任务为 Plan
    const stepDescriptions = pendingTasks.map((t) => t.description);
    const taskIds = pendingTasks.map((t) => t.id);
    const plan = taskOrchestrator.createPlan(
      'User-assigned task plan',
      stepDescriptions,
      session.id,
      taskIds
    );

    // 获取待执行步骤，通过 TaskOrchestrator 驱动
    const steps = taskOrchestrator.getPendingSteps(plan.id);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // 通过 TaskOrchestrator 标记运行中（同步更新 TaskRegistry）
      taskOrchestrator.markStepRunning(step.id);

      const stepPrompt = `[Plan Step ${i + 1}/${steps.length}]: ${step.description}\n\nExecute this step using available tools. When complete, summarize what was done.`;

      await this.executeStepPrompt(stepPrompt, session, options);

      // 通过 TaskOrchestrator 标记已完成（同步更新 TaskRegistry）
      taskOrchestrator.markStepCompleted(step.id);
    }

    // 汇总收尾
    const progress = taskOrchestrator.getPlanProgress(plan.id);
    const summaryPrompt = `All ${steps.length} plan steps have been completed (${progress?.percent ?? 0}%). Provide a brief summary of what was accomplished.`;
    await this.executeStepPrompt(summaryPrompt, session, options);
  }

  /**
   * 构建工具定义列表
   */
  /**
   * 注册表查询工具：按 tool_call_id 获取完整工具执行结果
   */
  private static readonly QUERY_TOOL_GET_RESULT: Record<string, unknown> = {
    type: 'function',
    function: {
      name: 'get_tool_result',
      description:
        '查询此前某次工具调用的完整执行结果。当压缩摘要或上下文中的工具结果信息不足以支持后续决策时，使用此工具获取全部细节。参数 tool_call_id 来自 assistant 消息的 tool_calls 数组。',
      parameters: {
        type: 'object',
        properties: {
          tool_call_id: {
            type: 'string',
            description:
              '工具调用 ID（如 call_xxxx），来自 assistant 消息的 tool_calls 数组中的 id 字段',
          },
        },
        required: ['tool_call_id'],
      },
    },
  };

  /**
   * 注册表查询工具：列出当前会话的所有工具调用记录
   */
  private static readonly QUERY_TOOL_LIST_CALLS: Record<string, unknown> = {
    type: 'function',
    function: {
      name: 'list_tool_calls',
      description:
        '列出当前会话中所有已执行工具的调用记录，包括 tool_call_id、工具名称和所属轮次。可指定 round 参数按轮次过滤。使用 get_tool_result 基于返回的 tool_call_id 查询完整详情。',
      parameters: {
        type: 'object',
        properties: {
          round: {
            type: 'number',
            description:
              '可选，指定轮次号（从 1 开始）。不传时返回全部轮次记录。',
          },
        },
        required: [],
      },
    },
  };

  private buildToolDefinitions(
    sessionId?: string
  ): Array<Record<string, unknown>> {
    const definitions: Array<Record<string, unknown>> = [];

    // 从工具注册表获取标准工具定义
    if (this.toolRegistry) {
      const registry = this.toolRegistry as unknown as {
        getToolSchemas: () => Array<Record<string, unknown>>;
      };
      const schemas = registry.getToolSchemas?.() || [];
      for (const schema of schemas) {
        definitions.push({
          type: 'function',
          function: {
            name: schema.name as string,
            description: schema.description as string,
            parameters: {
              type: 'object',
              properties:
                (
                  schema.input_schema as {
                    properties?: unknown;
                    required?: string[];
                  }
                )?.properties || {},
              required:
                (
                  schema.input_schema as {
                    properties?: unknown;
                    required?: string[];
                  }
                )?.required || [],
            },
          },
        });
      }
    }

    // 注入注册表查询工具
    // 只有当会话中已有工具执行记录时才注入，避免不必要地暴露查询能力
    if (sessionId && toolResultRegistry.getRoundCount(sessionId) > 0) {
      definitions.push(
        ChatManagerImpl.QUERY_TOOL_GET_RESULT,
        ChatManagerImpl.QUERY_TOOL_LIST_CALLS
      );
    }

    return definitions;
  }

  /**
   * 流式发送消息
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生流数据块
   */
  async *streamMessage(
    content: string,
    options?: StreamMessageOptions
  ): AsyncGenerator<string | ChatStreamChunk, Message, unknown> {
    // 清理用户输入，防止XSS和隐藏字符攻击
    content = recursivelySanitizeUnicode(content) as string;

    // 验证输入安全性 — 检测到敏感数据时脱敏后继续，而非阻断
    const validationResult = securityService.validateInput(content);
    if (!validationResult.valid) {
      logger.warn('用户输入包含敏感数据，已自动脱敏处理', {
        module: 'chat:manager',
        action: 'streamMessage',
      });
      content = securityService.sanitize(content);
      securityService.logSecurityError({
        type: SensitiveErrorType.SENSITIVE_DATA_DETECTED,
        message: '用户输入包含敏感数据，已自动脱敏处理',
      });
    }

    // 获取或创建会话（统一 Gateway 降级加载）
    const sessionId = options?.sessionId || this._currentSessionId;
    if (!sessionId) {
      throw new AppError(
        'No session id provided',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    const session = await this._getOrLoadSession(sessionId, options?.metadata);
    if (!session) {
      throw new AppError(
        'No session found or created',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 触发 ChatPreMessage Hook
    const preMsgResult = await this.hookChainManager.execute('chat', {
      event: 'chat.pre-message',
      data: { message: content, sessionId: session.id },
      sessionId: session.id,
    });
    for (const hr of preMsgResult.before) {
      if (
        hr.data &&
        typeof hr.data === 'object' &&
        'message' in (hr.data as Record<string, unknown>)
      ) {
        content = (hr.data as Record<string, string>).message;
      }
    }

    // 创建用户消息
    const userMessage = this.messageService.createUserMessage(content, {
      sessionId: session.id,
      metadata: options?.metadata,
    });

    // 添加消息到会话
    this._addAndPersistMessage(session.id, userMessage);

    // 通知会话状态变化为运行状态
    this.getSessionMachine(session.id).start('processUserInput');

    // 准备消息列表（用于API调用）
    const messages = session.messages;
    let apiMessages = messages.map((msg) => {
      // 对工具结果消息，若内容过大则截断，避免旧数据主导 LLM 上下文
      let content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);

      if (
        msg.role === 'tool' &&
        typeof content === 'string' &&
        content.length > ChatManagerImpl.TOOL_RESULT_MAX_LENGTH
      ) {
        content = ChatManagerImpl.truncateToolResult(content);
      }

      const chatMessage: Record<string, unknown> = {
        role: msg.role,
        content,
      };

      // 对于工具结果消息，确保添加 tool_call_id
      // 优先使用 msg.toolCallId，其次从 metadata 中查找
      // 只有在确实存在 tool_call_id 时才设置该字段，避免向 API 发送空值
      if (msg.role === 'tool') {
        const tcId =
          msg.toolCallId ||
          (msg.metadata?.toolCallId as string) ||
          (msg.metadata?.tool_call_id as string);
        if (tcId) {
          chatMessage.tool_call_id = tcId;
        }
      }

      // 对于助手消息，添加tool_calls（从metadata中读取）
      if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
        const toolCalls = msg.metadata.tool_calls as Record<string, unknown>[];
        chatMessage.tool_calls = toolCalls.map(
          (tc: Record<string, unknown>) => {
            if (tc.type && tc.function) {
              return tc;
            }
            return {
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
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

    // 将附带的图片转换为多模态 content 数组
    if (options?.images && options.images.length > 0) {
      const lastUserMsg = [...apiMessages]
        .reverse()
        .find((m: Record<string, unknown>) => m.role === 'user');
      if (lastUserMsg && typeof lastUserMsg.content === 'string') {
        const contentBlocks: Array<Record<string, unknown>> = [
          { type: 'text', text: lastUserMsg.content },
        ];
        for (const img of options.images) {
          try {
            const imageData = fs.readFileSync(img.path);
            const base64 = imageData.toString('base64');
            const ext =
              path.extname(img.filename).slice(1).toLowerCase() || 'png';
            const mimeType = ext === 'jpg' ? 'jpeg' : ext;
            contentBlocks.push({
              type: 'image_url',
              image_url: { url: `data:image/${mimeType};base64,${base64}` },
            });
          } catch (err) {
            logger.warn('图片文件读取失败，跳过该图片', {
              path: img.path,
              error: String(err),
            });
          }
        }
        lastUserMsg.content = contentBlocks;
      }

      // 注册图片路径到会话已知路径集合
      this._registerImagePaths(
        options.sessionId || '',
        options.images.map((img) => img.path)
      );
    }

    this._sanitizeApiMessages(apiMessages);

    // 获取工具定义
    let toolDefinitions: Record<string, unknown>[] = [];
    if (this.toolRegistry) {
      const registry = this.toolRegistry as unknown as {
        getToolSchemas: () => Array<Record<string, unknown>>;
      };
      const schemas = registry.getToolSchemas?.() || [];
      for (const schema of schemas) {
        toolDefinitions.push({
          type: 'function',
          function: {
            name: schema.name as string,
            description: schema.description as string,
            parameters: {
              type: 'object',
              properties:
                (
                  schema.input_schema as {
                    properties?: unknown;
                    required?: string[];
                  }
                )?.properties || {},
              required:
                (
                  schema.input_schema as {
                    properties?: unknown;
                    required?: string[];
                  }
                )?.required || [],
            },
          },
        });
      }
    }

    // 注入注册表查询工具（仅在当前会话有工具执行记录时）
    if (toolResultRegistry.getRoundCount(session.id) > 0) {
      toolDefinitions.push(
        ChatManagerImpl.QUERY_TOOL_GET_RESULT,
        ChatManagerImpl.QUERY_TOOL_LIST_CALLS
      );
    }

    // 触发 ChatPreStream Hook
    await this.hookChainManager.execute('chat', {
      event: 'chat.pre-stream',
      data: { message: content, sessionId: session.id },
      sessionId: session.id,
    });

    const hasSystemMessage = apiMessages.some(
      (m: Record<string, unknown>) => m.role === 'system'
    );
    if (!hasSystemMessage) {
      const sysPrompt = await this.getOrAssembleSystemPrompt(session, content);
      apiMessages.unshift({ role: 'system', content: sysPrompt });
    }

    let assistantMessage: Message | undefined;
    let accumulatedContent = '';
    let finalResponse: ChatResponse | null = null;

    if (!this.llmClient) {
      throw new AppError(
        'LLM client not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const activeClient = this.getClientForModel(options?.model);

    // 上下文长度保护：超限则尝试 AI 压缩，失败则截断旧消息
    const maxCtx = this._resolveMaxContextTokens(options?.model);
    await this._truncateApiMessages(apiMessages, maxCtx, session.id);

    const gen = activeClient.streamMessage(
      apiMessages as unknown as ChatMessage[],
      {
        ...options,
        tools:
          toolDefinitions.length > 0
            ? (toolDefinitions as unknown as ToolDefinition[])
            : undefined,
      }
    );

    let result = await gen.next();
    while (!result.done) {
      const chunk = result.value as string | ThinkingProviderChunk;
      if (typeof chunk === 'string') {
        accumulatedContent += chunk;
        options?.onStream?.(chunk);
        yield chunk;
      } else if (chunk?.type === 'thinking') {
        const thinkingChunk: ChatStreamChunk = {
          type: 'thinking',
          content: chunk.content,
          sessionId: session.id,
        };
        yield thinkingChunk;
      }
      result = await gen.next();
    }
    finalResponse = result.value as unknown as ChatResponse;

    this.recordChatResponseUsage(session.id, finalResponse?.usage);

    // 异步记录使用量到 UsageStatsService + CostTracker + LLMTracker
    // ChatManager 直接调用 AI provider，不经过 aiService，需要在此处插桩
    trackUsage(finalResponse ?? {}, {
      model: options?.model || 'unknown',
      providerId: activeClient.getProviderId(),
      latencyMs: 0,
      isStreaming: true,
      sessionId: session.id,
    }).catch((err) => {
      logger.warn('用量记录失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 通知外部：本次 LLM 响应的词元用量
    if (options?.onUsage && finalResponse?.usage) {
      const u = finalResponse.usage as unknown as Record<string, number>;
      const inputTokens = u.prompt_tokens ?? u.inputTokens ?? 0;
      const outputTokens = u.completion_tokens ?? u.outputTokens ?? 0;
      options.onUsage({
        inputTokens,
        outputTokens,
        cacheReadInputTokens:
          u.prompt_cache_hit_tokens ??
          u.cache_read_input_tokens ??
          u.cacheReadInputTokens ??
          0,
        cacheCreationInputTokens:
          u.prompt_cache_miss_tokens ??
          u.cache_creation_input_tokens ??
          u.cacheCreationInputTokens ??
          0,
        totalTokens:
          u.total_tokens ?? u.totalTokens ?? inputTokens + outputTokens,
        estimatedCostUsd:
          (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
      });
    }

    // 创建助手消息
    assistantMessage = this.messageService.createAssistantMessage(
      accumulatedContent,
      {
        sessionId: session.id,
      }
    );
    // 传播 finishReason 到消息对象（修复 BUG #10 L3）
    assistantMessage.finishReason = finalResponse?.finishReason || 'stop';

    // 添加助手消息到会话
    // 将 tool_calls 附加到存储的助手消息上，确保后续重建 apiMessages 时格式正确
    if (finalResponse?.tool_calls && finalResponse.tool_calls.length > 0) {
      assistantMessage.metadata = {
        ...assistantMessage.metadata,
        tool_calls: finalResponse.tool_calls.map((tc: ParsedToolCall) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments || {}),
          },
        })),
      };
    }
    this._addAndPersistMessage(session.id, assistantMessage);

    // 响应后自动提取记忆
    await this.extractMemoryFromChat(content, accumulatedContent, session.id);

    // 触发 ChatPostStream Hook
    await this.hookChainManager.execute('chat', {
      event: 'chat.post-stream',
      data: {
        message: content,
        response: finalResponse,
        sessionId: session.id,
      },
      sessionId: session.id,
    });

    // 触发 ChatPostMessage Hook
    await this.hookChainManager.execute('chat', {
      event: 'chat.post-message',
      data: {
        message: content,
        response: finalResponse,
        sessionId: session.id,
      },
      sessionId: session.id,
    });

    // 处理工具调用 — 使用 while 循环支持多轮递归工具调用
    if (finalResponse?.tool_calls && finalResponse.tool_calls.length > 0) {
      let currentRoundMessages = [...apiMessages];
      let currentToolCalls: ParsedToolCall[] = [...finalResponse.tool_calls];
      let roundAccumulatedContent = accumulatedContent;

      // 注册表：进入工具循环第一轮
      const rollbackRoundId = toolResultRegistry.nextRound(session.id);

      // 回滚：开始轮次追踪
      await this._startRollbackRound(session.id, rollbackRoundId).catch(
        (err) => {
          logger.warn('回滚轮次启动失败', { error: String(err) });
          handleError(err, {
            module: 'chat:ChatManager',
            action: 'rollback:startRound',
          }).catch(() => {});
        }
      );

      while (currentToolCalls.length > 0) {
        const processedResults: Array<{
          normalizedToolCall: ToolCall;
          result: ToolResult;
        }> = [];

        for (const toolCall of currentToolCalls) {
          const toolName = getToolCallName(toolCall);

          // 触发 ChatPreToolCall Hook
          const preToolResult = await this.hookChainManager.execute('chat', {
            event: 'chat.pre-tool-call',
            data: {
              toolCall: {
                id: toolCall.id,
                name: toolName,
                arguments: toolCall.arguments,
              },
              sessionId: session.id,
            },
            sessionId: session.id,
          });
          if (preToolResult.before.some((r) => r.preventContinuation)) {
            throw new AppError(
              `Tool ${toolName} execution denied by hook`,
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          }

          const argsStr = JSON.stringify(toolCall.arguments || {}).slice(
            0,
            200
          );
          options?.onToolCall?.('start', toolName, toolCall.id, argsStr);

          // ---- 检查工具是否需要用户交互（如 ask_user_question） ----
          const toolObj = (
            this.toolRegistry as unknown as {
              getTool: (name: string) =>
                | {
                    requiresUserInteraction?: () => boolean;
                  }
                | undefined;
            }
          ).getTool?.(toolName);

          if (toolObj?.requiresUserInteraction?.()) {
            const toolArgs = toolCall.arguments as Record<string, unknown>;
            const questionId = `q_${Date.now()}_${(toolCall.id || '').slice(0, 8)}`;

            // 校验并兜底 options（防止 LLM 漏传或全空 label）
            const rawOptions =
              (toolArgs.options as Array<{
                label?: string;
                description?: string;
              }>) || [];
            const validatedOptions = rawOptions
              .filter((opt) => opt.label && String(opt.label).trim().length > 0)
              .slice(0, 4)
              .map((opt) => ({
                label: String(opt.label).trim(),
                description: opt.description
                  ? String(opt.description).trim()
                  : '',
              }));

            let finalOptions = validatedOptions;
            if (validatedOptions.length < 2) {
              // LLM 调用错误：options 不足 2 项，自动兜底两个中性选项
              // 注意：不可以使用"继续"等暗示已有方案的标签，
              // 因为 LLM 可能在未输出方案的情况下就调用了 ask_user_question
              logger.warn(
                '[ChatManager] ask_user_question options 数量不足，自动兜底',
                {
                  questionId,
                  rawCount: rawOptions.length,
                  validCount: validatedOptions.length,
                }
              );
              finalOptions = [
                { label: '好的，开始讨论', description: '按当前方向直接开始' },
                { label: '我补充信息', description: '我还有其他信息要补充' },
              ];
            }

            // 创建待处理交互 Promise
            const interactionPromise = new Promise<string[]>((resolve) => {
              this._pendingInteraction = {
                questionId,
                resolve,
                promise: undefined as unknown as Promise<string[]>,
              };
            });
            // 修复循环引用：将 promise 指向自身
            (
              this._pendingInteraction as { promise: Promise<string[]> }
            ).promise = interactionPromise;

            // yield 问题分块到 UI 层
            const questionChunk: ChatStreamChunk = {
              type: 'question',
              content: (toolArgs.question as string) || '',
              sessionId: session.id,
              toolCall: {
                id: toolCall.id,
                name: toolName,
                arguments: toolArgs,
              },
              questionData: {
                questionId,
                question: (toolArgs.question as string) || '',
                header: (toolArgs.header as string) || '请选择',
                options: finalOptions,
                multiSelect: toolArgs.multiSelect as boolean | undefined,
              },
            };
            logger.info('[ChatManager] Yielding question chunk', {
              questionId,
              question: (toolArgs.question as string)?.slice(0, 40),
              optionsCount: finalOptions.length,
              wasFallback: validatedOptions.length < 2,
            });
            yield questionChunk;

            // 阻塞等待用户输入
            logger.info('等待用户回答', {
              questionId,
              question: toolArgs.question,
            });
            const answers = await interactionPromise;

            // 将用户答案注入工具参数
            (toolCall.arguments as Record<string, unknown>)._userAnswers =
              answers;
            logger.info('收到用户回答', { questionId, answers });
          }
          // ---- 结束用户交互检查 ----

          const toolResult = await this.executeTool({
            id: toolCall.id,
            name: toolName,
            arguments: toolCall.arguments,
            sessionId: session.id,
          });

          const resultDetail = toolResult.error
            ? `失败: ${toolResult.error.slice(0, 200)}`
            : `成功: ${(JSON.stringify(toolResult.result) ?? '').slice(0, 200)}`;
          options?.onToolCall?.('end', toolName, toolCall.id, resultDetail);

          // 触发 ChatPostToolCall Hook
          await this.hookChainManager.execute('chat', {
            event: 'chat.post-tool-call',
            data: {
              toolCallId: toolCall.id,
              toolName: toolName,
              result: toolResult.result,
              error: toolResult.error,
              sessionId: session.id,
            },
            sessionId: session.id,
          });

          // 注册表：存储工具执行结果
          toolResultRegistry.storeResult(
            session.id,
            toolCall.id,
            toolName,
            toolCall.arguments,
            { result: toolResult.result, error: toolResult.error },
            toolResultRegistry.getCurrentRound(session.id)
          );

          const toolResultMessage = this.messageService.createToolResultMessage(
            toolResult,
            {
              sessionId: session.id,
            }
          );
          this._addAndPersistMessage(session.id, toolResultMessage);

          processedResults.push({
            normalizedToolCall: {
              id: toolCall.id,
              name: toolName,
              arguments: toolCall.arguments,
            },
            result: toolResult,
          });

          // ---- 通知前端：工具执行完成，更新 block 状态 ----
          const completionChunk: ChatStreamChunk = {
            type: 'tool_call',
            content: '',
            sessionId: session.id,
            toolCall: {
              id: toolCall.id,
              name: toolName,
              arguments: toolCall.arguments,
              status: toolResult.error ? 'failed' : 'completed',
            },
          };
          yield completionChunk;
          // ---- 结束工具完成通知 ----

          // ---- 检测 todo 数据并 yield todo chunk ----
          const todoData = this._extractTodoData(toolResult);
          if (todoData) {
            const todoChunk: ChatStreamChunk = {
              type: 'todo',
              content: JSON.stringify(todoData),
              sessionId: session.id,
              todoData,
            };
            yield todoChunk;
          }
          // ---- 结束 todo chunk yield ----
        }

        // 构建完整请求：基础消息 + 带有全部 tool_calls 的 assistant + 全部工具结果
        const updatedMessages: Record<string, unknown>[] = [
          ...currentRoundMessages,
          {
            role: 'assistant',
            content: roundAccumulatedContent || null,
            tool_calls: currentToolCalls.map((tc: ParsedToolCall) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            })),
          },
          ...processedResults.map((pr) => ({
            role: 'tool' as const,
            content: pr.result.result
              ? JSON.stringify(pr.result.result)
              : pr.result.error || '{}',
            tool_call_id: pr.normalizedToolCall.id,
          })),
        ];

        let toolResultAccumulatedContent = '';

        const toolGen = activeClient.streamMessage(
          updatedMessages as unknown as ChatMessage[],
          {
            ...options,
            tools:
              toolDefinitions.length > 0
                ? (toolDefinitions as unknown as ToolDefinition[])
                : undefined,
          }
        );

        const toolGenResult = await toolGen.next();
        let toolResultIter = toolGenResult;
        while (!toolResultIter.done) {
          const chunk = toolResultIter.value as string | ThinkingProviderChunk;

          if (typeof chunk === 'string') {
            toolResultAccumulatedContent += chunk;
            options?.onStream?.(chunk);
            yield chunk;
          } else if (chunk?.type === 'thinking') {
            const thinkingChunk: ChatStreamChunk = {
              type: 'thinking',
              content: chunk.content,
              sessionId: session.id,
            };
            yield thinkingChunk;
          }

          toolResultIter = await toolGen.next();
        }
        const toolResultResponse =
          toolResultIter.value as unknown as ChatResponse;

        this.recordChatResponseUsage(session.id, toolResultResponse?.usage);

        // 异步记录使用量
        trackUsage(toolResultResponse ?? {}, {
          model: options?.model || 'unknown',
          providerId: activeClient.getProviderId(),
          latencyMs: 0,
          isStreaming: true,
          sessionId: session.id,
        }).catch((err) => {
          logger.warn('用量记录失败', {
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // 通知外部：本次工具结果 LLM 响应的词元用量
        if (options?.onUsage && toolResultResponse?.usage) {
          const u = toolResultResponse.usage as unknown as Record<
            string,
            number
          >;
          const inputTokens = u.prompt_tokens ?? u.inputTokens ?? 0;
          const outputTokens = u.completion_tokens ?? u.outputTokens ?? 0;
          options.onUsage({
            inputTokens,
            outputTokens,
            cacheReadInputTokens:
              u.prompt_cache_hit_tokens ??
              u.cache_read_input_tokens ??
              u.cacheReadInputTokens ??
              0,
            cacheCreationInputTokens:
              u.prompt_cache_miss_tokens ??
              u.cache_creation_input_tokens ??
              u.cacheCreationInputTokens ??
              0,
            totalTokens:
              u.total_tokens ?? u.totalTokens ?? inputTokens + outputTokens,
            estimatedCostUsd:
              (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15,
          });
        }

        const toolResultAssistantMessage =
          this.messageService.createAssistantMessage(
            toolResultAccumulatedContent,
            {
              sessionId: session.id,
            }
          );
        // 传播 finishReason 到消息对象（修复 BUG #10 L3）
        toolResultAssistantMessage.finishReason =
          toolResultResponse?.finishReason || 'stop';

        // 将 tool_calls 附加到存储的助手消息上，支持递归调用
        if (
          toolResultResponse?.tool_calls &&
          toolResultResponse.tool_calls.length > 0
        ) {
          toolResultAssistantMessage.metadata = {
            ...toolResultAssistantMessage.metadata,
            tool_calls: toolResultResponse.tool_calls.map(
              (tc: ParsedToolCall) => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments:
                    typeof tc.arguments === 'string'
                      ? tc.arguments
                      : JSON.stringify(tc.arguments || {}),
                },
              })
            ),
          };
        }
        this._addAndPersistMessage(session.id, toolResultAssistantMessage);

        // 检查是否有新的工具调用，有则继续下一轮
        if (
          toolResultResponse?.tool_calls &&
          toolResultResponse.tool_calls.length > 0
        ) {
          // 注册表：进入下一轮
          toolResultRegistry.nextRound(session.id);
          const assistantMsgForCompress = updatedMessages[
            currentRoundMessages.length
          ] as Record<string, unknown>;
          const toolResultsForCompress = updatedMessages.slice(
            currentRoundMessages.length + 1
          ) as Record<string, unknown>[];
          currentRoundMessages = this._compressToolHistory(
            currentRoundMessages,
            session.id,
            assistantMsgForCompress,
            toolResultsForCompress
          );
          currentToolCalls = [...toolResultResponse.tool_calls];
          roundAccumulatedContent = toolResultAccumulatedContent;
          assistantMessage = toolResultAssistantMessage;
        } else {
          assistantMessage = toolResultAssistantMessage;
          currentToolCalls = [];
        }
      }

      // 回滚：结束轮次追踪并创建快照
      await this._endRollbackRound(session.id, content).catch((err) => {
        logger.warn('回滚轮次结束失败', { error: String(err) });
        handleError(err, {
          module: 'chat:ChatManager',
          action: 'rollback:endRound',
        }).catch(() => {});
      });
    }

    // 通知会话状态变化为空闲状态
    this.getSessionMachine(session.id).finish('工具执行完成');

    // 跨轮对话摘要：保存关键决策
    this._persistTurnSummary(session);

    // Session Memory: 累计本轮数据，达到阈值则触发提炼
    this._accumulateSessionMemory(
      session.id,
      content,
      accumulatedContent,
      finalResponse?.usage?.inputTokens || 0,
      finalResponse?.tool_calls?.length || 0
    );

    options?.onComplete?.(assistantMessage);
    return assistantMessage;
  }

  /**
   * 解析待处理的用户交互
   * 当工具需要用户输入时，UI 层调用此方法提供用户答案，从而恢复工具执行
   *
   * @param questionId 问题ID（必须与待处理交互的 questionId 匹配）
   * @param answers 用户选择的答案列表
   * @returns 是否成功解析
   */
  resolveInteraction(questionId: string, answers: string[]): boolean {
    if (
      this._pendingInteraction &&
      this._pendingInteraction.questionId === questionId
    ) {
      logger.info('解析用户交互', { questionId, answers });
      this._pendingInteraction.resolve(answers);
      this._pendingInteraction = null;
      return true;
    }
    logger.warn('未找到匹配的待处理交互', { questionId });
    return false;
  }

  /**
   * 获取非流式路径中的待处理交互数据
   * @param sessionId 会话ID
   * @returns 待处理的提问数据，如果没有则返回 null
   */
  getPendingInteraction(sessionId: string): QuestionData | null {
    const state = this.pendingInteractions.get(sessionId);
    return state?.questionData ?? null;
  }

  /**
   * 继续非流式路径中的交互（用户回答后恢复工具执行）
   * 恢复 sendMessage() 中断的工具循环：注入用户答案执行交互工具，
   * 执行剩余工具，继续 LLM 多轮递归
   */
  async continueInteraction(
    sessionId: string,
    questionId: string,
    answers: string[]
  ): Promise<Message> {
    const state = this.pendingInteractions.get(sessionId);
    if (!state) {
      throw new AppError(
        `会话 ${sessionId} 没有待恢复的交互状态`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    if (state.questionData.questionId !== questionId) {
      throw new AppError(
        `问题 ID 不匹配: 期望 ${state.questionData.questionId}，实际 ${questionId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    this.pendingInteractions.delete(sessionId);
    logger.info('恢复非流式交互', { sessionId, questionId, answers });

    const session = this._getLocalSession(sessionId);
    if (!session) {
      throw new AppError(
        `会话 ${sessionId} 不存在`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 解构保存的状态
    let {
      currentRoundMessages,
      currentToolCalls,
      processedResults,
      interactionIdx,
      roundAssistantMsg,
      toolDefinitions,
    } = state;

    // ----- 执行从 interactionIdx 开始的工具 -----
    // 先完成当前轮次中 interactionIdx 及之后的工具
    const remainingTools = currentToolCalls.slice(interactionIdx);
    const newProcessedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }> = [...processedResults];

    for (let i = 0; i < remainingTools.length; i++) {
      const toolCall = remainingTools[i];
      const normalizedToolCall: ToolCall = {
        id: toolCall.id,
        name: toolCall.name || 'unknown',
        arguments: toolCall.arguments || {},
      };

      // 解析参数
      let parsedArguments: Record<string, unknown>;
      if (typeof normalizedToolCall.arguments === 'string') {
        try {
          parsedArguments = JSON.parse(normalizedToolCall.arguments);
        } catch {
          parsedArguments = {};
        }
      } else {
        parsedArguments = normalizedToolCall.arguments as Record<
          string,
          unknown
        >;
      }

      // 如果是交互工具（第一个），注入用户答案
      if (i === 0) {
        parsedArguments._userAnswers = answers;
      }

      // 执行工具
      const toolResult = await this.executeTool({
        id: normalizedToolCall.id,
        name: normalizedToolCall.name,
        arguments: parsedArguments,
        sessionId: session.id,
      });

      // 注册表：存储工具执行结果
      toolResultRegistry.storeResult(
        session.id,
        normalizedToolCall.id,
        normalizedToolCall.name,
        parsedArguments,
        { result: toolResult.result, error: toolResult.error },
        toolResultRegistry.getCurrentRound(session.id)
      );

      // 保存工具结果消息
      const toolResultMessage = this.messageService.createToolResultMessage(
        toolResult,
        { sessionId: session.id }
      );
      this._addAndPersistMessage(session.id, toolResultMessage);

      newProcessedResults.push({ normalizedToolCall, result: toolResult });
    }

    // ----- 构建下一轮 LLM 请求 -----
    let updatedMessages: Record<string, unknown>[];
    let assistantMsg = roundAssistantMsg;

    // 继续多轮递归工具循环
    // 使用 assistantMessage 作为累积消息，继续 while 循环
    // 注册表：进入下一轮
    toolResultRegistry.nextRound(session.id);
    while (true) {
      // 构建包含本轮全部结果的完整请求
      updatedMessages = [
        ...currentRoundMessages,
        {
          role: 'assistant',
          content:
            typeof assistantMsg.content === 'string'
              ? assistantMsg.content
              : JSON.stringify(assistantMsg.content),
          tool_calls: currentToolCalls.map((tc: ParsedToolCall) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        },
        ...newProcessedResults.map((pr) => {
          const toolResultContent = pr.result.result
            ? typeof pr.result.result === 'string'
              ? pr.result.result
              : JSON.stringify(pr.result.result)
            : pr.result.error || '{}';
          return {
            role: 'tool' as const,
            content: toolResultContent,
            tool_call_id: pr.normalizedToolCall.id,
          };
        }),
      ];

      // 发送到 LLM
      const activeClient = this.getLLMClient();
      const toolResultResponse = await activeClient.sendMessage(
        updatedMessages as unknown as ChatMessage[],
        {
          tools:
            toolDefinitions.length > 0
              ? (toolDefinitions as unknown as ToolDefinition[])
              : undefined,
        }
      );

      this.recordChatResponseUsage(session.id, toolResultResponse.usage);

      // 异步记录使用量
      trackUsage(toolResultResponse, {
        model: 'unknown',
        providerId: activeClient.getProviderId(),
        latencyMs: 0,
        isStreaming: false,
        sessionId: session.id,
      }).catch((err) => {
        logger.warn('用量记录失败', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // 创建本轮 assistant 消息
      const toolResultAssistantContent =
        typeof toolResultResponse.content === 'string'
          ? toolResultResponse.content
          : JSON.stringify(toolResultResponse.content);

      const toolResultAssistantMsg = this.messageService.createAssistantMessage(
        toolResultAssistantContent,
        { sessionId: session.id }
      );
      toolResultAssistantMsg.sessionId = session.id;

      if (
        toolResultResponse.tool_calls &&
        toolResultResponse.tool_calls.length > 0
      ) {
        const toolCallsData = toolResultResponse.tool_calls.map(
          (tc: ParsedToolCall) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })
        );
        toolResultAssistantMsg.metadata = {
          ...toolResultAssistantMsg.metadata,
          tool_calls: toolCallsData,
        };
      }
      this._addAndPersistMessage(session.id, toolResultAssistantMsg);

      // 检查是否有新的工具调用
      if (
        toolResultResponse.tool_calls &&
        toolResultResponse.tool_calls.length > 0
      ) {
        // 继续下一轮
        // 注册表：进入下一轮
        toolResultRegistry.nextRound(session.id);
        const assistantMsgForCompress = updatedMessages[
          currentRoundMessages.length
        ] as Record<string, unknown>;
        const toolResultsForCompress = updatedMessages.slice(
          currentRoundMessages.length + 1
        ) as Record<string, unknown>[];
        currentRoundMessages = this._compressToolHistory(
          currentRoundMessages,
          session.id,
          assistantMsgForCompress,
          toolResultsForCompress
        );
        currentToolCalls = [...toolResultResponse.tool_calls];
        newProcessedResults.length = 0; // 清空，重新累积
        assistantMsg = toolResultAssistantMsg;
        continue;
      }

      // 没有更多工具调用，返回最终消息
      return toolResultAssistantMsg;
    }
  }

  /**
   * 获取或创建回滚集成实例
   * @param sessionId 会话 ID
   * @returns 回滚集成实例
   */
  private _getRollbackIntegration(sessionId: string): RollbackIntegration {
    let integration = this.rollbackIntegrations.get(sessionId);
    if (!integration) {
      integration = new RollbackIntegration(sessionId);

      // 连接撤消/重做权限控制
      // 将 undo_round / redo_round 作为虚拟工具名，复用 PermissionManager
      if (this.permissionManager) {
        const pm = this.permissionManager as {
          checkPermissionForTool: (
            name: string,
            args: Record<string, unknown>
          ) => Promise<{ allowed: boolean; reason?: string }>;
        };
        integration.setPermissionChecker(async (action, roundId) => {
          const result = await pm.checkPermissionForTool(
            action === 'undo' ? 'undo_round' : 'redo_round',
            { sessionId, roundId }
          );
          return { allowed: result.allowed, reason: result.reason };
        });
      }

      this.rollbackIntegrations.set(sessionId, integration);
    }
    return integration;
  }

  /**
   * 开始回滚轮次追踪
   * @param sessionId 会话 ID
   * @param roundId 轮次编号
   */
  private async _startRollbackRound(
    sessionId: string,
    roundId: number
  ): Promise<void> {
    const integration = this._getRollbackIntegration(sessionId);
    const scanPaths = [resolveProjectRoot()];
    await integration.onRoundStart(sessionId, roundId, scanPaths);
  }

  /**
   * 结束回滚轮次追踪并创建快照
   * @param sessionId 会话 ID
   * @param messageSummary 用户消息摘要
   */
  private async _endRollbackRound(
    sessionId: string,
    messageSummary: string
  ): Promise<void> {
    const integration = this.rollbackIntegrations.get(sessionId);
    if (integration) {
      await integration.onRoundEnd(messageSummary);
    }
  }

  /**
   * 执行工具
   * @param toolCall 工具调用
   * @returns 工具结果
   */
  async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    // 工具参数由 LLM 生成，不需要 Unicode 清理（用户输入在进入 LLM 前已清理）
    // 注意: 对工具参数做 NFKC 归一化会破坏文件路径中的全角字符（如 （）→()），导致文件找不到
    const normalizedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments as Record<string, unknown>,
    };

    // 本地查询工具：直接从注册表返回，不经过工具注册表执行
    if (normalizedToolCall.name === 'get_tool_result') {
      const targetId = normalizedToolCall.arguments.tool_call_id as string;
      const stored = toolResultRegistry.findByCallId(targetId);
      logger.info('LLM 查询工具结果', {
        toolCallId: toolCall.id,
        targetId,
        found: !!stored,
      });
      if (!stored) {
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: { found: false, toolCallId: targetId },
          error: undefined,
        };
      }
      return {
        toolCallId: toolCall.id,
        toolName: normalizedToolCall.name,
        result: { found: true, toolCall: stored },
        error: undefined,
      };
    }

    if (normalizedToolCall.name === 'list_tool_calls') {
      // 没有 sessionId 上下文，无法列出
      // 调用方通过存档消息传递 sessionId，此处返回空列表
      logger.info('LLM 查询工具列表（无 sessionId 上下文，返回空列表）', {
        toolCallId: toolCall.id,
      });
      return {
        toolCallId: toolCall.id,
        toolName: normalizedToolCall.name,
        result: { toolCalls: [] },
        error: undefined,
      };
    }

    // 检查工具权限
    if (this.permissionManager) {
      const pm = this.permissionManager as {
        checkPermissionForTool: (
          name: string,
          args: Record<string, unknown>
        ) => Promise<{ allowed: boolean; reason?: string }>;
      };
      const permissionResult = await pm.checkPermissionForTool(
        normalizedToolCall.name,
        normalizedToolCall.arguments
      );

      if (!permissionResult.allowed) {
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: null,
          error: `Permission denied: ${permissionResult.reason || 'Tool execution not allowed'}`,
        };
      }
    }

    // 回滚：拦截文件工具操作（Write / Edit）
    // 在工具执行前记录文件的"操作前状态"
    if (
      normalizedToolCall.name === FILE_WRITE_TOOL_NAME ||
      normalizedToolCall.name === FILE_EDIT_TOOL_NAME
    ) {
      const filePath = normalizedToolCall.arguments?.file_path as
        | string
        | undefined;
      if (filePath && toolCall.sessionId) {
        const integration = this.rollbackIntegrations.get(toolCall.sessionId);
        if (integration) {
          const op: FileOperation = {
            path: filePath,
            type: 'modified',
          };
          integration.onToolBeforeExecute(op).catch((err) => {
            logger.warn('回滚：文件操作前追踪失败', { error: String(err) });
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'rollback:onToolBeforeExecute',
            }).catch(() => {});
          });
        }
      }
    }

    // inputPath 安全校验：对图像类工具校验输入路径是否在已知路径集合中
    const IMAGE_TOOL_NAMES = new Set([
      'image_analysis',
      'image',
      'image_svg_generate',
      'canvas',
    ]);
    if (IMAGE_TOOL_NAMES.has(normalizedToolCall.name) && toolCall.sessionId) {
      const args = normalizedToolCall.arguments;
      let inputPath = (args.inputPath || args.file_path || args.path) as
        | string
        | undefined;

      if (!inputPath && normalizedToolCall.name === 'canvas') {
        // canvas import 使用 elements[0].src 作为图片路径
        const elements = args.elements as Array<{ src?: string }> | undefined;
        if (Array.isArray(elements) && elements.length > 0 && elements[0].src) {
          inputPath = elements[0].src;
        }
      }

      if (!inputPath) {
        // inputPath 为空时，从 imageContext 自动回退补全
        const ctx = this._sessionImageContext.get(toolCall.sessionId);
        if (ctx) {
          if (normalizedToolCall.name === 'image') {
            inputPath =
              ctx.lastEditedImage?.filePath ||
              ctx.lastGeneratedImage?.filePath ||
              ctx.lastAnalyzedImage?.filePath;
          } else {
            inputPath =
              ctx.lastAnalyzedImage?.filePath ||
              ctx.lastGeneratedImage?.filePath ||
              ctx.lastEditedImage?.filePath;
          }
          if (inputPath) {
            logger.info('工具调用 inputPath 为空，从 imageContext 自动补全', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              autoFilledPath: inputPath,
            });
            normalizedToolCall.arguments = {
              ...args,
              inputPath,
            };
          }
        }
      }

      if (inputPath) {
        const knownPaths = this._getKnownImagePaths(toolCall.sessionId);

        if (knownPaths.length > 0 && !knownPaths.includes(inputPath)) {
          const closestPath = this._findClosestPath(inputPath, knownPaths);

          if (closestPath) {
            logger.warn('工具调用路径不匹配，自动修正为最接近的已知路径', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              inputPath,
              correctedPath: closestPath,
            });
            normalizedToolCall.arguments = {
              ...args,
              inputPath: closestPath,
            };
          } else {
            logger.error('工具调用路径不在已知集合中，拒绝执行', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              inputPath,
              knownPaths,
            });
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: null,
              error: `Invalid path: ${inputPath} is not in known image paths. Available paths: ${knownPaths.join(', ')}`,
            };
          }
        }
      }
    }

    if (this.toolRegistry) {
      // 直接使用工具注册表执行
      try {
        const context = {
          toolUseId: normalizedToolCall.id,
          options: {
            cwd: resolveProjectRoot(),
            env: process.env as Record<string, string>,
          },
        };

        const registry = this.toolRegistry as unknown as {
          executeTool: (
            params: {
              toolName: string;
              input: Record<string, unknown>;
            },
            context: {
              toolUseId: string;
              options: Record<string, unknown>;
            }
          ) => Promise<{
            result?: unknown;
            data?: unknown;
            error?: string;
            metadata?: { error?: string };
            output?: string;
          }>;
        };
        const toolResult = await registry.executeTool(
          {
            toolName: normalizedToolCall.name,
            input: normalizedToolCall.arguments,
          },
          context
        );

        // 检查工具执行结果是否包含错误
        let error: string | undefined;
        if (toolResult.error) {
          error =
            typeof toolResult.error === 'string'
              ? toolResult.error
              : JSON.stringify(toolResult.error);
        } else if (toolResult.metadata?.error) {
          error =
            typeof toolResult.metadata.error === 'string'
              ? toolResult.metadata.error
              : JSON.stringify(toolResult.metadata.error);
        }

        // 注册图像工具输出路径到已知路径集合
        const resultData = (toolResult.data || toolResult.result) as
          | Record<string, unknown>
          | undefined;
        if (resultData && !error && toolCall.sessionId) {
          const extractedPaths = this._extractImagePathsFromResult(
            normalizedToolCall.name,
            resultData
          );
          if (extractedPaths.length > 0) {
            this._registerImagePaths(toolCall.sessionId, extractedPaths);
          }

          // 更新会话级图像上下文
          this._updateImageContext(
            toolCall.sessionId,
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            resultData
          );

          // 生图完成后通知前端刷新图库
          if (normalizedToolCall.name === 'image_generate') {
            eventNotificationService.emitCustomEvent('tool:completed', {
              toolName: 'image_generate',
              sessionId: toolCall.sessionId,
              toolCallId: toolCall.id,
              images: (resultData as Record<string, unknown>).images,
              resultData,
            });
          }
        }

        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: toolResult.data || toolResult.result,
          error,
        };
      } catch (error) {
        logger.error('工具执行失败', {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          error: error instanceof Error ? error.message : String(error),
        });
        handleError(error, {
          module: 'chat:ChatManager',
          action: 'executeTool',
          context: {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
          },
        }).catch(() => {});
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else if (this.toolIntegration) {
      return this.toolIntegration.executeTool(toolCall);
    } else {
      throw new AppError(
        'No tool integration or tool registry initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 创建新会话
   * @param params 创建会话的参数
   * @returns 会话对象
   */
  createSession(params: CreateSessionParams): ChatSession {
    const now = new Date();
    const sessionId =
      params.id ||
      'session_' +
        Date.now().toString(36) +
        Math.random().toString(36).substr(2);
    const session: ChatSession = {
      id: sessionId,
      title: params.title,
      state: SessionState.ACTIVE,
      metadata: {
        title: params.title,
        description: params.description,
        tags: params.tags,
        mode: params.mode,
        model: params.model,
        creator: params.creator,
        lastActivityAt: now,
        totalMessages: params.initialMessages?.length || 0,
        totalTokens: 0,
        totalCost: 0,
        titleAutoGenerated: false,
        ...params.metadata,
      },
      messages: params.initialMessages || [],
      createdAt: now,
      updatedAt: now,
    };

    this._chatSessions.set(session.id, session);
    this._currentSessionId = session.id;

    this.tokenTracker?.clearSession(session.id);

    // 持久化会话到 FileSystemUnifiedStorage
    this.sessionGateway
      .createSession({
        id: session.id,
        title: params.title ?? session.title,
        metadata: {},
      })
      .catch((e) => {
        logger.error('Failed to persist session creation', {
          sessionId: session.id,
          error: String(e),
        });
      });

    // 触发 ChatSessionStart Hook
    this.hookChainManager.execute('chat', {
      event: 'chat.session-start',
      data: { sessionId: session.id },
      sessionId: session.id,
    });

    // 追踪会话活跃度
    getSessionActivityTracker().startActivity(session.id);

    return session;
  }

  /**
   * 确保会话已加载（内存缓存 → Gateway 降级 → 创建新会话）
   */
  private async _ensureSessionLoaded(sessionId: string): Promise<ChatSession> {
    // Step 1: 内存缓存命中
    const cached = this._chatSessions.get(sessionId);
    if (cached) {
      return cached;
    }

    // Step 2: 尝试从 Gateway（持久化存储）加载
    try {
      const storedSession = await this.sessionGateway.getSession(sessionId);
      if (storedSession) {
        const storedMessages = await this.sessionGateway.getMessages(sessionId);
        const messages: Message[] = (storedMessages || []).map((m) => {
          let content: string;
          if (typeof m.content === 'string') {
            content = m.content;
          } else if (Array.isArray(m.content)) {
            const textBlocks = m.content.filter((b) => b.type === 'text');
            content =
              textBlocks.length > 0
                ? textBlocks
                    .map((b) => (b as { type: 'text'; text: string }).text)
                    .join('')
                : '';
          } else {
            content = '';
          }
          return {
            id: m.id,
            role: m.role,
            content,
            createdAt: new Date(m.timestamp),
            updatedAt: new Date(m.timestamp),
            sessionId: storedSession.id,
            toolCallId: m.metadata?.toolCallId,
            metadata: m.metadata as Record<string, unknown> | undefined,
            blocks: m.blocks as unknown as
              | Record<string, unknown>[]
              | undefined,
            tool_calls: m.metadata?.tool_calls,
          } as Message;
        });
        const chatSession: ChatSession = {
          id: storedSession.id,
          title: storedSession.title,
          state: this._mapSessionStatusToState(storedSession.status),
          metadata: {
            title: storedSession.title || '',
            ...storedSession.metadata,
            totalMessages: messages.length,
            lastActivityAt: new Date(storedSession.lastActivityAt),
          },
          messages,
          createdAt: new Date(storedSession.createdAt),
          updatedAt: new Date(storedSession.updatedAt),
        };
        this._chatSessions.set(storedSession.id, chatSession);
        logger.info('从 Gateway 降级加载会话成功', { sessionId });
        return chatSession;
      }
    } catch (e) {
      logger.warn('Gateway 降级加载失败，将创建新会话', {
        sessionId,
        error: String(e),
      });
    }

    // Step 3: Gateway 也未找到 → 创建新会话
    logger.warn('会话未找到，创建新会话', { sessionId });
    return this.createSession({
      title: 'New Session',
      id: sessionId,
    });
  }

  /**
   * 统一获取或加载会话（替代 _getLocalSession || createSession 模式）
   */
  private async _getOrLoadSession(
    sessionId: string,
    metadata?: Record<string, unknown>
  ): Promise<ChatSession> {
    const cached = this._chatSessions.get(sessionId);
    if (cached) {
      return cached;
    }

    try {
      const storedSession = await this.sessionGateway.getSession(sessionId);
      if (storedSession) {
        const storedMessages = await this.sessionGateway.getMessages(sessionId);
        const messages: Message[] = (storedMessages || []).map((m) => {
          let content: string;
          if (typeof m.content === 'string') {
            content = m.content;
          } else if (Array.isArray(m.content)) {
            const textBlocks = m.content.filter((b) => b.type === 'text');
            content =
              textBlocks.length > 0
                ? textBlocks
                    .map((b) => (b as { type: 'text'; text: string }).text)
                    .join('')
                : '';
          } else {
            content = '';
          }
          return {
            id: m.id,
            role: m.role,
            content,
            createdAt: new Date(m.timestamp),
            updatedAt: new Date(m.timestamp),
            sessionId: storedSession.id,
            toolCallId: m.metadata?.toolCallId,
            metadata: m.metadata as Record<string, unknown> | undefined,
            blocks: m.blocks as unknown as
              | Record<string, unknown>[]
              | undefined,
            tool_calls: m.metadata?.tool_calls,
          } as Message;
        });
        const chatSession: ChatSession = {
          id: storedSession.id,
          title: storedSession.title,
          state: this._mapSessionStatusToState(storedSession.status),
          metadata: {
            title: storedSession.title || '',
            ...storedSession.metadata,
            totalMessages: messages.length,
            lastActivityAt: new Date(storedSession.lastActivityAt),
          },
          messages,
          createdAt: new Date(storedSession.createdAt),
          updatedAt: new Date(storedSession.updatedAt),
        };
        this._chatSessions.set(storedSession.id, chatSession);

        // Session State Hydration
        try {
          const hydrated = getSessionStateHydrator().hydrate(chatSession);
          if (hydrated.todos || hydrated.recentFiles.length > 0) {
            chatSession.metadata = {
              ...chatSession.metadata,
              hydratedTodos: hydrated.todos,
              hydratedRecentFiles: hydrated.recentFiles,
              hydratedDecisions: hydrated.recentDecisions,
            };
          }
        } catch {
          // 回灌失败不影响
        }
        return chatSession;
      }
    } catch (e) {
      logger.warn('Gateway 加载失败，将创建新会话', {
        sessionId,
        error: String(e),
      });
    }

    return this.createSession({
      title: 'New Session',
      id: sessionId,
      metadata,
    });
  }

  /**
   * 切换会话
   * @param sessionId 会话ID
   */
  async switchSession(sessionId: string): Promise<void> {
    const otel = getOTelTracing();
    const span = otel.startSpan('ChatManager.switchSession', {
      'session.id': sessionId,
    });
    try {
      // 记录离开当前会话的时间戳（用于回切召回）
      if (this._currentSessionId && this._currentSessionId !== sessionId) {
        this._sessionLeaveTimes.set(this._currentSessionId, Date.now());
      }

      await this._ensureSessionLoaded(sessionId);
      this._currentSessionId = sessionId;

      // 检测回切：离开超过 30 秒时发射召回事件
      const leaveTime = this._sessionLeaveTimes.get(sessionId);
      if (leaveTime && Date.now() - leaveTime > 30_000) {
        this._sessionLeaveTimes.delete(sessionId);
        eventNotificationService.emitCustomEvent('agent:memory:recalling', {
          sessionId,
          awayMs: Date.now() - leaveTime,
        });
      }

      logger.info('会话切换成功', { sessionId });
      otel.endSpan(span);
    } catch (e) {
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      await handleError(e, {
        module: 'chat:ChatManager',
        action: 'switchSession',
        context: { sessionId },
        rethrow: false,
      });
    }
  }

  /**
   * 获取当前会话
   * @returns 当前会话对象
   */
  getCurrentSession(): ChatSession | undefined {
    return this._getLocalSession(this._currentSessionId);
  }

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  getSessions(): ChatSession[] {
    return Array.from(this._chatSessions.values());
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): void {
    // 触发 ChatSessionEnd Hook
    this.hookChainManager.execute('chat', {
      event: 'chat.session-end',
      data: { sessionId },
      sessionId,
    });

    this._chatSessions.delete(sessionId);
    if (this._currentSessionId === sessionId) {
      this._currentSessionId = null;
    }

    // 停止会话活跃度追踪
    getSessionActivityTracker().stopActivity(sessionId);

    // 同步删除持久化存储
    this.sessionGateway.deleteSession(sessionId).catch((e) => {
      logger.error('Failed to delete session from gateway', {
        error: String(e),
      });
    });
  }

  /**
   * 清除所有会话
   */
  async clearAllSessions(): Promise<void> {
    const sessionIds = Array.from(this._chatSessions.keys());
    for (const id of sessionIds) {
      this.hookChainManager.execute('chat', {
        event: 'chat.session-end',
        data: { sessionId: id },
        sessionId: id,
      });
    }
    this._chatSessions.clear();
    this._currentSessionId = null;

    // 清理持久化存储
    const storedSessions = await this.sessionGateway.listSessions();
    for (const stored of storedSessions) {
      await this.sessionGateway.deleteSession(stored.id).catch(() => {});
    }
  }

  /**
   * 保存会话
   * @param session 会话对象
   */
  async saveSession(session: ChatSession): Promise<void> {
    this._chatSessions.set(session.id, session);
  }

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象
   */
  async loadSession(sessionId: string): Promise<ChatSession | undefined> {
    return this._getLocalSession(sessionId);
  }

  /**
   * 加载所有会话
   * @returns 会话列表
   */
  async loadSessions(): Promise<ChatSession[]> {
    return Array.from(this._chatSessions.values());
  }

  /**
   * 添加消息到会话
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  addMessage(sessionId: string, message: Message): void {
    this._addAndPersistMessage(sessionId, message);
  }

  /**
   * 获取会话消息
   * @param sessionId 会话ID
   * @returns 消息列表
   */
  getSessionMessages(sessionId: string): Message[] {
    const session = this._getLocalSession(sessionId);
    return session?.messages || [];
  }

  /**
   * 搜索消息
   * @param query 搜索查询
   * @param sessionId 会话ID（可选）
   * @returns 消息列表
   */
  searchMessages(query: string, sessionId?: string): Message[] {
    if (sessionId) {
      const session = this._getLocalSession(sessionId);
      if (session) {
        return this.messageService.searchMessages(session.messages, query);
      }
      return [];
    } else {
      const allMessages: Message[] = [];
      for (const session of this._chatSessions.values()) {
        allMessages.push(...session.messages);
      }
      return this.messageService.searchMessages(allMessages, query);
    }
  }

  /**
   * 获取消息服务
   * @returns 消息服务
   */
  getMessageService(): MessageService {
    return this.messageService;
  }

  /**
   * 获取流服务
   * @returns 流服务
   */
  getStreamService(): StreamService {
    return this.streamService;
  }

  /**
   * 获取会话网关（持久化存储）
   * @returns 会话网关
   */
  getSessionGateway(): SessionGateway {
    return this.sessionGateway;
  }

  /**
   * 获取会话管理器
   * @returns 会话管理器
   */
  getSessionManager(): any {
    return {
      getSession: (id: string) => this._getLocalSession(id),
      getCurrentSession: () => this._getLocalSession(this._currentSessionId),
      setCurrentSession: (id: string) => {
        this._currentSessionId = id;
      },
      getSessions: () => Array.from(this._chatSessions.values()),
      addMessage: (id: string, msg: Message) =>
        this._addAndPersistMessage(id, msg),
      deleteSession: (id: string) => {
        this._chatSessions.delete(id);
      },
      saveSession: (s: ChatSession) => {
        this._chatSessions.set(s.id, s);
      },
      loadSession: (id: string) => Promise.resolve(this._getLocalSession(id)),
      loadSessions: () =>
        Promise.resolve(Array.from(this._chatSessions.values())),
      createCheckpoint: (sessionId: string, label?: string) =>
        this._checkpointService
          .saveCheckpointWithData(
            sessionId,
            this._getLocalSession(sessionId)?.messages || [],
            this._getLocalSession(sessionId)?.metadata || { title: '' },
            this._getLocalSession(sessionId)?.state || SessionState.ACTIVE,
            label
          )
          .then((cp) => cp.id),
      listCheckpoints: (sessionId: string) =>
        this._checkpointService.listCheckpoints(sessionId),
      rollbackToCheckpoint: (checkpointId: string) =>
        this._checkpointService.rollbackToCheckpoint(checkpointId, {
          messages: [],
          metadata: { title: '' },
          state: SessionState.ACTIVE,
        }),
      deleteCheckpoint: (checkpointId: string) =>
        this._checkpointService.deleteCheckpoint(checkpointId),
      deleteSessionCheckpoints: (sessionId: string) =>
        this._checkpointService.deleteSessionCheckpoints(sessionId),
      getLatestCheckpoint: (sessionId: string) =>
        this._checkpointService.getLatestCheckpoint(sessionId),
    };
  }

  /**
   * 根据模型名获取对应的 LLM 客户端
   * 如果模型属于其他 Provider（如 Ollama），自动创建对应的 ToolAwareClient
   */
  private getClientForModel(model?: string): ToolAwareClient {
    if (!this.llmClient) {
      throw new AppError(
        'LLM client not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (!model) return this.llmClient;

    const currentProviderId = this.llmClient.getProviderId();
    const resolvedProvider = providerRegistry.getByModel(model);

    if (resolvedProvider && resolvedProvider.id !== currentProviderId) {
      return new ToolAwareClient(
        resolvedProvider,
        this
          .toolRegistry as unknown as import('@modules/ai/interfaces/ToolExecutor').ToolRegistry,
        this.toolExecutor
      );
    }

    return this.llmClient;
  }

  /**
   * 获取LLM客户端
   * @returns LLM客户端
   */
  getLLMClient(): ToolAwareClient {
    if (!this.llmClient) {
      throw new AppError(
        'LLM client not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return this.llmClient;
  }

  /**
   * 获取工具集成
   * @returns 工具集成
   */
  getToolIntegration(): ToolIntegration | undefined {
    return this.toolIntegration;
  }

  /**
   * 设置工具集成
   * @param toolIntegration 工具集成
   */
  setToolIntegration(toolIntegration: ToolIntegration): void {
    this.toolIntegration = toolIntegration;
  }

  /**
   * 设置LLM客户端
   * @param llmClient LLM客户端
   */
  setLLMClient(llmClient: ToolAwareClient): void {
    this.llmClient = llmClient;
  }

  /**
   * 设置工具注册表
   * @param registry 工具注册表
   */
  setToolRegistry(registry: ToolRegistry | null): void {
    this.toolRegistry = registry;
  }

  /**
   * 获取工具注册表
   * @returns 工具注册表
   */
  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  /**
   * 设置令牌追踪器
   */
  setTokenTracker(tracker: SessionTokenTracker | null): void {
    this.tokenTracker = tracker;
  }

  /**
   * 获取令牌追踪器
   */
  getTokenTracker(): SessionTokenTracker | null {
    return this.tokenTracker;
  }

  /**
   * 设置权限管理器
   * @param permissionManager 权限管理器
   */
  setPermissionManager(permissionManager: unknown): void {
    this.permissionManager = permissionManager;
  }

  /**
   * 获取权限管理器
   * @returns 权限管理器
   */
  getPermissionManager(): unknown {
    return this.permissionManager;
  }

  /**
   * 设置工具执行器
   * @param toolExecutor 工具执行器
   */
  setToolExecutor(toolExecutor: IToolExecutor | null): void {
    this.toolExecutor = toolExecutor;
  }

  /**
   * 获取工具执行器
   * @returns 工具执行器
   */
  getToolExecutor(): IToolExecutor | null {
    return this.toolExecutor;
  }

  /**
   * 设置子Agent管理器
   * @param subAgentManager 子Agent管理器
   */
  setSubAgentManager(subAgentManager: unknown): void {
    this.subAgentManager = subAgentManager;
  }

  /**
   * 获取子Agent管理器
   * @returns 子Agent管理器
   */
  getSubAgentManager(): unknown {
    return this.subAgentManager;
  }

  /**
   * 获取会话元数据服务
   * @returns 会话元数据服务
   */
  getSessionMetadataService(): typeof sessionMetadataService {
    return sessionMetadataService;
  }

  /**
   * 获取事件通知服务
   * @returns 事件通知服务
   */
  getEventNotificationService(): typeof eventNotificationService {
    return eventNotificationService;
  }

  /**
   * 获取消息处理服务
   * @returns 消息处理服务
   */
  getMessageProcessingService(): typeof messageProcessingService {
    return messageProcessingService;
  }

  /**
   * 获取权限模式集成服务
   * @returns 权限模式集成服务
   */
  getPermissionModeIntegrationService(): typeof permissionModeIntegrationService {
    return permissionModeIntegrationService;
  }

  /**
   * 获取性能优化服务
   * @returns 性能优化服务
   */
  getPerformanceOptimizationService(): typeof performanceOptimizationService {
    return performanceOptimizationService;
  }

  /**
   * 获取安全服务
   * @returns 安全服务
   */
  getSecurityService(): typeof securityService {
    return securityService;
  }

  /**
   * 获取查询引擎
   * @returns QueryEngine实例
   */
  getQueryEngine(): QueryEngine {
    if (!this.queryEngine) {
      this.queryEngine = createQueryEngine(this, this.queryEngineConfig);
    }
    return this.queryEngine;
  }

  /**
   * 设置查询引擎配置
   * @param config 查询引擎配置
   */
  setQueryEngineConfig(config: QueryEngineConfig): void {
    this.queryEngineConfig = config;
    if (this.queryEngine) {
      this.queryEngine = createQueryEngine(this, config);
    }
  }

  /**
   * 使用查询引擎处理消息
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生消息块
   */
  async *query(
    content: string,
    options?: {
      sessionId?: string;
      maxTurns?: number;
      maxBudgetUsd?: number;
    }
  ): AsyncGenerator<string, unknown, unknown> {
    const queryEngine = this.getQueryEngine();

    // 构建配置
    const config: QueryEngineConfig = {
      maxTurns: options?.maxTurns || this.queryEngineConfig?.maxTurns,
      maxBudgetUsd:
        options?.maxBudgetUsd || this.queryEngineConfig?.maxBudgetUsd,
    };

    // 更新配置
    this.setQueryEngineConfig(config);

    // 创建或获取会话
    const sessionId =
      options?.sessionId || this.createSession({ title: 'Query Session' }).id;

    // 使用QueryEngine处理消息
    const messages = queryEngine.submitMessage(content, { sessionId });

    for await (const message of messages) {
      if (message.type === 'text' && message.content) {
        yield message.content;
      } else if (message.type === 'tool_use' && message.toolUse) {
        yield `[工具调用: ${message.toolUse.name}]`;
      } else if (message.type === 'tool_result' && message.toolResult) {
        yield `[工具结果: ${message.toolResult.content}]`;
      } else if (message.type === 'error') {
        throw new AppError(
          message.error || '查询错误',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    return undefined;
  }

  /**
   * 获取查询状态
   * @returns 查询状态
   */
  getQueryState(): string {
    if (!this.queryEngine) {
      return 'idle';
    }
    return this.queryEngine.getQueryState();
  }

  /**
   * 使用查询引擎进行流式查询
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生流式消息块
   */
  async *streamQuery(
    content: string,
    options?: {
      sessionId?: string;
      maxTurns?: number;
      maxBudgetUsd?: number;
      onChunk?: (chunk: string) => void;
      onComplete?: (result: unknown) => void;
    }
  ): AsyncGenerator<string, unknown, unknown> {
    const queryEngine = this.getQueryEngine();

    // 构建配置
    const config: QueryEngineConfig = {
      maxTurns: options?.maxTurns || this.queryEngineConfig?.maxTurns,
      maxBudgetUsd:
        options?.maxBudgetUsd || this.queryEngineConfig?.maxBudgetUsd,
    };

    // 更新配置
    this.setQueryEngineConfig(config);

    // 创建或获取会话
    const sessionId =
      options?.sessionId ||
      this.createSession({ title: 'Stream Query Session' }).id;

    // 使用QueryEngine处理消息
    const messages = queryEngine.submitMessage(content, { sessionId });

    let accumulatedResult: unknown[] = [];

    for await (const message of messages) {
      if (message.type === 'text' && message.content) {
        // 流式输出文本内容
        for (let i = 0; i < message.content.length; i += 10) {
          const chunk = message.content.slice(
            i,
            Math.min(i + 10, message.content.length)
          );
          options?.onChunk?.(chunk);
          yield chunk;
        }
        accumulatedResult.push({ type: 'text', content: message.content });
      } else if (message.type === 'tool_use' && message.toolUse) {
        const toolInfo = `[工具调用: ${message.toolUse.name}]`;
        options?.onChunk?.(toolInfo);
        yield toolInfo;
        accumulatedResult.push({ type: 'tool_use', toolUse: message.toolUse });
      } else if (message.type === 'tool_result' && message.toolResult) {
        const resultContent = `[工具结果: ${message.toolResult.content}]`;
        options?.onChunk?.(resultContent);
        yield resultContent;
        accumulatedResult.push({
          type: 'tool_result',
          toolResult: message.toolResult,
        });
      } else if (message.type === 'error') {
        throw new AppError(
          message.error || '查询错误',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    // 调用完成回调
    options?.onComplete?.({
      sessionId,
      result: accumulatedResult,
      state: this.getQueryState(),
    });

    return accumulatedResult;
  }

  /**
   * 检查是否需要压缩
   * @param sessionId 会话ID
   * @returns 压缩边界信息或null
   */
  async checkCompactBoundary(
    sessionId?: string
  ): Promise<CompactBoundary | null> {
    const targetSessionId =
      sessionId || this._getLocalSession(this._currentSessionId)?.id;
    if (!targetSessionId) {
      return null;
    }

    const session = this._getLocalSession(targetSessionId);
    if (!session) {
      return null;
    }

    const sessionMessages: SessionMessage[] = session.messages.map((msg) => ({
      id: msg.id,
      type: msg.role as SessionMessage['type'],
      content:
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })) as unknown as SessionMessage[];

    return this.compactService.detectCompactBoundary(
      targetSessionId,
      sessionMessages
    );
  }

  /**
   * 执行会话压缩
   * @param sessionId 会话ID
   * @returns 压缩产物列表
   */
  async compactSession(sessionId?: string): Promise<CompactArtifact[]> {
    const targetSessionId =
      sessionId || this._getLocalSession(this._currentSessionId)?.id;
    if (!targetSessionId) {
      return [];
    }

    const session = this._getLocalSession(targetSessionId);
    if (!session) {
      return [];
    }

    // 转换消息格式
    const sessionMessages: SessionMessage[] = session.messages.map((msg) => ({
      id: msg.id,
      type: msg.role as SessionMessage['type'],
      content:
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })) as unknown as SessionMessage[];

    const artifacts = await this.compactService.performCompact(
      targetSessionId,
      sessionMessages
    );

    // 如果有压缩产物，注入到会话中
    if (artifacts.length > 0) {
      await this.compactService.reinjectArtifacts(targetSessionId, artifacts);
    }

    return artifacts;
  }

  /**
   * 获取压缩服务
   * @returns 压缩服务实例
   */
  getCompactService(): CompactServiceImpl {
    return this.compactService;
  }

  async createCheckpoint(sessionId: string, label?: string): Promise<string> {
    const session = this._getLocalSession(sessionId);
    if (!session) {
      throw new AppError(
        'Session not found',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1004'
      );
    }

    const cp = await this._checkpointService.saveCheckpointWithData(
      sessionId,
      session.messages,
      session.metadata,
      session.state,
      label
    );

    return cp.id;
  }

  async listCheckpoints(
    sessionId: string
  ): Promise<import('./types/checkpoint').SessionCheckpoint[]> {
    return this._checkpointService.listCheckpoints(sessionId);
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<{
    session: ChatSession;
    diff: import('./types/checkpoint').CheckpointDiff;
  }> {
    const checkpoint =
      await this._checkpointService.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new AppError(
        'Checkpoint not found',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    await this._checkpointService.rollbackToCheckpoint(checkpointId, {
      messages: checkpoint.messages || [],
      metadata: checkpoint.metadata || { title: '' },
      state: SessionState.ACTIVE,
    });

    return {
      session:
        this._getLocalSession(checkpoint.sessionId) ||
        this.createSession({ title: 'Rollback Session' }),
      diff: {
        addedMessages: 0,
        removedMessages: checkpoint.messages?.length || 0,
        stateChanged: true,
        metadataChanged: true,
        summary: `Rolled back to checkpoint: ${checkpointId}`,
      },
    };
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    return this._checkpointService.deleteCheckpoint(checkpointId);
  }

  async getLatestCheckpoint(
    sessionId: string
  ): Promise<import('./types/checkpoint').SessionCheckpoint | null> {
    return this._checkpointService.getLatestCheckpoint(sessionId);
  }

  /**
   * Session Memory 累计 + 阈值检测 + 触发提炼
   * 每轮对话后调用，fire-and-forget 不阻塞响应
   */
  private _accumulateSessionMemory(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    tokens: number,
    toolCalls: number
  ): void {
    try {
      const mm = getSessionMemoryManager();
      let memory = mm.loadMemory(sessionId);
      if (memory.items.length === 0) {
        mm.initMemory(sessionId);
      }

      const input = {
        userMessage,
        assistantResponse,
        tokens,
        toolCalls,
      };
      const result = mm.accumulateTurn(memory, input);

      if (result.shouldTrigger) {
        // fire-and-forget: LLM 智能提炼 → memory.md
        const llmClient = this.llmClient;
        const session = this._chatSessions.get(sessionId);
        if (llmClient && session) {
          setImmediate(async () => {
            try {
              // 构建最近对话文本
              const recentMsgs = (session.messages || []).slice(-10);
              const conversationText = recentMsgs
                .map(
                  (m) =>
                    `[${m.role}]: ${typeof m.content === 'string' ? m.content.slice(0, 500) : ''}`
                )
                .join('\n');

              const existingMemory =
                mm.readRawMemory(sessionId) ||
                MEMORY_TEMPLATE.replace(
                  '{{lastExtraction}}',
                  new Date().toISOString()
                );

              // LLM 提炼
              const extractor = new SessionMemoryExtractor({
                sendMessage: (msgs) =>
                  llmClient
                    .sendMessage(msgs as never)
                    .then((r: { content: string }) => r.content),
              });
              const memoryContent = await extractor.extract(
                conversationText,
                existingMemory
              );

              mm.writeRawMemory(sessionId, memoryContent);
              logger.info('Session Memory LLM 提炼完成', { sessionId });
            } catch (err) {
              logger.warn('Session Memory LLM 提炼失败', {
                sessionId,
                error: String(err),
              });
              // 降级：简单追加用户消息摘要
              try {
                mm.appendToMemory(result.memory, [
                  {
                    type: 'discussion' as const,
                    content: userMessage.slice(0, 200),
                  },
                ]);
              } catch {
                // 降级也失败，放弃
              }
            }
          });
        } else {
          // 无 LLM 可用：简单降级
          setImmediate(() => {
            try {
              mm.appendToMemory(result.memory, [
                {
                  type: 'discussion' as const,
                  content: userMessage.slice(0, 200),
                },
              ]);
            } catch {
              /* 忽略 */
            }
          });
        }
      }
    } catch (err) {
      // 记忆系统失败不影响主流程
      logger.debug('Session Memory accumulation skipped', {
        sessionId,
        error: String(err),
      });
    }
  }

  /**
   * 从工具结果中提取 todo 数据
   * 检测 metadata._todoData 并返回结构化 TodoBlockData
   */
  private _extractTodoData(toolResult: ToolResult): TodoBlockData | null {
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
}

/**
 * 创建聊天管理器实例
 * @returns 聊天管理器实例
 */
export function createChatManager(): ChatManager {
  return new ChatManagerImpl();
}

// 向后兼容导出
export type { ChatManager } from './ChatManagerInterface.js';
