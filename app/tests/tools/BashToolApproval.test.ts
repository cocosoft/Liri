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
import { describe, it, expect, afterEach, spyOn } from 'bun:test';
import { BashTool } from '../../src/tools/bash/BashTool.js';
import {
  ApprovedCommandRegistry,
  hashCommand,
} from '../../src/permission/ApprovedCommandRegistry.js';
import { completeSecuritySystem } from '../../src/security/CompleteSecuritySystem.js';
import type { BashSecurityAnalyzer } from '../../src/security/BashSecurityAnalyzer.js';
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

  it('已批准的安全命令通过复检并真实执行（A2 基线语义）', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    // 预先批准该命令（hash 规范化匹配）
    reg.approve('session-1', hashCommand('echo approve-pass'));
    const tool = new BashTool(reg);
    const result = await tool.execute(
      { command: 'echo approve-pass' },
      makeContext('session-1')
    );
    // A2 = 安全基线（默认开）：批准只免"审批交互"，硬拦截仍须过 —— 安全命令照常放行
    expect(result.metadata?.securityIntercepted).not.toBe(true);
    // 命令真实执行并输出回显
    expect(result.success).toBe(true);
    expect(String(result.data ?? '')).toContain('approve-pass');
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

/** 灰度开关的环境变量读写辅助 */
function withFlag(name: string, on: boolean): () => void {
  const key = `FEATURE_${name}`;
  const prev = process.env[key];
  if (on) process.env[key] = 'true';
  else delete process.env[key];
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

describe('A1 审计 sessionId（2026-10-09）', () => {
  it('auditAction 收到真实 sessionId（而非 toolUseId）', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const tool = new BashTool(reg);
    const spy = spyOn(completeSecuritySystem, 'auditAction');
    try {
      const context = {
        sessionId: 'session-A1',
        toolUseId: 'toolu-should-not-be-used',
        options: {} as ToolUseContext['options'],
        abortController: new AbortController(),
        readFileState: {},
      } as unknown as ToolUseContext;
      await tool.execute({ command: 'echo audit-only' }, context);
      const call = spy.mock.calls.find(
        (c) => (c[0] as { action?: string }).action === 'bash_execute'
      );
      expect(call).toBeDefined();
      expect((call![0] as { sessionId?: string }).sessionId).toBe('session-A1');
    } finally {
      spy.mockRestore();
      reg.dispose();
    }
  });
});

describe('A2 已批准命令安全复检（安全基线 BASH_APPROVED_REVALIDATE，2026-10-09 默认开）', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('默认开（基线）：已批准的危险命令**被硬拦截**（第九轮审查 §七 翻转）', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    reg.approve('session-1', hashCommand('echo format-test'));
    const tool = new BashTool(reg);
    const result = await tool.execute(
      { command: 'echo format-test' },
      makeContext('session-1')
    );
    // 翻转前（默认关）此处为 `not.toBe(true)`；翻转后批准只免"审批交互"，硬拦截仍须过
    expect(result.metadata?.securityIntercepted).toBe(true);
    expect(result.metadata?.reason).toBe('dangerous_command');
    reg.dispose();
  });

  it('显式开：已批准的危险命令仍被硬拦截', async () => {
    restore = withFlag('BASH_APPROVED_REVALIDATE', true);
    const reg = new ApprovedCommandRegistry(60_000, false);
    reg.approve('session-1', hashCommand('echo format-test'));
    const tool = new BashTool(reg);
    const result = await tool.execute(
      { command: 'echo format-test' },
      makeContext('session-1')
    );
    expect(result.metadata?.securityIntercepted).toBe(true);
    expect(result.metadata?.reason).toBe('dangerous_command');
    reg.dispose();
  });

  it('显式关（灰度回退）：已批准的危险命令跳过拦截（旧行为）', async () => {
    // 注意：`withFlag(name, false)` 是"删除 env ⇒ 用默认值"；A2 默认已为 true
    // ⇒ 回退验证必须**显式设 'false'**（不能用删除）。
    const key = 'FEATURE_BASH_APPROVED_REVALIDATE';
    const prev = process.env[key];
    process.env[key] = 'false';
    try {
      const reg = new ApprovedCommandRegistry(60_000, false);
      reg.approve('session-1', hashCommand('echo format-test'));
      const tool = new BashTool(reg);
      const result = await tool.execute(
        { command: 'echo format-test' },
        makeContext('session-1')
      );
      expect(result.metadata?.securityIntercepted).not.toBe(true);
      reg.dispose();
    } finally {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  });

  it('默认开：已批准的安全命令仍正常执行（复检不误伤）', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    reg.approve('session-1', hashCommand('echo safe-approved'));
    const tool = new BashTool(reg);
    const result = await tool.execute(
      { command: 'echo safe-approved' },
      makeContext('session-1')
    );
    expect(result.metadata?.securityIntercepted).not.toBe(true);
    expect(result.success).toBe(true);
    expect(String(result.data ?? '')).toContain('safe-approved');
    reg.dispose();
  });
});

describe('A4 解释器命令人工确认（灰度开关 BASH_INTERPRETER_GUARD，默认关）', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('开关开：本会被放行的解释器命令转人工确认（不执行）', async () => {
    restore = withFlag('BASH_INTERPRETER_GUARD', true);
    const reg = new ApprovedCommandRegistry(60_000, false);
    const tool = new BashTool(reg);
    // 强制安全分析器放行（模拟"白名单/信任工作区"本会 allow 的场景），
    // 以验证 A4 把"本会执行"的解释器命令升级为人工确认。
    const analyzer = (
      tool as unknown as { securityAnalyzer: BashSecurityAnalyzer }
    ).securityAnalyzer;
    const spy = spyOn(analyzer, 'analyze').mockReturnValue({
      safe: true,
      behavior: 'allow',
      riskLevel: 'low',
      matchedPatterns: [],
    });
    try {
      const result = await tool.execute(
        { command: 'node --version' },
        makeContext('session-1')
      );
      expect(result.requireApproval).toBe(true);
      expect(result.metadata?.reason).toBe('interpreter_guard');
    } finally {
      spy.mockRestore();
      reg.dispose();
    }
  });

  it('默认关：解释器命令不受 A4 影响（按既有安全层决策）', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const tool = new BashTool(reg);
    const analyzer = (
      tool as unknown as { securityAnalyzer: BashSecurityAnalyzer }
    ).securityAnalyzer;
    const spy = spyOn(analyzer, 'analyze').mockReturnValue({
      safe: true,
      behavior: 'allow',
      riskLevel: 'low',
      matchedPatterns: [],
    });
    try {
      const result = await tool.execute(
        { command: 'echo hello-a4-off' },
        makeContext('session-1')
      );
      // 非解释器命令，A4 不介入 → 正常执行
      expect(result.requireApproval).not.toBe(true);
      expect(String(result.data ?? '')).toContain('hello-a4-off');
    } finally {
      spy.mockRestore();
      reg.dispose();
    }
  });
});
