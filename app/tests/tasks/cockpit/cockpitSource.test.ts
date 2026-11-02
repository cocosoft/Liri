/**
 * P39-b-1 · 驾驶舱数据装配
 *
 * 验证：
 * ① 由 `workitems` 行 + 最新派工映射为 `CockpitItem`（stage 仍由纯函数派生）；
 * ② "已结束"判定由调用方注入（本模块不复制状态清单）；
 * ③ 无 id 的行跳过；缺字段不臆造（title/cost 仅在存在时带上）；
 * ④ 装配结果与快照的不变式自洽（数字 = 列表长度）。
 */
import { describe, it, expect } from 'bun:test';

import {
  buildCockpitSnapshot,
  checkCockpitInvariants,
  loadCockpitItems,
  markActionableAttention,
  type CockpitItem,
  type CockpitSourceDeps,
} from '../../../src/tasks/cockpit';
import type { TicketAssignmentRecord } from '../../../src/tasks/ticketAssignmentStore';

function assignment(
  over: Partial<TicketAssignmentRecord>
): TicketAssignmentRecord {
  return {
    assignmentId: 'a',
    workItemId: 'w',
    executor: 'alwayson',
    state: 'running',
    startedAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function deps(
  rows: Array<Record<string, unknown>>,
  assignments: Record<string, TicketAssignmentRecord[]>
): CockpitSourceDeps {
  return {
    listWorkItems: async () => rows,
    listAssignments: async (id) => assignments[id] ?? [],
    // 测试内注入的"已结束"判定（生产中复用 TaskStatus 事实源）
    isEndedStatus: (status) => status === 'completed' || status === 'cancelled',
  };
}

describe('loadCockpitItems', () => {
  it('映射 ended / 最新派工 / 排队；无 id 的行跳过', async () => {
    const items = await loadCockpitItems(
      deps(
        [
          { id: 'w1', status: 'completed', title: '已完成', costTokens: 100 },
          { id: 'w2', status: 'in_progress' },
          { id: 'w3', status: 'pending' },
          { id: '', status: 'in_progress' },
        ],
        {
          w1: [
            assignment({
              workItemId: 'w1',
              state: 'running',
              reportState: 'ready',
            }),
            assignment({ workItemId: 'w1', state: 'ended' }),
          ],
          w2: [
            assignment({
              workItemId: 'w2',
              state: 'running',
              reportState: 'blocked',
            }),
          ],
        }
      )
    );

    expect(items.map((i) => i.id)).toEqual(['w1', 'w2', 'w3']);

    // 已结束由注入判定；最新派工取末条（ended）
    expect(items[0].facts.ended).toBe(true);
    expect(items[0].facts.latestAssignment?.state).toBe('ended');
    expect(items[0].title).toBe('已完成');
    expect(items[0].costTokens).toBe(100);

    expect(items[1].facts.ended).toBeUndefined();
    expect(items[1].facts.latestAssignment).toEqual({
      state: 'running',
      report: 'blocked',
    });

    // 无派工 ⇒ facts 为空（stage 派生为 queued）
    expect(items[2].facts).toEqual({});
    expect('title' in items[2]).toBe(false);
  });

  it('P39-b-2：接管会话取最新派工，缺省回落工作项行', async () => {
    const items = await loadCockpitItems(
      deps(
        [
          { id: 'w1', status: 'in_progress', sessionId: 'row-s' },
          { id: 'w2', status: 'in_progress' },
          { id: 'w3', status: 'in_progress', sessionId: 'row-s3' },
        ],
        {
          w1: [assignment({ workItemId: 'w1', sessionId: 'assign-s' })],
        }
      )
    );

    expect(items[0].sessionId).toBe('assign-s');
    expect(items[1].sessionId).toBeUndefined();
    expect(items[2].sessionId).toBe('row-s3');
  });

  it('装配 + 快照：分组自洽、数字=列表长度', async () => {
    const items = await loadCockpitItems(
      deps(
        [
          { id: 'w1', status: 'completed' },
          { id: 'w2', status: 'in_progress' },
          { id: 'w3', status: 'pending' },
        ],
        {
          w1: [assignment({ workItemId: 'w1', state: 'ended' })],
          w2: [
            assignment({
              workItemId: 'w2',
              state: 'running',
              reportState: 'blocked',
            }),
          ],
        }
      )
    );

    const snapshot = buildCockpitSnapshot(items, 1_700_000_000_000);
    expect(snapshot.groups.map((g) => g.key)).toEqual([
      'person:blocked',
      'working:queued',
      'ended',
    ]);
    expect(checkCockpitInvariants(snapshot, items)).toEqual([]);
    expect(snapshot.metrics.total).toBe(3);
    expect(snapshot.metrics.humanInterventionRate).toBeCloseTo(1 / 3);
    // 缺 succeeded 结构化来源 ⇒ 完成率如实为 undefined（不臆造）
    expect(snapshot.metrics.completionRate).toBeUndefined();
  });
});

describe('P37 · 面板四条件标记', () => {
  it('命中集合 ⇒ facts.attention=true；不修改入参', () => {
    const items: CockpitItem[] = [
      { id: 'w1', facts: {} },
      {
        id: 'w2',
        facts: { latestAssignment: { state: 'running' } },
      },
    ];

    const marked = markActionableAttention(items, new Set(['w1']));

    expect(marked[0]!.facts.attention).toBe(true);
    expect(marked[1]!.facts.attention).toBeUndefined();
    // 原数组不被修改（纯函数）
    expect(items[0]!.facts.attention).toBeUndefined();
  });

  it('标记后进入 person:answer 分组', () => {
    const items: CockpitItem[] = [{ id: 'w1', facts: {} }];
    const marked = markActionableAttention(items, new Set(['w1']));
    const snapshot = buildCockpitSnapshot(marked, 1);

    expect(snapshot.groups[0]).toMatchObject({ key: 'person:answer' });
    expect(snapshot.groups[0]!.items.map((item) => item.id)).toEqual(['w1']);
  });
});
