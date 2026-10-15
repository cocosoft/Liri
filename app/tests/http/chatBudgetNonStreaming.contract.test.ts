// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T8（Spec `daily-budget-over-limit-ux.md` §1.2 G-2 / §5-D-1 B）：
// **非流式 `chat()` 补日预算闸门**。此前硬闸门只挂**流式**路径（`preSendContextProtection`）
// ⇒ 非流式入口（HTTP 非流式 / 通道 / A2A / 工作流）可绕过日预算、把额度跑穿（G-2）。
//
// 断言口径（决策规则层；接线由既有 handler + `test:guarded` 回归兜底 —— 与 T3 同法）：
//  ① 闸门本身：`invokeLlm` 在**发起模型调用之前**判定，拒绝即抛 `DAILY_BUDGET_EXCEEDED`
//     且不发起模型调用、不留请求边界事件；
//  ② 码保真：`buildChatErrorResponse`（llmChatOps）把 `AppError` 的 code/context 带回响应；
//  ③ 反应形态：`mapChatErrorResponse`（chat-handlers）按码映射 —— 限额 ⇒ 429 结构化可操作体，
//     其余 ⇒ 既有 500（不回归）。
//  ④ ①②③ 串起来的**端到端形态**（用例「端到端形态」）。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import { invokeLlm } from '../../src/chat/orchestrator/sendMessageFlow';
import type { SendMessageContext } from '../../src/chat/orchestrator/sendMessageFlow';
import { buildChatErrorResponse } from '../../src/runtime/api/llmChatOps';
import { mapChatErrorResponse } from '../../src/infrastructure/http/handlers/chat-handlers';
import type { ToolAwareClient } from '@modules/ai';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const LIMIT = 10;
const SESSION_ID = 'sess-t8';

/** 最小非流式上下文（只覆盖 `invokeLlm` 实际触达的字段） */
function makeCtx(
  appendStreamEvent: (
    sid: string,
    ev: unknown
  ) => Promise<{ ok: boolean; tailSeq: number }>,
  /** 记账号桩：默认为 no-op（不结算）；需要验证"预扣→结算"的用例按真实契约注入 settleFor */
  recordChatResponseUsage: (sid: string, usage: unknown) => void = () => {}
): SendMessageContext {
  return {
    host: {
      ENABLE_TELEMETRY: false,
      toolRoundCount: 0,
      appendStreamEvent,
      recordChatResponseUsage,
    },
    content: 'hi',
    options: {},
    session: { id: SESSION_ID },
    sessionId: SESSION_ID,
    apiMessages: [{ role: 'user', content: 'hi' }],
    toolDefinitions: [],
  } as unknown as SendMessageContext;
}

/** 事件记录器：捕获 host 侧落盘调用（不触真实存储） */
function makeAppender(): {
  appendStreamEvent: (
    sid: string,
    ev: unknown
  ) => Promise<{ ok: boolean; tailSeq: number }>;
  events: unknown[];
} {
  const events: unknown[] = [];
  return {
    events,
    appendStreamEvent: async (_sid, ev) => {
      events.push(ev);
      return { ok: true, tailSeq: events.length };
    },
  };
}

function makeClient(): {
  client: ToolAwareClient;
  sendMessage: () => number;
} {
  let calls = 0;
  const client = {
    sendMessage: async () => {
      calls += 1;
      return { content: 'ok' };
    },
    getProviderId: () => 'provider-test',
  } as unknown as ToolAwareClient;
  return { client, sendMessage: () => calls };
}

