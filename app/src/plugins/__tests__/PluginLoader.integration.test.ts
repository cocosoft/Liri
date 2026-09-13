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
 * PluginLoader 集成测试 — 仓库自带 example-plugin 可被真实加载（Q2 兼容性回归）
 * 2026-08-06：验证官方示例（平铺 manifest + entryPoint=src/index.ts）能被发现、校验通过并真实 import。
 * 若此测试失败，说明示例插件与加载器契约不一致（P0 兼容性缺口回归）。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { PluginLoader } from '../core/PluginLoader';
import { PluginState } from '../types/PluginTypes';

// 仓库内示例插件目录：app/plugins（相对 app 的 cwd；bun test 在 app/ 下执行）
const EXAMPLE_PLUGINS_DIR = join(process.cwd(), 'plugins');

describe('PluginLoader 集成（example-plugin）', () => {
  let tempDir: string;
  const originalLiriHome = process.env.LIRI_HOME;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'liri-plugin-integration-'));
    // 隔离插件配置落盘目录，避免污染真实用户目录
    process.env.LIRI_HOME = tempDir;
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalLiriHome === undefined) {
      delete process.env.LIRI_HOME;
    } else {
      process.env.LIRI_HOME = originalLiriHome;
    }
  });

  test('example-plugin 可被发现且 manifest 解析正确', async () => {
    const loader = new PluginLoader({
      pluginDirectories: [EXAMPLE_PLUGINS_DIR],
      autoLoad: false,
    });
    await loader.initialize();

    const plugin = loader.getPlugin('example-plugin');
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe('example-plugin');
    expect(plugin?.version).toBe('1.0.0');
    expect(plugin?.manifest?.entryPoint).toBe('src/index.ts');
  });

  test('example-plugin 可被真实加载（import 入口，state=LOADED）', async () => {
    const loader = new PluginLoader({
      pluginDirectories: [EXAMPLE_PLUGINS_DIR],
      autoLoad: false,
    });
    await loader.initialize();

    const result = await loader.loadPlugin('example-plugin');
    expect(result.success).toBe(true);
    const plugin = loader.getPlugin('example-plugin');
    expect(plugin?.state).toBe(PluginState.LOADED);
    expect(plugin?.instance).toBeDefined();
  });
});
