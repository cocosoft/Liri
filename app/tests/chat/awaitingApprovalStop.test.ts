// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 2026-11-06（审批根因簇 P0-1/P0-2/P0-3）回归锁。
//
// 真机 `session_mw458fpp3ea32a050e` 的三条实证：
//   ① 单回合 33 分钟 / 200 轮 —— 工具返回 `awaiting_approval` 后模型继续跑，
//      15 张审批卡全部在回合内过期；
//   ② 批准后 `resumeStream` 打印「所有工具已完成，无需恢复」—— 等待审批的调用
//      被记成了"已答"，无处重放；
//   ③ `tool/canceled` 补发会把等待审批的调用也标成已答（events 重建路径同样失联）。
//
// 本文件的用例均为「修复前必失败」：
//   - 循环在提交审批后立即收尾（不再调用第二次 LLM）；
//   - 终止原因 = `awaiting_approval`，收尾文案明确告知"批准后自动继续"；
//   - `awaiting_approval` 的 tool/result **不算已答**（events 重建仍能重放）；
//   - 从落盘消息中能捞出待重放的 tool_call id。

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';
import {
  mapTerminationToGoalReason,
  resolveTerminationOutput,
} from '../../src/chat/terminationOutput.js';
import {
  extractAwaitingApprovalToolCallIds,
  extractPendingToolCallsFromEvents,
  planToolReplay,
} from '../../src/chat/utils/pendingToolCalls.js';
import type { LiriEvent } from '@modules/session/types/events';

const AWAITING_PAYLOAD = {
  status: 'awaiting_approval',
  message: '工具 bash 需要审批，已提交审批卡片等待用户批准',
  pendingApproval: true,
  inboxId: 'inbox-1',
};

function makeCtx(): { ctx: ToolLoopContext; llmCalls: () => number } {
  let callCount = 0;
  const nextResponse = (): ChatResponse => {
    callCount++;
    if (callCount === 1) {
      return {
        content: '',
        stop_reason: 'tool_calls',
        tool_calls: [
          {
            id: 'tc-bash',
            name: 'bash',
            arguments: { command: 'bun test' },
          },
        ],
      } as ChatResponse;
    }
    // 若循环没有在审批处收尾，就会走到这里（本用例断言 llmCalls === 1）
    return { content: '不应到达', stop_reason: 'stop' } as ChatResponse;
  };
  const ctx = {
    session: { id: 'sess-awaiting-approval', messages: [] },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async (toolCall: { id: string; name: string }) => ({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: AWAITING_PAYLOAD,
      error: undefined,
    }),
    pendingInteractions: new Map(),
    loopDetector: {
      detect: () => ({ stuck: false }),
      recordToolCallOutcome: () => {},
      recordTurn: () => {},
    },
    messageService: {
      createToolResultMessage: (result: unknown) => ({
        id: 'tool-msg',
        content: String(result),
      }),
      createAssistantMessage: (content: string) => ({
        id: 'assistant-msg',
        content,
        role: 'assistant',
      }),
    },
    addAndPersistMessage: () => {},
    checkpointService: { saveCheckpointWithData: async () => undefined },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
    activeClient: {
      streamMessage: async function* (
        _messages: ChatMessage[],
        _options: Record<string, unknown>
      ): AsyncGenerator<string, ChatResponse> {
        return nextResponse();
      },
      sendMessage: async () => nextResponse(),
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
    maxToolTurns: 8,
    estimateMessagesTokens: () => 0,
  } as unknown as ToolLoopContext;
  return { ctx, llmCalls: () => callCount };
}

function makeInput() {
  return {
    apiMessages: [{ role: 'user', content: '跑测试' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
  } as never;
}

async function drain(loop: ReActToolLoop): Promise<void> {
  for await (const _e of loop.run(makeInput())) {
    /* consume */
  }
}

describe('P0-2：工具提交审批 ⇒ 本回合立即收尾（不再空转）', () => {
  it('只调用一次 LLM，终止原因为 awaiting_approval，收尾文案告知"批准后自动继续"', async () => {
    const { ctx, llmCalls } = makeCtx();
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 8 });
    await drain(loop);

    // 修复前：模型带着"已提交审批"继续下一轮（真机 200 轮），llmCalls 会是 2
    expect(llmCalls()).toBe(1);
    expect(loop.getTerminationReason()).toBe('awaiting_approval');
    const tip = loop.getTerminationTip();
    expect(tip).toContain('等待你的审批');
    expect(tip).toContain('批准后会自动接着执行');
  });

  it('终止输出映射：awaiting_approval 有专属文案，且不落目标原因码（中性暂停）', () => {
    const out = resolveTerminationOutput({
      reason: 'awaiting_approval',
      iteration: 1,
      maxIterations: 8,
      isLongTaskSignal: false,
      droppedToolCallsAtStop: 0,
      maxTotalDurationMs: 3 * 60 * 60 * 1000,
    });
    expect(out.finishReason).toBe('awaiting_approval');
    expect(out.suffix).toContain('等待你的审批');
    expect(mapTerminationToGoalReason('awaiting_approval')).toBeNull();
  });
});

describe('P0-1：awaiting_approval 不算"已答"（否则批准后无物可重放）', () => {
  it('events 重建：awaiting_approval 的 tool/result 不计入 answered，仍在 pending', () => {
    const events = [
      {
        type: 'assistant/tool_call',
        data: {
          toolCallId: 'tc-bash',
          name: 'bash',
          args: { command: 'bun test' },
          messageId: 'm1',
        },
      },
      {
        type: 'tool/result',
        data: {
          toolCallId: 'tc-bash',
          result: JSON.stringify(AWAITING_PAYLOAD),
          isError: false,
        },
      },
    ] as unknown as LiriEvent[];

    const { pending, answered } = extractPendingToolCallsFromEvents(events);
    // 修复前：answered 含 tc-bash ⇒ pending 为空 ⇒ 「所有工具已完成，无需恢复」
    expect(answered.has('tc-bash')).toBe(false);
    expect(pending.map((p) => p.toolCallId)).toEqual(['tc-bash']);
  });

  it('负向对照：普通工具结果仍然算已答（不得因本次改动反复重放）', () => {
    const events = [
      {
        type: 'assistant/tool_call',
        data: { toolCallId: 'tc-ok', name: 'grep', args: {} },
      },
      {
        type: 'tool/result',
        data: { toolCallId: 'tc-ok', result: '{"matches":[]}', isError: false },
      },
    ] as unknown as LiriEvent[];

    const { pending, answered } = extractPendingToolCallsFromEvents(events);
    expect(answered.has('tc-ok')).toBe(true);
    expect(pending).toEqual([]);
  });

  it('从落盘消息中提取待重放的 tool_call id（content 块形态）', () => {
    const ids = extractAwaitingApprovalToolCallIds([
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            value: JSON.stringify(AWAITING_PAYLOAD),
            toolCallId: 'tc-bash',
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            value: JSON.stringify({ matches: [] }),
            toolCallId: 'tc-grep',
          },
        ],
      },
    ]);
    expect([...ids]).toEqual(['tc-bash']);
  });

  it('落盘态（顶层无 toolCallId，id 只在 metadata.toolCallId）同样能捞出', () => {
    // 真机 `session_mwd5mp8jd5fe8bce9c` 的形状：messages.jsonl 的 tool 消息
    // `{ role:'tool', content:[{type:'tool_result', value}], metadata:{ toolCallId } }`
    const ids = extractAwaitingApprovalToolCallIds([
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            value: JSON.stringify(AWAITING_PAYLOAD),
          },
        ],
        metadata: { toolCallId: 'call_00_LpFCNgAmxLeYpYsKZawV9783' },
      },
    ]);
    // 修复前：id 取不到 ⇒ 空集 ⇒ 续跑把未落定调用当普通剩余工具重放（重复审批卡）
    expect([...ids]).toEqual(['call_00_LpFCNgAmxLeYpYsKZawV9783']);
  });
});

