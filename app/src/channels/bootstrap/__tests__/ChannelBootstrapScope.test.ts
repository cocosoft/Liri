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
 * 通道级 scope 测试（T3.4 通道迁移）
 *
 * 验证：bootstrap 注册通道时创建通道级 scope 并登记注销逆操作；
 * disposeAll 释放 scope 时通道从 registry 注销（优雅退出清理）。
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { ChannelBootstrapper } from '../ChannelBootstrapper';
import { channelRegistry } from '../../registry/ChannelRegistry';
import { dependencyRegistry } from '@modules/context';

/** 最小 IChannelPlugin mock（结构对齐 adaptPluginToInterface 使用面） */
function makeMockPlugin(id: string): any {
  return {
    id,
    meta: { name: id },
    capabilities: {},
    config: {},
    lifecycle: {
      getStatus: () => ({ connected: false }),
      connect: async () => true,
      disconnect: async () => {},
    },
    outbound: { sendText: async () => ({ success: true }) },
    security: {},
  };
}

describe('通道级 scope（T3.4 通道迁移）', () => {
  let bootstrapper: ChannelBootstrapper;

  beforeEach(() => {
    bootstrapper = new ChannelBootstrapper();
    bootstrapper.registerPluginChannel('mock', () => makeMockPlugin('mock-ch'));
  });

  test('bootstrap 注册后 disposeAll 注销通道', async () => {
    const result = await bootstrapper.bootstrap({
      channels: [{ type: 'mock', enabled: true }],
    });
    expect(result.registered).toBe(1);
    expect(channelRegistry.get('mock-ch')).toBeDefined();

    await bootstrapper.disposeAll();
    expect(channelRegistry.get('mock-ch')).toBeUndefined();
  });

  test('disposeAll 幂等（重复调用不抛错）', async () => {
    await bootstrapper.bootstrap({
      channels: [{ type: 'mock', enabled: true }],
    });
    await bootstrapper.disposeAll();
    await expect(bootstrapper.disposeAll()).resolves.toBeUndefined();
  });

  test('通道注册/注销经 DependencyRegistry 广播状态（T3.5/G1）', async () => {
    const changes: { type: string; next?: { registered?: boolean } }[] = [];
    const unsub = dependencyRegistry.subscribe('channel:mock-ch:status', (c) =>
      changes.push(c as { type: string; next?: { registered?: boolean } })
    );

    await bootstrapper.bootstrap({
      channels: [{ type: 'mock', enabled: true }],
    });
    expect(changes.at(-1)?.type).toBe('provide');
    expect(changes.at(-1)?.next?.registered).toBe(true);

    await bootstrapper.disposeAll();
    expect(changes.at(-1)?.type).toBe('withdraw');

    unsub();
  });
});
