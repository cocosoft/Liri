/**
 * SOP 观察期度量（M7，2026-11-15）
 *
 * 钉住四件事：
 * ① **只算 run**：`op=view/list` 与别家技能名不计；`op` 缺省按 run（旧调用语义）；
 * ② **按轮 join**：`assistant/tool_call` 归属最近的 `turn/start`，`turn/quality` 取同轮最后一条；
 * ③ **不猜缺数**：有调用但该轮无质量事件 ⇒ `unscoredTurns`（既不算通过也不算低分）；
 * ④ **三态判定**：低分优先 `flagged` ⇒ 次数不足 `insufficient` ⇒ 否则 `supported`。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';

import type { LiriEvent } from '@modules/session/types/events';
import {
  collectSopSkillObservations,
  judgeSopObservation,
  summarizeSopObservations,
  SOP_OBSERVATION_MIN_USES,
  type SopTurnObservation,
} from '@modules/tasks';
import {
  SopDraftStore,
  SOP_DRAFT_APPROVED,
} from '../../../src/tasks/evolution/SopDraftStore';
import { createSopCommand } from '../../../src/commands/builtin/sop/Sop';

const SKILL = 'sop-abc123';
/** 观察窗起点（相对当前时间往回 1 分钟；命令层默认窗是"最近 7 天"） */
const SINCE = Date.now() - 60_000;

function ev(
  type: string,
  seq: number,
  time: number,
  data: Record<string, unknown>
): LiriEvent {
  return { type, seq, time, sessionId: 's1', data } as unknown as LiriEvent;
}

/** 一次技能执行（默认 op=run、目标技能 = SKILL） */
function call(seq: number, name = SKILL, op?: string): LiriEvent {
  return ev('assistant/tool_call', seq, SINCE + seq, {
    toolCallId: `c${seq}`,
    name: 'skill',
    args: op === undefined ? { name } : { op, name },
    callSeq: seq,
  });
}

function quality(seq: number, turn: number, score: number): LiriEvent {
  return ev('turn/quality', seq, SINCE + seq, {
    turnNumber: turn,
    score,
    evaluatorVersion: 'v1',
    components: { completion: 1, verdict: 0.5, toolThrash: 1, cost: 1 },
    signals: {
      status: 'completed',
      toolCalls: 1,
      inputTokens: 10,
      outputTokens: 10,
    },
    reviewed: false,
  });
}

function start(seq: number, turn: number, time = SINCE + seq): LiriEvent {
  return ev('turn/start', seq, time, { turn });
}

describe('collectSopSkillObservations（只算 run + 按轮归属 + 窗口）', () => {
  it('op 缺省/run 计入；view/list 与别家技能名不计', () => {
    const events = [
      start(1, 1),
      call(2), // 缺省 op = run
      call(3, SKILL, 'run'),
      call(4, SKILL, 'view'),
      call(5, SKILL, 'list'),
      call(6, 'sop-other'),
    ];
    const turns = collectSopSkillObservations('s1', events, {
      skillName: SKILL,
      since: SINCE,
    });
    expect(turns).toEqual([
      { sessionId: 's1', turnNumber: 1, uses: 2, score: null },
    ]);
  });

  it('早于观察窗的事件不计（turn/start 与调用都不算）', () => {
    const events = [start(1, 1, SINCE - 500), call(2), start(3, 2), call(4)];
    const turns = collectSopSkillObservations('s1', events, {
      skillName: SKILL,
      since: SINCE,
    });
    expect(turns.map((t) => t.turnNumber)).toEqual([2]);
    expect(turns[0].uses).toBe(1);
  });

  it('没有 turn/start 归属的调用不计（不猜轮次）', () => {
    const turns = collectSopSkillObservations('s1', [call(1)], {
      skillName: SKILL,
      since: SINCE,
    });
    expect(turns).toHaveLength(0);
  });

  it('同轮多条 turn/quality 取最后一条', () => {
    const turns = collectSopSkillObservations(
      's1',
      [start(1, 1), call(2), quality(3, 1, 0.2), quality(4, 1, 0.9)],
      { skillName: SKILL, since: SINCE }
    );
    expect(turns[0].score).toBe(0.9);
  });
});

