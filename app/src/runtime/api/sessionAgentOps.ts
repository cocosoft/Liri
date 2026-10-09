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
 * SessionAgentOps —— 工具查询 / 会话 CRUD 与查询 / 代理任务 / 文件类型（拆分自 `CoreAPIImpl`）
 *
 * 2026-10-09（文件规模债拆分，见 `.trae/specs/core-api-impl-split.md` S1）：自 `CoreAPIImpl.ts`
 * **纯搬迁**（只搬不改，CS01）—— 行为与注释逐行保留。`CoreAPIImpl` 侧仅留**薄转发**。
 *
 * 依赖经**惰性 getter**注入（对照 `sessionMessagesRead.ts` / `messageMutation.ts` / `sessionTitling.ts`），
 * 避免构造期求值与循环依赖。
 */

import * as fs from 'fs';
import type { Coordinator } from '@modules/core';
import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';
import type { ChatManager } from '@modules/chat';
import type { SessionManager } from '@modules/session/types/session';
import type { DerivationDiff } from '@modules/session';
import type { LiriEvent } from '@modules/session/types/events';
import type {
  getConverterEngine,
  FileTypeDetector,
  ConversionResult,
  FileInfo,
  ConversionOptions,
} from '@modules/tools';
import type {
  ToolInfo,
  ToolCallSpec,
  ToolResult,
  SessionInfo,
  SessionCreateParams,
  AgentTaskParams,
  AgentProgress,
  AgentResult,
  ConvertFileParams,
} from './CoreAPI';
import type { SessionMessagesRead } from './sessionMessagesRead';
import type { MessageMutation } from './messageMutation';
import type { SessionTitling } from './sessionTitling';
import type { ToolManager } from '@modules/tools';

const logger = getLogger('runtime:api:CoreAPIImpl');

function countConversationMessages(
  messages: Array<{ role: string }> | undefined
): number {
  if (!messages) return 0;
  return messages.filter((m) => m.role === 'user' || m.role === 'assistant')
    .length;
}

/** 统计用户消息数 = 对话轮次 */
function countUserMessages(
  messages: Array<{ role: string }> | undefined
): number {
  if (!messages) return 0;
  return messages.filter((m) => m.role === 'user').length;
}

/** 惰性依赖端口（每次调用求值 ⇒ 与宿主注册/创建时序解耦） */
export interface SessionAgentOpsDeps {
  getToolManager(): ToolManager;
  getChatManager(): ChatManager;
  getSessionManager(): SessionManager;
  getSessionMessagesRead(): SessionMessagesRead;
  getMessageMutation(): MessageMutation;
  getSessionTitling(): SessionTitling;
  getCoordinator(): Coordinator;
  getConverterEngine(): ReturnType<typeof getConverterEngine>;
  getFileTypeDetector(): FileTypeDetector;
}

export class SessionAgentOps {
  constructor(private readonly deps: SessionAgentOpsDeps) {}

