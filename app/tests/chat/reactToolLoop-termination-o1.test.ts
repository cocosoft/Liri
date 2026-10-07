/**
 * 一期 O1-1（2026-09-24「会话暴露问题分析与优化方案」§五）：
 *  - O1-1：`loop_detected` 被 `max_turns` 遮蔽时，必须**并列上报到 metadata**（此前只进文案）；
 *
 * PathGuard 处置粒度（2026-10-07 修复，承接原 O1-2）：
 *  - 原 O1-2 只修正了**文案**（不再谎称"工具调用循环"），但仍**整批丢弃 + 终止本轮**；
 *    用户裁定「如果被拦截，可以跳过」⇒ 改为**按调用粒度跳过**：命中调用回填失败结果、
 *    同批其余调用照常执行、本轮继续（终止原因不再是 `guard_blocked`）。
 *
 * 参照 plan：dev_docs/会话暴露问题分析与优化方案-20260924.md §五 一期
 */

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';

function makeCtx(
  overrides: Partial<ToolLoopContext> & {
    llmSequence?: Array<() => ChatResponse>;
  } = {}
): { ctx: ToolLoopContext } {
  const seq = overrides.llmSequence ?? [
    () => ({ content: 'done', stop_reason: 'stop' }) as ChatResponse,
  ];
  let callNo = 0;
  const ctx = {
    session: { id: 'sess-o1', messages: [], metadata: {}, state: {} },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async () => ({ result: 'ok', error: undefined }),
    pendingInteractions: new Map(),
    loopDetector: {
      detect: () => ({ stuck: false }),
      recordToolCallOutcome: () => {},
      recordTurn: () => {},
    },
    messageService: {
      createToolResultMessage: (result: unknown) => ({
        id: 't',
        content: String(result),
      }),
      createAssistantMessage: (
        content: string,
        options?: { sessionId?: string; id?: string }
      ) => ({ id: options?.id ?? 'a-gen', content, role: 'assistant' }),
    },
    addAndPersistMessage: () => {},
    checkpointService: { saveCheckpointWithData: async () => undefined },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
    activeClient: {
      streamMessage: async function* (
        _m: ChatMessage[],
        _o: Record<string, unknown>
      ): AsyncGenerator<string, ChatResponse> {
        const r = seq[Math.min(callNo++, seq.length - 1)]();
        if (r.content) yield r.content;
        return r;
      },
      sendMessage: async () =>
        seq[Math.min(callNo++, seq.length - 1)]() as ChatResponse,
      getProviderId: () => 'mock',
    },
    unifiedTracker: {
      resetStreamTokens: () => {},
      updateBaselineForRound: () => {},
    },
    recordChatResponseUsage: () => {},
    toolResultRegistry: {
      storeResult: () => {},
      getCurrentRound: () => 0,
      nextRound: () => 1,
    },
    toolRegistry: { getTool: () => undefined },
    toolDefinitions: [],
    buildToolRoundMessages: (m: Record<string, unknown>[]) => m,
    maxToolTurns: 3,
    estimateMessagesTokens: () => 0,
    ...overrides,
  } as unknown as ToolLoopContext;
  return { ctx };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
    ...overrides,
  } as never;
}

async function drain(loop: ReActToolLoop): Promise<void> {
  for await (const _e of loop.run(makeInput())) {
    /* consume */
  }
}

