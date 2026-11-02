/**
 * P39 · 驾驶舱读侧聚合
 *
 * 覆盖方案 §5 P39 的验收口径：
 * ① stage 派生为主视角：分组键来自 `deriveTicketStage`，人先、工作次之、idle、ended；
 * ② 分组数字**恒等于**列表长度（可勾稽）；
 * ③ 健康态不占空间（空分组不输出）；
 * ④ 指标口径：人工介入率 / 完成率 / 每项成本（无样本 ⇒ undefined，不编造 0）。
 */
import { describe, it, expect } from 'bun:test';

import {
  COCKPIT_GROUP_ORDER,
  buildCockpitSnapshot,
  checkCockpitInvariants,
  type CockpitItem,
} from '../../../src/tasks/cockpit';

const NOW = Date.parse('2026-11-02T12:00:00Z');

function item(id: string, over: Partial<CockpitItem> = {}): CockpitItem {
  return { id, facts: {}, ...over };
}

const ANSWER = item('a', { facts: { attention: true } });
const DELIVERY = item('d', { facts: { deliveryPending: true } });
const REVIEW = item('r', {
  facts: { latestAssignment: { state: 'running', report: 'ready' } },
});
const BLOCKED = item('b', {
  facts: { latestAssignment: { state: 'running', report: 'blocked' } },
});
const FAILED = item('f', {
  facts: { latestAssignment: { state: 'running', report: 'failed' } },
});
const QUEUED = item('q', { facts: {} });
const WORKING = item('w', {
  facts: { latestAssignment: { state: 'running', report: 'progress' } },
});
const IDLE = item('i', { facts: { latestAssignment: { state: 'ended' } } });
const ENDED_OK = item('e1', { facts: { ended: true }, succeeded: true });
const ENDED_BAD = item('e2', { facts: { ended: true }, succeeded: false });

describe('分组与顺序', () => {
  it('人先、工作次之、idle、ended；键与派生 stage 一致', () => {
    const snapshot = buildCockpitSnapshot(
      [
        ENDED_OK,
        IDLE,
        WORKING,
        QUEUED,
        FAILED,
        BLOCKED,
        REVIEW,
        DELIVERY,
        ANSWER,
      ],
      NOW
    );
    expect(snapshot.groups.map((g) => g.key)).toEqual([
      'person:delivery',
      'person:answer',
      'person:review',
      'person:blocked',
      'person:failed',
      'working:queued',
      'working',
      'idle',
      'ended',
    ]);
    expect(snapshot.generatedAt).toBe(NOW);
    expect(
      checkCockpitInvariants(snapshot, [
        ENDED_OK,
        IDLE,
        WORKING,
        QUEUED,
        FAILED,
        BLOCKED,
        REVIEW,
        DELIVERY,
        ANSWER,
      ])
    ).toEqual([]);
  });

  it('空分组不输出（健康态不占空间）', () => {
    const snapshot = buildCockpitSnapshot([WORKING], NOW);
    expect(snapshot.groups.map((g) => g.key)).toEqual(['working']);
    expect(snapshot.groups[0].label).toBe('执行中');
  });

  it('标签来自 COCKPIT_GROUP_LABELS；顺序表覆盖全部派生键', () => {
    const snapshot = buildCockpitSnapshot([ANSWER], NOW);
    const key = snapshot.groups[0].key;
    expect((COCKPIT_GROUP_ORDER as readonly string[]).includes(key)).toBe(true);
    expect(snapshot.groups[0].label).toBe('待你回答');
  });
});

describe('可勾稽（数字 = 列表长度）', () => {
  it('分组总数 = 项总数；每组的 items 长度即该组数字', () => {
    const items = [ANSWER, DELIVERY, WORKING, IDLE, ENDED_OK, ENDED_BAD];
    const snapshot = buildCockpitSnapshot(items, NOW);

    const sum = snapshot.groups.reduce((n, g) => n + g.items.length, 0);
    expect(sum).toBe(items.length);
    expect(snapshot.metrics.total).toBe(items.length);
    expect(checkCockpitInvariants(snapshot, items)).toEqual([]);
  });

  it('不变式能抓出重复 id 与手工拼错分组', () => {
    const dup = buildCockpitSnapshot([ANSWER, ANSWER], NOW);
    expect(checkCockpitInvariants(dup, [ANSWER, ANSWER])).toEqual([
      '重复工作项 id：a',
    ]);

    const forged = {
      generatedAt: NOW,
      groups: [{ key: 'ended', label: '已结束', items: [WORKING] }],
      metrics: {
        total: 1,
        personCount: 0,
        humanInterventionRate: 0,
        endedCount: 0,
      },
    };
    expect(checkCockpitInvariants(forged, [WORKING])).toEqual([
      '工作项 w 被放进 ended，派生结果应为 working',
    ]);
  });
});

describe('指标口径', () => {
  it('人工介入率 = person 项 / 总项', () => {
    const snapshot = buildCockpitSnapshot([ANSWER, REVIEW, WORKING, IDLE], NOW);
    expect(snapshot.metrics.personCount).toBe(2);
    expect(snapshot.metrics.humanInterventionRate).toBe(0.5);
  });

  it('完成率 = 成功结束 / 已结束；无已结束 ⇒ undefined', () => {
    const withEnded = buildCockpitSnapshot([ENDED_OK, ENDED_BAD, WORKING], NOW);
    expect(withEnded.metrics.endedCount).toBe(2);
    expect(withEnded.metrics.completionRate).toBe(0.5);

    const noEnded = buildCockpitSnapshot([WORKING], NOW);
    expect(noEnded.metrics.completionRate).toBeUndefined();
  });

  it('每项成本：只对有样本的项求均值；无样本 ⇒ undefined（不按 0 算）', () => {
    const snapshot = buildCockpitSnapshot(
      [
        item('x', { costTokens: 100 }),
        item('y', { costTokens: 300 }),
        item('z'),
      ],
      NOW
    );
    expect(snapshot.metrics.avgCostTokens).toBe(200);

    expect(
      buildCockpitSnapshot([item('z')], NOW).metrics.avgCostTokens
    ).toBeUndefined();
  });

  it('空输入 ⇒ 全零 / undefined（不抛错）', () => {
    const snapshot = buildCockpitSnapshot([], NOW);
    expect(snapshot.groups).toEqual([]);
    expect(snapshot.metrics).toEqual({
      total: 0,
      personCount: 0,
      humanInterventionRate: 0,
      endedCount: 0,
    });
    expect(checkCockpitInvariants(snapshot, [])).toEqual([]);
  });
});
