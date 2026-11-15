/**
 * 学习反馈闭环（2026-11-15，M1 + M2）
 *
 * 钉住四件事：
 * ① **归因只看结构化字段**（5 类；证据随行）；
 * ② **候选台账幂等**（同会话同轮同类 ⇒ 同 id；重复扫描不新增）；
 * ③ **M1 不提供 approve** —— 由 M2 的 `verify → approve` 链路取代：
 *    未校验不能批准、批准只写语料**种子**（`expectation: null`）、撤销只标记不删行；
 * ④ **轮次 ↔ 用户输入的结构化配对**（`turn/start` 与 `user/message`，不做文案猜测）。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';

import type { LiriEvent } from '@modules/session/types/events';
import {
  attributeBadcase,
  buildLearningCandidates,
  collectTurnToolObservations,
  collectTurnUserInputs,
  computeCategoryDecisions,
  computeLearningCandidateId,
  computeLearningCandidateStats,
  LEARNING_CANDIDATE_APPROVED,
  LEARNING_CANDIDATE_PENDING,
  LEARNING_CANDIDATE_REJECTED,
  LEARNING_CANDIDATE_VERIFIED,
  LEARNING_EXPIRED_NOTE,
  LearningCandidateStore,
  suggestCategoryCutoffs,
  type TurnQualityPayload,
} from '@modules/tasks';
import { createLearnCommand } from '../../../src/commands/builtin/learn/Learn';

/** 质量载荷（默认：低分 + 无工具失败） */
function quality(over: Partial<TurnQualityPayload> = {}): TurnQualityPayload {
  return {
    turnNumber: 1,
    score: 0.3,
    evaluatorVersion: 'v1',
    components: { completion: 1, verdict: 0.5, toolThrash: 1, cost: 1 },
    signals: {
      status: 'completed',
      toolCalls: 2,
      inputTokens: 10,
      outputTokens: 10,
    },
    reviewed: false,
    ...over,
  };
}

function ev(
  type: string,
  seq: number,
  data: Record<string, unknown>
): LiriEvent {
  return {
    type,
    seq,
    time: seq,
    sessionId: 's1',
    data,
  } as unknown as LiriEvent;
}

describe('attributeBadcase（S2 归因，纯函数）', () => {
  it('复核 REJECT ⇒ verifier_reject，证据含 verdict', () => {
    const r = attributeBadcase({
      quality: quality({
        reviewed: true,
        review: { verdict: 'REJECT', confidence: 0.9 },
      }),
    });
    expect(r.category).toBe('verifier_reject');
    expect(r.evidence.some((e) => e.includes('verdict=REJECT'))).toBe(true);
  });

  it('有工具失败 ⇒ tool_failure，证据点名工具与错误码', () => {
    const r = attributeBadcase({
      quality: quality(),
      tools: [
        { name: 'Read', ok: true },
        { name: 'Bash', ok: false, errorCode: 'EACCES' },
      ],
    });
    expect(r.category).toBe('tool_failure');
    expect(r.evidence.some((e) => e.includes('Bash:EACCES'))).toBe(true);
  });

  it('aborted + 复核因预算跳过 ⇒ budget_exhausted', () => {
    const r = attributeBadcase({
      quality: quality({
        signals: {
          status: 'aborted',
          toolCalls: 3,
          inputTokens: 10,
          outputTokens: 10,
        },
        reviewSkipped: 'budget',
      }),
    });
    expect(r.category).toBe('budget_exhausted');
    expect(r.evidence.some((e) => e.includes('budget-skipped'))).toBe(true);
  });

  it('工具反复度低且调用多 ⇒ retry_loop', () => {
    const r = attributeBadcase({
      quality: quality({
        components: { completion: 1, verdict: 0.5, toolThrash: 0.2, cost: 1 },
        signals: {
          status: 'completed',
          toolCalls: 9,
          inputTokens: 10,
          outputTokens: 10,
        },
      }),
    });
    expect(r.category).toBe('retry_loop');
  });

  it('无结构化命中 ⇒ low_value_answer，分数越低置信度越高', () => {
    const low = attributeBadcase({ quality: quality({ score: 0.1 }) });
    const high = attributeBadcase({ quality: quality({ score: 0.4 }) });
    expect(low.category).toBe('low_value_answer');
    expect(high.category).toBe('low_value_answer');
    expect(low.confidence).toBeGreaterThan(high.confidence);
  });
});

