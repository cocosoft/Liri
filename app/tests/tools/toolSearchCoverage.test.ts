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
 * `tool_search` 检索覆盖面回归（2026-10-11 真机事故修复）。
 *
 * 事故：普通会话 `taskType:"default"` 的任务裁剪把 `bash`/`powershell` 从模型函数清单移除，
 * 而 `tool_search` 的**关键词分支只搜「延迟加载」工具** ⇒ 模型查 "execute shell command
 * bash …" 返回空 ⇒ 自述"环境无 shell 工具"，执行类任务无法验证产物（导出会话实证）。
 *
 * 锁定两条契约：
 *  1. 关键词分支覆盖**全量已注册工具**（含 alwaysLoad / 非延迟的内置工具）；
 *  2. 检索面**排除有意归档**工具（`ARCHIVED_MISC_TOOLS`，如 `computer_use`）——
 *     归档语义是"对模型永久不可见"，放宽检索不得成为绕过归档的旁路。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ToolSearchTool } from '../../src/tools/ToolSearchTool/ToolSearchTool';
import { getToolRegistry } from '../../src/tools/ToolRegistry';
import type { Tool } from '../../src/tools/types/Tool';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

/** 单 token 名 ⇒ 关键词命中 `parsed.parts.includes(term)`（最高权重路径） */
const PROBE_NAME = 'zzzprobetool';
/** 有意归档工具名（须被检索面排除） */
const ARCHIVED_NAME = 'computer_use';

const registry = getToolRegistry();
let prevArchived: Tool | undefined;

function fakeTool(name: string, description: string): Tool {
  return {
    name,
    description,
    params: [],
    searchHint: description,
    isMcp: false,
    // 关键：**非延迟**（alwaysLoad）—— 修复前关键词分支只搜延迟工具 ⇒ 不可命中
    shouldDefer: false,
    alwaysLoad: true,
    isEnabled: () => true,
    isReadOnly: () => true,
    execute: async () => ({ data: 'ok' }),
  } as unknown as Tool;
}

const ctx = {} as unknown as ToolUseContext;

async function search(query: string): Promise<string[]> {
  const r = await new ToolSearchTool().execute({ query }, ctx);
  return (r.data as { matches: string[] }).matches;
}

beforeAll(() => {
  prevArchived = registry.getTool(ARCHIVED_NAME);
  registry.registerTool(fakeTool(PROBE_NAME, 'execute shell command probe'));
  registry.registerTool(fakeTool(ARCHIVED_NAME, 'control desktop computer'));
});

afterAll(() => {
  registry.unregisterTool(PROBE_NAME);
  registry.unregisterTool(ARCHIVED_NAME);
  // 若真实 `computer_use` 原本已注册，测试覆盖后需还原（避免污染同进程其它用例）
  if (prevArchived) registry.registerTool(prevArchived);
});

describe('tool_search 检索覆盖面（2026-10-11）', () => {
  it('非延迟的内置工具可被关键词命中（修复前只搜延迟工具 ⇒ 永远搜不到）', async () => {
    expect(await search(PROBE_NAME)).toContain(PROBE_NAME);
  });

  it('有意归档工具被排除在检索面外（computer_use 仍"永久不可见"）', async () => {
    expect(await search('computer')).not.toContain(ARCHIVED_NAME);
  });
});
