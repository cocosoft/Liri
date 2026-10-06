/**
 * U4 在线质量评估：事件派生 + 编排单测。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 D4/D5 + §5（用例 3/4/6/7）。
 *
 * 装置：**内存桩端口**（无文件、无网络、无真实 LLM）——
 * 断言"未注入复核器 ⇒ **零 LLM 调用**"是规格 D3 的硬约束，故桩上计数。
 */
import { describe, expect, it } from 'bun:test';
import type { LiriEvent } from '../../src/session/types/events';
import { deriveTurnSignals } from '../../src/evals/online/deriveTurnSignals';
import { runTurnQualityPass } from '../../src/evals/online/turnQualityEvaluator';
import { MAX_REVIEWS_PER_IDLE } from '../../src/evals/online/weights';

const SID = 's1';

/** 构造一条事件（测试用最小合法形状） */
function ev(
  seq: number,
  type: string,
  data: Record<string, unknown>,
  sessionId = SID
): LiriEvent {
  return {
    type,
    seq,
    time: 1_700_000_000_000 + seq,
    sessionId,
    data,
  } as unknown as LiriEvent;
}

/** 一轮完整事件序列（start → n×tool_call → metric → end） */
function turnEvents(
  turn: number,
  fromSeq: number,
  opts: {
    toolCalls?: number;
    finishReason?: string;
    error?: string;
    duration?: number;
    outputTokens?: number;
  } = {}
): { events: LiriEvent[]; nextSeq: number } {
  let seq = fromSeq;
  const events: LiriEvent[] = [ev(seq++, 'turn/start', { turn })];
  for (let i = 0; i < (opts.toolCalls ?? 0); i++) {
    events.push(
      ev(seq++, 'assistant/tool_call', { toolCallId: `c${i}`, name: 'grep' })
    );
  }
  if (opts.duration !== undefined || opts.outputTokens !== undefined) {
    events.push(
      ev(seq++, 'metric/timing', {
        duration: opts.duration ?? 1000,
        outputTokens: opts.outputTokens ?? 100,
      })
    );
  }
  events.push(
    ev(seq++, 'turn/end', {
      turn,
      ...(opts.finishReason ? { finishReason: opts.finishReason } : {}),
      ...(opts.error ? { error: opts.error } : {}),
    })
  );
  return { events, nextSeq: seq };
}

/**
 * 内存桩端口（read 按 seq 升序 + 类型过滤；append 追加并自增 seq）。
 *
 * `reviewTurn` 是**端口**能力（不是 pass 选项）；桩内**统一计数**，
 * 以便断言"未注入 ⇒ 零 LLM 调用"（规格 D3 硬约束）。
 */
function makePorts(
  initial: LiriEvent[] = [],
  hooks: {
    reviewTurn?: (input: { sessionId: string; turnNumber: number }) => Promise<{
      verdict: 'APPROVE' | 'REJECT' | 'ESCALATE';
      confidence: number;
      checkPassRate?: number;
      reason?: string;
    } | null>;
  } = {}
) {
  const log: LiriEvent[] = [...initial];
  let seq = log.reduce((m, e) => Math.max(m, e.seq), 0);
  let reviewCalls = 0;
  const reviewTurn = hooks.reviewTurn;

  return {
    log,
    get reviewCalls() {
      return reviewCalls;
    },
    /** 当前日志最大 seq（测试里续造新轮时用来分配 seq） */
    get maxSeq() {
      return seq;
    },
    /** 端口是否具备复核能力（用于断言"未注入"） */
    get hasReviewTurn() {
      return reviewTurn !== undefined;
    },
    ...(reviewTurn
      ? {
          reviewTurn: async (input: {
            sessionId: string;
            turnNumber: number;
          }) => {
            reviewCalls += 1;
            return reviewTurn(input);
          },
        }
      : {}),
    async readEvents(
      sessionId: string,
      query: {
        fromSeq?: number;
        toSeq?: number;
        types?: string[];
        limit?: number;
      }
    ): Promise<LiriEvent[]> {
      return log
        .filter(
          (e) =>
            e.sessionId === sessionId &&
            (query.fromSeq === undefined || e.seq >= query.fromSeq) &&
            (query.toSeq === undefined || e.seq <= query.toSeq) &&
            (query.types === undefined || query.types.includes(e.type))
        )
        .sort((a, b) => a.seq - b.seq)
        .slice(0, query.limit ?? 1000);
    },
    async appendEvent(
      sessionId: string,
      event: { type: string; data: Record<string, unknown> }
    ): Promise<void> {
      seq += 1;
      log.push(ev(seq, event.type, event.data, sessionId));
    },
  };
}