describe('collectTurnToolObservations（事件配对）', () => {
  it('按 callSeq 配对 tool_call/tool/result，并按最近的 turn/start 归属轮次', () => {
    const events = [
      ev('turn/start', 1, { turn: 1 }),
      ev('assistant/tool_call', 2, {
        toolCallId: 'c1',
        name: 'Read',
        args: {},
        callSeq: 3,
      }),
      ev('tool/result', 3, { callSeq: 3, toolCallId: 'c1', result: 'ok' }),
      ev('assistant/tool_call', 4, {
        toolCallId: 'c2',
        name: 'Bash',
        args: {},
        callSeq: 5,
      }),
      ev('tool/result', 5, {
        callSeq: 5,
        toolCallId: 'c2',
        result: 'denied',
        isError: true,
      }),
      ev('turn/start', 6, { turn: 2 }),
      ev('assistant/tool_call', 7, {
        toolCallId: 'c3',
        name: 'Glob',
        args: {},
        callSeq: 9,
      }),
      ev('tool/result', 8, { callSeq: 9, toolCallId: 'c3', result: '[]' }),
    ];
    const byTurn = collectTurnToolObservations(events);
    expect(byTurn.get(1)).toEqual([
      { name: 'Read', ok: true },
      { name: 'Bash', ok: false },
    ]);
    expect(byTurn.get(2)).toEqual([{ name: 'Glob', ok: true }]);
  });

  it('未配对的 tool_call 不计（不猜成败）', () => {
    const byTurn = collectTurnToolObservations([
      ev('turn/start', 1, { turn: 1 }),
      ev('assistant/tool_call', 2, {
        toolCallId: 'c1',
        name: 'Read',
        args: {},
        callSeq: 3,
      }),
    ]);
    expect(byTurn.size).toBe(0);
  });
});

describe('collectTurnUserInputs（轮次 ↔ 用户输入的结构化配对）', () => {
  it('取 turn/start 之前最近一条 user/message（无 userMessageSeq 时）', () => {
    const events = [
      ev('user/message', 1, { content: '第一个问题' }),
      ev('turn/start', 2, { turn: 1 }),
      ev('turn/quality', 3, quality({ turnNumber: 1, score: 0.2 })),
      ev('user/message', 4, { content: '第二个问题' }),
      ev('turn/start', 5, { turn: 2 }),
    ];
    const inputs = collectTurnUserInputs(events);
    expect(inputs.get(1)).toBe('第一个问题');
    expect(inputs.get(2)).toBe('第二个问题');
  });

  it('有 userMessageSeq 时按 seq 精确取（不取最近一条）', () => {
    const events = [
      ev('user/message', 1, { content: 'A' }),
      ev('user/message', 2, { content: 'B' }),
      ev('turn/start', 3, { turn: 1, userMessageSeq: 1 }),
    ];
    expect(collectTurnUserInputs(events).get(1)).toBe('A');
  });

  it('没有用户消息 ⇒ 不登记（不伪造空串）', () => {
    const events = [ev('turn/start', 1, { turn: 1 })];
    expect(collectTurnUserInputs(events).size).toBe(0);
  });
});

