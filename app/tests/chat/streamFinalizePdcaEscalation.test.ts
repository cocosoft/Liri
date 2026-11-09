// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * BUG-A（2026-10-27 真机长程任务）**下游**回归：兜底文案不得进入 PDCA 编排。
 *
 * 事故：`resolveTerminationOutput` 在"本轮无可见正文"时产出兜底文案
 * （`⚠️ 本次未能生成回复…`）。`ChatStreamFinalize` 随后把**助手正文**当作编排任务描述
 * 下发给 `escalateToPdcaViaBareSession` / `maybeLaunchPdca` ⇒ 编排器用"本次未能生成回复"
 * 当需求做 PRD，并在工作区建出无关需求目录（实测 89 条无关消息）。
 *
 * 修法：判定走**结构化标记** `metadata.emptyOutputFallback`（禁止文案匹配 —— CS02），
 * 兜底轮改用**用户任务原句**作描述。
 *
 * N-2（2026-11-06 真机长程任务，第二次长程实测）：改成"**兜底轮直接不升级**"。
 * 实证 `session_mw4vwtmp38957bec2f`：兜底后仍升级 ⇒ Planner 用同一模型同一上下文连续两次
 * 空输出 ⇒ `PLAN_PARSE_FAILED`，还顺手建了一个目录都不存在的空项目。连一句回复都产不出的
 * 回合，拉起 4 阶段编排只会把失败放大成三条用户可见错误。
 */
import { describe, expect, it } from 'bun:test';

import { ChatStreamFinalize } from '../../src/chat/manager/streamFinalize.js';
import type { StreamFinalizeDeps } from '../../src/chat/manager/streamFinalize.js';
import { EMPTY_OUTPUT_FALLBACK_TEXT } from '../../src/chat/terminationOutput.js';
import type { Message } from '../../src/session/types/message.js';
import type { ChatSession } from '../../src/session/types/session.js';

const FIRST_USER = '帮我开发超级玛丽第一关';
const LAST_USER = '请实现第二关的代码';
const DONE_TEXT = '第一关已完成，产物在 mario/levels/1.html';

const makeSession = (): ChatSession =>
  ({
    id: 'sess-bug-a',
    metadata: {},
    messages: [
      { id: 'u1', role: 'user', content: FIRST_USER },
      { id: 'u2', role: 'user', content: LAST_USER },
    ],
  }) as unknown as ChatSession;

const makeAssistant = (content: string, flagged: boolean): Message =>
  ({
    id: 'a1',
    role: 'assistant',
    content,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(flagged ? { metadata: { emptyOutputFallback: true } } : {}),
  }) as unknown as Message;

/** N-13：输出预算被推理耗尽的收尾（正文是系统文案，metadata 只有 finishReason） */
const makeBudgetExhaustedAssistant = (content: string): Message =>
  ({
    id: 'a2',
    role: 'assistant',
    content,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: { finishReason: 'output_budget_exhausted' },
  }) as unknown as Message;

/** 采集升级入口收到的参数；其余依赖一律 no-op */
function makeDeps(capture: { payload?: unknown }): StreamFinalizeDeps {
  return {
    addAndPersistMessage: async () => {},
    getStreamMaxTurn: async () => 0,
    getToolRound: () => 0,
    hasTurnEnded: () => true,
    getStreamTailSeq: async () => 0,
    appendStreamEvent: async () => ({}),
    endStreamSession: () => {},
    finishSessionMachine: () => {},
    sessionAbortControllers: new Map(),
    sessionExecutionIds: new Map(),
    persistTurnSummary: () => {},
    accumulateSessionMemory: () => {},
    recentUserText: () => LAST_USER,
    shouldUseCodeMode: () => false,
    escalateToPdcaViaBareSession: async (params: {
      session: ChatSession;
      assistantContent: string;
      lastUserContent: string;
    }) => {
      capture.payload = params;
    },
    autoCreateProject: async () => null,
    maybeLaunchPdca: () => {},
    isTelemetryEnabled: () => false,
    summarizeSession: () => {},
    flushPendingPersists: async () => {},
    incToolRound: () => {},
  } as unknown as StreamFinalizeDeps;
}

/** OTel span 最小桩（finalize 会 `endSpan` ⇒ 至少需要 setStatus/end） */
const spanStub = {
  setStatus: () => {},
  end: () => {},
  setAttribute: () => {},
  setAttributes: () => {},
  addEvent: () => {},
  recordException: () => {},
  updateName: () => {},
  isRecording: () => false,
  spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
} as never;

