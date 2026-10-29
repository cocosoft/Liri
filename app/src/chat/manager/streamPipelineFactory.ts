// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * streamPipelineFactory — `_createStreamPipeline` 的装配外移（issue #17 · D10，2026-10-29）
 *
 * 迁出来源：`ChatManager._createStreamPipeline` 的方法体（原 2232–2271，约 39 行）。
 *
 * 方法体本身即**端口字面量** ⇒ 与 `orchestratorHost` 同一手法：宿主 `asWiringHost` 单点断言，
 * `assertHostSurface` + 键表做装配期 fail-fast（issue #16 契约守卫）。
 */

import type { ChatSession } from '@modules/session/types/session';
import type {
  Message,
  StreamMessageOptions,
} from '@modules/session/types/message';
import type { ToolAwareClient } from '@modules/ai';
import type { UnifiedTokenTracker } from '@modules/tokenBudget';
import type { HookChainManager } from '@modules/hooks';
import type { ImageContextService } from '../services/ImageContextService';
import type { MessageService } from '../services/MessageService.js';
import { StreamPipeline } from '../pipeline/StreamPipeline.js';
import type { PipelineContext } from '../pipeline/StreamPipeline.js';
import {
  asWiringHost,
  assertHostSurface,
  type AssertNever,
} from './wiringHostGuard';

export interface StreamPipelineHost {
  getClientForModel(model?: string): ToolAwareClient;
  imageContextService: ImageContextService;
  llmClient: ToolAwareClient | undefined;
  unifiedTracker: UnifiedTokenTracker;
  hookChainManager: HookChainManager;
  extractFilePathsFromText(text: string): string[];
  _addAndPersistMessage(sessionId: string, message: Message): Promise<void>;
  recordChatResponseUsage(
    sessionId: string,
    usage: Record<string, number> | null | undefined,
    requestId?: number,
    model?: string
  ): void;
  extractMemoryFromChat(
    userContent: string,
    assistantContent: string,
    sessionId: string
  ): Promise<void>;
  messageService: MessageService;
}

const STREAM_PIPELINE_HOST_KEYS = [
  'getClientForModel',
  'imageContextService',
  'unifiedTracker',
  'hookChainManager',
  'extractFilePathsFromText',
  '_addAndPersistMessage',
  'recordChatResponseUsage',
  'extractMemoryFromChat',
  'messageService',
] as const;

/** 构造期尚未赋值的成员（值判空会误报；`llmClient` 由 `setLLMClient` 稍后注入） */
const STREAM_PIPELINE_DEFERRED_KEYS = ['llmClient'] as const;

/** 编译期全量覆盖检查（接口加成员而键表漏登记 ⇒ `tsc` 报错） */
export type StreamPipelineHostKeysExhaustive = AssertNever<
  Exclude<
    keyof StreamPipelineHost,
    | (typeof STREAM_PIPELINE_HOST_KEYS)[number]
    | (typeof STREAM_PIPELINE_DEFERRED_KEYS)[number]
  >
>;

/**
 * 创建 StreamPipeline 实例（把宿主的既有能力逐个注入管线上下文）。
 */
export function createStreamPipelineFor(
  rawHost: object,
  session: ChatSession,
  content: string,
  options?: StreamMessageOptions
): StreamPipeline {
  const host = asWiringHost<StreamPipelineHost>(rawHost);
  assertHostSurface(host, STREAM_PIPELINE_HOST_KEYS, 'createStreamPipelineFor');
  const activeClient = host.getClientForModel(options?.model);
  const ctx: PipelineContext = {
    content,
    session,
    options,
    imageContextService: host.imageContextService,
    llmClient: host.llmClient as PipelineContext['llmClient'],
    activeClient: activeClient as PipelineContext['activeClient'],
    unifiedTracker: host.unifiedTracker as PipelineContext['unifiedTracker'],
    hookChainManager:
      host.hookChainManager as unknown as PipelineContext['hookChainManager'],
    extractFilePathsFromText: (text) => host.extractFilePathsFromText(text),
    addAndPersistMessage: (sid, msg) => host._addAndPersistMessage(sid, msg),
    recordChatResponseUsage: (sid, usage, requestId, model) =>
      host.recordChatResponseUsage(
        sid,
        usage as Record<string, number>,
        requestId,
        model
      ),
    extractMemoryFromChat: (userMsg, aiMsg, sid) =>
      host.extractMemoryFromChat(userMsg, aiMsg, sid),
    messageService: host.messageService as PipelineContext['messageService'],
    apiMessages: [],
    toolDefinitions: [],
    accumulatedContent: '',
    finalResponse: null,
  };
  return new StreamPipeline(ctx);
}