describe('LearningCandidateStore（S3 台账）', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function store(): LearningCandidateStore {
    dir = mkdtempSync(join(tmpdir(), 'learn-cand-'));
    return new LearningCandidateStore(dir);
  }

  const content = (id = 'abc123') => ({
    id,
    sessionId: 's1',
    turnNumber: 3,
    category: 'tool_failure' as const,
    score: 0.3,
    evidence: ['score=0.30', 'tools_failed=Bash:EACCES'],
    summary: '第 3 轮 tool_failure（score 0.30）：tools_failed=Bash:EACCES',
  });

  it('save 幂等：同 id 只创建一次，已决状态不被改写', () => {
    const s = store();
    expect(s.save(content(), 1)).toBe('created');
    expect(s.save(content(), 2)).toBe('existing');

    const first = s.list()[0];
    expect(first.status).toBe(LEARNING_CANDIDATE_PENDING);
    const rejected = s.reject(first, '误报');
    expect(rejected.status).toBe(LEARNING_CANDIDATE_REJECTED);

    // 再次 save 同一 id ⇒ existing，且不把已拒绝改回待决
    expect(s.save(content(), 3)).toBe('existing');
    expect(s.list()[0].status).toBe(LEARNING_CANDIDATE_REJECTED);
  });

  it('统计：空台账 ⇒ rejectedShare 为 null（不伪造 0%）', () => {
    const s = store();
    expect(computeLearningCandidateStats(s.list()).rejectedShare).toBeNull();
  });

  it('统计：2 条候选拒绝 1 条 ⇒ rejectedShare = 0.5', () => {
    const s = store();
    s.save(content('id1'), 1);
    s.save({ ...content('id2'), turnNumber: 4 }, 2);
    s.reject(s.list().find((c) => c.id === 'id1')!, '误报');
    const stats = computeLearningCandidateStats(s.list());
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.rejectedShare).toBeCloseTo(0.5, 5);
  });

  /** 可校验的候选（id 必须能由公式复算，否则结构化校验会拒绝） */
  function verifiableContent(sessionId = 's1', turnNumber = 3) {
    return {
      ...content(
        computeLearningCandidateId(sessionId, turnNumber, 'tool_failure')
      ),
      sessionId,
      turnNumber,
      input: '为什么我的命令被拒绝了？',
    };
  }

  it('统计：四态分别计数（verified / rejected 各 1）', () => {
    const s = store();
    s.save(verifiableContent('s1', 3), 1);
    s.save(verifiableContent('s2', 4), 2);
    const first = s.list().find((c) => c.sessionId === 's1')!;
    const second = s.list().find((c) => c.sessionId === 's2')!;
    s.markVerified(first, 10);
    s.reject(second, '误报');
    const stats = computeLearningCandidateStats(s.list());
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(0);
    expect(stats.verified).toBe(1);
    expect(stats.approved).toBe(0);
    expect(stats.rejected).toBe(1);
  });

  it('verify → approve → revoke 全链：种子一行、expectation 为 null、撤销只标记不删行', () => {
    const s = store();
    s.save(verifiableContent(), 1);

    const verified = s.markVerified(s.list()[0], 100);
    expect(verified?.status).toBe(LEARNING_CANDIDATE_VERIFIED);
    expect(verified?.gate).toEqual({ checkedAt: 100, kind: 'structural' });

    const approved = s.approve(verified!, 200);
    expect(approved?.status).toBe(LEARNING_CANDIDATE_APPROVED);
    expect(approved?.expiresAt).toBeGreaterThan(200);

    const seeds = s.listApprovedCases();
    expect(seeds).toHaveLength(1);
    expect(seeds[0].expectation).toBeNull();
    expect(seeds[0].input).toBe('为什么我的命令被拒绝了？');
    expect(seeds[0].expiresAt).toBe(approved?.expiresAt);
    expect(seeds[0].revokedAt).toBeUndefined();
    // 一行一条（JSONL 追加，不覆盖）
    const lines = readFileSync(s.getApprovedCasesPath(), 'utf-8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(1);

    const revoked = s.revoke(approved!, '误批', 300);
    expect(revoked.status).toBe(LEARNING_CANDIDATE_REJECTED);
    expect(revoked.note).toContain('已撤销');
    const afterRevoke = s.listApprovedCases();
    expect(afterRevoke).toHaveLength(1);
    expect(afterRevoke[0].revokedAt).toBe(300);
  });

  it('未校验不能批准：pending ⇒ approve 返回 null 且不写种子', () => {
    const s = store();
    s.save(verifiableContent(), 1);
    expect(s.approve(s.list()[0])).toBeNull();
    expect(s.listApprovedCases()).toHaveLength(0);
    expect(s.list()[0].status).toBe(LEARNING_CANDIDATE_PENDING);
  });

  it('结构化校验拒绝 id 不可复算的候选（不改状态）', () => {
    const s = store();
    s.save(content('not-a-hash'), 1);
    expect(s.markVerified(s.list()[0])).toBeNull();
    expect(s.list()[0].status).toBe(LEARNING_CANDIDATE_PENDING);
  });

  it('阈值回流：只统计已决候选（pending / verified 不计入分母）', () => {
    const s = store();
    s.save({ ...content('a1'), category: 'tool_failure' }, 1);
    s.save({ ...content('b2'), category: 'retry_loop' }, 2);
    s.reject(s.list().find((c) => c.id === 'a1')!, '噪声');

    const policies = computeCategoryDecisions(s.list());
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      category: 'tool_failure',
      decided: 1,
      rejected: 1,
      rejectedShare: 1,
      cutoff: null,
    });
  });

  it('阈值回流：样本不足不收紧；达标后下调 0.1 且不低于下限', () => {
    const s = store();
    for (let i = 0; i < 9; i++) {
      s.save({ ...content(`r${i}`), turnNumber: i + 1 }, i);
    }
    for (const c of s.list()) s.reject(c);
    expect(
      suggestCategoryCutoffs(s.list(), { baseCutoff: 0.45 }).cutoffs
    ).toEqual({});

    s.save({ ...content('r9'), turnNumber: 10 }, 100);
    s.reject(s.list().find((c) => c.id === 'r9')!);
    expect(
      suggestCategoryCutoffs(s.list(), { baseCutoff: 0.45 }).cutoffs
        .tool_failure
    ).toBeCloseTo(0.35, 5);
    // 下限：0.15 - 0.1 = 0.05 ⇒ 取 0.1（不把阈值压到产不出候选）
    expect(
      suggestCategoryCutoffs(s.list(), { baseCutoff: 0.15 }).cutoffs
        .tool_failure
    ).toBeCloseTo(0.1, 5);
  });

  it('到期收口：过期批准转 rejected 并标记种子 revokedAt；未到期不动', () => {
    const s = store();
    s.save(verifiableContent('s1', 3), 1);
    s.save(verifiableContent('s2', 4), 2);
    const early = s.list().find((c) => c.sessionId === 's1')!;
    const late = s.list().find((c) => c.sessionId === 's2')!;
    const earlyApproved = s.approve(s.markVerified(early, 10)!, 100)!;
    s.approve(s.markVerified(late, 20)!, 200);

    // 差 1ms 还不算过期（边界）
    expect(s.expireOverdue(earlyApproved.expiresAt! - 1)).toBe(0);
    expect(
      s.list().filter((c) => c.status === LEARNING_CANDIDATE_APPROVED)
    ).toHaveLength(2);

    expect(s.expireOverdue(earlyApproved.expiresAt!)).toBe(1);
    const expiredOne = s.list().find((c) => c.sessionId === 's1')!;
    expect(expiredOne.status).toBe(LEARNING_CANDIDATE_REJECTED);
    expect(expiredOne.note).toBe(LEARNING_EXPIRED_NOTE);

    const seeds = s.listApprovedCases();
    expect(seeds.find((c) => c.id === earlyApproved.id)!.revokedAt).toBe(
      earlyApproved.expiresAt
    );
    const stillApproved = seeds.find((c) => c.sessionId === 's2')!;
    expect(stillApproved.revokedAt).toBeUndefined();

    // 幂等：再跑一次不重复改写
    expect(s.expireOverdue(earlyApproved.expiresAt!)).toBe(0);
  });
});

