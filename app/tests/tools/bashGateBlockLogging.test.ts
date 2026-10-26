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
 * BashTool 硬拦截分支可观测性（2026-10-25 补日志）
 *
 * 缺陷背景：`bash: security_gate_blocked` 此前**零日志** —— 拦截事件只落会话消息、
 * 不进 app.log（用户会话 `session_mvl0d0a3d6e2e9a764` 实证「bash 构建命令被安全策略拦截」
 * 无法在服务端日志检索）。修复参照 `powershell_wrapper_blocked` 先例，给
 * `checkPathSafety` / `checkBashDangerousCommand` / `checkAstAndAnalyzer` 三个分支补
 * `logger.warn`（字段同构：sessionId + commandPreview + reason）。
 *
 * 覆盖：
 * - 路径拦截（path_safety）⇒ warn 记录 reason
 * - 危险命令拦截（dangerous_command）⇒ warn 记录 reason
 * - 分析器 deny（security_analyzer_deny）⇒ warn 记录 reason
 * - 负向对照：正常放行命令 ⇒ 零条 security_gate_blocked（不误报）
 *
 * 日志断言方式与 `bashSecuritySwitchDefaults.test.ts` 同构：spy `getLogger('tools\bash\BashTool')`
 * 的 `warn`（同一 logger 单例），按消息 key 过滤。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { getLogger } from '@modules/monitoring';
import {
  BashTool,
  resetGraySwitchWarningForTest,
} from '../../src/tools/bash/BashTool.js';
import { ApprovedCommandRegistry } from '../../src/permission/ApprovedCommandRegistry.js';
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

/** BashTool 使用的 logger 单例（与 `BashTool.ts` 同一字面量 ⇒ 同一实例） */
const bashLogger = getLogger('tools\bash\BashTool');

/** 安全门拦截日志 key（与 BashTool.ts 新增 warn 一致） */
const GATE_BLOCKED_KEY = 'bash: security_gate_blocked';

type WarnCall = [string, Record<string, unknown>];

let warnSpy: ReturnType<typeof spyOn> | undefined;

/** 过滤出安全门拦截日志（避免与灰度告警等其它 warn 混淆） */
function gateBlockCalls(): WarnCall[] {
  const calls = (warnSpy?.mock.calls ?? []) as WarnCall[];
  return calls.filter((c) => c[0] === GATE_BLOCKED_KEY);
}

afterEach(() => {
  warnSpy?.mockRestore();
  warnSpy = undefined;
  resetGraySwitchWarningForTest();
});

describe('BashTool 硬拦截分支可观测性（2026-10-25 补日志）', () => {
  it('checkPathSafety 拦截 ⇒ warn 记录 reason=path_safety + commandPreview + sessionId', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    try {
      const tool = new BashTool(reg);
      warnSpy = spyOn(bashLogger, 'warn');
      const result = await tool.execute(
        { command: 'echo /etc/passwd' },
        makeContext('sess-path')
      );
      // 门本身语义不变：仍拦截（本测试只验日志，不改变拦截行为）
      expect(result.metadata?.securityIntercepted).toBe(true);
      expect(result.metadata?.reason).toBe('path_safety');

      const calls = gateBlockCalls();
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toMatchObject({
        sessionId: 'sess-path',
        reason: 'path_safety',
      });
      expect(String(calls[0][1].commandPreview ?? '')).toContain('/etc/passwd');
    } finally {
      reg.dispose();
    }
  });

  it('checkBashDangerousCommand 拦截 ⇒ warn 记录 reason=dangerous_command', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    try {
      const tool = new BashTool(reg);
      warnSpy = spyOn(bashLogger, 'warn');
      const result = await tool.execute(
        { command: 'echo format' },
        makeContext('sess-danger')
      );
      expect(result.metadata?.reason).toBe('dangerous_command');

      const calls = gateBlockCalls();
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toMatchObject({
        sessionId: 'sess-danger',
        reason: 'dangerous_command',
      });
    } finally {
      reg.dispose();
    }
  });

  it('checkAstAndAnalyzer deny ⇒ warn 记录 reason=security_analyzer_deny', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    try {
      const tool = new BashTool(reg);
      // 强制安全分析器 deny（模拟本仓固定安全姿态：BashSecurityAnalyzer 拒绝管道/重定向等）
      const analyzer = (
        tool as unknown as { securityAnalyzer: BashSecurityAnalyzer }
      ).securityAnalyzer;
      const analyzeSpy = spyOn(analyzer, 'analyze').mockReturnValue({
        safe: false,
        behavior: 'deny',
        riskLevel: 'high',
        matchedPatterns: [],
      } as ReturnType<BashSecurityAnalyzer['analyze']>);
      try {
        warnSpy = spyOn(bashLogger, 'warn');
        const result = await tool.execute(
          { command: 'echo deny-mock' },
          makeContext('sess-deny')
        );
        expect(result.metadata?.reason).toBe('security_analyzer_deny');

        const calls = gateBlockCalls();
        expect(calls.length).toBe(1);
        expect(calls[0][1]).toMatchObject({
          sessionId: 'sess-deny',
          reason: 'security_analyzer_deny',
        });
      } finally {
        analyzeSpy.mockRestore();
      }
    } finally {
      reg.dispose();
    }
  });

  it('F1：deny 带原因 ⇒ 工具结果含 matchedRule / code，不再是「命令被阻止执行」', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    try {
      const tool = new BashTool(reg);
      const analyzer = (
        tool as unknown as { securityAnalyzer: BashSecurityAnalyzer }
      ).securityAnalyzer;
      const analyzeSpy = spyOn(analyzer, 'analyze').mockReturnValue({
        safe: false,
        behavior: 'deny',
        riskLevel: 'high',
        message: '复合命令被拒绝：重定向（>）',
        matchedPatterns: ['compound-readonly denied: 重定向（>）'],
      } as ReturnType<BashSecurityAnalyzer['analyze']>);
      try {
        const result = await tool.execute(
          { command: 'dir > out.txt' },
          makeContext('sess-deny-reason')
        );
        expect(result.success).toBe(false);
        expect(String(result.error ?? result.data)).toContain(
          '复合命令被拒绝：重定向'
        );
        expect(result.metadata?.matchedRule).toBe(
          'compound-readonly denied: 重定向（>）'
        );
        expect(result.metadata?.code).toBe('SECURITY_ANALYZER_DENY');
      } finally {
        analyzeSpy.mockRestore();
      }
    } finally {
      reg.dispose();
    }
  });

  it('负向对照：正常放行命令 ⇒ 零条 security_gate_blocked（不误报）', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    try {
      const tool = new BashTool(reg);
      warnSpy = spyOn(bashLogger, 'warn');
      const result = await tool.execute(
        { command: 'echo safe-gate-pass' },
        makeContext('sess-pass')
      );
      expect(result.success).toBe(true);
      expect(String(result.data ?? '')).toContain('safe-gate-pass');
      expect(gateBlockCalls().length).toBe(0);
    } finally {
      reg.dispose();
    }
  });
});
