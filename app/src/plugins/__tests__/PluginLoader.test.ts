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
 * PluginLoader 单测
 * 2026-08-06：验证加载器已从 Mock 桩修复为真实解析/加载
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PluginLoader } from '../core/PluginLoader';
import { PluginState } from '../types/PluginTypes';

describe('PluginLoader', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'liri-plugin-test-'));
    // 有效插件：含 plugin.json
    const pluginDir = join(tempDir, 'test-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A real test plugin',
        author: 'Test Author',
        tags: ['test'],
      }),
      'utf-8'
    );
    // 无效目录：无 plugin.json（应被发现阶段跳过）
    mkdirSync(join(tempDir, 'no-manifest'), { recursive: true });
    // 兼容格式插件：{ plugin: {...} } 包裹结构 + main 字段（npm 包/example-plugin 旧格式，Q2）
    const wrappedDir = join(tempDir, 'wrapped-plugin');
    mkdirSync(wrappedDir, { recursive: true });
    writeFileSync(
      join(wrappedDir, 'plugin.json'),
      JSON.stringify({
        plugin: {
          id: 'wrapped-plugin',
          name: 'Wrapped Plugin',
          version: '2.0.0',
          description: '包裹格式清单',
          author: 'Wrapped Author',
          main: 'src/index.js',
        },
      }),
      'utf-8'
    );
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('真实解析 plugin.json 清单（非 Mock）', async () => {
    const loader = new PluginLoader({
      pluginDirectories: [tempDir],
      autoLoad: false,
    });
    await loader.initialize();

    const plugin = loader.getPlugin('test-plugin');
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('Test Plugin');
    expect(plugin?.version).toBe('1.0.0');
    expect(plugin?.manifest?.description).toBe('A real test plugin');
  });

  test('无 plugin.json 的目录不注册为插件', async () => {
    const loader = new PluginLoader({
      pluginDirectories: [tempDir],
      autoLoad: false,
    });
    await loader.initialize();

    expect(loader.getPlugin('no-manifest')).toBeUndefined();
  });

  test('loadPlugin 将状态置为 LOADED', async () => {
    const loader = new PluginLoader({
      pluginDirectories: [tempDir],
      autoLoad: false,
    });
    await loader.initialize();

    const result = await loader.loadPlugin('test-plugin');
    expect(result.success).toBe(true);
    expect(loader.getPlugin('test-plugin')?.state).toBe(PluginState.LOADED);
    expect(loader.getPlugin('test-plugin')?.stats?.loadCount).toBe(1);
  });

  test('loadPlugin 对不存在的插件返回失败', async () => {
    const loader = new PluginLoader({
      pluginDirectories: [tempDir],
      autoLoad: false,
    });
    await loader.initialize();

    const result = await loader.loadPlugin('missing-plugin');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('兼容 { plugin: {...} } 包裹格式清单（Q2）', async () => {
    const loader = new PluginLoader({
      pluginDirectories: [tempDir],
      autoLoad: false,
    });
    await loader.initialize();

    const plugin = loader.getPlugin('wrapped-plugin');
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('Wrapped Plugin');
    expect(plugin?.version).toBe('2.0.0');
    // entryPoint 从 main 字段派生（npm 包通常声明 main 而非 entryPoint）
    expect(plugin?.manifest?.entryPoint).toBe('src/index.js');
  });
});