describe('U4 deriveTurnSignals：从事件派生每轮信号', () => {
  it('一轮完整：计数/求和/endSeq/status=completed', () => {
    const { events } = turnEvents(1, 1, {
      toolCalls: 3,
      duration: 2500,
      outputTokens: 700,
    });
    const derived = deriveTurnSignals(events);
    expect(derived).toHaveLength(1);
    expect(derived[0].turnNumber).toBe(1);
    expect(derived[0].signals.toolCalls).toBe(3);
    expect(derived[0].signals.durationMs).toBe(2500);
    expect(derived[0].signals.outputTokens).toBe(700);
    expect(derived[0].signals.status).toBe('completed');
    // endSeq = turn/end 的 seq
    expect(derived[0].endSeq).toBe(events[events.length - 1].seq);
  });

  it('status 由 finishReason 结构化映射（error / canceled / 其余）', () => {
    const a = deriveTurnSignals(
      turnEvents(1, 1, { finishReason: 'error' }).events
    );
    const b = deriveTurnSignals(
      turnEvents(1, 1, { finishReason: 'canceled' }).events
    );
    const c = deriveTurnSignals(
      turnEvents(1, 1, { finishReason: 'length' }).events
    );
    expect(a[0].signals.status).toBe('error');
    expect(b[0].signals.status).toBe('aborted');
    expect(c[0].signals.status).toBe('completed');
  });

  it('未收轮（只有 turn/start）⇒ 不产出（未终态不评）', () => {
    const derived = deriveTurnSignals([ev(1, 'turn/start', { turn: 1 })]);
    expect(derived).toEqual([]);
  });

  it('无 metric/timing ⇒ durationMs 为 undefined（"没测到"≠"花很久"）', () => {
    const derived = deriveTurnSignals(
      turnEvents(1, 1, { toolCalls: 1 }).events
    );
    expect(derived[0].signals.durationMs).toBeUndefined();
  });

  it('多轮分段：各自独立累计', () => {
    const t1 = turnEvents(1, 1, { toolCalls: 1, outputTokens: 10 });
    const t2 = turnEvents(2, t1.nextSeq, { toolCalls: 5, outputTokens: 20 });
    const derived = deriveTurnSignals([...t1.events, ...t2.events]);
    expect(derived).toHaveLength(2);
    expect(derived[0].signals.toolCalls).toBe(1);
    expect(derived[1].signals.toolCalls).toBe(5);
    expect(derived[1].signals.outputTokens).toBe(20);
  });
});

describe('U4 runTurnQualityPass：落事件与水位', () => {
  it('落 N 条 turn/quality，字段齐全且 reviewed=false（无复核器时）', async () => {
    const t1 = turnEvents(1, 1, { toolCalls: 2, duration: 1000 });
    const t2 = turnEvents(2, t1.nextSeq, { toolCalls: 1, duration: 900 });
    const ports = makePorts([...t1.events, ...t2.events]);

    const r = await runTurnQualityPass(ports, { sessionIds: [SID] });
    expect(r.scored).toBe(2);
    const quality = ports.log.filter((e) => e.type === 'turn/quality');
    expect(quality).toHaveLength(2);
    const first = quality[0].data as Record<string, unknown>;
    expect(typeof first.score).toBe('number');
    expect(typeof first.evaluatorVersion).toBe('string');
    expect(first.reviewed).toBe(false);
    expect(first.components).toBeDefined();
    expect(first.signals).toBeDefined();
  });

  it('水位：第二次 pass 不重评（scored=0）', async () => {
    const t1 = turnEvents(1, 1, { toolCalls: 1 });
    const ports = makePorts(t1.events);
    const r1 = await runTurnQualityPass(ports, { sessionIds: [SID] });
    expect(r1.scored).toBe(1);

    const r2 = await runTurnQualityPass(ports, { sessionIds: [SID] });
    expect(r2.scored).toBe(0);
    expect(ports.log.filter((e) => e.type === 'turn/quality')).toHaveLength(1);
  });

  it('新轮次在下次 pass 补齐（水位只跳过已评）', async () => {
    const t1 = turnEvents(1, 1, { toolCalls: 1 });
    const ports = makePorts(t1.events);
    await runTurnQualityPass(ports, { sessionIds: [SID] });

    // 续造第 2 轮：seq 从**当前日志最大值之后**分配（模拟主链路在评估之后追加，
    // 也顺带覆盖"水位落在轮中 ⇒ 回看窗口保证不漏评"的路径）
    const t2 = turnEvents(2, ports.maxSeq + 1, { toolCalls: 1 });
    for (const e of t2.events) ports.log.push(e);
    const r2 = await runTurnQualityPass(ports, { sessionIds: [SID] });
    expect(r2.scored).toBe(1);
  });
});

