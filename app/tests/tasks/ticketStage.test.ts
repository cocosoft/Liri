/**
 * P34 · Ticket stage 派生（纯函数）单元测试
 *
 * 对照参考实现 `docs/003-execution.md:9-17` 的"首行命中"表逐行断言：
 * 同一组事实只能落一个 stage，且顺序不可调整（例如 `ended` 永远优先）。
 */
import { describe, it, expect } from 'bun:test';

import {
  deriveTicketStage,
  isPersonStage,
  ticketStageKey,
  type TicketFacts,
} from '../../src/tasks/ticketStage';

const base: TicketFacts = {
  latestAssignment: { state: 'running', report: 'progress' },
};

describe('P34 · Ticket stage 派生（首行命中）', () => {
  it('ended 最优先（即使还有其他事实）', () => {
    expect(
      deriveTicketStage({
        ...base,
        ended: true,
        deliveryPending: true,
        attention: true,
      })
    ).toEqual({ stage: 'ended' });
  });

  it('输入投递未完成 ⇒ person/delivery', () => {
    expect(deriveTicketStage({ ...base, deliveryPending: true })).toEqual({
      stage: 'person',
      action: 'delivery',
    });
  });

  it('结构化待答问题 ⇒ person/answer（先于报告判定）', () => {
    expect(
      deriveTicketStage({
        latestAssignment: { state: 'running', report: 'ready' },
        attention: true,
      })
    ).toEqual({ stage: 'person', action: 'answer' });
  });

  it('报告 ready ⇒ person/review', () => {
    expect(
      deriveTicketStage({
        latestAssignment: { state: 'running', report: 'ready' },
      })
    ).toEqual({ stage: 'person', action: 'review' });
  });

  it('报告 blocked/failed 且此后无人消息 ⇒ person/blocked|failed', () => {
    expect(
      deriveTicketStage({
        latestAssignment: { state: 'running', report: 'blocked' },
      })
    ).toEqual({ stage: 'person', action: 'blocked' });
    expect(
      deriveTicketStage({
        latestAssignment: { state: 'running', report: 'failed' },
      })
    ).toEqual({ stage: 'person', action: 'failed' });
  });

  it('blocked 之后人已回话 ⇒ 不再算"等人"（回到工作态）', () => {
    expect(
      deriveTicketStage({
        latestAssignment: { state: 'running', report: 'blocked' },
        humanSinceReport: true,
      })
    ).toEqual({ stage: 'working' });
  });

  it('无 Assignment / pending ⇒ working/queued', () => {
    expect(deriveTicketStage({})).toEqual({
      stage: 'working',
      action: 'queued',
    });
    expect(
      deriveTicketStage({ latestAssignment: { state: 'pending' } })
    ).toEqual({ stage: 'working', action: 'queued' });
  });

  it('报告 waiting 或 Assignment ended ⇒ idle', () => {
    expect(
      deriveTicketStage({
        latestAssignment: { state: 'running', report: 'waiting' },
      })
    ).toEqual({ stage: 'idle' });
    expect(deriveTicketStage({ latestAssignment: { state: 'ended' } })).toEqual(
      { stage: 'idle' }
    );
  });

  it('其余 ⇒ working（progress / dropped / running 无报告）', () => {
    expect(deriveTicketStage(base)).toEqual({ stage: 'working' });
    expect(
      deriveTicketStage({
        latestAssignment: { state: 'running', report: 'dropped' },
      })
    ).toEqual({ stage: 'working' });
    expect(
      deriveTicketStage({ latestAssignment: { state: 'running' } })
    ).toEqual({ stage: 'working' });
  });
});

describe('P34 · stage 辅助判据', () => {
  it('isPersonStage 只认"卡在人这里"', () => {
    expect(isPersonStage({ stage: 'person', action: 'answer' })).toBe(true);
    expect(isPersonStage({ stage: 'working', action: 'queued' })).toBe(false);
    expect(isPersonStage({ stage: 'idle' })).toBe(false);
    expect(isPersonStage({ stage: 'ended' })).toBe(false);
  });

  it('stageKey 稳定且可枚举（供日志/指标分组）', () => {
    expect(ticketStageKey({ stage: 'person', action: 'review' })).toBe(
      'person:review'
    );
    expect(ticketStageKey({ stage: 'working', action: 'queued' })).toBe(
      'working:queued'
    );
    expect(ticketStageKey({ stage: 'working' })).toBe('working');
    expect(ticketStageKey({ stage: 'idle' })).toBe('idle');
  });
});
