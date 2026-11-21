// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 入站监视 G3/P4：阈值告警（`.trae/specs/inbound-message-monitoring-gaps.md` §6）
 *
 * 覆盖：三条规则各自的触发/不触发、静默期（含**跨重启**）、投递失败不记静默期。
 * 所有读者均注入 ⇒ 不起定时器、不读真实指标/渠道态。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, unlinkSync } from 'node:fs';
import {
  InboundAlertEvaluator,
  CHANNEL_SILENCE_MS,
  REJECTION_WINDOW_MS,
  type ChannelCounters,
  type InboundAlert,
  type InboundChannelStatus,
} from '@modules/channels/monitoring/InboundAlertEvaluator';
import { ChannelAlertStateStore } from '@modules/channels/monitoring/ChannelAlertStateStore';

const dbPath = join(
  tmpdir(),
  `liri-alert-state-${Date.now()}-${Math.floor(performance.now())}.db`
);
const stateStore = new ChannelAlertStateStore(dbPath);

afterAll(() => {
  stateStore.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // @ignore-catch — 测试清理：Windows 下可能仍被占用
      }
    }
  }
});

const T0 = 1_760_000_000_000;

/** 每个用例独占渠道名：静默期按 `(规则, 渠道)` 落盘 ⇒ 复用名字会跨用例互相抑制 */
let seq = 0;
function uniqueChannel(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

function makeEvaluator(overrides: {
  counters?: () => ReadonlyMap<string, ChannelCounters>;
  inflight?: () => readonly {
    channelName: string;
    status: 'inflight' | 'ok' | 'fail' | 'rejected';
    startedAtMs: number;
  }[];
  channels?: () => readonly InboundChannelStatus[];
  notify?: (alert: InboundAlert) => void | Promise<void>;
  store?: ChannelAlertStateStore;
}): InboundAlertEvaluator {
  return new InboundAlertEvaluator({
    notify: overrides.notify ?? (() => undefined),
    stateStore: overrides.store ?? stateStore,
    counters: overrides.counters ?? (() => new Map()),
    inflight: overrides.inflight ?? (() => []),
    channels: overrides.channels ?? (() => []),
    now: () => T0,
  });
}

describe('P4 规则 1：拒绝率突增', () => {
  it('5 分钟窗口内 rejected ≥20 且占比 ≥50% ⇒ 触发一次', async () => {
    const channel = uniqueChannel('burst');
    let counters: ReadonlyMap<string, ChannelCounters> = new Map([
      [channel, { inbound: 0, rejected: 0 }],
    ]);
    const fired: InboundAlert[] = [];
    const evaluator = makeEvaluator({
      counters: () => counters,
      notify: (alert) => {
        fired.push(alert);
      },
    });

    await evaluator.evaluateOnce(T0); // 建立基线
    counters = new Map([[channel, { inbound: 30, rejected: 20 }]]);
    const alerts = await evaluator.evaluateOnce(T0 + REJECTION_WINDOW_MS);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].ruleId).toBe('INBOUND_REJECTION_BURST');
    expect(alerts[0].channel).toBe(channel);
    expect(fired).toHaveLength(1);

    // 静默期内不重复
    const again = await evaluator.evaluateOnce(T0 + REJECTION_WINDOW_MS * 2);
    expect(again).toHaveLength(0);
  });

  it('占比不足（20/100 = 20%）⇒ 不触发', async () => {
    const channel = uniqueChannel('ratio');
    let counters: ReadonlyMap<string, ChannelCounters> = new Map([
      [channel, { inbound: 0, rejected: 0 }],
    ]);
    const evaluator = makeEvaluator({ counters: () => counters });

    await evaluator.evaluateOnce(T0);
    counters = new Map([[channel, { inbound: 100, rejected: 20 }]]);
    const alerts = await evaluator.evaluateOnce(T0 + REJECTION_WINDOW_MS);
    expect(alerts).toHaveLength(0);
  });

  it('窗口未满 ⇒ 不评估（只更新基线）', async () => {
    const channel = uniqueChannel('window');
    let counters: ReadonlyMap<string, ChannelCounters> = new Map([
      [channel, { inbound: 0, rejected: 0 }],
    ]);
    const evaluator = makeEvaluator({ counters: () => counters });

    await evaluator.evaluateOnce(T0);
    counters = new Map([[channel, { inbound: 30, rejected: 20 }]]);
    const alerts = await evaluator.evaluateOnce(T0 + 60_000);
    expect(alerts).toHaveLength(0);
  });
});