describe('T8：非流式 chat 补日预算闸门（G-2/B）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
    getDailyBudget().setLimitUsd(LIMIT);
  });
  afterEach(() => {
    resetDailyBudgetForTest();
  });

  it('额度耗尽 ⇒ 抛 DAILY_BUDGET_EXCEEDED，且**不发起模型调用**、不留请求边界事件', async () => {
    const budget = getDailyBudget();
    budget.recordUsdUsage(LIMIT); // 已达金额上限 ⇒ locked（2026-10-15：档位只由 USD 产出）
    expect(budget.getMode().mode).toBe('locked');

    const { appendStreamEvent, events } = makeAppender();
    const ctx = makeCtx(appendStreamEvent);
    const { client, sendMessage } = makeClient();

    let thrown: unknown;
    try {
      await invokeLlm(ctx, client);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('DAILY_BUDGET_EXCEEDED');
    expect((thrown as AppError).context?.dailyLimit).toBe(LIMIT);
    expect((thrown as AppError).context?.todayUsed).toBe(LIMIT);
    // 闸门必须早于 `startRequest`（否则会留下 `request/start` 边界事件）
    expect(events.length).toBe(0);
    expect(sendMessage()).toBe(0);
  });

  it('未超限 ⇒ 放行且**既有非流式行为不回归**（照发模型请求 + 照落 request/start）', async () => {
    const { appendStreamEvent, events } = makeAppender();
    const ctx = makeCtx(appendStreamEvent);
    const { client, sendMessage } = makeClient();

    const { response } = await invokeLlm(ctx, client);

    expect(response.content).toBe('ok');
    expect(sendMessage()).toBe(1);
    expect(events.length).toBe(1);
    expect((events[0] as { type?: string }).type).toBe('request/start');
  });
});

describe('T14：非流式路径的**原子预扣**（不泄漏版）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
  });
  afterEach(() => {
    resetDailyBudgetForTest();
  });

  it('放行 ⇒ 模型调用**当场可见在途预留**；有 usage ⇒ 结算为真实用量、无残留', async () => {
    const { appendStreamEvent } = makeAppender();
    let projectedAtCall = -1;
    // 记账号按**真实契约**注入：`recordChatResponseUsage` → `settleFor(session, 真实用量)`
    const ctx = makeCtx(appendStreamEvent, (sid) =>
      getDailyBudget().settleFor(sid, 50)
    );
    const client = {
      sendMessage: async () => {
        projectedAtCall = getDailyBudget().getMode().projectedUsed;
        return {
          content: 'ok',
          usage: { prompt_tokens: 30, completion_tokens: 20 },
        };
      },
      getProviderId: () => 'provider-test',
    } as unknown as ToolAwareClient;

    await invokeLlm(ctx, client);

    const state = getDailyBudget().getMode();
    expect(projectedAtCall).toBeGreaterThan(0); // 预扣已生效（在途可见 ⇒ 并发请求会被计入）
    expect(state.todayUsed).toBe(50); // 真实用量入账
    expect(state.projectedUsed).toBe(state.todayUsed); // 在途已清（无残留）
  });

  it('无 usage 回显 ⇒ **显式释放**预扣（在途不得残留、也不得虚增用量）', async () => {
    const { appendStreamEvent } = makeAppender();
    const ctx = makeCtx(appendStreamEvent);
    const client = {
      sendMessage: async () => ({ content: 'ok' }), // 无 usage
      getProviderId: () => 'provider-test',
    } as unknown as ToolAwareClient;

    await invokeLlm(ctx, client);

    const state = getDailyBudget().getMode();
    expect(state.todayUsed).toBe(0);
    expect(state.projectedUsed).toBe(0); // 出口②：预留被释放
  });

  it('模型调用抛错 ⇒ 释放预扣后原样上抛（不留悬挂在途）', async () => {
    const { appendStreamEvent } = makeAppender();
    const ctx = makeCtx(appendStreamEvent);
    const client = {
      sendMessage: async () => {
        throw new Error('provider boom');
      },
      getProviderId: () => 'provider-test',
    } as unknown as ToolAwareClient;

    let thrown: unknown;
    try {
      await invokeLlm(ctx, client);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as Error).message).toBe('provider boom');
    const state = getDailyBudget().getMode();
    expect(state.todayUsed).toBe(0);
    expect(state.projectedUsed).toBe(0); // 出口③：预留被释放
  });
});

