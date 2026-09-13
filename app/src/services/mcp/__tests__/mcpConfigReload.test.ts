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
 * MCP 配置热重载 target 测试（§3.1 关联点3）
 *
 * 验证：
 *   1. filePatterns 匹配三层 MCP 配置路径（全局/用户/项目）
 *   2. 不匹配其他配置文件（字段级对账只响应 MCP 配置）
 *   3. reload 触发配置重载（loadConfigs）
 *   4. initMCPConfigReload 幂等启动（watcher + target 注册不抛错）
 */
import { describe, test, expect } from 'bun:test';
import {
  createMCPConfigReloadTarget,
  initMCPConfigReload,
} from '../mcpConfigReload';

describe('MCP 配置热重载 target（§3.1 关联点3）', () => {
  test('filePatterns 匹配三层 MCP 配置路径', () => {
    const target = createMCPConfigReloadTarget({
      loadConfigs: async () => ({}),
    });
    const paths = [
      'C:\\Users\\user\\.pyapp\\mcp.json',
      'C:\\Users\\user\\.pyapp\\user\\mcp.json',
      '/home/user/.pyapp/mcp.json',
      '/home/user/.pyapp/user/mcp.json',
      '/project/.mcp.json',
      'E:\\proj\\.mcp.json',
    ];
    for (const p of paths) {
      const matched = target.filePatterns.some((re) => re.test(p));
      expect(matched, `应匹配: ${p}`).toBe(true);
    }
  });

  test('不匹配其他配置文件', () => {
    const target = createMCPConfigReloadTarget({
      loadConfigs: async () => ({}),
    });
    const paths = [
      'C:\\Users\\user\\.pyapp\\config.json',
      '/project/model.json',
      '/project/app.config.json',
      'C:\\Users\\user\\.pyapp\\user\\settings.json',
      '/project/mcp.backup.json',
    ];
    for (const p of paths) {
      const matched = target.filePatterns.some((re) => re.test(p));
      expect(matched, `不应匹配: ${p}`).toBe(false);
    }
  });

  test('reload 触发配置重载（loadConfigs）', async () => {
    let called = 0;
    const target = createMCPConfigReloadTarget({
      loadConfigs: async () => {
        called += 1;
        return {};
      },
    });
    await target.reload();
    expect(called).toBe(1);
  });

  test('initMCPConfigReload 幂等启动不抛错', () => {
    // watcher 对不存在的目录仅 warning；重复调用应被幂等守卫拦截
    expect(() => {
      initMCPConfigReload();
      initMCPConfigReload();
    }).not.toThrow();
  });
});