describe('summarizeSopObservations / judgeSopObservation（三态）', () => {
  const turn = (
    over: Partial<SopTurnObservation> = {}
  ): SopTurnObservation => ({
    sessionId: 's1',
    turnNumber: 1,
    uses: 1,
    score: 0.9,
    ...over,
  });

  it('低分轮与缺分数轮分别记账；uses 合计', () => {
    const obs = summarizeSopObservations(
      SKILL,
      [
        turn({ turnNumber: 1, uses: 2, score: 0.2 }),
        turn({ turnNumber: 2, score: null }),
      ],
      0.45
    );
    expect(obs.uses).toBe(3);
    expect(obs.lowScoreTurns.map((t) => t.turnNumber)).toEqual([1]);
    expect(obs.unscoredTurns.map((t) => t.turnNumber)).toEqual([2]);
  });

  it('低分优先：即使次数不足也判 flagged', () => {
    const obs = summarizeSopObservations(SKILL, [turn({ score: 0.1 })], 0.45);
    const judgement = judgeSopObservation(obs);
    expect(judgement.verdict).toBe('flagged');
    expect(judgement.reasons[0]).toContain('伴随低分');
  });

  it('次数不足 ⇒ insufficient（并提示还需几次）', () => {
    const obs = summarizeSopObservations(SKILL, [turn()], 0.45);
    const judgement = judgeSopObservation(obs);
    expect(judgement.verdict).toBe('insufficient');
    expect(judgement.reasons[0]).toContain(`需 ≥ ${SOP_OBSERVATION_MIN_USES}`);
  });

  it('次数达标且无低分 ⇒ supported（缺分数轮如实附注）', () => {
    const turns = [
      ...Array.from({ length: SOP_OBSERVATION_MIN_USES }, (_, i) =>
        turn({ turnNumber: i + 1, score: 0.9 })
      ),
      turn({ turnNumber: 99, score: null }),
    ];
    const obs = summarizeSopObservations(SKILL, turns, 0.45);
    const judgement = judgeSopObservation(obs);
    expect(judgement.verdict).toBe('supported');
    expect(judgement.reasons[0]).toContain('缺质量事件');
  });
});

describe('/sop observe（命令层）', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function setup(status: 'pending' | 'approved', events: LiriEvent[] = []) {
    dir = mkdtempSync(join(tmpdir(), 'sop-observe-'));
    const store = new SopDraftStore(join(dir, 'drafts'), join(dir, 'skills'));
    store.save({
      id: 'abc123',
      title: '测试草案',
      planId: 'p1',
      markdown: '# SOP：测试草案',
    });
    const draft = store.list()[0];
    if (status === 'approved') store.decide(draft, SOP_DRAFT_APPROVED);
    const cmd = createSopCommand({
      store,
      distill: () => [],
      listSessionIds: async () => ['s1'],
      readEvents: async () => events,
      readScoreCutoff: async () => 0.45,
    });
    return { store, cmd };
  }

  it('未批准 ⇒ 拒绝观测（不伪造度量）', async () => {
    const { cmd } = setup('pending');
    const res = await cmd.execute('observe abc123', {} as never);
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('未批准');
  });

  it('已批准 + 6 次执行 + 无低分 ⇒ supported', async () => {
    const events = [start(1, 1)];
    for (let i = 0; i < 6; i++) events.push(call(i + 2));
    events.push(quality(20, 1, 0.9));
    const { cmd } = setup('approved', events);

    const res = await cmd.execute('observe abc123', {} as never);
    expect(res.success).toBe(true);
    expect(String(res.message)).toContain('判定：supported');
    expect((res.data as { uses: number }).uses).toBe(6);
  });

  it('已批准 + 低分 ⇒ flagged', async () => {
    const events = [start(1, 1), call(2), quality(3, 1, 0.1)];
    const { cmd } = setup('approved', events);
    const res = await cmd.execute('observe abc123', {} as never);
    expect(String(res.message)).toContain('判定：flagged');
  });

  it('天数非正整数 ⇒ 明确失败', async () => {
    const { cmd } = setup('approved');
    const res = await cmd.execute('observe abc123 0', {} as never);
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('正整数');
  });
});