describe('T8：非流式错误码保真（buildChatErrorResponse）', () => {
  it('AppError ⇒ 透出真实业务码 + 上下文（供上层按码分流）', () => {
    const res = buildChatErrorResponse({
      error: new AppError(
        '今日 Token 预算已用完',
        ErrorCategory.RESOURCE,
        ErrorSeverity.MEDIUM,
        'DAILY_BUDGET_EXCEEDED',
        { sessionId: SESSION_ID, todayUsed: 901_200, dailyLimit: 500_000 }
      ),
      sessionId: SESSION_ID,
    });

    expect(res.finishReason).toBe('error');
    expect(res.sessionId).toBe(SESSION_ID);
    expect(res.errorCode).toBe('DAILY_BUDGET_EXCEEDED');
    expect(res.errorContext).toEqual({
      sessionId: SESSION_ID,
      todayUsed: 901_200,
      dailyLimit: 500_000,
    });
  });

  it('普通错误 ⇒ 无业务码 / 无上下文（不被误分流）', () => {
    const res = buildChatErrorResponse({
      error: new Error('boom'),
      sessionId: SESSION_ID,
    });

    expect(res.finishReason).toBe('error');
    expect(res.errorCode).toBeUndefined();
    expect(res.errorContext).toBeUndefined();
  });

  it('AppError 无上下文 ⇒ 不伪造 errorContext', () => {
    const res = buildChatErrorResponse({
      error: new AppError(
        'x',
        ErrorCategory.EXECUTION,
        ErrorSeverity.LOW,
        'SOME_CODE'
      ),
      sessionId: SESSION_ID,
    });

    expect(res.errorCode).toBe('SOME_CODE');
    expect(res.errorContext).toBeUndefined();
  });
});

describe('T8：非流式错误响应映射（mapChatErrorResponse）', () => {
  it('撞限 ⇒ 429 + 真实码 + 上下文 + 放行三件套入口（**不再只回 500**）', () => {
    const mapped = mapChatErrorResponse({
      errorCode: 'DAILY_BUDGET_EXCEEDED',
      errorContext: { todayUsed: 901_200, dailyLimit: 500_000 },
    });

    expect(mapped.status).toBe(429);
    expect(mapped.status).not.toBe(500);
    expect(mapped.body.error.type).toBe('budget_exceeded');
    expect(mapped.body.error.code).toBe('DAILY_BUDGET_EXCEEDED');
    expect(mapped.body.error.context).toEqual({
      todayUsed: 901_200,
      dailyLimit: 500_000,
    });
    expect(mapped.body.error.relief?.method).toBe('POST');
    expect(mapped.body.error.relief?.path).toBe('/v1/cost/daily-budget/relief');
    expect(mapped.body.error.relief?.kinds).toEqual([
      'boost',
      'waive-once',
      'unlock-today',
    ]);
  });

  it('无码 / 非限额码 ⇒ 仍是既有 500 通用体（**不回归**，且不误给放行入口）', () => {
    const noCode = mapChatErrorResponse({});
    expect(noCode.status).toBe(500);
    expect(noCode.body.error.type).toBe('server_error');
    expect(noCode.body.error.relief).toBeUndefined();

    const otherCode = mapChatErrorResponse({ errorCode: 'CONTEXT_OVERFLOW' });
    expect(otherCode.status).toBe(500);
    expect(otherCode.body.error.type).toBe('server_error');
    expect(otherCode.body.error.code).toBe('CONTEXT_OVERFLOW');
    expect(otherCode.body.error.relief).toBeUndefined();
  });

  it('端到端形态：闸门异常 ⇒ 结构化可操作 JSON（含放行入口 + DAILY_BUDGET_EXCEEDED）', () => {
    const gateError = new AppError(
      '今日 Token 预算已用完（已用 901200 / 上限 500000），为避免超额，本次未调用模型。',
      ErrorCategory.RESOURCE,
      ErrorSeverity.MEDIUM,
      'DAILY_BUDGET_EXCEEDED',
      {
        sessionId: SESSION_ID,
        todayUsed: 901_200,
        dailyLimit: 500_000,
        estimateThisRound: 1_200,
      }
    );

    // ① 闸门抛错 → ② CoreAPI 保真 → ③ HTTP 映射
    const coreResponse = buildChatErrorResponse({
      error: gateError,
      sessionId: SESSION_ID,
    });
    const mapped = mapChatErrorResponse(coreResponse);

    expect(mapped.status).toBe(429);
    expect(mapped.body.error.code).toBe('DAILY_BUDGET_EXCEEDED');
    expect(mapped.body.error.relief?.path).toBe('/v1/cost/daily-budget/relief');
    expect(mapped.body.error.context).toEqual({
      sessionId: SESSION_ID,
      todayUsed: 901_200,
      dailyLimit: 500_000,
      estimateThisRound: 1_200,
    });
  });
});