describe('buildLearningCandidates（采集 → 归因 → 候选）', () => {
  it('只取低于阈值的轮，id 由会话+轮次+类别确定', () => {
    const events = [
      ev('turn/start', 1, { turn: 1 }),
      ev('turn/quality', 2, quality({ turnNumber: 1, score: 0.2 })),
      ev('turn/start', 3, { turn: 2 }),
      ev('turn/quality', 4, quality({ turnNumber: 2, score: 0.9 })),
    ];
    const candidates = buildLearningCandidates({
      sessionId: 's1',
      events,
      scoreCutoff: 0.45,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].turnNumber).toBe(1);
    expect(candidates[0].id).toBe(
      computeLearningCandidateId('s1', 1, 'low_value_answer')
    );
  });

  it('同轮重评 ⇒ 取最后一条质量事件', () => {
    const events = [
      ev('turn/quality', 1, quality({ turnNumber: 1, score: 0.2 })),
      ev('turn/quality', 2, quality({ turnNumber: 1, score: 0.8 })),
    ];
    const candidates = buildLearningCandidates({
      sessionId: 's1',
      events,
      scoreCutoff: 0.45,
    });
    expect(candidates).toHaveLength(0);
  });

  it('按类别收紧：被收紧类别的轻度低分不再成题，其它类别不受影响', () => {
    const events = [
      ev('turn/start', 1, { turn: 1 }),
      ev('assistant/tool_call', 2, {
        toolCallId: 'c1',
        name: 'Bash',
        args: {},
        callSeq: 3,
      }),
      ev('tool/result', 3, {
        callSeq: 3,
        toolCallId: 'c1',
        result: 'denied',
        isError: true,
      }),
      ev('turn/quality', 4, quality({ turnNumber: 1, score: 0.4 })),
      ev('turn/start', 5, { turn: 2 }),
      ev('turn/quality', 6, quality({ turnNumber: 2, score: 0.4 })),
    ];
    // 基线 0.45：两轮 0.40 都成题（tool_failure + low_value_answer）
    expect(
      buildLearningCandidates({ sessionId: 's1', events, scoreCutoff: 0.45 })
    ).toHaveLength(2);
    // 只收紧 tool_failure 到 0.35 ⇒ 0.40 不再成题；low_value_answer 保留
    const tightened = buildLearningCandidates({
      sessionId: 's1',
      events,
      scoreCutoff: 0.45,
      categoryCutoffs: { tool_failure: 0.35 },
    });
    expect(tightened).toHaveLength(1);
    expect(tightened[0].category).toBe('low_value_answer');
  });
});

