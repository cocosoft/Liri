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
 * PluginConfigManager 单测
 * 2026-08-06：验证配置落盘持久化（J-10）——setConfig 写盘、loadPersistedConfigs 恢复
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  PluginConfigManager,
  type ConfigSchema,
} from '../management/PluginConfigManager';

describe('PluginConfigManager', () => {
  let tempHome: string;
  const originalLiriHome = process.env.LIRI_HOME;

  beforeAll(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'liri-plugin-config-'));
    // 通过 LIRI_HOME 控制 ~/.pyapp/plugins/config 落盘位置，避免污染真实用户目录
    process.env.LIRI_HOME = tempHome;
  });

  afterAll(() => {
    rmSync(tempHome, { recursive: true, force: true });
    if (originalLiriHome === undefined) {
      delete process.env.LIRI_HOME;
    } else {
      process.env.LIRI_HOME = originalLiriHome;
    }
  });

  const schema: ConfigSchema[] = [
    { key: 'apiKey', type: 'string', label: 'API Key', required: true },
    { key: 'timeout', type: 'number', label: '超时', default: 30 },
  ];

  const configFilePath = () =>
    join(tempHome, 'plugins', 'config', 'config.json');

  test('setConfig 将配置落盘到 config.json', () => {
    const mgr = new PluginConfigManager();
    mgr.setSchema('test-plugin', schema);

    const result = mgr.setConfig('test-plugin', {
      apiKey: 'sk-test',
      timeout: 60,
    });

    expect(result.valid).toBe(true);
    expect(existsSync(configFilePath())).toBe(true);
    const persisted = JSON.parse(
      readFileSync(configFilePath(), 'utf-8')
    ) as Record<string, Record<string, unknown>>;
    expect(persisted['test-plugin']).toEqual({
      apiKey: 'sk-test',
      timeout: 60,
    });
  });

  test('新实例 loadPersistedConfigs 恢复已落盘配置', () => {
    // 前一个用例已落盘；新实例（模拟重启）从盘加载
    const mgr = new PluginConfigManager();
    mgr.loadPersistedConfigs();

    expect(mgr.getConfig('test-plugin')).toEqual({
      apiKey: 'sk-test',
      timeout: 60,
    });
  });

  test('无效配置返回 valid=false 且不落盘', () => {
    const mgr = new PluginConfigManager();
    mgr.setSchema('test-plugin', schema);

    // 缺少必填 apiKey，且类型错误
    const result = mgr.setConfig('test-plugin', {
      apiKey: 123 as unknown as string,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.key === 'apiKey')).toBe(true);
    // 配置未生效：仅保留 schema 默认值（timeout），不含传入的 apiKey
    expect(mgr.getConfig('test-plugin')).toEqual({ timeout: 30 });
  });

  test('setConfig 触发 configUpdated 事件', async () => {
    const mgr = new PluginConfigManager();
    mgr.setSchema('test-plugin', schema);

    let fired = false;
    mgr.on('configUpdated', (payload: { pluginId: string }) => {
      if (payload.pluginId === 'test-plugin') fired = true;
    });

    mgr.setConfig('test-plugin', { apiKey: 'sk-evt' });
    expect(fired).toBe(true);
  });

  test('resetConfig 删除配置并同步落盘', () => {
    const mgr = new PluginConfigManager();
    mgr.setSchema('test-plugin', schema);
    mgr.setConfig('test-plugin', { apiKey: 'sk-x' });

    mgr.resetConfig('test-plugin');

    // 重置后仅剩 schema 默认值，配置已从内存与磁盘删除
    expect(mgr.getConfig('test-plugin')).toEqual({ timeout: 30 });
    // 落盘文件中不应再有该插件（仅剩字段被移除）
    const persisted = JSON.parse(
      readFileSync(configFilePath(), 'utf-8')
    ) as Record<string, unknown>;
    expect(persisted['test-plugin']).toBeUndefined();
  });
});