  async listTools(): Promise<ToolInfo[]> {
    const registrations = this.deps.getToolManager().getTools();

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
    const reg = this.deps.getToolManager().getTool(name);
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

  /**
   * 执行工具（自 `CoreAPIImpl` 纯搬迁，C3-S1）
   */
  async executeTool(
    sessionId: string,
    toolCall: ToolCallSpec
  ): Promise<ToolResult> {
    const startTime = Date.now();
    logger.info('CoreAPIImpl.executeTool() 入口', {
      toolName: toolCall.name,
      sessionId,
      hasArgs: !!toolCall.arguments,
    });

    try {
      const rawResult = await this.deps
        .getToolManager()
        .executeTool(
          toolCall.name,
          toolCall.arguments as Record<string, unknown>,
          { sessionId }
        );
      const result = rawResult as {
        output?: unknown;
        data?: unknown;
        error?: string | null;
        success: boolean;
      };

      const response = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: result.success ?? true,
        data: result.data ?? null,
        result: result.output ?? null,
        error: result.error ?? null,
        executionTime: Date.now() - startTime,
      };
      logger.info('CoreAPIImpl.executeTool() 出口', {
        toolName: toolCall.name,
        success: response.success,
        hasData: !!response.data,
        error: response.error,
        executionTime: response.executionTime,
      });
      return response;
    } catch (error) {
      const errorResponse = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        data: null,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      };
      handleError(error, {
        module: 'runtime:api',
        action: 'executeTool执行异常',
        context: {
          toolName: toolCall.name,
          executionTime: errorResponse.executionTime,
        },
      });
      return errorResponse;
    }
  }

  async createSession(params?: SessionCreateParams): Promise<SessionInfo> {
    const session = await this.deps.getChatManager().createSession({
      title: params?.title || 'New Session',
      tags: params?.tags,
      mode: params?.mode,
      metadata: params?.metadata,
    });

    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: countConversationMessages(session.messages),
      roundCount: countUserMessages(session.messages),
      metadata: session.metadata,
    };
  }

  /**
   * D3（2026-08-24）：事件级 fork——委托 ChatManager → SessionGateway.forkSession
   *
   * 子会话刚创建（messages.jsonl 为空），messageCount/roundCount 置 0；
   * 历史对话以事件前缀保留（[1..boundary]，seq 不变），血缘在 session.metadata。
   */
  async forkSession(
    sourceId: string,
    options: { boundary?: number; childTitle?: string } = {}
  ): Promise<{
    success: boolean;
    session?: SessionInfo;
    boundary?: number;
    copied?: number;
    error?: string;
  }> {
    const result = await this.deps
      .getChatManager()
      .forkSession(sourceId, options);
    if (!result.success || !result.session) {
      return {
        success: result.success,
        boundary: result.boundary,
        copied: result.copied,
        error: result.error,
      };
    }
    const s = result.session;
    return {
      success: true,
      session: {
        id: s.id,
        title: s.title,
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
        messageCount: 0,
        roundCount: 0,
        // UnifiedSession.metadata（SessionMetadata）展开为可序列化对象
        metadata: { ...(s.metadata as Record<string, unknown>) },
      },
      boundary: result.boundary,
      copied: result.copied,
    };
  }

  async getSession(sessionId: string): Promise<SessionInfo | undefined> {
    const session = this.deps.getSessionManager().getSession(sessionId);
    if (!session) {
      return undefined;
    }
    // TB-14（2026-09-24）：同 getCurrentSession——`sessionManager` 的 `chatSessions` 是
    // **进程内存 Map**，对跨进程/跨实例的软删除一无所知，会把幽灵会话当有效返回
    //（实测复验第 6 步：删除后 `GET /v1/sessions/:id` 仍 200）。故返回前校验持久层
    // 是否仍存在（存储层已按磁盘目录回查，见 FileSystemUnifiedStorage.getSession）。
    const persisted = await this.deps
      .getChatManager()
      .getSessionGateway()
      .getSession(sessionId);
    if (!persisted) {
      logger.info('getSession:会话已不存在于持久层,按不存在返回', {
        sessionId,
      });
      return undefined;
    }

    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: countConversationMessages(session.messages),
      roundCount:
        session.metadata.roundCount ?? countUserMessages(session.messages),
      source: this.resolveSessionSource(session),
      metadata: session.metadata,
    };
  }

  async getSessionMessages(
    sessionId: string,
    query?: { limit?: number; before?: number }
  ): Promise<{
    messages: Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      tool_calls?: Array<Record<string, unknown>>;
      blocks?: Array<Record<string, unknown>>;
    }>;
    hasMore: boolean;
  }> {
    return this.deps
      .getSessionMessagesRead()
      .getSessionMessages(sessionId, query);
  }

  async verifySessionDerivation(sessionId: string): Promise<{
    available: boolean;
    diff?: DerivationDiff;
    reason?: string;
  }> {
    return this.deps
      .getSessionMessagesRead()
      .verifySessionDerivation(sessionId);
  }

  async getSessionEvents(
    sessionId: string,
    query?: {
      fromSeq?: number;
      toSeq?: number;
      /**
       * 向前补页（P1-1，2026-09-22）：只取 `seq < beforeSeq` 的事件，返回其中
       * **紧邻该点之前**的一页（至多 `limit` 条）。与 `fromSeq` 互斥优先。
       */
      beforeSeq?: number;
      types?: Array<string>;
      limit?: number;
      recent?: boolean;
    }
  ): Promise<{
    events: Array<LiriEvent>;
    tailSeq: number;
    /** 更早方向是否还有事件（向前补页用；与 `hasMore` 对称） */
    hasEarlier: boolean;
    hasMore: boolean;
  }> {
    return this.deps
      .getSessionMessagesRead()
      .getSessionEvents(sessionId, query);
  }

  async updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>
  ): Promise<void> {
    return this.deps
      .getMessageMutation()
      .updateMessageBlocks(sessionId, messageId, blocks);
  }

  /**
   * 删除单条消息（软删除）
   */
  async deleteMessage(
    sessionId: string,
    messageId: string
  ): Promise<{ success: boolean; messages: Array<Record<string, unknown>> }> {
    return this.deps.getMessageMutation().deleteMessage(sessionId, messageId);
  }

  /**
   * 截断消息（回退到指定消息之前）
   */
  async truncateMessages(
    sessionId: string,
    beforeMessageId: string
  ): Promise<{
    success: boolean;
    messages: Array<Record<string, unknown>>;
    remainingRollbacks: number;
    deletedMessageIds: string[];
    undoResults: Array<{ roundId: number; success: boolean; error?: string }>;
  }> {
    return this.deps
      .getMessageMutation()
      .truncateMessages(sessionId, beforeMessageId);
  }

  /**
   * 从会话对象解析来源渠道标识
   *
   * 优先级：
   * 1. session.metadata.channel（新创建的会话会在 metadata 中存储 channel）
   * 2. 从 session ID 前缀推断（兼容旧会话）
   * 3. 兜底返回 'web'（Web/Tauri 客户端等未显式标注来源的会话）
   */
  private resolveSessionSource(
    session: import('@modules/session/types/session').ChatSession
  ): string {
    // 优先从 metadata.channel 获取
    const channel = session.metadata?.channel as string | undefined;
    if (channel) return channel;

    // 从 session ID 前缀推断（兼容 QQ 等渠道创建的历史会话）
    const id = session.id;
    if (
      typeof id === 'string' &&
      (id.startsWith('c2c:') || id.startsWith('group:'))
    ) {
      return 'qq';
    }

    // 兜底：Web/Tauri 客户端发起的会话统一标记为 web
    return 'web';
  }

  async listSessions(): Promise<SessionInfo[]> {
    const all = this.deps.getSessionManager().getSessions();
    // TB-14（2026-09-24）：同 getSession——列表侧也须过滤"磁盘目录已消失"的幽灵会话
    //（跨进程/跨实例软删除，`chatSessions` 内存 Map 未同步；实测复验第 5 步删除后仍列出）。
    const presence = await Promise.all(
      all.map((s) =>
        this.deps.getChatManager().getSessionGateway().getSession(s.id)
      )
    );
    const sessions = all.filter((_, i) => presence[i] !== null);
    const ghostCount = all.length - sessions.length;
    if (ghostCount > 0) {
      logger.info('listSessions:已过滤磁盘不存在的幽灵会话', {
        ghostCount,
        total: all.length,
      });
    }

    let filteredCount = 0;
    const result = sessions
      // 过滤空壳会话：崩溃残留，有 session.json 但无消息
      .filter((session) => {
        const msgCount = countConversationMessages(session.messages);
        if (msgCount > 0) return true;
        // 有消息的会话一定保留；无消息但有崩溃标记的是空壳，过滤掉
        const crashRecovery = (
          session.metadata as Record<string, unknown> | undefined
        )?.crashRecovery;
        const keep = !crashRecovery;
        if (!keep) filteredCount += 1;
        return keep;
      })
      .map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: countConversationMessages(session.messages),
        roundCount: countUserMessages(session.messages),
        source: this.resolveSessionSource(session),
        metadata: session.metadata,
      }));
    // P2-2：记录空壳会话被过滤条数，便于排查"会话缺失"类问题（总数 vs 返回数对不上）
    if (filteredCount > 0) {
      logger.info('listSessions:过滤空壳会话', {
        total: sessions.length,
        filteredCount,
        returned: result.length,
      });
    }
    return result;
  }

  /**
   * 全文搜索消息（FTS5 倒排索引）
   * 2026-09-18：全局搜索"搜不到历史消息"根因是前端只做会话标题
   * 客户端过滤、从未接入后端消息全文搜索；此方法暴露 FTS 能力。
   */
  async searchMessagesFTS(
    query: string,
    limit?: number,
    allowedSessionIds?: Set<string>
  ): Promise<
    Array<{
      id: string;
      sessionId?: string;
      title: string;
      content: string;
      snippet: string;
      score: number;
      timestamp: number;
    }>
  > {
    const gateway = this.deps.getChatManager().getSessionGateway();
    // N-66：`allowedSessionIds` 由调用方（HTTP handler 按 moduleType 算好）下推，
    // 谓词在 FTS 引擎内生效 ⇒ 见 SessionGateway.searchMessagesFTS 的说明
    const results = await gateway.searchMessagesFTS(
      query,
      undefined,
      limit ?? 10,
      allowedSessionIds
    );
    return results.map((r) => ({
      id: r.document.id,
      sessionId: (r.document.metadata as Record<string, unknown> | undefined)
        ?.sessionId as string | undefined,
      title: r.document.title,
      content: r.document.content,
      snippet: r.snippet,
      score: r.score,
      timestamp: r.document.timestamp,
    }));
  }

  /** 轻量列出会话元数据 — 只读文件头 64KB，不加载完整会话 */
  async listLiteSessions(): Promise<
    Array<{ id: string; title?: string; status?: string; updatedAt?: string }>
  > {
    try {
      const gateway = this.deps.getChatManager().getSessionGateway();
      if (
        gateway &&
        'listLiteSessions' in (gateway as unknown as Record<string, unknown>)
      ) {
        return (
          gateway as unknown as {
            listLiteSessions: () => Promise<
              Array<{
                id: string;
                title?: string;
                status?: string;
                updatedAt?: string;
              }>
            >;
          }
        ).listLiteSessions();
      }
    } catch (_err) {
      // 降级到内存列表
    }
    // 降级：内存列表
    return this.deps
      .getSessionManager()
      .getSessions()
      .map((s) => ({
        id: s.id,
        title: s.title,
        status: s.state,
        updatedAt: s.updatedAt?.toISOString(),
      }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    // 走 ChatManager 完整删除路径（持久化删除会话 + 联动清理检查点）；
    // 原实现走 sessionManager(轻量 adapter) 仅删内存，导致磁盘会话与检查点残留
    await this.deps.getChatManager().deleteSession(sessionId);
    // D-LIFE（2026-09-17）：会话删除 → 释放其执行阶段追踪器（防 per-session Map 永久驻留）
    // B4（2026-10-05）：Map 随 C17 外迁 ⇒ 经模块方法删除。
    this.deps.getSessionTitling().deleteTracker(sessionId);
  }

  async clearAllSessions(moduleType?: string): Promise<void> {
    // moduleType 可选：仅清空指定模块会话（防其他调用方误删项目会话）
    await this.deps.getChatManager().clearAllSessions(moduleType);
    // D-LIFE（2026-09-17）：清空会话 → 同步释放全部执行阶段追踪器
    // B4（2026-10-05）：Map 随 C17 外迁 ⇒ 经模块方法清空。
    this.deps.getSessionTitling().clearTrackers();
  }

  async switchSession(sessionId: string): Promise<void> {
    // 2026-09-25（附带发现 8 根因）：原写法 `this.chatManager.switchSession(sessionId);`
    // **既不 await 也不 catch** ⇒ 两个后果：① 该 promise 的 rejection 无人消费，泄漏为全局
    // `unhandledRejection`（曾产生 37 份崩溃转储）；② **`await coreAPI.switchSession()` 的调用方
    // （如 `session-handlers.ts` 的 HTTP 处理器）立刻拿到 `undefined`**，导致"切到不存在会话"
    // **返回成功而非设计中的 404**，前端 P2-3 的跳转/清空分支从未生效。
    // 必须**传播**该 promise（`return`），让 404 语义与拒绝归属都回到调用方。
    return this.deps.getChatManager().switchSession(sessionId);
  }

  /**
   * P2-5 修复：压缩会话 — 委托 ChatManager 正式 API。
   * 原实现经 coreAPI.sessionGateway 取门面（CoreAPIImpl 无此属性）恒 undefined
   * → 恒 501，前端右键"压缩会话"无任何反应。
   */
  async compactSession(sessionId: string): Promise<unknown> {
    return this.deps.getChatManager().compactSession(sessionId);
  }

  /**
   * 修剪（清理过期/超出保留策略的会话）— 委托 ChatManager 正式 API。
   * 原 handlePruneSession 反射 coreAPI.sessionGateway.pruneNow 恒 501（与 P2-5 同根因）。
   */
  async pruneSessions(): Promise<unknown> {
    const gateway = this.deps.getChatManager().getSessionGateway();
    return gateway.pruneNow();
  }

  /**
   * 重命名会话标题（实现已外迁 `sessionTitling.ts`；`implements CoreAPI` + HTTP/命令/测试消费者）
   */
  async renameSession(
    sessionId: string,
    title: string,
    source: 'user' | 'ai' = 'user'
  ): Promise<void> {
    return this.deps
      .getSessionTitling()
      .renameSession(sessionId, title, source);
  }

  /**
   * E-3（2026-08-23，方案 D2-B）：设置占位标题（实现已外迁 `sessionTitling.ts`；测试消费者）
   */
  async setPreliminaryTitle(sessionId: string, title: string): Promise<void> {
    return this.deps.getSessionTitling().setPreliminaryTitle(sessionId, title);
  }

  /**
   * E-3（2026-08-23，方案 D2-B）：是否需要生成/精化标题
   * （实现已外迁 `sessionTitling.ts`；测试消费者经实例方法调用形态访问宿主）
   */
  shouldAutoTitle(sessionId: string): boolean {
    return this.deps.getSessionTitling().shouldAutoTitle(sessionId);
  }

  /**
   * 更新会话元数据（实现已外迁 `sessionTitling.ts`；`implements CoreAPI` + HTTP 消费者）
   */
  async updateSessionMeta(
    sessionId: string,
    meta: {
      model?: string;
      workspaceId?: string;
      providerId?: string;
      tasksOverride?: Record<string, string>;
      pinned?: boolean;
      /** plan/do 工作模式（见 `.trae/specs/plan-do-mode.md`；输入区开关写入） */
      workMode?: 'plan' | 'do';
    }
  ): Promise<void> {
    return this.deps.getSessionTitling().updateSessionMeta(sessionId, meta);
  }

  /**
   * 生成会话标题（实现已外迁 `sessionTitling.ts`；`implements CoreAPI` + HTTP 消费者）
   */
  async generateSessionTitle(
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<string | null> {
    return this.deps
      .getSessionTitling()
      .generateSessionTitle(sessionId, userMessage, assistantResponse);
  }

  async getCurrentSession(): Promise<SessionInfo | undefined> {
    const session = this.deps.getSessionManager().getCurrentSession();
    if (!session) {
      return undefined;
    }
    // TB-14（2026-09-24）：当前会话指针是**进程内存**字段，删除只在"执行删除的那个进程"内
    // 复位。因此当会话被**另一个进程/实例**（如 CLI 命令）删除后，本进程的指针仍指向它，
    // 直接返回会把"幽灵 id"暴露给前端（前端据"id 不在会话列表中"告警并回退）。
    // 故返回前校验持久层是否仍存在，失效则视为无当前会话——语义与 switchSession 的
    // P2-3（切换不存在的会话抛 404，不静默重建）一致，复用既有 gateway 句柄，不新增依赖。
    const gateway = this.deps.getChatManager().getSessionGateway();
    const persisted = await gateway.getSession(session.id);
    if (!persisted) {
      logger.info(
        'getCurrentSession:当前会话已不存在于持久层,按无当前会话返回',
        {
          sessionId: session.id,
        }
      );
      return undefined;
    }
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: countConversationMessages(session.messages),
      roundCount: countUserMessages(session.messages),
      metadata: session.metadata,
    };
  }

  async executeAgentTask(params: AgentTaskParams): Promise<AgentResult> {
    const startTime = Date.now();
    const taskId = this.deps.getCoordinator().addTask({
      description: params.description,
      prompt: params.prompt,
      subagentType: params.subagentType,
    });

    if (!params.runInBackground) {
      const { results } = await this.deps.getCoordinator().executeAll();
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
    const task = this.deps.getCoordinator().getTaskStatus(agentId);
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

    return this.deps.getConverterEngine().convertFile(params.filePath, options);
  }

  async detectFileType(filePath: string): Promise<FileInfo> {
    let size = 0;
    try {
      const stat = fs.statSync(filePath);
      size = stat.size;
    } catch (_err) {
      size = 0;
    }

    return this.deps.getFileTypeDetector().detect(filePath, size);
  }
}
