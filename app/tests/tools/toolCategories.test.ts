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
 * toolCategories 回归测试（2026-09-01）
 *
 * P0 修复：knowledge_save 此前未登记类别（misc）被 default/chat 白名单裁剪，
 * 导致"保存到知识库"在 default 任务下模型无保存工具 → 循环搜索 → 30 轮截断。
 * 修复后 knowledge_save 归 knowledge 类别、技能工具归 search 类别。
 * 本测试固化：核心工具在 default/chat 白名单内可见，防止再次被裁剪。
 */

import { describe, expect, test } from 'bun:test';
import {
  filterToolsByTask,
  getToolCategory,
  TOOL_CATEGORIES,
} from '../../src/tools/toolCategories';
import { toWireToolName } from '../../src/tools/toolNameCodec';

const CORE_TOOLS = [
  'knowledge_save',
  'knowledge_search',
  'knowledge_write',
  'skill_view',
  'skills_list',
  'skill',
  'tool_search',
  'web_fetch',
];

describe('toolCategories — P0 工具可见性回归', () => {
  test('knowledge_save 归 knowledge 类别', () => {
    expect(getToolCategory('knowledge_save')).toBe('knowledge');
    expect(getToolCategory('knowledge_search')).toBe('knowledge');
    expect(getToolCategory('knowledge_write')).toBe('knowledge');
  });

  test('技能工具归 search 类别（与 tool_search 同链）', () => {
    expect(getToolCategory('skill_view')).toBe('search');
    expect(getToolCategory('skills_list')).toBe('search');
    expect(getToolCategory('skill')).toBe('search');
  });

  test('default 任务白名单保留核心工具（knowledge_save + 技能工具）', () => {
    const defs = CORE_TOOLS.map((name) => ({ name }));
    const kept = filterToolsByTask(defs, 'default').map((t) => t.name);
    for (const name of CORE_TOOLS) {
      expect(kept).toContain(name);
    }
  });

  test('chat 任务白名单保留核心工具', () => {
    const defs = CORE_TOOLS.map((name) => ({ name }));
    const kept = filterToolsByTask(defs, 'chat').map((t) => t.name);
    for (const name of CORE_TOOLS) {
      expect(kept).toContain(name);
    }
  });

  test('P3: todo_write 恒保留（mandatory），chat/default 裁剪后仍可见', () => {
    // todo_write 类别为 'task'，chat/default 白名单不含 'task'；
    // 修复后经 MANDATORY_TOOLS 恒保留 → 普通对话 TaskCard 可发起。
    const defs = [
      { name: 'todo_write' },
      { name: 'bash' },
      { name: 'web_search' },
    ];
    for (const taskType of ['chat', 'default', undefined]) {
      const kept = filterToolsByTask(defs, taskType).map((t) => t.name);
      expect(kept).toContain('todo_write');
    }
  });

  test('N-41: Agent 恒保留（mandatory），default 裁剪后仍可见', () => {
    // N-41（2026-09-20）：Agent 类别不在 chat/default 白名单 ⇒ 过去被裁剪
    // （实测 default 裁剪日志 removedNames 含 "Agent"）⇒ 模型只能靠"越清单直接调用"
    // 侥幸可用，表现为"并行子代理在普通对话时好时坏 / 模型自述该工具不可用"。
    // 现纳入 MANDATORY_TOOLS 恒保留。
    // 注：`sessions_yield` 走**类别登记**（N-44 起登记为 'session'，default/chat 可见），
    // 不纳入 mandatory —— 它在 quick/local 等轻量集里仍会被裁。
    const defs = [{ name: 'agent' }, { name: 'bash' }, { name: 'web_search' }];
    for (const taskType of ['chat', 'default', undefined]) {
      const kept = filterToolsByTask(defs, taskType).map((t) => t.name);
      expect(kept).toContain('agent');
    }
  });

  test('N-44: MCP 动态工具名（server__tool）归 mcp 类别且在 default 保留', () => {
    // McpToolWrapper 命名 `${server}__${tool}`；normalizeToolName 命名 `mcp__${server}__${tool}`。
    // 两者都含双下划线 ⇒ getToolCategory 归 'mcp' ⇒ 纳入 chat/default 白名单。
    // 修复前：动态名未登记 → misc → misc 不在任何白名单 → MCP 工具对模型永久不可见。
    expect(getToolCategory('github__create_issue')).toBe('mcp');
    expect(getToolCategory('mcp__demo__search')).toBe('mcp');
    const defs = [{ name: 'github__create_issue' }, { name: 'bash' }];
    for (const taskType of ['chat', 'default', undefined]) {
      const kept = filterToolsByTask(defs, taskType).map((t) => t.name);
      expect(kept).toContain('github__create_issue');
    }
  });

  test('N-44: plan / clipboard / canvas 归 assist，普通对话可见', () => {
    expect(getToolCategory('plan')).toBe('assist');
    expect(getToolCategory('clipboard')).toBe('assist');
    expect(getToolCategory('canvas')).toBe('assist');
    const defs = [
      { name: 'plan' },
      { name: 'clipboard' },
      { name: 'canvas' },
      { name: 'bash' },
    ];
    for (const taskType of ['chat', 'default', undefined]) {
      const kept = filterToolsByTask(defs, taskType).map((t) => t.name);
      for (const name of ['plan', 'clipboard', 'canvas']) {
        expect(kept).toContain(name);
      }
    }
  });

  test('N-44: sessions_yield 归 session，default/chat 可见', () => {
    expect(getToolCategory('sessions_yield')).toBe('session');
    const defs = [{ name: 'sessions_yield' }, { name: 'bash' }];
    for (const taskType of ['chat', 'default', undefined]) {
      const kept = filterToolsByTask(defs, taskType).map((t) => t.name);
      expect(kept).toContain('sessions_yield');
    }
  });

  test('N-44: doc / channel / calendar / mail 四类已纳入 default', () => {
    const defs = [
      { name: 'doc_generate' },
      { name: 'channel' },
      { name: 'broadcast' },
      { name: 'calendar:add' },
      { name: 'mail:send' },
      { name: 'bash' },
    ];
    const kept = filterToolsByTask(defs, 'default').map((t) => t.name);
    expect(kept).toEqual([
      'doc_generate',
      'channel',
      'broadcast',
      'calendar:add',
      'mail:send',
    ]);
  });

  test('N-44: misc 仍会被裁（browser / computer_use 未开放，行为不变）', () => {
    expect(getToolCategory('browser')).toBe('misc');
    expect(getToolCategory('computer_use')).toBe('misc');
    expect(
      filterToolsByTask(
        [{ name: 'browser' }, { name: 'computer_use' }],
        'default'
      )
    ).toHaveLength(0);
  });

  test('N-44 扩展: mcp 类别已纳入 coding / agent 任务集', () => {
    // 上游决策：项目/编码会话与自主代理是 MCP 的典型使用场景，故这两套白名单也补 'mcp'。
    const defs = [{ name: 'github__create_issue' }, { name: 'bash' }];
    for (const taskType of ['coding', 'agent']) {
      const kept = filterToolsByTask(defs, taskType).map((t) => t.name);
      expect(kept).toContain('github__create_issue');
      expect(kept).toContain('bash'); // 反证：该任务集本身有效（非全量放行）
    }
  });

  test('N-45: 冒号命名空间工具的真名与 wire 名两种形态都能解析类别', () => {
    // 根因（2026-10-05 实测）：出站定义用 wire 名（buildToolDefinitions →
    // toWireToolName），而裁剪按定义里的名字查类别 ⇒ 冒号工具全部落 misc 被裁。
    // 注：wire 变换只替换 `:`（`-` 属合法字符）⇒ `office:doc-pipeline` → `office_doc-pipeline`
    expect(getToolCategory('office:workflow')).toBe('doc');
    expect(getToolCategory('office_workflow')).toBe('doc');
    expect(getToolCategory('office:doc-pipeline')).toBe('doc');
    expect(getToolCategory(toWireToolName('office:doc-pipeline'))).toBe('doc');
    expect(getToolCategory('calendar:add')).toBe('calendar');
    expect(getToolCategory('calendar_add')).toBe('calendar');
    expect(getToolCategory('mail:send')).toBe('mail');
    expect(getToolCategory('mail_send')).toBe('mail');
  });

  test('N-45: 生产形态（function.name = wire 名）裁剪后 office 工具对模型可见', () => {
    // 修复前：office_workflow → misc → 被裁 ⇒ 模型函数清单无该工具
    //（现场：模型称"工具不存在"、tool_search 返回空）
    const wfWire = toWireToolName('office:workflow');
    const pipeWire = toWireToolName('office:doc-pipeline');
    const defs = [
      { type: 'function' as const, function: { name: wfWire } },
      { type: 'function' as const, function: { name: pipeWire } },
      { type: 'function' as const, function: { name: 'bash' } },
    ];
    for (const taskType of ['chat', 'default', undefined]) {
      const kept = filterToolsByTask(defs, taskType).map(
        (t) => t.function.name
      );
      expect(kept).toContain(wfWire);
      expect(kept).toContain(pipeWire);
      expect(kept).not.toContain('bash'); // 反证：裁剪仍生效（非全量放行）
    }
  });

  test('N-45: 系统性不变量 —— 登记表每项的 wire 形态都解析到同一类别', () => {
    // 防回归：任何未来新增的冒号命名空间工具，若只登记真名而不支持 wire 形态，
    // 本用例立即失败（这正是 N-45 缺陷长期漏检的原因：原测试只用真名断言）。
    for (const [name, category] of Object.entries(TOOL_CATEGORIES)) {
      if (name.includes('__')) continue; // 动态 MCP 名走双下划线判据
      expect(getToolCategory(toWireToolName(name))).toBe(category);
    }
  });

  test('N-44 扩展: sleep_for / sleep_until 归 system，通用任务集内可见', () => {
    // 与同族的阻塞式 `sleep`（亦为 'system'）保持同一类别口径。
    expect(getToolCategory('sleep_for')).toBe('system');
    expect(getToolCategory('sleep_until')).toBe('system');
    const defs = [
      { name: 'sleep_for' },
      { name: 'sleep_until' },
      { name: 'bash' },
    ];
    for (const taskType of ['chat', 'default', 'coding', undefined]) {
      const kept = filterToolsByTask(defs, taskType).map((t) => t.name);
      expect(kept).toContain('sleep_for');
      expect(kept).toContain('sleep_until');
    }
  });
});
