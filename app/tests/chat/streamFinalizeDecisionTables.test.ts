// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2 复杂度外移（`streamFinalize.finalize` 70）**特征化**回归：
 *
 * 锁住两段被原样外移的判定表，避免「外移即改语义」：
 *   ① 裸会话升级判定（`bareSessionEscalation.applyBareSessionEscalation`）—— 轮次闸 / 强产出意图 /
 *      能力直通 / 兜底与预算否决 / demand 会话 / Code Mode 六个否决位的组合结果；
 *   ② 工具活动轮次的 `turn/end` 补写（`_writeTurnEnd`）—— 写入条件与 `finishReason` 取值。
 *
 * 判定表直接来自 [S6/P0-1/BUG-A/N-13/B2] 的历史注释，**不新造规则**。
 */
import { describe, expect, it } from 'bun:test';

import { ChatStreamFinalize } from '../../src/chat/manager/streamFinalize.js';
import type { StreamFinalizeDeps } from '../../src/chat/manager/streamFinalize.js';
import { applyBareSessionEscalation } from '../../src/chat/manager/bareSessionEscalation.js';
import { TRANSIENT_AWAITING_APPROVAL } from '../../src/chat/services/ToolExecutionService.js';
import type { Message } from '@modules/session/types/message.js';
import type { ChatSession } from '@modules/session/types/session.js';

const STRONG_FIRST = '帮我开发超级玛丽第一关';
const EXEC_LAST = '请实现第二关的代码';

const makeSession = (
  userContents: string[],
  metadata: Record<string, unknown> = {},
  id = 'sess-decision-table'
): ChatSession =>
  ({
    id,
    metadata,
    messages: userContents.map((content, i) => ({
      id: `u${i + 1}`,
      role: 'user',
      content,
    })),
  }) as unknown as ChatSession;

