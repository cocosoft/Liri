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
 * Agent 插件级 scope 测试（T3.4 插件 SDK 迁移）
 *
 * 验证：loadPlugin 创建插件级 scope 并登记 PluginSystem 注销逆操作；
 * unloadPlugin 卸载时 scope.dispose 触发注销（修复原 unload 后 PluginSystem 残留可见性）。
 * 使用真实临时插件文件（非 Mock，符合 CS04）。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PluginLoader } from '../PluginLoader';
import { pluginSystem } from '@modules/plugins';

const PLUGIN_ID = 'scope-test-plugin';
const TMP_DIR = join(tmpdir(), `agent-plugin-scope-${Date.now()}`);
const PLUGIN_PATH = join(TMP_DIR, 'plugin.ts');

const PLUGIN_SOURCE = `export const __scopeState = { disposed: false };

export default {
  id: '${PLUGIN_ID}',
  name: 'Scope Test',
  version: '1.0.0',
  description: 'T3.4 scope test plugin',
  initialize: async (config) => {
    config.onDispose?.(() => { __scopeState.disposed = true; });
  },
  activate: async () => {},
  deactivate: async () => {},
  getTools: () => [],
  getStrategies: () => [],
  getExtensions: () => [],
};
`;

describe('Agent 插件级 scope（T3.4 插件 SDK 迁移）', () => {
  beforeAll(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(PLUGIN_PATH, PLUGIN_SOURCE, 'utf-8');
  });

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  test('loadPlugin 后 PluginSystem 可见，unloadPlugin 后注销', async () => {
    const loader = new PluginLoader();
    const plugin = await loader.loadPlugin(PLUGIN_PATH);
    expect(plugin.id).toBe(PLUGIN_ID);
    expect(pluginSystem.getRegistry().getPlugin(PLUGIN_ID)).toBeDefined();

    await loader.unloadPlugin(PLUGIN_ID);
    expect(pluginSystem.getRegistry().getPlugin(PLUGIN_ID)).toBeUndefined();
  });

  test('声明式 onDispose（T3.6/G2）：initialize 登记的逆操作在卸载时执行', async () => {
    const mod = (await import(PLUGIN_PATH)) as {
      __scopeState: { disposed: boolean };
    };
    // 模块缓存：测试 1 已置 true，重置以隔离用例
    mod.__scopeState.disposed = false;
    const loader = new PluginLoader();

    await loader.loadPlugin(PLUGIN_PATH);
    expect(mod.__scopeState.disposed).toBe(false);

    await loader.unloadPlugin(PLUGIN_ID);
    expect(mod.__scopeState.disposed).toBe(true);
  });
});
