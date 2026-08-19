// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * StreamPipeline — 流式消息前后处理管线
 *
 * P2（08-09）：从 ChatManager.streamMessage（~740 行）提取可独立的前后处理步骤，
 * 将 streamMessage 精简为管线编排 + LLM 调用 + ToolLoopRunner。
 *
 * 提取步骤（按顺序）：
 *   pre:  图片路径注册 → 系统提示组装 → 上下文压缩 → pre-stream hook
 *   post: 内容修复 → 助手消息创建 → 记忆提取 → post-stream hooks
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { resolveOutputDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { getOTelTracing } from '@modules/monitoring/otel';
import { trackUsage } from '@modules/ai';
import { estimateMessagesTokens } from '../../ai/tokenizer/TokenEstimator';
import { resolveMaxContextTokens } from '../services/ChatHelper';
import {
  ensureThinkResponseTags,
  stripThinkResponseTags,
  stripOrphanToolTags,
} from '../services/MessageContextPipeline';
import { stripBareExploration } from '../services/bareExplorationStripper';
import { repairImageUrls } from '../services/ChatHelper';
import { StreamingToolCallScrubber } from '../../streaming/scrubbers/StreamingToolCallScrubber';
import { getModelPricing } from '../../cost/ModelPricing';
import { calculateTotalCost } from '../../cost/calculateCost';
import { compactionOrchestrator } from '../../context/compaction/CompactionOrchestrator';
import { validatePathsInOutput } from '../services/PathGuardService';
import type { ChatSession } from '../types/session.js';
import type { Message, StreamMessageOptions } from '../types/message.js';
import type {
  ChatResponse,
  ChatMessage,
  ToolDefinition,
  ParsedToolCall,
} from '@modules/ai';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import type { ImageContextService } from '../services/ImageContextService.js';

const logger = getLogger('chat:pipeline');

/* ===================================================================
 *  PipelineContext — 管线共享上下文
 * =================================================================== */

export interface PipelineContext {
  content: string;
  session: ChatSession;
  options?: StreamMessageOptions;
  imageContextService: ImageContextService;
  llmClient: {
    chat(
      messages: ChatMessage[],
      options?: Record<string, unknown>
    ): Promise<ChatResponse>;
    streamMessage(
      messages: ChatMessage[],
      options: Record<string, unknown>
    ): AsyncGenerator<
      string | import('@modules/ai').ThinkingProviderChunk,
      ChatResponse
    >;
    getProviderId(): string;
  };
  activeClient: PipelineContext['llmClient'];
  unifiedTracker: {
    resetStreamTokens(): void;
    recordCompaction(before: number, after: number): void;
  };
  hookChainManager: {
    execute(domain: string, payload: Record<string, unknown>): Promise<void>;
  };
  extractFilePathsFromText: (text: string) => string[];
  addAndPersistMessage: (sessionId: string, message: Message) => void;
  recordChatResponseUsage: (sessionId: string, usage: unknown) => void;
  extractMemoryFromChat: (
    userMsg: string,
    aiMsg: string,
    sessionId: string
  ) => Promise<void>;
  messageService: {
    createAssistantMessage(
      content: string,
      opts: { sessionId: string; id?: string }
    ): Message;
  };

  // 管线中间数据
  apiMessages: Record<string, unknown>[];
  toolDefinitions: ToolDefinition[];
  accumulatedContent: string;
  finalResponse: ChatResponse | null;
  assistantMessage?: Message;
}

/* ===================================================================
 *  StreamPipeline
 * =================================================================== */

export class StreamPipeline {
  ctx: PipelineContext;

  constructor(ctx: PipelineContext) {
    this.ctx = ctx;
  }

  /* ===============================================================
   *  Pre-processing（LLM 调用前）
   * =============================================================== */

  /** 注册图片路径 + 提取文件路径 */
  async registerImages(): Promise<void> {
    const { options } = this.ctx;
    if (!options?.images?.length) {
      // 仅提取文件路径
      this._extractFilePathsFromText();
      return;
    }

    const imagesRoot = join(resolveOutputDir(), 'images');
    const lastUserMsg = [...this.ctx.apiMessages]
      .reverse()
      .find((m: Record<string, unknown>) => m.role === 'user');
    if (lastUserMsg && typeof lastUserMsg.content === 'string') {
      const imagePaths = options.images
        .map((img: { path: string }) => {
          const absolutePath = img.path.startsWith(imagesRoot)
            ? img.path
            : join(imagesRoot, img.path);
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

    const absoluteImagePaths = options.images.map((img: { path: string }) =>
      img.path.startsWith(imagesRoot) ? img.path : join(imagesRoot, img.path)
    );
    this.ctx.imageContextService.registerImagePaths(
      options.sessionId || '',
      absoluteImagePaths
    );

    this._extractFilePathsFromText();
  }

  private _extractFilePathsFromText(): void {
    const { options } = this.ctx;
    const lastUserMsg = [...this.ctx.apiMessages]
      .reverse()
      .find(
        (m: Record<string, unknown>) =>
          m.role === 'user' && typeof m.content === 'string'
      );
    if (lastUserMsg && options?.sessionId) {
      const extractedPaths = this.ctx.extractFilePathsFromText(
        lastUserMsg.content as string
      );
      if (extractedPaths.length > 0) {
        this.ctx.imageContextService.registerImagePaths(
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

  /** 组装系统提示 */
  async assembleSystemPrompt(
    getOrAssembleSystemPrompt: (
      session: ChatSession,
      content: string
    ) => Promise<string>
  ): Promise<void> {
    const { options, session, content } = this.ctx;
    const hasSystemMessage = this.ctx.apiMessages.some(
      (m: Record<string, unknown>) => m.role === 'system'
    );
    if (hasSystemMessage) return;

    const assembled = await getOrAssembleSystemPrompt(session, content);
    const sysPrompt = options?.systemPrompt
      ? `${assembled}\n\n## 用户自定义系统提示\n${options.systemPrompt}`
      : assembled;
    this.ctx.apiMessages.unshift({ role: 'system', content: sysPrompt });
  }

  /** 上下文压缩 */
  async compactContext(): Promise<{
    applied: boolean;
    beforeTokens: number;
    afterTokens: number;
    savedPercent: number;
  }> {
    const otel = getOTelTracing();
    const span = otel.startSpan('chat:pipeline:compactContext', {
      'session.id': this.ctx.session.id,
    });
    const { session, options } = this.ctx;
    const beforeCompact = estimateMessagesTokens(this.ctx.apiMessages);
    // 耗时日志：发送路径压缩入口（skipTier3Sync 模式应毫秒级返回，不含 Tier3）
    const ctxStart = Date.now();
    logger.info('compaction:ctx_start — 发送路径压缩开始', {
      sessionId: session.id,
      model: options?.model || '',
      messageCount: this.ctx.apiMessages.length,
      estimatedTokens: beforeCompact,
      skipTier3Sync: true,
    });

    // 压缩结果（try 内赋值，供完成日志引用）
    let compResult: { messages: ChatMessage[]; applied: boolean } | undefined;

    try {
      compResult = await compactionOrchestrator.compact(
        this.ctx.apiMessages as unknown as ChatMessage[],
        { model: options?.model || '', sessionId: session.id },
        // 异步压缩（2026-08-14 补充落地）：发送路径不阻塞等待 Tier3（LLM 摘要），
        // 仅同步 Tier1/2；Tier3 由发送后 compactSessionInBackground 后台执行写回
        { skipTier3Sync: true }
      );
      if (compResult.applied) {
        span.addEvent('compaction.applied', {
          before: beforeCompact,
          after: estimateMessagesTokens(
            compResult.messages as unknown as ChatMessage[]
          ),
        });
        this.ctx.apiMessages = compResult.messages as unknown as Record<
          string,
          unknown
        >[];
        // C5 修复（压缩链路排查 2026-08-13）：压缩 applied 后仍校验是否 ≤ 窗口——
        // 与 sendMessageFlow 一致。Tier3 内部仅保证 afterTokens < beforeTokens，
        // 压缩后仍超限直接发送会 400 context 超限，追加截断兜底。
        const postAfter = estimateMessagesTokens(this.ctx.apiMessages);
        const postMaxCtx = resolveMaxContextTokens(options?.model);
        if (postMaxCtx > 0 && postAfter > postMaxCtx) {
          logger.warn('compaction:post_check — 压缩后仍超窗口，追加截断', {
            sessionId: session.id,
            afterTokens: postAfter,
            maxCtx: postMaxCtx,
          });
          await this._truncateApiMessages(postMaxCtx, session.id);
        }
      } else {
        span.addEvent('compaction.skipped', {
          reason: 'orchestrator_not_applied',
        });
        logger.info('compaction:skipped — 未压缩，转入截断策略', {
          sessionId: session.id,
          beforeTokens: beforeCompact,
          afterTokens: estimateMessagesTokens(this.ctx.apiMessages),
          reason: 'orchestrator_not_applied',
        });
        const maxCtx = resolveMaxContextTokens(options?.model);
        await this._truncateApiMessages(maxCtx, session.id);
      }
    } catch (compErr) {
      span.addEvent('compaction.failed', {
        error: compErr instanceof Error ? compErr.message : String(compErr),
      });
      logger.warn('compaction:failed — 降级到截断策略', {
        sessionId: session.id,
        error: compErr instanceof Error ? compErr.message : String(compErr),
      });
      const maxCtx = resolveMaxContextTokens(options?.model);
      await this._truncateApiMessages(maxCtx, session.id);
      handleError(compErr, {
        module: 'chat:manager',
        action: 'compaction',
        context: { sessionId: session.id },
      }).catch(() => {});
    } finally {
      try {
        otel.endSpan(span);
      } catch {
        /* span 可能已结束 */
      }
    }

    const afterTokens = estimateMessagesTokens(this.ctx.apiMessages);
    const savedPercent =
      afterTokens > 0 ? Math.round((1 - afterTokens / beforeCompact) * 100) : 0;
    if (savedPercent > 0) {
      logger.info('compaction:completed', {
        sessionId: session.id,
        before: beforeCompact,
        after: afterTokens,
        savedPercent,
      });
      options?.onProgress?.({
        stage: 'generating',
        message: `上下文已压缩: ${beforeCompact} → ${afterTokens} tokens（节省 ${savedPercent}%）`,
      });
      // 1.8 修复：压缩提示不再落盘为系统消息（context_state 仅作流式进度提示，
      // 落盘会污染会话内容与导出文件）；压缩记录由 logger + unifiedTracker 保留。
      this.ctx.unifiedTracker.recordCompaction(beforeCompact, afterTokens);
    }

    // 耗时日志：发送路径压缩完成——elapsedMs 应毫秒级（Tier1/2 同步）；
    // 若接近 60s 说明 skipTier3Sync 未生效（Tier3 仍同步阻塞），据此确认异步化效果
    const ctxElapsed = Date.now() - ctxStart;
    logger.info('compaction:ctx_done — 发送路径压缩完成', {
      sessionId: session.id,
      elapsedMs: ctxElapsed,
      applied: compResult?.applied,
      beforeTokens: beforeCompact,
      afterTokens: estimateMessagesTokens(this.ctx.apiMessages),
      skipTier3Sync: true,
      tier3SyncBlocked: ctxElapsed > 5000,
    });

    // 返回压缩信息（供 streamMessageFlow 发射前端可见的压缩状态块）
    return {
      applied: compResult?.applied ?? false,
      beforeTokens: beforeCompact,
      afterTokens: estimateMessagesTokens(this.ctx.apiMessages),
      savedPercent,
    };
  }

  private async _truncateApiMessages(
    maxTokens: number,
    sessionId: string
  ): Promise<void> {
    let totalTokens = estimateMessagesTokens(this.ctx.apiMessages);
    while (totalTokens > maxTokens && this.ctx.apiMessages.length > 2) {
      // BUG-C 修复：从 index 1 起跳过 role === 'system' 的消息，
      // 避免截断误删系统提示（角色设定/工具定义/压缩摘要）。
      // 仅当头部之后全是 system 时（findIndex 返回 -1）停止截断。
      const idx = this.ctx.apiMessages.findIndex(
        (m, i) => i > 0 && (m as Record<string, unknown>).role !== 'system'
      );
      if (idx === -1) break;
      const [removed] = this.ctx.apiMessages.splice(idx, 1);
      logger.debug('截断消息', {
        sessionId,
        removedRole: (removed as Record<string, unknown>)?.role,
        remainingTokens: estimateMessagesTokens(this.ctx.apiMessages),
      });
      totalTokens = estimateMessagesTokens(this.ctx.apiMessages);
    }
  }

  /** Pre-stream hook */
  async preStreamHook(): Promise<void> {
    await this.ctx.hookChainManager.execute('chat', {
      event: 'chat.pre-stream',
      data: { message: this.ctx.content, sessionId: this.ctx.session.id },
      sessionId: this.ctx.session.id,
    });
  }

  /* ===============================================================
   *  Post-processing（LLM 调用后）
   * =============================================================== */

  /** 修复内容 + 擦洗工具调用标签 */
  repairContent(): string {
    const repaired = ensureThinkResponseTags(
      repairImageUrls(this.ctx.accumulatedContent)
    );
    const stripped = stripThinkResponseTags(repaired);
    // P0 修复：剥离"裸探索段"（模型未走 thinking 通道、直接泄漏进正文的工具过程叙述）
    const explorationStripped = stripBareExploration(stripped);
    const scrubber = new StreamingToolCallScrubber();
    const scrubbed = scrubber.scrub({
      content: explorationStripped,
      isComplete: true,
    });
    const residual = scrubber.flush();
    return stripOrphanToolTags(scrubbed.content + residual);
  }

  /** 记录用量 */
  recordUsage(): void {
    const { finalResponse, options, session } = this.ctx;
    // 成本 0/0 修复（2026-08-14 复检 #5）：finalResponse 缺失或其 usage 为空时跳过
    // 空记录（与 ReActToolLoop._reportUsage 对齐），避免 0/0 tokens 污染成本/LLMTracker
    const usage = finalResponse?.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | undefined;
    if (
      !usage ||
      (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0) === 0
    ) {
      return;
    }
    this.ctx.recordChatResponseUsage(session.id, finalResponse?.usage);

    trackUsage(finalResponse ?? {}, {
      model: options?.model || 'unknown',
      providerId: this.ctx.activeClient.getProviderId(),
      latencyMs: 0,
      isStreaming: true,
      sessionId: session.id,
    }).catch((err) => {
      logger.warn('用量记录失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /** 创建助手消息 */
  createAssistantMessage(
    finalContent: string,
    opts?: { id?: string }
  ): Message {
    const { finalResponse, session } = this.ctx;
    const assistantMessage = this.ctx.messageService.createAssistantMessage(
      finalContent,
      { sessionId: session.id, id: opts?.id }
    );
    // 排查日志：确认自定义 id 是否被 createMessage 采用（params.id || generateMessageId）
    logger.debug('pipeline:createAssistantMessage', {
      sessionId: session.id,
      requestedId: opts?.id,
      finalId: assistantMessage.id,
      idAdopted: opts?.id ? assistantMessage.id === opts.id : false,
    });
    // P1 修复（AB-3）：优先用 finalResponse.finishReason（错误路径为 'error'），
    // 再回退 stop_reason / 'stop'——否则内部流错误（genIteration catch）落盘消息
    // 会被写成 'stop'，前端把失败流误判为成功
    // @modules/ai 的 ChatResponse 无 finishReason 字段（错误路径由 streamMessageFlow 注入）
    assistantMessage.finishReason =
      (finalResponse as { finishReason?: string } | null)?.finishReason ||
      finalResponse?.stop_reason ||
      'stop';

    if (finalResponse?.tool_calls?.length) {
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
    this.ctx.addAndPersistMessage(session.id, assistantMessage);
    this.ctx.assistantMessage = assistantMessage;
    return assistantMessage;
  }

  /** 记忆提取 + 路径校验 + post-stream hooks */
  async postProcess(userContent: string): Promise<void> {
    const otel = getOTelTracing();
    const span = otel.startSpan('chat:pipeline:postProcess', {
      'session.id': this.ctx.session.id,
    });
    const { session, accumulatedContent, imageContextService } = this.ctx;

    try {
      span.addEvent('postProcess.memoryExtraction');
      await this.ctx.extractMemoryFromChat(
        userContent,
        accumulatedContent,
        session.id
      );

      if (accumulatedContent.length > 0) {
        span.addEvent('postProcess.pathValidation');
        await validatePathsInOutput(
          accumulatedContent,
          imageContextService.confirmedPaths
        );
      }

      span.addEvent('postProcess.hooks');
      await this.ctx.hookChainManager.execute('chat', {
        event: 'chat.post-stream',
        data: {
          message: userContent,
          response: this.ctx.finalResponse,
          sessionId: session.id,
        },
        sessionId: session.id,
      });

      await this.ctx.hookChainManager.execute('chat', {
        event: 'chat.post-message',
        data: {
          message: userContent,
          response: this.ctx.finalResponse,
          sessionId: session.id,
        },
        sessionId: session.id,
      });
    } finally {
      try {
        otel.endSpan(span);
      } catch {
        /* span 可能已结束 */
      }
    }
  }

  /** 通知 onUsage 回调 */
  notifyUsage(): void {
    const { options, finalResponse } = this.ctx;
    if (!options?.onUsage || !finalResponse?.usage) return;

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
      estimatedCostUsd: (() => {
        try {
          return calculateTotalCost(
            getModelPricing(options.model ?? ''),
            inputTokens,
            outputTokens,
            u.cache_creation_input_tokens ?? u.cacheCreationInputTokens ?? 0,
            u.cache_read_input_tokens ?? u.cacheReadInputTokens ?? 0
          );
        } catch {
          return 0;
        }
      })(),
    });
  }
}