const makeAssistant = (content: string): Message =>
  ({
    id: 'a1',
    role: 'assistant',
    content,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Message;

interface Capture {
  escalation?: { assistantContent: string; lastUserContent: string };
  events: Array<{ type: string; data?: Record<string, unknown> }>;
  machineReasons: string[];
}

function makeDeps(
  capture: Capture,
  overrides: Partial<StreamFinalizeDeps> = {}
): StreamFinalizeDeps {
  return {
    addAndPersistMessage: async () => {},
    getStreamMaxTurn: async () => 0,
    getToolRound: () => 0,
    hasTurnEnded: () => false,
    appendStreamEvent: async (_sessionId: string, event: unknown) => {
      capture.events.push(
        event as { type: string; data?: Record<string, unknown> }
      );
      return {};
    },
    endStreamSession: () => {},
    finishSessionMachine: (_id: string, reason: string) => {
      capture.machineReasons.push(`finish:${reason}`);
    },
    pauseSessionMachine: (_id: string, reason: string) => {
      capture.machineReasons.push(`pause:${reason}`);
    },
    syncStateForMessage: () => {},
    sessionAbortControllers: new Map(),
    sessionExecutionIds: new Map(),
    persistTurnSummary: () => {},
    accumulateSessionMemory: () => {},
    recentUserText: () => '',
    shouldUseCodeMode: () => false,
    escalateToPdcaViaBareSession: async (params: {
      assistantContent: string;
      lastUserContent: string;
    }) => {
      capture.escalation = {
        assistantContent: params.assistantContent,
        lastUserContent: params.lastUserContent,
      };
    },
    autoCreateProject: async () => null,
    maybeLaunchPdca: () => {},
    isTelemetryEnabled: () => false,
    summarizeSession: () => {},
    flushPendingPersists: async () => {},
    // P2-4①（2026-11-28）：回合收尾折叠投影（桩：本文件不关心投影落盘）
    foldMessageProjection: async () => {},
    incToolRound: () => {},
    ...overrides,
  } as unknown as StreamFinalizeDeps;
}

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

async function runFinalize(args: {
  session: ChatSession;
  assistant: Message;
  deps: StreamFinalizeDeps;
  terminationReason?: string;
  finalResponse?: unknown;
}): Promise<void> {
  const finalize = new ChatStreamFinalize(args.deps);
  const content =
    typeof args.assistant.content === 'string' ? args.assistant.content : '';
  await finalize.finalize(
    args.session,
    content,
    content,
    args.assistant,
    (args.finalResponse ?? null) as never,
    new AbortController(),
    spanStub,
    undefined,
    args.terminationReason
  );
}

async function decide(args: {
  userContents: string[];
  assistantContent?: string;
  metadata?: Record<string, unknown>;
  shouldUseCodeMode?: (text: string) => boolean;
  recentUserText?: string;
  sessionId?: string;
  terminationReason?: string;
}): Promise<Capture> {
  const capture: Capture = { events: [], machineReasons: [] };
  const session = makeSession(
    args.userContents,
    args.metadata ?? {},
    args.sessionId ?? `sess-${Math.random().toString(36).slice(2)}`
  );
  const assistant = makeAssistant(args.assistantContent ?? '第一关已完成');
  await runFinalize({
    session,
    assistant,
    deps: makeDeps(capture, {
      recentUserText: () => args.recentUserText ?? '',
      ...(args.shouldUseCodeMode
        ? { shouldUseCodeMode: args.shouldUseCodeMode }
        : {}),
    }),
    terminationReason: args.terminationReason,
  });
  return capture;
}

describe('裸会话升级判定（外移自 finalize）', () => {
  it('第 2+ 轮 + 执行意图 ⇒ 升级，描述为用户任务原句', async () => {
    const capture = await decide({
      userContents: [STRONG_FIRST, EXEC_LAST],
      recentUserText: EXEC_LAST,
    });
    expect(capture.escalation).toBeDefined();
    expect(capture.escalation?.lastUserContent).toBe(EXEC_LAST);
    expect(capture.escalation?.assistantContent).toBe('第一关已完成');
  });

  it('首轮 + 强产出意图 ⇒ 放行（轮次闸豁免）', async () => {
    const capture = await decide({
      userContents: [STRONG_FIRST],
      recentUserText: STRONG_FIRST,
    });
    expect(capture.escalation).toBeDefined();
  });

  it('首轮 + 弱意图 ⇒ 不升级（需 2+ 轮）', async () => {
    const capture = await decide({
      userContents: ['请检查一下日志'],
      recentUserText: '请检查一下日志',
    });
    expect(capture.escalation).toBeUndefined();
  });

  it('能力直通（读文件）⇒ 不升级', async () => {
    const capture = await decide({
      userContents: [STRONG_FIRST, '帮我读一下 package.json'],
      recentUserText: '帮我读一下 package.json',
    });
    expect(capture.escalation).toBeUndefined();
  });

  it('Code Mode 命中 ⇒ 不升级', async () => {
    const capture = await decide({
      userContents: [STRONG_FIRST, EXEC_LAST],
      recentUserText: EXEC_LAST,
      shouldUseCodeMode: () => true,
    });
    expect(capture.escalation).toBeUndefined();
  });

  // 2026-11-18 真机 `session_mwkthat73b80a6724f`：等待审批收尾时正文被追加系统提示语
  // （`⏸ 有工具调用正在等待你的审批…`）⇒ 旧闸门因"正文非空"放行，用该提示语当任务描述
  // 建出无关项目 + 阶段链 PDCA。此处锁住结构化否决位。
  it('本轮因等待审批收尾 ⇒ 不升级（即便正文是提示语、轮次闸也满足）', async () => {
    const capture = await decide({
      userContents: [STRONG_FIRST, EXEC_LAST],
      recentUserText: EXEC_LAST,
      assistantContent:
        '\n\n⏸ 有工具调用正在等待你的审批：请在下方审批卡片（或收件箱）中处理后继续；批准后会自动接着执行，无需重发消息。',
      terminationReason: TRANSIENT_AWAITING_APPROVAL,
    });
    expect(capture.escalation).toBeUndefined();
  });

  it('普通收尾（terminationReason 非等待审批）⇒ 仍升级（否决位不扩大）', async () => {
    const capture = await decide({
      userContents: [STRONG_FIRST, EXEC_LAST],
      recentUserText: EXEC_LAST,
      terminationReason: 'completed',
    });
    expect(capture.escalation).toBeDefined();
  });

  it('demand 会话首轮即升级（不看轮次闸）', async () => {
    const capture = await decide({
      userContents: ['做一个记账应用'],
      recentUserText: '做一个记账应用',
      metadata: { autonomy: 'demand' },
    });
    expect(capture.escalation).toBeDefined();
  });

  it('有上下文（projectId）⇒ 本段整体不参与', async () => {
    const escalated: unknown[] = [];
    const handled = await applyBareSessionEscalation({
      session: makeSession([STRONG_FIRST, EXEC_LAST]),
      contextId: 'proj-1',
      assistantMessage: makeAssistant('第一关已完成'),
      lastUserContent: EXEC_LAST,
      userTexts: {
        count: 2,
        firstContent: STRONG_FIRST,
        lastSingleContent: EXEC_LAST,
      },
      emptyOutputFallback: false,
      outputBudgetExhausted: false,
      awaitingApprovalStop: false,
      capabilityDirect: false,
      demandMode: false,
      shouldUseCodeMode: () => false,
      escalate: async (params) => {
        escalated.push(params);
      },
    });
    expect(handled).toBe(false);
    expect(escalated).toHaveLength(0);
  });
});

describe('工具活动轮次的 turn/end 补写（外移自 finalize）', () => {
  it('本轮有工具活动且未写过 end ⇒ 写一条 turn/end（最终响应无 tool_calls ⇒ finishReason=stop）', async () => {
    const capture: Capture = { events: [], machineReasons: [] };
    const assistant = {
      ...makeAssistant('已完成'),
      blocks: [{ type: 'tool_call' }],
    } as unknown as Message;
    await runFinalize({
      session: makeSession([STRONG_FIRST], {}, 'sess-turn-end-1'),
      assistant,
      deps: makeDeps(capture, { getStreamMaxTurn: async () => 3 }),
    });
    const turnEnd = capture.events.find((e) => e.type === 'turn/end');
    expect(turnEnd).toBeDefined();
    expect(turnEnd?.data?.turn).toBe(3);
    // 2026-08-24 修复的正是这一格：工具活动轮次即便最终响应无 tool_calls 也必须闭合 turn
    expect(turnEnd?.data?.finishReason).toBe('stop');
  });

  it('最终响应带 tool_calls ⇒ finishReason=tool_use', async () => {
    const capture: Capture = { events: [], machineReasons: [] };
    await runFinalize({
      session: makeSession([STRONG_FIRST], {}, 'sess-turn-end-5'),
      assistant: makeAssistant('已完成'),
      deps: makeDeps(capture),
      finalResponse: { tool_calls: [{ id: 't1' }] },
    });
    const turnEnd = capture.events.find((e) => e.type === 'turn/end');
    expect(turnEnd?.data?.finishReason).toBe('tool_use');
  });

  it('该 turn 已有 end ⇒ 不重复写（单写者幂等）', async () => {
    const capture: Capture = { events: [], machineReasons: [] };
    const assistant = {
      ...makeAssistant('已完成'),
      blocks: [{ type: 'tool_result' }],
    } as unknown as Message;
    await runFinalize({
      session: makeSession([STRONG_FIRST], {}, 'sess-turn-end-2'),
      assistant,
      deps: makeDeps(capture, { hasTurnEnded: () => true }),
    });
    expect(capture.events.some((e) => e.type === 'turn/end')).toBe(false);
  });

  it('无工具活动 ⇒ 不写 turn/end', async () => {
    const capture: Capture = { events: [], machineReasons: [] };
    await runFinalize({
      session: makeSession([STRONG_FIRST], {}, 'sess-turn-end-3'),
      assistant: makeAssistant('已完成'),
      deps: makeDeps(capture),
    });
    expect(capture.events.some((e) => e.type === 'turn/end')).toBe(false);
  });

  it('等待审批终止 ⇒ 状态机落 requires_action（pause），不落 idle', async () => {
    const capture: Capture = { events: [], machineReasons: [] };
    await runFinalize({
      session: makeSession([STRONG_FIRST], {}, 'sess-turn-end-4'),
      assistant: makeAssistant('请批准'),
      deps: makeDeps(capture),
      terminationReason: TRANSIENT_AWAITING_APPROVAL,
    });
    expect(capture.machineReasons).toContain('pause:等待审批');
    expect(capture.machineReasons.some((r) => r.startsWith('finish:'))).toBe(
      false
    );
  });
});
