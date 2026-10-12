/**
 * P2-1j —— S3「工具轮上下文装配」契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §5-P2-1j；实现见
 * `src/chat/orchestrator/streamMessageToolLoopContext.ts`。
 *
 * 锁定「装配面」（防止未来重构时**静默接错线**）：
 * 1. `executeTool` 把 `ParsedToolCall` 规范化为 `{id,name,arguments,sessionId}` 后转发；
 * 2. 本轮状态（`abortSignal`/`activeClient`/`toolDefinitions`/`toolCallSeqMap`/`session`）
 *    **同引用透传**；`toolRegistry`/`maxToolTurns` 取自 host；
 * 3. `streamingCheckpoint` **在装配处适配为端口**（`toStreamingCheckpointPort`，含必填 `suspend`）
 *    ⇒ 不再同引用，但两个端口方法必须**转发到同一实例**（转发等价判据）；
 * 4. `onToolUsage` 经 `toUsageInfo` 映射后才回调 `options.onUsage`（全 0 用量 ⇒ 不回调）；
 * 5. `appendStreamEvent` 原样转发 `(sid, ev)`。
 */
import { describe, expect, it } from 'bun:test';

import { buildToolLoopContext } from '../../../src/chat/orchestrator/streamMessageToolLoopContext.js';
import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import type { StreamingAutoCheckpoint } from '../../../src/chat/services/StreamingAutoCheckpoint.js';
import type { ToolLoopContext } from '../../../src/chat/ToolLoopRunner.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { ToolDefinition } from '@modules/ai';

/** 装配结果按字段松散访问（不依赖 `ToolLoopContext` 的完整形状） */
type LooseCtx = {
  session: unknown;
  abortSignal: unknown;
  activeClient: unknown;
  streamingCheckpoint: unknown;
  toolDefinitions: unknown;
  toolCallSeqMap: unknown;
  toolRegistry: unknown;
  maxToolTurns: unknown;
  executeTool: (
    tc: { id: string; name: string; arguments: unknown },
    opts?: unknown
  ) => unknown;
  onToolUsage: (usage: Record<string, unknown>) => void;
  appendStreamEvent: (sid: string, ev: unknown) => unknown;
};

function fakeHost() {
  const calls = {
    executeTool: [] as Array<{ tool: unknown; opts: unknown }>,
    appendStreamEvent: [] as Array<{ sid: string; ev: unknown }>,
    addAndPersist: [] as Array<{ sid: string; msg: unknown }>,
  };
  const toolRegistry = { tag: 'registry' };
  const host = {
    MAX_TOOL_TURNS: 7,
    pendingInteractions: { tag: 'pi' },
    messageService: { tag: 'ms' },
    checkpointService: { tag: 'cs' },
    unifiedTracker: { tag: 'ut' },
    loopDetector: { tag: 'ld' },
    getToolRegistry: () => toolRegistry,
    executeTool: (tool: unknown, opts: unknown) => {
      calls.executeTool.push({ tool, opts });
      return Promise.resolve('ok');
    },
    addAndPersistMessage: (sid: string, msg: unknown) => {
      calls.addAndPersist.push({ sid, msg });
      return Promise.resolve();
    },
    buildToolRoundMessages: () => [],
    recordChatResponseUsage: () => {},
    appendStreamEvent: (sid: string, ev: unknown) => {
      calls.appendStreamEvent.push({ sid, ev });
      return Promise.resolve({ ok: true });
    },
    getStreamTailSeq: () => 1,
    bufferStreamTextChunk: () => Promise.resolve(),
    flushStreamEventBuffer: () => Promise.resolve(),
  } as unknown as ChatOrchestratorHost;
  return { host, calls, toolRegistry };
}

