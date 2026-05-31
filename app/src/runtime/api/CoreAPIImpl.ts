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
 * CoreAPI 实现
 * 串联现有的 ChatManager、ToolManager、Coordinator、ConverterEngine 等服务
 * 作为应用唯一对外门面，为所有外部入口提供一致的功能入口
 */

import * as fs from 'fs';
import type { CoreAPI } from './CoreAPI';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  ToolCallSpec,
  ToolResult,
  ToolInfo,
  SessionInfo,
  SessionCreateParams,
  AgentTaskParams,
  AgentProgress,
  AgentResult,
  ConvertFileParams,
} from './CoreAPI';
import type {
  ConversionResult,
  FileInfo,
  ConversionOptions,
} from '@modules/tools/converter/engine/types';
import { getConverterEngine } from '@modules/tools/converter/engine/ConverterEngine';
import { FileTypeDetector } from '@modules/tools/converter/engine/FileTypeDetector';
import type { ChatManager } from '@modules/chat/ChatManager';
import { createChatManager } from '@modules/chat/ChatManager';
import type { SessionManager } from '@modules/chat/types/session';
import type { ToolManager } from '@modules/tools/core/ToolManager';
import { globalToolManager } from '@modules/tools/core/ToolManager';
import type { Coordinator } from '@modules/core/Coordinator';
import { coordinator as defaultCoordinator } from '@modules/core/Coordinator';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { getTitleGenerator } from '@modules/agent/TitleGenerator';

const logger = new Logger({ level: LogLevel.INFO });

let _coreApiInstance: CoreAPIImpl | null = null;

/**
 * 创建 CoreAPIImpl 实例
 * 支持传入可选依赖覆盖，未传入时使用全局默认实例
 */
export function createCoreAPI(
  options?: ConstructorParameters<typeof CoreAPIImpl>[0]
): CoreAPIImpl {
  return new CoreAPIImpl(options);
}

/**
 * 获取全局 CoreAPIImpl 单例
 * 首次调用时自动创建，使用全局默认依赖
 */
export function getCoreAPI(): CoreAPIImpl {
  if (!_coreApiInstance) {
    _coreApiInstance = createCoreAPI();
  }
  return _coreApiInstance;
}

/**
 * CoreAPI 实现类
 * 通过构造函数注入依赖，所有参数均为可选，默认使用全局单例
 */
export class CoreAPIImpl implements CoreAPI {
  private chatManager: ChatManager;
  private sessionManager: SessionManager;
  private toolManager: ToolManager;
  private coordinator: Coordinator;
  private converterEngine: ReturnType<typeof getConverterEngine>;
  private fileTypeDetector: FileTypeDetector;

  constructor(options?: {
    chatManager?: ChatManager;
    sessionManager?: SessionManager;
    toolManager?: ToolManager;
    coordinator?: Coordinator;
    converterEngine?: ReturnType<typeof getConverterEngine>;
    fileTypeDetector?: FileTypeDetector;
  }) {
    this.chatManager = options?.chatManager ?? createChatManager();
    this.sessionManager =
      options?.sessionManager ?? (this.chatManager as any).getSessionManager();
    this.toolManager = options?.toolManager ?? globalToolManager;
    this.coordinator = options?.coordinator ?? defaultCoordinator;
    this.converterEngine = options?.converterEngine ?? getConverterEngine();
    this.fileTypeDetector = options?.fileTypeDetector ?? new FileTypeDetector();
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const message = await this.chatManager.sendMessage(request.content, {
        sessionId: request.sessionId,
        metadata: request.metadata,
        stream: request.stream,
      });

      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((block) => ('value' in block ? block.value : ''))
              .join('');

      return {
        content,
        sessionId: message.sessionId || request.sessionId || '',
        messageId: message.id,
        finishReason: 'stop',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('CoreAPI.chat 失败', { error: message });

      return {
        content: '',
        sessionId: request.sessionId || '',
        messageId: '',
        finishReason: 'error',
      };
    }
  }

