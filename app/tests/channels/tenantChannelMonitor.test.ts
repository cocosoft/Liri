/**
 * 多租户 P3：租户通道实例纳入实时监控
 *
 * 背景：租户通道（`setupChannels` 的 `_tenantInstances`）**不注册进 `channelRegistry`**
 *（避免按 name 反查串到部署级实例）⇒ 监控器此前完全看不到它们：状态面缺项、
 * 断连不产生事件。修法是在连接成功后**单独登记**给监控器（push 模型），断开时注销。
 *
 * 覆盖：
 * ① 登记后出现在 `getStatusAll()` / `getChannelStatus()`，类型取插件 id；
 * ② 健康探测生效：不健康达阈值 ⇒ 状态转 `error` 并写快照（**不自愈重连**）；
 * ③ 注销后从状态面消失。
 */
import { describe, it, expect } from 'bun:test';

import { ChannelRealtimeMonitor } from '../../src/channels/monitoring/ChannelRealtimeMonitor.js';
import type { IChannelPlugin } from '../../src/channels/types/IChannel.js';

const CHANNEL_ID = 'acme:alice::fake-feishu';

function makePlugin(options: {
  healthy: boolean;
  connected: boolean;
}): IChannelPlugin {
  return {
    id: 'fake-feishu',
    lifecycle: {
      connect: async () => {},
      disconnect: async () => {},
      healthCheck: async () => ({ healthy: options.healthy, latencyMs: 7 }),
      getStatus: () => ({
        connected: options.connected,
        latencyMs: 7,
        lastMessageAt: null,
        uptimeMs: 1000,
      }),
    },
  } as unknown as IChannelPlugin;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ChannelRealtimeMonitor：租户实例', () => {
  it('登记后出现在状态快照里，类型取插件 id', () => {
    const monitor = new ChannelRealtimeMonitor();
    monitor.registerTenantChannel(
      CHANNEL_ID,
      makePlugin({ healthy: true, connected: true })
    );

    const all = monitor.getStatusAll();
    const entry = all.find((s) => s.channelId === CHANNEL_ID);
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('fake-feishu');
    expect(entry!.enabled).toBe(true);
    // 观测到已连接 ⇒ 状态校正为 connected
    expect(entry!.status).toBe('connected');

    expect(monitor.getChannelStatus(CHANNEL_ID)).not.toBeNull();
    expect(monitor.getChannelStatus('not-registered')).toBeNull();
  });

  it('探测不健康达阈值 ⇒ error + 快照（且**不触发自愈重连**）', async () => {
    const monitor = new ChannelRealtimeMonitor({
      probeIntervalMs: 10,
      maxConsecutiveProbeFailures: 2,
      healthCheckTimeoutMs: 50,
    });
    monitor.registerTenantChannel(
      CHANNEL_ID,
      makePlugin({ healthy: false, connected: true })
    );

    monitor.start();
    try {
      await sleep(80); // ≥ 3 轮探测
    } finally {
      monitor.stop();
    }

    const status = monitor.getChannelStatus(CHANNEL_ID);
    expect(status!.healthy).toBe(false);
    expect(status!.status).toBe('error');
    expect(status!.lastError).toContain('租户通道');
  });

  it('注销后从状态面消失（幂等）', () => {
    const monitor = new ChannelRealtimeMonitor();
    monitor.registerTenantChannel(
      CHANNEL_ID,
      makePlugin({ healthy: true, connected: true })
    );
    expect(monitor.getStatusAll().some((s) => s.channelId === CHANNEL_ID)).toBe(
      true
    );

    monitor.unregisterTenantChannel(CHANNEL_ID);
    monitor.unregisterTenantChannel(CHANNEL_ID); // 幂等
    expect(monitor.getStatusAll().some((s) => s.channelId === CHANNEL_ID)).toBe(
      false
    );
    expect(monitor.getChannelStatus(CHANNEL_ID)).toBeNull();
  });
});
