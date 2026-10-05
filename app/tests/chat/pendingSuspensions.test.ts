/**
 * A1 T3：挂起清单投影（`projectPendingSuspensions`）单测。
 *
 * 覆盖：未答→挂起 / 用户答复→解析 / 结算标记→解析 / 尾轮收口→无挂起 /
 * 多问排序 / 空事件；以及证伪点——仅凭**结构化 questionId** 配对，不做文案匹配。
 */
import { describe, it, expect } from 'bun:test';
import type { LiriEvent } from '../../src/session/types/events.js';
import {
  projectPendingSuspensions,
  planSuspensionSettlement,
  DEFAULT_SUSPENSION_TIMEOUT_MS,
  SUSPENSION_SETTLED_STATUS_TYPE,
  type PendingSuspension,
} from '../../src/chat/services/pendingSuspensions.js';

const SID = 'session_test';

/** 造事件（宽松类型：仅投影所需字段） */
function ev(
  type: string,
  data: Record<string, unknown>,
  time: number,
  seq: number
): LiriEvent {
  return { type, seq, time, sessionId: SID, data } as unknown as LiriEvent;
}

describe('projectPendingSuspensions（A1 T3 挂起清单投影）', () => {
  it('未完结轮 + 未答提问 ⇒ 挂起 1 条（deadline = askedAt + timeout）', () => {
    const events = [
      ev('turn/start', { turn: 1 }, 1000, 1),
      ev(
        'assistant/question',
        { questionId: 'q1', question: '继续？' },
        1200,
        2
      ),
    ];
    const pending = projectPendingSuspensions(events, {
      sessionId: SID,
      timeoutMs: 5000,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toEqual({
      kind: 'question',
      sessionId: SID,
      refId: 'q1',
      question: '继续？',
      askedAt: 1200,
      deadline: 6200,
    });
  });

  it('用户答复（user/message.questionId 匹配）⇒ 已解析，不再挂起', () => {
    const events = [
      ev('turn/start', { turn: 1 }, 1000, 1),
      ev('assistant/question', { questionId: 'q1' }, 1200, 2),
      ev('user/message', { content: '继续', questionId: 'q1' }, 1500, 3),
    ];
    expect(projectPendingSuspensions(events, { sessionId: SID })).toEqual([]);
  });

  it('结算标记（assistant/status.questionId）⇒ 已解析（幂等）', () => {
    const events = [
      ev('turn/start', { turn: 1 }, 1000, 1),
      ev('assistant/question', { questionId: 'q1' }, 1200, 2),
      ev(
        'assistant/status',
        {
          content: '已结算',
          statusType: SUSPENSION_SETTLED_STATUS_TYPE,
          questionId: 'q1',
        },
        1600,
        3
      ),
    ];
    expect(projectPendingSuspensions(events, { sessionId: SID })).toEqual([]);
  });

  it('证伪用例：另一 questionId 的答复**不**解析本问（结构化配对，非文案）', () => {
    const events = [
      ev('turn/start', { turn: 1 }, 1000, 1),
      ev('assistant/question', { questionId: 'q1' }, 1200, 2),
      ev('user/message', { content: '继续', questionId: 'q_other' }, 1500, 3),
    ];
    const pending = projectPendingSuspensions(events, { sessionId: SID });
    expect(pending.map((p) => p.refId)).toEqual(['q1']);
  });

  it('尾轮已收口（存在 turn/end）⇒ 无挂起（提问随轮结束被放弃）', () => {
    const events = [
      ev('turn/start', { turn: 1 }, 1000, 1),
      ev('assistant/question', { questionId: 'q1' }, 1200, 2),
      ev('turn/end', { turn: 1, finishReason: 'stop' }, 1300, 3),
    ];
    expect(projectPendingSuspensions(events, { sessionId: SID })).toEqual([]);
  });

  it('仅在最后一段未完结轮内的提问算挂起（旧轮已收口不计）', () => {
    const events = [
      ev('turn/start', { turn: 1 }, 1000, 1),
      ev('assistant/question', { questionId: 'q_old' }, 1100, 2),
      ev('turn/end', { turn: 1, finishReason: 'stop' }, 1200, 3),
      ev('turn/start', { turn: 2 }, 2000, 4),
      ev('assistant/question', { questionId: 'q_new' }, 2100, 5),
    ];
    const pending = projectPendingSuspensions(events, { sessionId: SID });
    expect(pending.map((p) => p.refId)).toEqual(['q_new']);
  });

  it('多条挂起按 askedAt 升序（清单可复现）', () => {
    const events = [
      ev('turn/start', { turn: 1 }, 1000, 1),
      ev('assistant/question', { questionId: 'q2' }, 2200, 2),
      ev('assistant/question', { questionId: 'q1' }, 2100, 3),
    ];
    const pending = projectPendingSuspensions(events, { sessionId: SID });
    expect(pending.map((p) => p.refId)).toEqual(['q1', 'q2']);
  });

  it('空事件流 ⇒ 无挂起', () => {
    expect(projectPendingSuspensions([], { sessionId: SID })).toEqual([]);
  });

  it('默认超时 = DEFAULT_SUSPENSION_TIMEOUT_MS', () => {
    const events = [
      ev('turn/start', { turn: 1 }, 0, 1),
      ev('assistant/question', { questionId: 'q1' }, 1000, 2),
    ];
    const pending = projectPendingSuspensions(events, { sessionId: SID });
    expect(pending[0].deadline).toBe(1000 + DEFAULT_SUSPENSION_TIMEOUT_MS);
  });
});

describe('planSuspensionSettlement（A1 T4 结算决策）', () => {
  const item: PendingSuspension = {
    kind: 'question',
    sessionId: SID,
    refId: 'q1',
    question: '继续？',
    askedAt: 1000,
    deadline: 6000,
  };

  it('now ≥ deadline ⇒ expired=true，文案含「已超时」（不静默）', () => {
    const plan = planSuspensionSettlement(item, 6000);
    expect(plan.expired).toBe(true);
    expect(plan.questionId).toBe('q1');
    expect(plan.content).toContain('已超时');
  });

  it('now < deadline ⇒ expired=false，文案含「无恢复通道」', () => {
    const plan = planSuspensionSettlement(item, 5999);
    expect(plan.expired).toBe(false);
    expect(plan.content).toContain('无恢复通道');
  });

  it('question 缺省时结算文案回退为 questionId', () => {
    const plan = planSuspensionSettlement({ ...item, question: '' }, 9999);
    expect(plan.content).toContain('q1');
  });
});
