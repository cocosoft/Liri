/**
 * 多租户 P3：租户通道的**自愈重连**
 *
 * 背景：租户通道实例由 `setupChannels` 在各自身份作用域内连接，登记进
 * `ChannelRealtimeMonitor` 后只能被"探测"—— 断连被发现却拉不起来（监控器只有
 * `<ownerKey>::<type>` 这个键、**不持有凭据**，自己重连会跨身份复用宿主机凭据）。
 *
 * 现口径（push 注入）：
 * - `setupChannels` 注册时注入 `tenantReconnector`（`reconnectTenantChannel`）；
 * - 监控器探测不健康达阈值 ⇒ 指数退避调度重连，实际执行交给执行器；
 * - 执行器先 `principalFromKey(ownerKey)` 还原身份，再在 `runWithPrincipal` 内
 *   **重新解析该租户凭据**并 `disconnect → connect`；
 * - 未注入执行器 ⇒ 与改造前一致：只探测、不自愈。
 */
import { describe, it, expect } from 'bun:test';

import { ChannelRealtimeMonitor } from '../../src/channels/monitoring/ChannelRealtimeMonitor.js';
import { reconnectTenantChannelInScope } from '../../src/channels/setupChannels.js';
import type { IChannelPlugin } from '../../src/channels/types/IChannel.js';
import {
  getRequestPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';

const CHANNEL_ID = 'acme:alice::fake-feishu';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 可自愈的假插件：初始"已连接但不健康"，`connect()` 之后才变健康。
 * 模拟真实断连 → 重连 → 恢复的过程（探测循环随后会确认恢复）。
 */
function makeFlakyPlugin(): {
  plugin: IChannelPlugin;
  calls: { connect: number; disconnect: number };
} {
  let connected = true;
  let healthy = false;
  const calls = { connect: 0, disconnect: 0 };

  const plugin = {
    id: 'fake-feishu',
    lifecycle: {
      connect: async () => {
        calls.connect += 1;
        connected = true;
        healthy = true;
      },
      disconnect: async () => {
        calls.disconnect += 1;
        connected = false;
      },
      healthCheck: async () => ({ healthy, latencyMs: 5 }),
      getStatus: () => ({
        connected,
        latencyMs: 5,
        lastMessageAt: null,
        uptimeMs: 1,
      }),
    },
  } as unknown as IChannelPlugin;

  return { plugin, calls };
}

describe('ChannelRealtimeMonitor：租户通道自愈重连', () => {
  it('探测失败达阈值 ⇒ 调用注入的重连执行器，恢复后回到 connected', async () => {
    const monitor = new ChannelRealtimeMonitor({
      probeIntervalMs: 10,
      maxConsecutiveProbeFailures: 2,
      healthCheckTimeoutMs: 50,
      reconnectBaseMs: 5,
    });
    const { plugin, calls } = makeFlakyPlugin();
    const reconnected: string[] = [];

    monitor.setTenantReconnector(async (channelId) => {
      reconnected.push(channelId);
      // 模拟 setupChannels：disconnect → connect（真实实现还会重建凭据）
      await plugin.lifecycle.disconnect();
      await plugin.lifecycle.connect({ appId: 'fake' });
      return plugin.lifecycle.getStatus().connected;
    });
    monitor.registerTenantChannel(CHANNEL_ID, plugin);

    monitor.start();
    try {
      await sleep(120);
    } finally {
      monitor.stop();
    }

    expect(reconnected.length).toBeGreaterThanOrEqual(1);
    expect(reconnected[0]).toBe(CHANNEL_ID);
    expect(calls.connect).toBeGreaterThanOrEqual(1);
    // 重连后探测健康 ⇒ 状态复位为 connected（且重连计数清零）
    const status = monitor.getChannelStatus(CHANNEL_ID);
    expect(status!.status).toBe('connected');
    expect(status!.reconnectCount).toBe(0);
  });

  it('未注入执行器 ⇒ 与改造前一致：只置 error，不做任何重连', async () => {
    const monitor = new ChannelRealtimeMonitor({
      probeIntervalMs: 10,
      maxConsecutiveProbeFailures: 2,
      healthCheckTimeoutMs: 50,
      reconnectBaseMs: 5,
    });
    const { plugin, calls } = makeFlakyPlugin();

    monitor.registerTenantChannel(CHANNEL_ID, plugin);
    monitor.start();
    try {
      await sleep(80);
    } finally {
      monitor.stop();
    }

    expect(calls.connect).toBe(0);
    expect(monitor.getChannelStatus(CHANNEL_ID)!.status).toBe('error');
  });

  it('重连失败 ⇒ 保持 error 并继续退避重试（不是只试一次）', async () => {
    const monitor = new ChannelRealtimeMonitor({
      probeIntervalMs: 10,
      maxConsecutiveProbeFailures: 2,
      healthCheckTimeoutMs: 50,
      reconnectBaseMs: 5,
      reconnectMaxMs: 20,
    });
    const { plugin } = makeFlakyPlugin();
    let attempts = 0;

    monitor.setTenantReconnector(async () => {
      attempts += 1;
      return false; // 一直连不上
    });
    monitor.registerTenantChannel(CHANNEL_ID, plugin);

    monitor.start();
    try {
      await sleep(150);
    } finally {
      monitor.stop();
    }

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(monitor.getChannelStatus(CHANNEL_ID)!.status).not.toBe('connected');
  });
});

describe('reconnectTenantChannelInScope：身份作用域', () => {
  /** 测试替身：凭据解析注入（真实实现会按身份读 ChannelSecretStore） */
  const deps = { resolveCredentials: () => ({ appId: 'fake' }) };

  it('connect 在归属者身份作用域内执行（不是宿主 local:local）', async () => {
    let seenKey: string | null = null;
    const plugin = {
      id: 'fake-feishu',
      lifecycle: {
        connect: async () => {
          seenKey = principalKeyOf(getRequestPrincipal());
        },
        disconnect: async () => {},
        healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
        getStatus: () => ({ connected: true }),
      },
    } as unknown as IChannelPlugin;

    const ok = await reconnectTenantChannelInScope('acme:alice', plugin, deps);

    expect(ok).toBe(true);
    expect(seenKey).toBe('acme:alice');
  });

  it('归属键非法 ⇒ 不重连、不编造身份', async () => {
    let connects = 0;
    const plugin = {
      id: 'fake-feishu',
      lifecycle: {
        connect: async () => {
          connects += 1;
        },
        disconnect: async () => {},
        healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
        getStatus: () => ({ connected: true }),
      },
    } as unknown as IChannelPlugin;

    expect(await reconnectTenantChannelInScope('', plugin, deps)).toBe(false);
    expect(
      await reconnectTenantChannelInScope('no-colon-here', plugin, deps)
    ).toBe(false);
    expect(connects).toBe(0);
  });
});
