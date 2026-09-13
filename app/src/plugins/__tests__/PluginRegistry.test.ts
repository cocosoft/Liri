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
 * PluginRegistry 单测
 * 2026-08-06：验证注册、重复注册拦截、链式回退自动注册
 */
import { describe, test, expect } from 'bun:test';
import { PluginRegistry } from '../core/PluginRegistry';
import { PluginState, PluginRegistration } from '../types/PluginTypes';

function makeRegistration(
  id: string,
  overrides: Partial<PluginRegistration> = {}
): PluginRegistration {
  return {
    id,
    name: id,
    version: '1.0.0',
    path: `/tmp/${id}`,
    state: PluginState.LOADED,
    enabled: true,
    dependencies: [],
    dependents: [],
    registeredAt: new Date(),
    ...overrides,
  };
}

describe('PluginRegistry', () => {
  test('注册并查询插件', () => {
    const registry = new PluginRegistry();
    registry.registerPlugin(makeRegistration('alpha'));
    expect(registry.getPlugin('alpha')).toBeDefined();
    expect(registry.getAllPlugins()).toHaveLength(1);
  });

  test('重复注册抛 AppError', () => {
    const registry = new PluginRegistry();
    registry.registerPlugin(makeRegistration('alpha'));
    expect(() => registry.registerPlugin(makeRegistration('alpha'))).toThrow(
      /already registered/
    );
  });

  test('setFallback 链式回退并自动注册', () => {
    const registry = new PluginRegistry();
    registry.setFallback((pluginId) =>
      pluginId === 'fallback-plugin'
        ? makeRegistration('fallback-plugin')
        : undefined
    );

    // getPlugin 未命中 → 走回退加载器 → 自动注册并返回
    const plugin = registry.getPlugin('fallback-plugin');
    expect(plugin).toBeDefined();
    // 第二次查询直接从注册表命中（已自动注册）
    expect(registry.getPlugin('fallback-plugin')).toBeDefined();
  });

  test('回退加载器未命中时返回 undefined', () => {
    const registry = new PluginRegistry();
    registry.setFallback(() => undefined);
    expect(registry.getPlugin('nonexistent')).toBeUndefined();
  });

  test('unregisterPlugin 移除注册', () => {
    const registry = new PluginRegistry();
    registry.registerPlugin(makeRegistration('alpha'));
    expect(registry.unregisterPlugin('alpha')).toBe(true);
    expect(registry.getPlugin('alpha')).toBeUndefined();
  });
});
