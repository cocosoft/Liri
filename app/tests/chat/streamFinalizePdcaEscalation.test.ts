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
 * 本用例直接驱动 finalize 的裸会话升级分支，断言传给升级入口的 `assistantContent`。
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

describe('BUG-A 下游：兜底文案不得作为 PDCA 任务描述', () => {
  it('兜底轮（metadata.emptyOutputFallback）⇒ 用**用户任务原句**作描述', async () => {
    const capture: { payload?: unknown } = {};
    await runFinalize(makeAssistant(EMPTY_OUTPUT_FALLBACK_TEXT, true), capture);

    const payload = capture.payload as
      | { assistantContent?: string; lastUserContent?: string }
      | undefined;
    expect(payload).toBeDefined();
    // 关键：绝不能是系统兜底文案
    expect(payload?.assistantContent).not.toBe(EMPTY_OUTPUT_FALLBACK_TEXT);
    expect(payload?.assistantContent).toBe(LAST_USER);
    expect(payload?.lastUserContent).toBe(LAST_USER);
  });

  it('负向对照：正常正文轮 ⇒ 原样使用模型产出（不得被替换为用户原句）', async () => {
    const capture: { payload?: unknown } = {};
    await runFinalize(makeAssistant(DONE_TEXT, false), capture);

    const payload = capture.payload as
      | { assistantContent?: string }
      | undefined;
    expect(payload).toBeDefined();
    expect(payload?.assistantContent).toBe(DONE_TEXT);
  });
});
