/**
 * P33 · Policy 配置变更投递（2026-11-02）
 *
 * 覆盖：
 * ① 三类效果：规则禁用/文案变更、发送者失格、`auto→非 auto` 的推断项 proactive:false；
 * ② 变更检测按 `policyId`：首次只建基线、同版本不投递、变化投递一次；
 * ③ 只对**在途**且带合法 mandate 的工作项落 `policyEffect` 标记（终态/非法跳过）。
 */
import { describe, it, expect } from 'bun:test';

import type {
  AutonomyPolicyConfig,
  Mandate,
  PolicyEffect,
} from '@openliri/infra/permission';
import {
  computePolicyEffects,
  createPolicyChangeTracker,
  type PolicyChangeOptions,
} from '../../../src/tasks/autonomy/policyChange';
import type { LoadedAutonomyPolicy } from '../../../src/tasks/autonomy/policyConfig';

const AUTO: AutonomyPolicyConfig = {
  enabled: true,
  acceptMode: 'auto',
  sources: { cron: true },
  admission: {},
  rules: [{ id: 'r1', text: '定时巡检', enabled: true }],
};

function loaded(
  config: Partial<AutonomyPolicyConfig> = {},
  policyId = 'ps1-a'
): LoadedAutonomyPolicy {
  return {
    config: { ...AUTO, ...config },
    source: 'policySettings',
    policyId,
    errors: [],
  };
}

function mandate(over: Partial<Mandate> = {}): Mandate {
  return {
    strength: 'inferred',
    basis: { via: 'bot', rules: ['r1'], policyVersion: 'ps1-a' },
    scope: { source: 'cron', thread: 'cron:job-1' },
    ...over,
  };
}

function ticket(id = 't-1', over: Partial<Mandate> = {}) {
  return { id, mandate: mandate(over) };
}

function effects(
  previous: LoadedAutonomyPolicy,
  current: LoadedAutonomyPolicy,
  tickets = [ticket()]
): Map<string, PolicyEffect> {
  return computePolicyEffects(previous, current, tickets);
}

describe('computePolicyEffects', () => {
  it('auto → observe ⇒ 推断项 proactive:false', () => {
    const result = effects(
      loaded(),
      loaded({ acceptMode: 'observe' }, 'ps1-b')
    );
    expect(result.get('t-1')).toEqual({ proactive: false });
  });

  it('规则被禁用 ⇒ rules[{change:disabled}]', () => {
    const result = effects(
      loaded(),
      loaded(
        { rules: [{ id: 'r1', text: '定时巡检', enabled: false }] },
        'ps1-b'
      )
    );
    expect(result.get('t-1')).toEqual({
      rules: [{ id: 'r1', change: 'disabled' }],
    });
  });

  it('规则文案变更 ⇒ rules[{change:changed}]', () => {
    const result = effects(
      loaded(),
      loaded({ rules: [{ id: 'r1', text: '新文案', enabled: true }] }, 'ps1-b')
    );
    expect(result.get('t-1')).toEqual({
      rules: [{ id: 'r1', change: 'changed' }],
    });
  });

  it('来源被关闭 ⇒ requesterAllowed:false', () => {
    const result = effects(
      loaded(),
      loaded({ sources: { cron: false } }, 'ps1-b')
    );
    expect(result.get('t-1')).toEqual({ requesterAllowed: false });
  });

  it('无关变更（保留原规则 + 新增其它规则）⇒ 无效果', () => {
    const result = effects(
      loaded(),
      loaded(
        {
          rules: [
            { id: 'r1', text: '定时巡检', enabled: true },
            { id: 'other', text: 'x', enabled: true },
          ],
        },
        'ps1-b'
      )
    );
    expect(result.size).toBe(0);
  });
});

describe('createPolicyChangeTracker', () => {
  function row(
    id: string,
    status: string,
    mandateValue: unknown = mandate()
  ): Record<string, unknown> {
    return { id, status, sessionId: 's-1', mandate: mandateValue };
  }

  function setup(rows: ReadonlyArray<Record<string, unknown>>) {
    const writes: Record<string, unknown>[] = [];
    const options: PolicyChangeOptions = {
      listWorkItems: async () => rows,
      writeWorkItem: async (record) => {
        writes.push(record);
      },
      now: () => 1000,
    };
    return { writes, tracker: createPolicyChangeTracker(options) };
  }

  it('首次只建基线；同版本不投递；变化投递一次', async () => {
    const { writes, tracker } = setup([row('t-1', 'active')]);

    expect(await tracker.observe(loaded())).toBeNull();
    expect(await tracker.observe(loaded())).toBeNull();
    expect(writes).toEqual([]);

    const delivery = await tracker.observe(
      loaded({ acceptMode: 'observe' }, 'ps1-b')
    );
    expect(delivery).toMatchObject({
      fromPolicyId: 'ps1-a',
      toPolicyId: 'ps1-b',
      affected: [{ ticketId: 't-1', effect: { proactive: false } }],
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      id: 't-1',
      policyEffect: {
        proactive: false,
        fromPolicyId: 'ps1-a',
        toPolicyId: 'ps1-b',
        at: new Date(1000).toISOString(),
      },
    });

    // 同一版本再次观察 ⇒ 不重复投递
    expect(
      await tracker.observe(loaded({ acceptMode: 'observe' }, 'ps1-b'))
    ).toBeNull();
    expect(writes).toHaveLength(1);
  });

  it('终态 / 非法 mandate ⇒ 不参与投递', async () => {
    const { writes, tracker } = setup([
      row('done', 'completed'),
      row('bad', 'active', { strength: 'nope' }),
    ]);
    await tracker.observe(loaded());
    const delivery = await tracker.observe(
      loaded({ acceptMode: 'observe' }, 'ps1-b')
    );
    expect(delivery?.affected).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('读取工作项失败 ⇒ 只告警，不抛错', async () => {
    const tracker = createPolicyChangeTracker({
      listWorkItems: async () => {
        throw new Error('db down');
      },
      writeWorkItem: async () => {},
    });
    await tracker.observe(loaded());
    const delivery = await tracker.observe(
      loaded({ acceptMode: 'observe' }, 'ps1-b')
    );
    expect(delivery).toMatchObject({ affected: [] });
  });
});