async function runFinalize(
  assistant: Message,
  capture: { payload?: unknown }
): Promise<void> {
  const finalize = new ChatStreamFinalize(makeDeps(capture));
  const session = makeSession();
  const content =
    typeof assistant.content === 'string' ? assistant.content : '';
  await finalize.finalize(
    session,
    content,
    content,
    assistant,
    null,
    new AbortController(),
    spanStub
  );
}

describe('BUG-A / N-2 下游：兜底轮不得进入 PDCA 编排', () => {
  it('★ 兜底轮（metadata.emptyOutputFallback）⇒ **不升级**（N-2 短路）', async () => {
    const capture: { payload?: unknown } = {};
    await runFinalize(makeAssistant(EMPTY_OUTPUT_FALLBACK_TEXT, true), capture);

    // 修复前：会带着"用户原句"升级 ⇒ 编排器用同一模型再空输出一次 ⇒ PLAN_PARSE_FAILED
    expect(capture.payload).toBeUndefined();
  });

  it('负向对照：正常正文轮 ⇒ 照常升级，且用模型产出作描述', async () => {
    const capture: { payload?: unknown } = {};
    await runFinalize(makeAssistant(DONE_TEXT, false), capture);

    const payload = capture.payload as
      | { assistantContent?: string; lastUserContent?: string }
      | undefined;
    expect(payload).toBeDefined();
    expect(payload?.assistantContent).toBe(DONE_TEXT);
    expect(payload?.lastUserContent).toBe(LAST_USER);
  });

  // N-13（2026-11-06）：预算被推理耗尽同样"没有任何模型产出" ⇒ 与兜底轮同口径，不得升级编排。
  it('★ N-13：output_budget_exhausted 收尾 ⇒ 不升级', async () => {
    const capture: { payload?: unknown } = {};
    await runFinalize(
      makeBudgetExhaustedAssistant('⚠️ 本轮输出预算被推理耗尽…'),
      capture
    );
    expect(capture.payload).toBeUndefined();
  });
});

/**
 * B2（2026-11-09）：demand（许愿式）会话的同轮升级。
 *
 * 与交互会话的差异只有"是否值得拉起编排"这一处：许愿式首条消息通常不含「帮我/请」
 * 等强动词 ⇒ 走 `isDemandGoalIntent` 排除法；纯寒暄/致谢仍不得触发。
 */
describe('B2：demand 会话 —— 首条目标消息即升级编排', () => {
  /** 单条用户消息的会话（demand / 交互对照只差 metadata） */
  const makeSingleMessageSession = (
    text: string,
    metadata: Record<string, unknown> = {}
  ): ChatSession =>
    ({
      id: 'sess-demand-b2',
      metadata,
      messages: [{ id: 'u1', role: 'user', content: text }],
    }) as unknown as ChatSession;

  async function runFinalizeWith(
    session: ChatSession,
    assistant: Message,
    capture: { payload?: unknown }
  ): Promise<void> {
    const finalize = new ChatStreamFinalize(makeDeps(capture));
    const content =
      typeof assistant.content === 'string' ? assistant.content : '';
    await finalize.finalize(
      session,
      content,
      content,
      assistant,
      null,
      new AbortController(),
      spanStub
    );
  }

  it('★ demand + "做一个贪吃蛇小游戏"（无强动词、单轮）⇒ 升级', async () => {
    const capture: { payload?: unknown } = {};
    await runFinalizeWith(
      makeSingleMessageSession('做一个贪吃蛇小游戏', { autonomy: 'demand' }),
      makeAssistant('好的，我先规划…', false),
      capture
    );

    // 升级描述取 deps.recentUserText（测试桩固定为 LAST_USER）；这里只验证"确实升级了"
    const payload = capture.payload as
      | { assistantContent?: string }
      | undefined;
    expect(payload).toBeDefined();
    expect(payload?.assistantContent).toBe('好的，我先规划…');
  });

  it('负向对照：交互会话同一句话（单轮、无强动词）⇒ 不升级（现状不变）', async () => {
    const capture: { payload?: unknown } = {};
    await runFinalizeWith(
      makeSingleMessageSession('做一个贪吃蛇小游戏'),
      makeAssistant('好的，我先规划…', false),
      capture
    );
    expect(capture.payload).toBeUndefined();
  });

  it('demand + 纯致谢 ⇒ 仍不升级（排除法不是无条件放行）', async () => {
    const capture: { payload?: unknown } = {};
    await runFinalizeWith(
      makeSingleMessageSession('谢谢！', { autonomy: 'demand' }),
      makeAssistant('不客气', false),
      capture
    );
    expect(capture.payload).toBeUndefined();
  });
});