  async *chatStream(
    request: ChatRequest
  ): AsyncGenerator<ChatStreamChunk, ChatResponse, unknown> {
    let fullContent = '';
    let finalSessionId = request.sessionId || '';
    let finalMessageId = '';

    yield {
      type: 'status',
      content: 'AI is analyzing your request...',
      sessionId: finalSessionId,
    } as ChatStreamChunk;

    try {
      const pendingEvents: ChatStreamChunk[] = [];

      const generator = this.chatManager.streamMessage(request.content, {
        sessionId: request.sessionId,
        metadata: request.metadata,
        onToolCall: (phase, toolName, toolCallId, detail) => {
          console.log(
            `[CoreAPIImpl] onToolCall triggered: phase=${phase}, tool=${toolName}, id=${toolCallId}, detail=${detail}`
          );
          if (phase === 'start') {
            pendingEvents.push({
              type: 'status',
              content: `🔧 Running tool: ${toolName}`,
              sessionId: finalSessionId,
            } as ChatStreamChunk);
            if (detail && detail.length > 0) {
              pendingEvents.push({
                type: 'status',
                content: `   └─ 参数: ${detail}`,
                sessionId: finalSessionId,
              } as ChatStreamChunk);
            }
          } else {
            if (detail && detail.includes('失败')) {
              pendingEvents.push({
                type: 'status',
                content: `❌ Tool ${toolName} failed`,
                sessionId: finalSessionId,
              } as ChatStreamChunk);
              if (detail.length > 0) {
                pendingEvents.push({
                  type: 'status',
                  content: `   └─ ${detail}`,
                  sessionId: finalSessionId,
                } as ChatStreamChunk);
              }
            } else {
              pendingEvents.push({
                type: 'status',
                content: `✅ Tool ${toolName} completed successfully`,
                sessionId: finalSessionId,
              } as ChatStreamChunk);
              if (detail && detail.length > 0 && !detail.includes('成功:')) {
                pendingEvents.push({
                  type: 'status',
                  content: `   └─ ${detail}`,
                  sessionId: finalSessionId,
                } as ChatStreamChunk);
              }
            }
          }
        },
      });

      let result = await generator.next();
      while (!result.done) {
        const chunk = result.value;

        while (pendingEvents.length > 0) {
          yield pendingEvents.shift()!;
        }

        if (typeof chunk === 'string') {
          fullContent += chunk;

          yield {
            type: 'text',
            content: chunk,
            sessionId: finalSessionId,
          } as ChatStreamChunk;
        } else if (chunk) {
          yield chunk as ChatStreamChunk;
        }

        result = await generator.next();
      }

      while (pendingEvents.length > 0) {
        yield pendingEvents.shift()!;
      }

      const finalMessage = result.value;
      if (finalMessage) {
        finalSessionId = finalMessage.sessionId || finalSessionId;
        finalMessageId = finalMessage.id;

        const finalContent =
          typeof finalMessage.content === 'string'
            ? finalMessage.content
            : finalMessage.content
                .map((block) => ('value' in block ? block.value : ''))
                .join('');

        fullContent = finalContent || fullContent;

        const toolCalls = (finalMessage as any).tool_calls;
        if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
          for (const tc of toolCalls) {
            const fn = tc.function || tc;
            const toolName = fn.name || '';
            const toolArgs =
              typeof fn.arguments === 'string'
                ? JSON.parse(fn.arguments || '{}')
                : fn.arguments || {};

            yield {
              type: 'status',
              content: `📦 Tool result: ${toolName} — ${toolArgs && typeof toolArgs === 'object' ? JSON.stringify(toolArgs).slice(0, 80) : ''}`,
              sessionId: finalSessionId,
            } as ChatStreamChunk;

            yield {
              type: 'tool_call',
              content: '',
              sessionId: finalSessionId,
              toolCall: {
                id: tc.id || `tc_${Date.now()}`,
                name: toolName,
                arguments: toolArgs,
                status: 'completed',
              },
            } as ChatStreamChunk;
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('CoreAPI.chatStream 失败', { error: message });

      yield {
        type: 'error',
        content: message,
        sessionId: finalSessionId,
      } as ChatStreamChunk;
    }

    yield {
      type: 'done',
      content: '',
      sessionId: finalSessionId,
    } as ChatStreamChunk;

    return {
      content: fullContent,
      sessionId: finalSessionId,
      messageId: finalMessageId,
      finishReason: 'stop',
    };
  }

  async executeTool(
    sessionId: string,
    toolCall: ToolCallSpec
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const result = (await this.toolManager.executeTool(
        toolCall.name,
        toolCall.arguments as Record<string, unknown>,
        { sessionId }
      )) as { output?: unknown; success: boolean };

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: result.output ?? null,
        error: null,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      };
    }
  }

  async listTools(): Promise<ToolInfo[]> {
    const registrations = this.toolManager.getTools();

    return registrations.map((reg) => ({
      name: reg.definition.name,
      description: reg.definition.description,
      parameters: reg.definition.parameters
        ? Object.fromEntries(
            reg.definition.parameters.map((p) => [
              p.name,
              {
                type: p.type,
                description: p.description,
                required: p.required,
              },
            ])
          )
        : {},
      enabled: reg.definition.enabled ?? true,
    }));
  }

  async getTool(name: string): Promise<ToolInfo | undefined> {
    const reg = this.toolManager.getTool(name);
    if (!reg) {
      return undefined;
    }

    return {
      name: reg.definition.name,
      description: reg.definition.description,
      parameters: reg.definition.parameters
        ? Object.fromEntries(
            reg.definition.parameters.map((p) => [
              p.name,
              {
                type: p.type,
                description: p.description,
                required: p.required,
              },
            ])
          )
        : {},
      enabled: reg.definition.enabled ?? true,
    };
  }