describe('createLearnCommand（命令层）', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function setup(events: LiriEvent[] = []) {
    dir = mkdtempSync(join(tmpdir(), 'learn-cmd-'));
    const store = new LearningCandidateStore(dir);
    const cmd = createLearnCommand({
      store,
      listSessionIds: async () => ['s1'],
      readEvents: async () => events,
      readScoreCutoff: async () => 0.45,
    });
    return { store, cmd };
  }

  it('approve 前置校验：未校验 ⇒ 失败并提示先 verify', async () => {
    const { store, cmd } = setup([
      ev('turn/start', 1, { turn: 1 }),
      ev('turn/quality', 2, quality({ turnNumber: 1, score: 0.2 })),
    ]);
    await cmd.execute('scan 1', {} as never);
    const id = store.list()[0].id;

    const res = await cmd.execute(`approve ${id}`, {} as never);
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('需先 /learn verify');
    expect(store.list()[0].status).toBe(LEARNING_CANDIDATE_PENDING);
    expect(store.listApprovedCases()).toHaveLength(0);
  });

  it('verify → approve → export → revoke：种子一行、撤销需原因且只标记', async () => {
    const { store, cmd } = setup([
      ev('user/message', 1, { content: '为什么构建失败？' }),
      ev('turn/start', 2, { turn: 1 }),
      ev('turn/quality', 3, quality({ turnNumber: 1, score: 0.2 })),
    ]);
    await cmd.execute('scan 1', {} as never);
    const id = store.list()[0].id;
    expect(store.list()[0].input).toBe('为什么构建失败？');

    const verified = await cmd.execute(`verify ${id}`, {} as never);
    expect(verified.success).toBe(true);
    expect(store.list()[0].status).toBe(LEARNING_CANDIDATE_VERIFIED);

    const approved = await cmd.execute(`approve ${id}`, {} as never);
    expect(approved.success).toBe(true);
    expect(store.list()[0].status).toBe(LEARNING_CANDIDATE_APPROVED);
    const seeds = store.listApprovedCases();
    expect(seeds).toHaveLength(1);
    expect(seeds[0].expectation).toBeNull();
    expect(seeds[0].input).toBe('为什么构建失败？');

    const exported = await cmd.execute('export', {} as never);
    expect(exported.success).toBe(true);
    expect((exported.data as { total: number }).total).toBe(1);

    // 撤销必须写原因
    const noReason = await cmd.execute(`revoke ${id}`, {} as never);
    expect(noReason.success).toBe(false);

    const revoked = await cmd.execute(`revoke ${id} 误批`, {} as never);
    expect(revoked.success).toBe(true);
    expect(store.list()[0].status).toBe(LEARNING_CANDIDATE_REJECTED);
    expect(store.listApprovedCases()[0].revokedAt).toBeDefined();
  });

  it('list 惰性收口：过期批准转拒绝并给出提示', async () => {
    const { store, cmd } = setup([
      ev('turn/start', 1, { turn: 1 }),
      ev('turn/quality', 2, quality({ turnNumber: 1, score: 0.2 })),
    ]);
    await cmd.execute('scan 1', {} as never);
    const verified = store.markVerified(store.list()[0], 1)!;
    store.approve(verified, 2); // expiresAt 落在 1970 ⇒ 相对真实 now 已过期

    const res = await cmd.execute('list', {} as never);
    expect(res.success).toBe(true);
    expect(String(res.message)).toContain('已自动过期 1 条批准');
    expect(store.list()[0].status).toBe(LEARNING_CANDIDATE_REJECTED);
    expect((res.data as { rejected: number }).rejected).toBe(1);
  });

  it('scan 应用阈值回流：输出点名收紧类别，轻度低分不再成题', async () => {
    const { store, cmd } = setup([
      ev('turn/start', 1, { turn: 1 }),
      ev('assistant/tool_call', 2, {
        toolCallId: 'c1',
        name: 'Bash',
        args: {},
        callSeq: 3,
      }),
      ev('tool/result', 3, {
        callSeq: 3,
        toolCallId: 'c1',
        result: 'denied',
        isError: true,
      }),
      ev('turn/quality', 4, quality({ turnNumber: 1, score: 0.4 })),
    ]);

    // 10 条同类别已决且全被拒 ⇒ 拒绝占比 100%，触发收紧
    for (let i = 0; i < 10; i++) {
      store.save({
        id: `seed${i}`,
        sessionId: 's0',
        turnNumber: i + 1,
        category: 'tool_failure',
        score: 0.3,
        evidence: ['score=0.30'],
        summary: `seed ${i}`,
      });
      store.reject(store.list().find((c) => c.id === `seed${i}`)!);
    }

    const res = await cmd.execute('scan 1', {} as never);
    expect(String(res.message)).toContain('已按拒绝占比收紧');
    expect(String(res.message)).toContain('tool_failure → 0.35');
    // 0.40 在 0.35 之上 ⇒ 该类别不再成题
    expect((res.data as { created: number }).created).toBe(0);
  });

  it('scan 产出候选后 list 可见，reject 后台账与统计同步', async () => {
    const events = [
      ev('turn/start', 1, { turn: 1 }),
      ev('turn/quality', 2, quality({ turnNumber: 1, score: 0.2 })),
    ];
    const { store, cmd } = setup(events);

    const scanned = await cmd.execute('scan 1', {} as never);
    expect(scanned.success).toBe(true);
    expect((scanned.data as { created: number }).created).toBe(1);

    const listed = await cmd.execute('list', {} as never);
    expect(String(listed.message)).toContain('第 1 轮 low_value_answer');

    const id = store.list()[0].id;
    const rejected = await cmd.execute(`reject ${id} 误报`, {} as never);
    expect(rejected.success).toBe(true);
    expect((rejected.data as { rejectedShare: number }).rejectedShare).toBe(1);
    expect(store.list()[0].status).toBe(LEARNING_CANDIDATE_REJECTED);

    // 前缀不匹配 ⇒ 明确失败（不静默成功）
    const missing = await cmd.execute('reject 第', {} as never);
    expect(missing.success).toBe(false);
  });
});