// 2026-11-12（真机 `session_mwcyhmmpd44e93b602`）：审批未落定的调用被续跑重放 ⇒
// 同一 toolCallId 写下第二条 `awaiting_approval` tool/result（新 messageId）⇒ 重复审批卡。
// 实证：seq 865/869（call_00_gjfuJh…）、878/882（call_00_fNPaXZ…）同 id 重复。
describe('审批未落定 ⇒ 续跑不重放（否则重复审批卡）', () => {
  const awaitingCalls = [
    { id: 'tc-awaiting', name: 'bash' },
    { id: 'tc-pending', name: 'bash' },
  ];

  it('剩余调用全部仍被未处理审批卡挡住 ⇒ 本次空转（不重放、不写重复结果）', () => {
    const plan = planToolReplay(
      awaitingCalls,
      new Set(['tc-awaiting', 'tc-pending'])
    );
    expect(plan.replay).toEqual([]);
    expect(plan.skippedPendingCount).toBe(2);
  });

  it('审批已落定（不再被卡住）⇒ 照旧重放（批准后必须执行）', () => {
    const plan = planToolReplay(awaitingCalls, new Set());
    expect(plan.replay.map((c) => c.id)).toEqual(['tc-awaiting', 'tc-pending']);
    expect(plan.skippedPendingCount).toBe(0);
  });

  it('混合场景（一半仍待批）⇒ 沿用原口径全量重放，不动重放锚点', () => {
    const plan = planToolReplay(awaitingCalls, new Set(['tc-awaiting']));
    expect(plan.replay.map((c) => c.id)).toEqual(['tc-awaiting', 'tc-pending']);
    expect(plan.skippedPendingCount).toBe(0);
  });

  it('负向对照：无审批等待项时行为零变更（全部重放）', () => {
    const plan = planToolReplay(
      [...awaitingCalls, { id: 'tc-normal', name: 'grep' }],
      new Set()
    );
    expect(plan.replay.map((c) => c.id)).toEqual([
      'tc-awaiting',
      'tc-pending',
      'tc-normal',
    ]);
    expect(plan.skippedPendingCount).toBe(0);
  });
});