describe('ReActToolLoop 终止语义（一期 O1-1 / PathGuard 处置粒度）', () => {
  it('O1-1：max_turns 与 loop_detected 同时命中 ⇒ 循环信号并列落 metadata（此前只在文案里）', async () => {
    const { ctx } = makeCtx({
      llmSequence: [
        () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc1', name: 'bash', arguments: {} }],
          }) as ChatResponse,
      ],
      loopDetector: {
        detect: () => ({
          stuck: true,
          level: 'critical',
          detector: 'file_io',
          message: '重复读写',
        }),
        recordToolCallOutcome: () => {},
        recordTurn: () => {},
      } as never,
    });
    // maxIterations=1：act 内置 loopDetected 后，下一轮开头即 iteration >= maxIterations
    // ⇒ 判别器走 max_turns（先于 loop_detected），正是 G2 描述的遮蔽形态
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 1 });
    await drain(loop);

    expect(loop.getTerminationReason()).toBe('max_turns');

    const final = loop.getAssistantMessage();
    // 文案侧此前已有并列上报（F2-5）
    expect(String(final.content)).toContain('同时检测到工具调用循环');
    const meta =
      (final as unknown as { metadata?: Record<string, unknown> }).metadata ??
      {};
    // 修复前：metadata 只有 finishReason='max_turns'，循环信号被吞 ⇒ 失败
    expect(meta.finishReason).toBe('max_turns');
    expect(meta.concurrentReasons).toEqual(['loop_detected']);
  });

  it('2026-10-07：PathGuard 拦截 ⇒ 仅跳过该调用（不丢弃整批、不终止本轮）', async () => {
    const executedArgs: string[] = [];
    const { ctx } = makeCtx({
      llmSequence: [
        () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            // `.env` 命中 PathGuard 默认拒绝列表（**/.env）；同批另一调用为普通路径。
            // ⚠️ 必须用**真实注册名 + 真实参数名**（`file_read`/`file_path`）：原用例用漂移名
            // `read_file`/`path`，与 PathGuard 的漂移清单"同频"⇒ 守卫实际已失效却仍绿灯（2026-09-26 修）。
            tool_calls: [
              {
                id: 'tc-blocked',
                name: 'file_read',
                arguments: { file_path: '.env' },
              },
              {
                id: 'tc-ok',
                name: 'file_read',
                arguments: { file_path: 'src/a.ts' },
              },
            ],
          }) as ChatResponse,
        () => ({ content: '（收尾）', stop_reason: 'stop' }) as ChatResponse,
      ],
      executeTool: async (
        call: Parameters<ToolLoopContext['executeTool']>[0]
      ) => {
        executedArgs.push(String(call.arguments.file_path));
        return { toolCallId: call.id, toolName: call.name, result: 'ok' };
      },
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });
    await drain(loop);

    // 修复前：任一命中即 `return { results: [], ... }` + `guard_blocked` 终止本轮
    // ⇒ 整批调用被丢弃、任务死掉（用户裁定「如果被拦截，可以跳过」）。
    // 修复后：仅跳过命中调用、本轮继续 ⇒ 正常收尾。
    expect(loop.getTerminationReason()).toBe('completed');
    // 被拦截调用始终**不执行**（护栏不放宽）；同批其余调用照常执行（不再牵连整批）
    expect(executedArgs).not.toContain('.env');
    expect(executedArgs).toContain('src/a.ts');
    // 旧文案「本轮提前结束」不再出现
    expect(String(loop.getAssistantMessage().content)).not.toContain(
      '本轮提前结束'
    );
  });

  it('⑤ PathGuard 写类判别：真实写工具走 checkWrite（锁文件只在**写**拒绝列表）', async () => {
    const executedArgs: string[] = [];
    const { ctx } = makeCtx({
      llmSequence: [
        () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            // `package-lock.json` 仅存在于 DEFAULT_DENY_WRITE_PATTERNS（**读**列表不含它）
            // ⇒ 只有写类判定正确（走 checkWrite）才会被拦截。
            tool_calls: [
              {
                id: 'tc1',
                name: 'file_write',
                arguments: { file_path: 'package-lock.json' },
              },
            ],
          }) as ChatResponse,
        () => ({ content: '（收尾）', stop_reason: 'stop' }) as ChatResponse,
      ],
      executeTool: async (
        call: Parameters<ToolLoopContext['executeTool']>[0]
      ) => {
        executedArgs.push(String(call.arguments.file_path));
        return { toolCallId: call.id, toolName: call.name, result: 'ok' };
      },
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });
    await drain(loop);

    // 修复前：`file_write` 不在漂移清单里 ⇒ 取不到路径 + 判为非写 ⇒ 守卫放行（会执行）
    // 写类判定正确 ⇒ 该调用被拦下、**未执行**
    expect(executedArgs).toEqual([]);
    expect(loop.getTerminationReason()).toBe('completed');
  });
});