function build() {
  const { host, calls, toolRegistry } = fakeHost();
  const session = { id: 's1' } as unknown as ChatSession;
  const abortSignal = new AbortController().signal;
  const activeClient = {
    tag: 'client',
  } as unknown as ToolLoopContext['activeClient'];
  // 检查点以**裸实例**形状传入；装配处适配为端口 ⇒ 用调用轨迹证明「转发到同一实例」
  const cpCalls: string[] = [];
  const streamingCheckpoint = {
    onToolCompleted: async () => {
      cpCalls.push('onToolCompleted');
    },
    suspend: async (reason: string) => {
      cpCalls.push(`suspend:${reason}`);
    },
  } as unknown as StreamingAutoCheckpoint;
  const toolDefinitions: ToolDefinition[] = [
    { type: 'function', function: { name: 'bash' } } as ToolDefinition,
  ];
  const toolCallSeqMap = new Map<string, number>([['c0', 3]]);
  const onUsageArgs: unknown[] = [];
  const ctx = buildToolLoopContext({
    host,
    session,
    options: { onUsage: (u: unknown) => onUsageArgs.push(u) } as never,
    abortSignal,
    streamingCheckpoint,
    activeClient,
    toolDefinitions,
    toolCallSeqMap,
    toolResultRegistry: {
      tag: 'registry-of-results',
    } as unknown as ToolLoopContext['toolResultRegistry'],
  }) as unknown as LooseCtx;
  return {
    ctx,
    host,
    calls,
    toolRegistry,
    session,
    abortSignal,
    activeClient,
    streamingCheckpoint,
    cpCalls,
    toolDefinitions,
    toolCallSeqMap,
    onUsageArgs,
  };
}

describe('P2-1j S3 工具轮上下文装配', () => {
  it('`executeTool` 规范化为 `{id,name,arguments,sessionId}` 并转发 opts', async () => {
    const b = build();
    await b.ctx.executeTool(
      { id: 'c1', name: 'bash', arguments: { cmd: 'ls' } },
      { useErrorHandler: true }
    );
    expect(b.calls.executeTool).toEqual([
      {
        tool: {
          id: 'c1',
          name: 'bash',
          arguments: { cmd: 'ls' },
          sessionId: 's1',
        },
        opts: { useErrorHandler: true },
      },
    ]);
  });

  it('本轮状态**同引用**透传；检查点经装配处适配为端口（转发同一实例）；`toolRegistry`/`maxToolTurns` 取自 host', async () => {
    const b = build();
    expect(b.ctx.session).toBe(b.session);
    expect(b.ctx.abortSignal).toBe(b.abortSignal);
    expect(b.ctx.activeClient).toBe(b.activeClient);
    expect(b.ctx.toolDefinitions).toBe(b.toolDefinitions);
    expect(b.ctx.toolCallSeqMap).toBe(b.toolCallSeqMap);
    expect(b.ctx.toolRegistry).toBe(b.toolRegistry);
    expect(b.ctx.maxToolTurns).toBe(7);
    // 检查点：装配处适配为端口（含必填 `suspend`）⇒ 断言不再是同引用，而是**转发等价**
    const port = b.ctx.streamingCheckpoint as {
      onToolCompleted: (d: Record<string, unknown>) => Promise<void>;
      suspend: (reason: string) => Promise<void>;
    };
    await port.onToolCompleted({});
    await port.suspend('budget');
    expect(b.cpCalls).toEqual(['onToolCompleted', 'suspend:budget']);
  });

  it('`onToolUsage`：经 `toUsageInfo` 映射后才回调；全 0 用量 ⇒ **不**回调', () => {
    const b = build();
    b.ctx.onToolUsage({ prompt_tokens: 10, completion_tokens: 5 });
    expect(b.onUsageArgs).toHaveLength(1);
    expect(b.onUsageArgs[0]).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
    });

    b.ctx.onToolUsage({ prompt_tokens: 0, completion_tokens: 0 });
    expect(b.onUsageArgs).toHaveLength(1); // 未新增
  });

  it('`appendStreamEvent` 原样转发 `(sid, ev)`', async () => {
    const b = build();
    const ev = { type: 'assistant/status' };
    await b.ctx.appendStreamEvent('s1', ev);
    expect(b.calls.appendStreamEvent).toEqual([{ sid: 's1', ev }]);
  });
});
