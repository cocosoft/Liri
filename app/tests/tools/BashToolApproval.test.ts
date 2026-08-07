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
 * 工具执行审批链路 P2-3 — BashTool 放行通道测试
 *
 * 覆盖（P0-4）：
 * - 未批准的危险命令被安全拦截（securityIntercepted，命令不执行）
 * - 已批准命令（ApprovedCommandRegistry 命中 session+hash）跳过安全拦截层并真实执行
 *
 * 测试命令选择 "echo format-test"：
 * - 无审批：包含危险命令词 "format" → 在危险命令列表层被拦截
 * - 有审批：跳过拦截层 → cmd/sh 安全回显，跨平台可执行
 */
import { describe, it, expect } from 'bun:test';
import { BashTool } from '../../src/tools/bash/BashTool.js';
import {
  ApprovedCommandRegistry,
  hashCommand,
} from '../../src/permission/ApprovedCommandRegistry.js';
import type { ToolUseContext } from '../../src/tools/types/Tool.js';

/** 最小可用的 ToolUseContext（仅 execute 用到 sessionId） */
function makeContext(sessionId: string): ToolUseContext {
  return {
    sessionId,
    options: {} as ToolUseContext['options'],
    abortController: new AbortController(),
    readFileState: {},
  } as unknown as ToolUseContext;
}

describe('BashTool 放行通道（P0-4）', () => {
  it('未批准的危险命令被安全拦截（securityIntercepted）', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const tool = new BashTool(reg);
    const result = await tool.execute(
      { command: 'echo format-test' },
      makeContext('session-1')
    );
    expect(result.metadata?.securityIntercepted).toBe(true);
    expect(result.metadata?.reason).toBe('dangerous_command');
    reg.dispose();
  });

  it('已批准命令跳过安全拦截并真实执行', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    // 预先批准该命令（hash 规范化匹配）
    reg.approve('session-1', hashCommand('echo format-test'));
    const tool = new BashTool(reg);
    const result = await tool.execute(
      { command: 'echo format-test' },
      makeContext('session-1')
    );
    // 不再是安全拦截结果
    expect(result.metadata?.securityIntercepted).not.toBe(true);
    // 命令真实执行并输出回显
    expect(result.success).toBe(true);
    expect(String(result.data ?? '')).toContain('format-test');
    reg.dispose();
  });

  it('跨会话不共享放行：其他会话仍被拦截', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    reg.approve('session-1', hashCommand('echo format-test'));
    const tool = new BashTool(reg);
    const result = await tool.execute(
      { command: 'echo format-test' },
      makeContext('session-2')
    );
    expect(result.metadata?.securityIntercepted).toBe(true);
    reg.dispose();
  });

  it('命令实质变化不命中放行：修改后的命令仍被拦截', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    reg.approve('session-1', hashCommand('echo format-test'));
    const tool = new BashTool(reg);
    // 命令变化 → hash 不同 → 未命中放行 → 危险命令词 format 触发拦截
    const result = await tool.execute(
      { command: 'echo format-evil' },
      makeContext('session-1')
    );
    expect(result.metadata?.securityIntercepted).toBe(true);
    reg.dispose();
  });
});
