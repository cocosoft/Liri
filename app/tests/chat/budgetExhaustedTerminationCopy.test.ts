/**
 * 预算耗尽**收尾文案与事实一致**（2026-10-16，台账 `BUDGET-EXHAUSTED-TERMINATION-COPY`）。
 *
 * **背景（用户实证）**：用户反复看到「⚠️ 已达到本轮 token 预算上限，工具链提前终止。」并追问
 * "不是要求从根源上解决吗？"。取证结论：这句话的**唯一来源**是
 * `ReActToolLoop.resolveTerminationOutput()` 的 `budget_exhausted` 分支（`query/ReActLoop.ts:371-372`
 * 亦记明"唯一来源"），而该相位有**两种语义完全不同**的来源：
 *   · `'loop'`  = **上下文窗口预算**（`createStreamBudget(model)`：`spent ≥ 92% × 窗口` ⇒ EXCEEDED；
 *     由 `createAgentLoop()` 对流式路径**默认注入** ⇒ 生产活路径）—— 与"放行(relief)"无关，
 *     **不可**放行续跑；
 *   · `'daily'` = **日预算**（可挂起，放行后自动续跑；v1.7 起 `BUDGET_SUSPEND_RESUME` 默认开）。
 * 原实现两者**共用同一句**且**不感知是否已挂起** ⇒ 既名不副实（窗口阈值不是"预算"），又与
 * "已实现挂起续跑"的机制自相矛盾、且不给可执行出路。
 *
 * 本文件钉住三态文案 + 无可续跑承诺时不承诺。
 */
import { describe, expect, it } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';

/** 恒 EXCEEDED 的假预算（`needsGraceCall=false` ⇒ 不发放宽限调用，直接判耗尽） */
const ALWAYS_EXHAUSTED = {
  canExecute: () => false,
  needsGraceCall: () => false,
};

function makeLoop(): ReActToolLoop {
  const ctx = {
    session: { id: 'sess-budget-copy', messages: [], metadata: {}, state: {} },
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
      createAssistantMessage: (content: string, options?: { id?: string }) => ({
        id: options?.id ?? 'a-gen',
        content,
        role: 'assistant',
      }),
    },
    addAndPersistMessage: () => {},
    checkpointService: { saveCheckpointWithData: async () => undefined },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
    activeClient: {
      streamMessage: async function* () {
        return { content: 'x', stop_reason: 'stop' };
      },
      sendMessage: async () => ({
        content: '',
        stop_reason: 'stop',
      }),
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
    estimateMessagesTokens: () => 0,
    toolRegistry: { getTool: () => undefined },
    toolDefinitions: [],
    buildToolRoundMessages: (m: Record<string, unknown>[]) => m,
    maxToolTurns: 10,
  } as unknown as ToolLoopContext;

  return new ReActToolLoop(
    ctx,
    {
      apiMessages: [{ role: 'user', content: 'hi' }],
      currentToolCalls: [],
      assistantMessage: null,
      nonStreaming: true,
    } as never,
    { maxIterations: 5, budget: ALWAYS_EXHAUSTED as never }
  );
}

async function drain(loop: ReActToolLoop): Promise<void> {
  for await (const _e of loop.run({
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
  } as never)) {
    /* consume */
  }
}

/** 仅用于定向断言**文案分支**：写入相位与"耗尽事实"（私有字段，经窄断言访问） */
function forceBudgetExhausted(
  loop: ReActToolLoop,
  fact: { kind: 'loop' | 'daily'; suspended: boolean } | undefined
): void {
  const inst = loop as unknown as {
    state: { phase: string };
    _lastBudgetExhausted?: { kind: 'loop' | 'daily'; suspended: boolean };
  };
  inst.state.phase = 'budget_exhausted';
  if (fact) inst._lastBudgetExhausted = fact;
}

describe('预算耗尽收尾文案三态（与事实一致）', () => {
  it('`loop`（上下文窗口预算，真驱动）⇒ 点明"窗口"并给可执行出路，**不再**说"token 预算上限"', async () => {
    const loop = makeLoop();
    await drain(loop);

    expect(loop.getTerminationReason()).toBe('budget_exhausted');
    const text = String(loop.getAssistantMessage().content);
    expect(text).toContain('本轮上下文已接近模型窗口上限');
    expect(text).toContain('发送新消息即可继续');
    // 旧文案（误导：窗口阈值被说成"预算上限"，且不给出路）必须消失
    expect(text).not.toContain('已达到本轮 token 预算上限');
  });

  it('`daily` + 已挂起 ⇒ 告知"进度已保存 + 放行后自动续跑"，**不说"提前终止"**', () => {
    const loop = makeLoop();
    forceBudgetExhausted(loop, { kind: 'daily', suspended: true });

    const text = String(loop.getAssistantMessage().content);
    expect(text).toContain('本轮进度已保存');
    expect(text).toContain('自动从这里续跑');
    expect(text).toContain('日限额');
    // 与"已实现挂起续跑"矛盾的说法必须消失（`loop` 分支的"提前收尾"也不得出现）
    expect(text).not.toContain('工具链提前终止');
    expect(text).not.toContain('工具链提前收尾');
  });

  it('`daily` + **未**挂起（开关关 / 无检查点）⇒ 不得承诺自动续跑，只给"放行后重发"', () => {
    const loop = makeLoop();
    forceBudgetExhausted(loop, { kind: 'daily', suspended: false });

    const text = String(loop.getAssistantMessage().content);
    expect(text).toContain('未能保存续跑点');
    expect(text).toContain('重发本条消息');
    expect(text).not.toContain('自动从这里续跑');
  });

  it('兜底（无耗尽事实）⇒ 保留原句，保证其它入口零回归', () => {
    const loop = makeLoop();
    forceBudgetExhausted(loop, undefined);

    const text = String(loop.getAssistantMessage().content);
    expect(text).toContain('已达到本轮 token 预算上限，工具链提前终止。');
  });
});
