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
 * ChannelRegistry 注册中心单元测试（P2-2 / 4.11）
 * 覆盖：注册 enabled 默认值、updateConfig 同步内存、重启（重复注册）DB 覆盖、getEnabled 过滤
 */

import { describe, expect, it } from 'bun:test';
import { ChannelRegistry } from '../../src/channels/registry/ChannelRegistry';
import type {
  ChannelId,
  IChannelPlugin,
} from '../../src/channels/types/IChannel';

/** 构造最小 IChannelPlugin mock（id 固定为 'testch'） */
function makePlugin(id: string): IChannelPlugin {
  const channelId = id as ChannelId;
  return {
    id: channelId,
    meta: {
      id: channelId,
      displayName: id,
      vendor: 'test',
      vendorSite: '',
      icon: id,
      markdownCapable: false,
      maxMessageLength: 1000,
      supportedMessageTypes: ['text'],
    },
    capabilities: {
      directMessage: true,
      groupMessage: false,
      groupMention: false,
      threading: false,
      reactions: false,
      interactive: false,
      voiceCall: false,
      fileUpload: false,
      imageMessage: false,
      webhook: false,
    },
    config: {
      validate: () => ({ valid: true, errors: [] }),
      getDefaultConfig: () => ({}),
    },
    lifecycle: {
      connect: async () => {},
      disconnect: async () => {},
      healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
      getStatus: () => ({
        connected: false,
        latencyMs: 0,
        lastMessageAt: null,
        uptimeMs: 0,
      }),
    },
    outbound: {
      sendText: async () => ({ success: true }),
      sendMarkdown: async () => ({ success: true }),
      sendImage: async () => ({ success: true }),
      sendFile: async () => ({ success: true }),
      sendInteractive: async () => ({ success: true }),
    },
    security: {
      dmPolicy: 'open',
      allowFrom: [],
      pairingCodeTimeoutMs: 60_000,
      maxPairingAttempts: 5,
      resolveSender: async () => ({
        userId: id,
        displayName: id,
        isApproved: true,
      }),
      authorizeMessage: async () => ({ allowed: true }),
    },
  };
}

describe('ChannelRegistry（4.11）', () => {
  it('注册 IChannelPlugin 默认 enabled=true', () => {
    const registry = new ChannelRegistry(':memory:');
    registry.register(makePlugin('telegram'));
    const ch = registry.get('telegram');
    expect(ch).toBeDefined();
    expect(ch!.enabled).toBe(true);
    expect(registry.getEnabled().map((c) => c.name)).toContain('telegram');
  });

  it('updateConfig 禁用后同步内存 enabled 并过滤 getEnabled', () => {
    const registry = new ChannelRegistry(':memory:');
    registry.register(makePlugin('telegram'));
    registry.updateConfig('telegram', { enabled: false });
    expect(registry.get('telegram')!.enabled).toBe(false);
    expect(registry.getEnabled().map((c) => c.name)).not.toContain('telegram');
  });

  it('重复注册（模拟重启）时 DB 持久化 enabled 覆盖适配默认值', () => {
    const registry = new ChannelRegistry(':memory:');
    registry.register(makePlugin('telegram'));
    registry.updateConfig('telegram', { enabled: false });
    // 模拟重启后重新注册（新实例，默认 enabled=true）
    registry.register(makePlugin('telegram'));
    expect(registry.get('telegram')!.enabled).toBe(false);
    expect(registry.getEnabled().map((c) => c.name)).not.toContain('telegram');
  });

  it('重新启用后 getEnabled 恢复包含该通道', () => {
    const registry = new ChannelRegistry(':memory:');
    registry.register(makePlugin('telegram'));
    registry.updateConfig('telegram', { enabled: false });
    registry.updateConfig('telegram', { enabled: true });
    expect(registry.get('telegram')!.enabled).toBe(true);
    expect(registry.getEnabled().map((c) => c.name)).toContain('telegram');
  });

  it('未注册通道 get 返回 undefined', () => {
    const registry = new ChannelRegistry(':memory:');
    expect(registry.get('nonexistent')).toBeUndefined();
  });
});
