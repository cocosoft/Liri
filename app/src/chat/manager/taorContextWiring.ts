// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * taorContextWiring — `_buildTAORContext` 的端口装配外移（issue #17 · D9，2026-10-29）
 *
 * 迁出来源：`ChatManager._buildTAORContext` 的方法体（原 1341–1379，约 38 行）。
 *
 * 该方法的**全部内容就是端口字面量**（12 个转发），因此与 `orchestratorHost` 同一手法：
 * 宿主以 `asWiringHost` 单点断言传入，并由 `assertHostSurface` + 键表做**装配期 fail-fast**
 * （issue #16 契约守卫；私有成员改名 ⇒ 构造期立即抛错，而非运行时 undefined）。
 */

import type { ChatManagerTAORContext } from '@modules/query';
import type { ToolAwareClient, ToolDefinition } from '@modules/ai';
import type { ToolCall, ToolResult } from '@modules/session/types/tool';
import type {
  Message,
  SendMessageOptions,
} from '@modules/session/types/message';
import type { LiriEvent } from '@modules/session/types/events';
import type { ToolRegistry } from '@modules/tools';
import type { PendingInteractionEntry } from '@modules/utils/pendingInteractions';
import type { SessionScopedRegistry } from '@modules/utils/SessionScopedRegistry';
import type { SessionLifecycleManager } from '../services/SessionLifecycleManager.js';
import type { MessageService } from '../services/MessageService.js';
import { buildTAORContext } from './taorContext';
import {
  asWiringHost,
  assertHostSurface,
  type AssertNever,
} from './wiringHostGuard';

export interface TaorContextWiringHost {
  sessionLifecycle: SessionLifecycleManager;
  toolRegistry: ToolRegistry | null;
  _pendingInteractions: SessionScopedRegistry<PendingInteractionEntry>;
  getClientForModel(model?: string): ToolAwareClient;
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
  messageService: MessageService;
  _addAndPersistMessage(sessionId: string, message: Message): Promise<void>;
  appendStreamEvent(
    sessionId: string,
    event: LiriEvent
  ): Promise<{ ok: boolean; reason?: string; tailSeq: number }>;
  getStreamTailSeq(sessionId: string): Promise<number>;
  flushPendingPersists(): Promise<void>;
}

const TAOR_CONTEXT_HOST_KEYS = [
  'sessionLifecycle',
  'toolRegistry',
  '_pendingInteractions',
  'getClientForModel',
  'executeTool',
  'messageService',
  '_addAndPersistMessage',
  'appendStreamEvent',
  'getStreamTailSeq',
  'flushPendingPersists',
] as const;

/** 编译期全量覆盖检查（接口加成员而键表漏登记 ⇒ `tsc` 报错） */
export type TaorContextHostKeysExhaustive = AssertNever<
  Exclude<keyof TaorContextWiringHost, (typeof TAOR_CONTEXT_HOST_KEYS)[number]>
>;

/**
 * 构建 TAORLoopDeps 上下文（宿主断言 + 契约守卫 + 端口转发）。
 */
export function buildTAORContextFor(
  rawHost: object,
  sessionId: string,
  toolDefinitions: ToolDefinition[],
  options?: SendMessageOptions
): ChatManagerTAORContext {
  const host = asWiringHost<TaorContextWiringHost>(rawHost);
  assertHostSurface(host, TAOR_CONTEXT_HOST_KEYS, 'buildTAORContextFor');
  return buildTAORContext(sessionId, toolDefinitions, options, {
    // 2026-10-23（`/effort` 第二步）：会话元数据 → 本轮 thinking（同步只读，含归属校验）
    getSessionMetadata: (id) => host.sessionLifecycle.getSessionMetadata(id),
    getToolInteraction: (name) => {
      const tool = host.toolRegistry?.getTool(name);
      if (!tool) return undefined;
      return {
        requiresUserInteraction: () =>
          typeof (tool as { requiresUserInteraction?: () => boolean })
            .requiresUserInteraction === 'function'
            ? (
                tool as { requiresUserInteraction: () => boolean }
              ).requiresUserInteraction()
            : false,
      };
    },
    pendingInteractions: host._pendingInteractions,
    getClientForModel: (model) => host.getClientForModel(model),
    executeTool: (toolCall, opts) => host.executeTool(toolCall, opts),
    createToolResultMessage: (toolResult, opts) =>
      host.messageService.createToolResultMessage(toolResult, opts),
    createAssistantMessage: (content, opts) =>
      host.messageService.createAssistantMessage(content, opts),
    addAndPersistMessage: (sid, message) => {
      host._addAndPersistMessage(sid, message);
    },
    appendStreamEvent: (sid, event) => host.appendStreamEvent(sid, event),
    getStreamTailSeq: (sid) => host.getStreamTailSeq(sid),
    flushPendingPersists: () => host.flushPendingPersists(),
  });
}