describe('U4 runTurnQualityPass：复核（上限 / 未配模型）', () => {
  it('未注入复核器 ⇒ 可疑轮标 reviewSkipped=no-model，且**零 LLM 调用**', async () => {
    const ports = makePorts(
      turnEvents(1, 1, { finishReason: 'error', error: 'boom' }).events
    );
    const r = await runTurnQualityPass(ports, { sessionIds: [SID] });
    const data = ports.log.find((e) => e.type === 'turn/quality')!
      .data as Record<string, unknown>;
    expect(data.reviewed).toBe(false);
    expect(data.reviewSkipped).toBe('no-model');
    expect(r.reviewed).toBe(0);
    expect(r.skippedReviews).toBe(1);
    // 桩上"零 LLM 调用"：复核能力根本未注入 ⇒ 无法调用，计数恒 0
    expect(ports.hasReviewTurn).toBe(false);
    expect(ports.reviewCalls).toBe(0);
  });

  it(`可疑轮超过上限 ⇒ 只复核 ${MAX_REVIEWS_PER_IDLE} 条，其余标 budget`, async () => {
    const total = MAX_REVIEWS_PER_IDLE + 3;
    const events: LiriEvent[] = [];
    let seq = 1;
    for (let i = 0; i < total; i++) {
      const t = turnEvents(i + 1, seq, {
        finishReason: 'error',
        error: `e${i}`,
      });
      events.push(...t.events);
      seq = t.nextSeq;
    }
    // 复核器注入在**端口**上（桩内计数）
    const ports = makePorts(events, {
      reviewTurn: async () => ({ verdict: 'REJECT', confidence: 0.8 }),
    });

    const r = await runTurnQualityPass(ports, { sessionIds: [SID] });

    expect(r.reviewed).toBe(MAX_REVIEWS_PER_IDLE);
    expect(ports.reviewCalls).toBe(MAX_REVIEWS_PER_IDLE);
    const skippedBudget = ports.log
      .filter((e) => e.type === 'turn/quality')
      .map((e) => (e.data as Record<string, unknown>).reviewSkipped)
      .filter((v) => v === 'budget');
    expect(skippedBudget).toHaveLength(total - MAX_REVIEWS_PER_IDLE);
  });

  it('复核返回 null ⇒ 记 no-model（不伪造"已复核"）', async () => {
    const ports = makePorts(
      turnEvents(1, 1, { finishReason: 'error', error: 'x' }).events,
      { reviewTurn: async () => null }
    );
    const r = await runTurnQualityPass(ports, { sessionIds: [SID] });
    const data = ports.log.find((e) => e.type === 'turn/quality')!
      .data as Record<string, unknown>;
    expect(r.reviewed).toBe(0);
    expect(data.reviewed).toBe(false);
    expect(data.reviewSkipped).toBe('no-model');
  });

  it('复核结论写入事件 review 字段', async () => {
    const ports = makePorts(
      turnEvents(1, 1, { finishReason: 'error', error: 'x' }).events,
      {
        reviewTurn: async () => ({
          verdict: 'ESCALATE',
          confidence: 0.4,
          reason: '无法判定',
        }),
      }
    );
    await runTurnQualityPass(ports, { sessionIds: [SID] });
    const data = ports.log.find((e) => e.type === 'turn/quality')!
      .data as Record<string, unknown>;
    expect(data.reviewed).toBe(true);
    expect(data.review).toEqual({
      verdict: 'ESCALATE',
      confidence: 0.4,
      reason: '无法判定',
    });
    expect(data.reviewSkipped).toBeUndefined();
  });
});

describe('U4 runTurnQualityPass：让出与错误隔离', () => {
  it('yieldEvery=1 与缺省结果一致（让出不改语义）', async () => {
    const events: LiriEvent[] = [];
    let seq = 1;
    for (let i = 0; i < 5; i++) {
      const t = turnEvents(i + 1, seq, { toolCalls: i });
      events.push(...t.events);
      seq = t.nextSeq;
    }
    const a = await runTurnQualityPass(makePorts(events), {
      sessionIds: [SID],
    });
    const b = await runTurnQualityPass(makePorts(events), {
      sessionIds: [SID],
      yieldEvery: 1,
    });
    expect(b.scored).toBe(a.scored);
    expect(b.reviewed).toBe(a.reviewed);
  });

  it('单会话失败不中断其它会话（记入 errors，不吞错也不越层抛）', async () => {
    const good = turnEvents(1, 1, { toolCalls: 1 });
    const ports = makePorts(good.events);
    const evil = {
      ...ports,
      readEvents: async (
        sessionId: string,
        q: Parameters<typeof ports.readEvents>[1]
      ) => {
        if (sessionId === 'bad') throw new Error('read failed');
        return ports.readEvents(sessionId, q);
      },
    };

    const r = await runTurnQualityPass(evil, { sessionIds: ['bad', SID] });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].sessionId).toBe('bad');
    // 正常会话仍被处理
    expect(r.scored).toBe(1);
  });
});
