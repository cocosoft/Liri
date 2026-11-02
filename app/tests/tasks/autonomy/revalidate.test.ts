/**
 * P33 · Mandate 重校验（2026-11-02）
 *
 * 覆盖：
 * ① 策略关闭 ⇒ 不读库、不写、不判定（零行为变更）；
 * ② 已结束 + 带 mandate：mode/来源/规则变化 ⇒ 失败并写 `mandateRevoked`；
 * ③ 恢复正常 ⇒ 清除撤销标记；
 * ④ 非结束态 / 无 mandate / 非法 mandate ⇒ 跳过。
 */
import { describe, it, expect } from 'bun:test';

import type { AutonomyPolicyConfig, Mandate } from '@openliri/infra/permission';
import {
  revalidateEndedTicketsForSession,
  type RevalidateOptions,
} from '../../../src/tasks/autonomy/revalidate';
import type { LoadedAutonomyPolicy } from '../../../src/tasks/autonomy/policyConfig';

function policy(
  over: Partial<AutonomyPolicyConfig> = {}
): LoadedAutonomyPolicy {
  return {
    config: {
      enabled: true,
      acceptMode: 'auto',
      sources: { cron: true },
      admission: {},
      rules: [{ id: 'r1', text: '定时巡检', enabled: true }],
      ...over,
    },
    source: 'policySettings',
    policyId: 'ps1-new',
    errors: [],
  };
}

function mandate(over: Partial<Mandate> = {}): Mandate {
  return {
    strength: 'inferred',
    basis: { via: 'bot', rules: ['r1'], policyVersion: 'ps1-old' },
    scope: { source: 'cron', thread: 'cron:job-1' },
    ...over,
  };
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    status: 'completed',
    sessionId: 's-1',
    mandate: mandate(),
    ...over,
  };
}

function run(
  rows: ReadonlyArray<Record<string, unknown>>,
  over: Partial<RevalidateOptions> = {}
) {
  const writes: Record<string, unknown>[] = [];
  const options: RevalidateOptions = {
    listWorkItems: async () => rows,
    writeWorkItem: async (record) => {
      writes.push(record);
    },
    loadPolicy: () => policy(),
    now: () => 1000,
    ...over,
  };
  return {
    writes,
    result: revalidateEndedTicketsForSession('s-1', options),
  };
}

describe('revalidateEndedTicketsForSession', () => {
  it('策略关闭 ⇒ 不读库、不写、不判定', async () => {
    let listCalls = 0;
    const { writes, result } = run([], {
      loadPolicy: () => policy({ enabled: false }),
      listWorkItems: async () => {
        listCalls += 1;
        return [];
      },
    });
    expect(await result).toEqual([]);
    expect(listCalls).toBe(0);
    expect(writes).toEqual([]);
  });

  it('当前策略仍成立 ⇒ ok，且不写任何标记', async () => {
    const { writes, result } = run([row()]);
    expect(await result).toEqual([
      { ticketId: 't-1', ok: true, policyId: 'ps1-new' },
    ]);
    expect(writes).toEqual([]);
  });

  it('mode 降为 observe ⇒ mode_off 并写撤销标记', async () => {
    const { writes, result } = run([row()], {
      loadPolicy: () => policy({ acceptMode: 'observe' }),
    });
    const results = await result;
    expect(results[0]).toMatchObject({ ok: false, reason: 'mode_off' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      id: 't-1',
      mandateRevoked: true,
      mandateRevokedReason: 'mode_off',
      mandateRevokedAt: new Date(1000).toISOString(),
    });
  });

  it('来源关闭 ⇒ source_off', async () => {
    const { writes, result } = run([row()], {
      loadPolicy: () => policy({ sources: { cron: false } }),
    });
    expect((await result)[0]).toMatchObject({
      ok: false,
      reason: 'source_off',
    });
    expect(writes[0]).toMatchObject({ mandateRevokedReason: 'source_off' });
  });

  it('规则被禁用 ⇒ rules_disabled', async () => {
    const { result } = run([row()], {
      loadPolicy: () =>
        policy({ rules: [{ id: 'r1', text: '', enabled: false }] }),
    });
    expect((await result)[0]).toMatchObject({
      ok: false,
      reason: 'rules_disabled',
    });
  });

  it('恢复正常 ⇒ 清除既有撤销标记', async () => {
    const { writes, result } = run([
      row({ mandateRevoked: true, mandateRevokedReason: 'mode_off' }),
    ]);
    expect((await result)[0].ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect('mandateRevoked' in writes[0]!).toBe(false);
    expect('mandateRevokedReason' in writes[0]!).toBe(false);
  });

  it('非结束态 / 无 mandate / 非法 mandate ⇒ 跳过', async () => {
    const { writes, result } = run([
      row({ id: 'active', status: 'active' }),
      row({ id: 'no-mandate', mandate: undefined }),
      row({ id: 'bad-mandate', mandate: { strength: 'nope' } }),
    ]);
    expect(await result).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('同一已撤销项再次失败 ⇒ 不重复写（避免每条消息写库）', async () => {
    const { writes, result } = run(
      [row({ mandateRevoked: true, mandateRevokedReason: 'mode_off' })],
      { loadPolicy: () => policy({ acceptMode: 'observe' }) }
    );
    expect((await result)[0].ok).toBe(false);
    expect(writes).toEqual([]);
  });
});