  async createSession(params?: SessionCreateParams): Promise<SessionInfo> {
    const session = this.chatManager.createSession({
      title: params?.title || 'New Session',
      tags: params?.tags,
      mode: params?.mode,
    });

    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages?.length || 0,
      metadata: session.metadata,
    };
  }

  async getSession(sessionId: string): Promise<SessionInfo | undefined> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages?.length || 0,
      metadata: session.metadata,
    };
  }

  async getSessionMessages(sessionId: string): Promise<
    Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      tool_calls?: Array<Record<string, unknown>>;
    }>
  > {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return [];
    }

    return (session.messages || []).map((msg) => ({
      id: msg.id,
      role: msg.role.toLowerCase(),
      content:
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((b) => b.type === 'text')
                .map((b) => (b as { type: 'text'; text: string }).text)
                .join('')
            : '',
      timestamp:
        msg.createdAt instanceof Date ? msg.createdAt.getTime() : Date.now(),
      tool_calls: msg.tool_calls as Array<Record<string, unknown>> | undefined,
    }));
  }

  async listSessions(): Promise<SessionInfo[]> {
    const sessions = this.sessionManager.getSessions();

    return sessions.map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages?.length || 0,
      metadata: session.metadata,
    }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessionManager.deleteSession(sessionId);
  }

  async switchSession(sessionId: string): Promise<void> {
    this.chatManager.switchSession(sessionId);
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const session = this.chatManager
      .getSessions()
      .find((s) => s.id === sessionId);
    if (session) {
      session.title = title;
    }
  }

  async generateSessionTitle(
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<string | null> {
    try {
      const titleGenerator = getTitleGenerator();
      const title = await titleGenerator.generateTitle(
        userMessage,
        assistantResponse,
        async (messages) => {
          const llmClient = this.chatManager.getLLMClient();
          const response = await llmClient.sendMessage(messages as any, {});
          return response?.content || null;
        }
      );
      return title;
    } catch (error) {
      logger.warning('Failed to generate session title', error);
      return null;
    }
  }

  async getCurrentSession(): Promise<SessionInfo | undefined> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      return undefined;
    }
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages?.length || 0,
      metadata: session.metadata,
    };
  }

  async executeAgentTask(params: AgentTaskParams): Promise<AgentResult> {
    const startTime = Date.now();
    const taskId = this.coordinator.addTask({
      description: params.description,
      prompt: params.prompt,
      subagentType: params.subagentType,
    });

    if (!params.runInBackground) {
      const { results } = await this.coordinator.executeAll();
      const task = results.find((r) => r.id === taskId);

      if (!task) {
        return {
          agentId: taskId,
          content: '',
          state: 'failed',
          summary: {
            durationMs: Date.now() - startTime,
            tokensUsed: 0,
          },
        };
      }

      return {
        agentId: taskId,
        content: task.result || task.error || '',
        state: task.status === 'completed' ? 'completed' : 'failed',
        summary: {
          durationMs:
            (task.endTime || Date.now()) - (task.startTime || startTime),
          tokensUsed: task.usage?.totalTokens || 0,
        },
      };
    }

    return {
      agentId: taskId,
      content: '',
      state: 'running',
      summary: {
        durationMs: 0,
        tokensUsed: 0,
      },
    };
  }

  async getAgentProgress(agentId: string): Promise<AgentProgress | undefined> {
    const task = this.coordinator.getTaskStatus(agentId);
    if (!task) {
      return undefined;
    }

    const progressMap: Record<string, number> = {
      pending: 0,
      running: 50,
      completed: 100,
      failed: 100,
      stopped: 100,
      timed_out: 100,
    };

    return {
      agentId: task.id,
      state: task.status,
      progress: progressMap[task.status] || 0,
      message: task.description || task.error || task.status,
    };
  }

  async convertFile(params: ConvertFileParams): Promise<ConversionResult> {
    const options: ConversionOptions = {
      maxFileSize: params.options?.maxFileSize as number | undefined,
      includeMetadata: params.options?.includeMetadata as boolean | undefined,
      formatSpecific: params.options?.formatSpecific as
        | Record<string, unknown>
        | undefined,
    };

    return this.converterEngine.convertFile(params.filePath, options);
  }

  async detectFileType(filePath: string): Promise<FileInfo> {
    let size = 0;
    try {
      const stat = fs.statSync(filePath);
      size = stat.size;
    } catch {
      size = 0;
    }

    return this.fileTypeDetector.detect(filePath, size);
  }

  /**
   * 获取内部 ChatManager 实例
   * 供 REPL 等入口进行 LLM 客户端配置
   */
  getChatManager(): ChatManager {
    return this.chatManager;
  }

  /**
   * 获取内部 ToolManager 实例
   * 供 REPL 等入口获取工具注册表
   */
  getToolManager(): ToolManager {
    return this.toolManager;
  }
}