describe('P4 规则 2：inflight 卡死', () => {
  it('超过 5 分钟仍 inflight ⇒ 按渠道聚合告警', async () => {
    const channel = uniqueChannel('stuck');
    const evaluator = makeEvaluator({
      inflight: () => [
        {
          channelName: channel,
          status: 'inflight',
          startedAtMs: T0 - 10 * 60_000,
        },
        {
          channelName: channel,
          status: 'inflight',
          startedAtMs: T0 - 6 * 60_000,
        },
        {
          channelName: uniqueChannel('stuck-other'),
          status: 'inflight',
          startedAtMs: T0 - 60_000,
        },
        { channelName: channel, status: 'ok', startedAtMs: T0 - 30 * 60_000 },
      ],
    });

    const alerts = await evaluator.evaluateOnce(T0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].ruleId).toBe('INBOUND_INFLIGHT_STUCK');
    expect(alerts[0].channel).toBe(channel);
    expect(alerts[0].content).toContain('2 条');
  });
});

describe('P4 规则 3：渠道静默', () => {
  it('启用且 24h 无入站 ⇒ 告警；未启用不告警', async () => {
    const channel = uniqueChannel('silent');
    const evaluator = makeEvaluator({
      channels: () => [
        {
          channelId: channel,
          enabled: true,
          lastMessageAt: T0 - CHANNEL_SILENCE_MS - 60_000,
          uptimeMs: 10 * 24 * 3600_000,
        },
        {
          channelId: uniqueChannel('disabled'),
          enabled: false,
          lastMessageAt: null,
          uptimeMs: 10 * 24 * 3600_000,
        },
      ],
    });

    const alerts = await evaluator.evaluateOnce(T0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].ruleId).toBe('INBOUND_CHANNEL_SILENT');
    expect(alerts[0].channel).toBe(channel);
  });

  it('从未收到消息时用 uptime 反推：运行 25h ⇒ 告警', async () => {
    const evaluator = makeEvaluator({
      channels: () => [
        {
          channelId: uniqueChannel('never'),
          enabled: true,
          lastMessageAt: null,
          uptimeMs: 25 * 3600_000,
        },
      ],
    });
    const alerts = await evaluator.evaluateOnce(T0);
    expect(alerts).toHaveLength(1);
  });

  it('刚启动（uptime 1h）且无消息 ⇒ 不告警', async () => {
    const evaluator = makeEvaluator({
      channels: () => [
        {
          channelId: uniqueChannel('fresh'),
          enabled: true,
          lastMessageAt: null,
          uptimeMs: 3600_000,
        },
      ],
    });
    const alerts = await evaluator.evaluateOnce(T0);
    expect(alerts).toHaveLength(0);
  });
});

describe('P4 静默期与投递失败', () => {
  it('静默期落盘：新实例（模拟重启）同一窗口内不再告警', async () => {
    const channel: InboundChannelStatus = {
      channelId: `silent-${Date.now()}`,
      enabled: true,
      lastMessageAt: T0 - CHANNEL_SILENCE_MS - 60_000,
      uptimeMs: 10 * 24 * 3600_000,
    };
    const first = makeEvaluator({ channels: () => [channel] });
    expect(await first.evaluateOnce(T0)).toHaveLength(1);

    // 新 store + 新 evaluator，指向同一库 ⇒ 读到刚写入的 last_fired_at
    const reloadedStore = new ChannelAlertStateStore(dbPath);
    const restarted = makeEvaluator({
      channels: () => [channel],
      store: reloadedStore,
    });
    expect(await restarted.evaluateOnce(T0 + 60_000)).toHaveLength(0);
    reloadedStore.close();
  });

  it('投递抛错 ⇒ 不记静默期，下个 tick 重试', async () => {
    const channel: InboundChannelStatus = {
      channelId: `retry-${Date.now()}`,
      enabled: true,
      lastMessageAt: T0 - CHANNEL_SILENCE_MS - 60_000,
      uptimeMs: 10 * 24 * 3600_000,
    };
    let attempts = 0;
    const evaluator = makeEvaluator({
      channels: () => [channel],
      notify: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('inbox down');
      },
    });

    expect(await evaluator.evaluateOnce(T0)).toHaveLength(0);
    expect(await evaluator.evaluateOnce(T0 + 60_000)).toHaveLength(1);
    expect(attempts).toBe(2);
  });
});
