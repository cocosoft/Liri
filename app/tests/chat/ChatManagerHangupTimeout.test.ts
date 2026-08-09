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
 * ChatManager 工具执行超时兜底回归测试（P0-2）
 *
 * 覆盖 S-1/T-1/U-1 同源挂起类缺陷的防护核心：
 * 修复前 executeTool 无超时兜底，工具（如 REPL 执行、Provider 流）永久挂起时，
 * 工具循环永久 await → 会话 mutex 永不释放 → 同会话 30s acquire timeout。
 * 修复后 _withToolTimeout 统一超时（默认 5 分钟，env TOOL_EXEC_TIMEOUT_MS 可覆盖），
 * 挂起工具超时返回失败结果，调用方不再永久 await。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { ChatManagerImpl } from '../../src/chat/ChatManager.js';
import type { ToolRegistry } from '@modules/tools/ToolRegistry';

describe('ChatManager 工具执行超时兜底（P0-2）', () => {
  let cm: ChatManagerImpl;

  beforeEach(() => {
    cm = new ChatManagerImpl();
  });

  afterEach(() => {
    delete process.env.TOOL_EXEC_TIMEOUT_MS;
  });

  it('工具永久挂起时，超时后返回超时结果而非永久 await（锁防护回归）', async () => {
    process.env.TOOL_EXEC_TIMEOUT_MS = '200';
    // mock 工具注册表：executeTool 永不 resolve（模拟挂起工具，如 REPL/Provider 流挂起）
    const registry = {
      getToolSchemas: () => [],
      executeTool: () => new Promise(() => {}),
    } as unknown as ToolRegistry;
    cm.setToolRegistry(registry);

    const start = Date.now();
    const result = await cm.executeTool({
      id: 't1',
      name: 'hang_tool',
      arguments: {},
    });
    const elapsed = Date.now() - start;

    // 超时结果返回（不永久 await → 上层工具循环可继续 → mutex 可释放）
    expect(result.error).toContain('超时');
    // 在 200ms 超时附近返回，而非无限等待
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(2000);
  });

  it('正常快速工具不受超时影响', async () => {
    process.env.TOOL_EXEC_TIMEOUT_MS = '200';
    const registry = {
      getToolSchemas: () => [],
      executeTool: () =>
        Promise.resolve({ data: { ok: true }, error: undefined }),
    } as unknown as ToolRegistry;
    cm.setToolRegistry(registry);

    const result = await cm.executeTool({
      id: 't2',
      name: 'fast_tool',
      arguments: {},
    });
    expect(result.result).toEqual({ ok: true });
    expect(result.error).toBeUndefined();
  });
});
