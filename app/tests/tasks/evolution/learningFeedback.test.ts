/**
 * 学习反馈闭环 M1（2026-11-15）
 *
 * 钉住三件事：
 * ① **归因只看结构化字段**（5 类；证据随行）；
 * ② **候选台账幂等**（同会话同轮同类 ⇒ 同 id；重复扫描不新增）；
 * ③ **M1 不提供 approve** —— 命令层显式拒绝，物理上不可能改变模型行为。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';

import type { LiriEvent } from '@modules/session/types/events';
import {
  attributeBadcase,
  buildLearningCandidates,
  collectTurnToolObservations,
  computeLearningCandidateId,
  computeLearningCandidateStats,
  LEARNING_CANDIDATE_PENDING,
  LEARNING_CANDIDATE_REJECTED,
  LearningCandidateStore,
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

  it('拒绝 approve（M1 不提供，避免误以为能改变行为）', async () => {
    const { cmd } = setup();
    const res = await cmd.execute('approve abc', {} as never);
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('M1 不提供 /learn approve');
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
