/**
 * P33-a · 策略门控来源（2026-11-02）
 *
 * 覆盖：
 * ① 策略关闭 ⇒ 原样透传（不附加策略字段）；
 * ② observe ⇒ 丢弃事件（记录 wouldAccept）；
 * ③ auto + 规则命中 ⇒ 透传并附加 `policyId/mandate`；
 * ④ 来源关闭 ⇒ 丢弃；
 * ⑤ 变更观察器每次事件都会收到当前策略（自身只在变化时做 IO）。
 */
import { describe, it, expect } from 'bun:test';

import type { AutonomyPolicyConfig } from '@openliri/infra/permission';
import {
  withPolicyGate,
  type PolicyGatedSourceOptions,
} from '../../../src/tasks/sources/policyGatedSource';
import type {
  EventSource,
  InboundEvent,
  ThreadKey,
} from '../../../src/tasks/sources/types';
import type { LoadedAutonomyPolicy } from '../../../src/tasks/autonomy/policyConfig';

const EVENT: InboundEvent = {
  threadKey: 'fs:/repo/src/a.ts' as ThreadKey,
  externalId: '/repo/src/a.ts@42',
  type: 'file_changed',
  payload: { path: '/repo/src/a.ts', kind: 'change' },
  cursor: 42,
};

function loaded(
  config: Partial<AutonomyPolicyConfig> = {},
  policyId = 'ps1-test'
): LoadedAutonomyPolicy {
  return {
    config: {
      enabled: true,
      acceptMode: 'auto',
      sources: { fs: true },
      admission: {},
      rules: [{ id: 'fs.watch', text: '关注项目文件变更', enabled: true }],
      ...config,
    },
    source: 'policySettings',
    policyId,
    errors: [],
  };
}

function fakeSource() {
  let handler: ((event: InboundEvent) => void | Promise<void>) | null = null;
  const source: EventSource = {
    id: 'fs',
    async subscribe(h) {
      handler = h;
      return () => {
        handler = null;
      };
    },
  };
  return {
    source,
    emit: async (event: InboundEvent = EVENT) => {
      await handler?.(event);
    },
  };
}

async function run(
  policy: LoadedAutonomyPolicy,
  options: Partial<PolicyGatedSourceOptions> = {}
) {
  const base = fakeSource();
  const received: InboundEvent[] = [];
  const observed: LoadedAutonomyPolicy[] = [];
  const gated = withPolicyGate(base.source, {
    loadPolicy: () => policy,
    observePolicyChange: async (loadedNow) => {
      observed.push(loadedNow);
      return null;
    },
    ...options,
  });
  const dispose = await gated.subscribe((event) => {
    received.push(event);
  });
  await base.emit();
  dispose();
  return { received, observed };
}

describe('withPolicyGate', () => {
  it('策略关闭 ⇒ 原样透传（不附加 policyId）', async () => {
    const { received, observed } = await run(
      loaded({ enabled: false, acceptMode: 'off' })
    );
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(EVENT);
    expect(observed).toHaveLength(1);
  });

  it('observe + 规则命中 ⇒ 丢弃（零副作用）', async () => {
    const { received } = await run(loaded({ acceptMode: 'observe' }));
    expect(received).toEqual([]);
  });

  it('auto + 规则命中 ⇒ 透传并附加 policyId/mandate', async () => {
    const { received } = await run(loaded());
    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toMatchObject({
      path: '/repo/src/a.ts',
      kind: 'change',
      policyId: 'ps1-test',
      mandate: {
        strength: 'inferred',
        basis: { via: 'bot', rules: ['fs.watch'], policyVersion: 'ps1-test' },
        scope: { source: 'fs', thread: 'fs:/repo/src/a.ts' },
      },
    });
  });

  it('来源关闭 ⇒ 丢弃', async () => {
    const { received } = await run(loaded({ sources: { fs: false } }));
    expect(received).toEqual([]);
  });
});
