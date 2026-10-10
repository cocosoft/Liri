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
 * 专项 A #7 —— **跨层安全回归测试**（2026-10-10，第九轮审查 §八 / §九）。
 *
 * 审查原文要求：*"验证 Rust AST、TypeScript 分析、Guardrail、审批和实际 spawn 的最终决策一致"*。
 *
 * 这补齐的是此前**唯一未做**的专项 A 任务：既有测试是**单层/缺陷级**的
 * （`bashAstHardening` 覆盖原生↔降级↔env；`bashLandlockExec` 覆盖门控↔argv；
 * `BashToolApproval` 覆盖审批↔放行），**没有**把"分析 → 拦截 → 审批 → 执行"整条链
 * 串起来断言**最终决策与各层判据一致**。
 *
 * 本文件三组：
 *  ① **两台原生桥哨兵一致性**（`BashAST` + `BashSecurityAnalyzer`）：加载状态必须
 *     "**要么真加载、要么明确标降级**"，不得两者皆假（`BashSecurityAnalyzer` 的哨兵
 *     缺陷即在此被发现：`=== undefined` 判定 + `null` 初始化 ⇒ 恒假 + 谎报未降级）。
 *  ② **诚实性契约**：`getNativeStatus().degraded` 必须与真实加载状态一致（不得谎报）。
 *  ③ **最终决策一致性矩阵**：对危险/良性命令，BashTool 的最终决策（拦截 / 需审批 /
 *     执行）必须与独立计算的四层判据（AST / analyzer / sandbox checker / danger list）
 *     **单调一致** —— 任一层报危险 ⇒ 绝不静默放行；全部层清白 ⇒ 不误伤。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { BashTool } from '../../src/tools/bash/BashTool.js';
import {
  ApprovedCommandRegistry,
  hashCommand,
} from '../../src/permission/ApprovedCommandRegistry.js';
import {
  BashSecurityAnalyzer,
  getBashAnalyzerStats,
  resetBashAnalyzerForTest,
} from '../../src/security/BashSecurityAnalyzer.js';
import {
  parseForSecurity,
  isDangerousCommand,
  getBashAstStats,
  resetBashAstForTest,
} from '../../src/security/bash/BashAST.js';
import { SandboxSecurityChecker } from '../../src/sandbox/SandboxSecurityChecker.js';
import type { ToolUseContext } from '../../src/tools/types/Tool.js';

/** 最小可用的 ToolUseContext（BashTool.execute 仅用到 sessionId） */
function makeContext(sessionId: string): ToolUseContext {
  return {
    sessionId,
    options: {} as ToolUseContext['options'],
    abortController: new AbortController(),
    readFileState: {},
  } as unknown as ToolUseContext;
}

const registries: ApprovedCommandRegistry[] = [];
afterEach(() => {
  for (const reg of registries.splice(0)) reg.dispose();
});

function newTool(): BashTool {
  const reg = new ApprovedCommandRegistry(60_000, false);
  registries.push(reg);
  return new BashTool(reg);
}

/** 独立计算的四层判据（不经过 BashTool） */
function layerVerdicts(command: string): {
  astKind: 'simple' | 'too-complex' | 'parse-unavailable';
  astDangerous: boolean;
  analyzerBehavior: string;
  sandboxAllowed: boolean;
} {
  const ast = parseForSecurity(command);
  const analyzer = new BashSecurityAnalyzer();
  const sandbox = new SandboxSecurityChecker().checkDangerousCommands(command);
  return {
    astKind: ast.kind,
    astDangerous:
      ast.kind === 'simple' &&
      ast.commands.some((c) => isDangerousCommand(c.argv)),
    analyzerBehavior: analyzer.analyze(command).behavior,
    sandboxAllowed: sandbox.allowed,
  };
}

/** 运行 BashTool 后的最终决策（是否真的执行了命令） */
async function finalDecision(
  command: string
): Promise<{ executed: boolean; intercepted: boolean; approval: boolean }> {
  const tool = newTool();
  const r = await tool.execute({ command }, makeContext(`s-${command}`));
  const intercepted = r.metadata?.securityIntercepted === true;
  const approval = r.metadata?.requireApproval === true;
  const executed = r.success === true && !intercepted && !approval;
  return { executed, intercepted, approval };
}

// ─────────────────────────────────────────────────────────────
// ① 两台原生桥哨兵一致性
// ─────────────────────────────────────────────────────────────

describe('专项 A #7-① 原生桥哨兵一致性（BashAST + BashSecurityAnalyzer）', () => {
  it('BashSecurityAnalyzer 哨兵修正：`analyze()` 后加载状态必居其一（不再恒假短路）', () => {
    resetBashAnalyzerForTest();
    new BashSecurityAnalyzer().analyze('ls -la');
    const s = getBashAnalyzerStats();
    // 修正前：`null` 初始化 + `=== undefined` 判定 ⇒ 条件恒假 ⇒
    //   nativeLoaded=false **且** nativeLoadFailed=false（从未尝试加载）。
    // 修正后：要么加载成功（nativeLoaded），要么明确失败（nativeLoadFailed）。
    expect(s.nativeLoaded || s.nativeLoadFailed).toBe(true);
  });

  it('BashSecurityAnalyzer 加载/降级至少一侧被记账（可观测）', () => {
    resetBashAnalyzerForTest();
    new BashSecurityAnalyzer().analyze('ls -la');
    const s = getBashAnalyzerStats();
    expect(s.nativeCallCount + s.tsFallbackCount).toBeGreaterThan(0);
  });

  it('两台桥契约同形：BashAST 与 BashSecurityAnalyzer 均满足"加载或失败"', () => {
    resetBashAstForTest();
    resetBashAnalyzerForTest();
    parseForSecurity('ls -la');
    new BashSecurityAnalyzer().analyze('ls -la');
    const ast = getBashAstStats();
    const an = getBashAnalyzerStats();
    expect(ast.nativeLoaded || ast.nativeLoadFailed).toBe(true);
    expect(an.nativeLoaded || an.nativeLoadFailed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// ② 诚实性契约：降级状态不得谎报
// ─────────────────────────────────────────────────────────────

describe('专项 A #7-② 降级状态诚实性（getNativeStatus 不得谎报）', () => {
  it('`degraded` 必须与真实加载状态一致；`degraded` 为真时 reason 必非空', () => {
    resetBashAnalyzerForTest();
    const analyzer = new BashSecurityAnalyzer();
    analyzer.analyze('ls -la');
    const status = analyzer.getNativeStatus();
    const stats = getBashAnalyzerStats();

    // 未加载 ⇒ 必须自报降级（修正前：nativeLoaded=false 却 degraded=false ⇒ 谎报）
    expect(status.degraded).toBe(!stats.nativeLoaded);
    // 自洽：降级 ⟺ 有原因；未降级 ⟺ 无原因
    expect(status.degraded).toBe(status.reason !== null);
  });
});

// ─────────────────────────────────────────────────────────────
// ③ 最终决策一致性矩阵
// ─────────────────────────────────────────────────────────────

/** 危险命令：**导出的分析/沙箱层**（analyzer / sandbox checker / AST）应能识别 */
const DANGEROUS = ['rm -rf /', 'sudo apt install x', 'chmod 777 /etc/passwd'];

/**
 * 危险命令：仅由 **BashTool 内建危险列表**（私有，`DANGEROUS_COMMANDS`）识别。
 * 这是**纵深防御的额外一层** —— analyzer/sandbox 合法地不报 `format`，但工具仍须拦截。
 */
const DANGEROUS_LIST_ONLY = ['echo format-test'];

/** 良性命令：各层清白，最终应**真实执行**（防"恒拒"假绿） */
const BENIGN = ['echo layer-consistent-ok', 'echo hello-layer'];

describe('专项 A #7-③ 最终决策一致性：危险命令绝不静默放行', () => {
  for (const command of DANGEROUS) {
    it(`\`${command}\` ⇒ 最终不执行，且至少一层独立判据报警`, async () => {
      const v = layerVerdicts(command);
      const d = await finalDecision(command);

      // 至少一层独立判据报警（证明"报警的层"与"工具最终决策"指向一致）
      const anyLayerFlags =
        !v.sandboxAllowed ||
        v.analyzerBehavior !== 'allow' ||
        v.astDangerous ||
        v.astKind !== 'simple';
      expect(anyLayerFlags).toBe(true);

      // 最终决策绝不静默放行
      expect(d.executed).toBe(false);
      expect(d.intercepted || d.approval).toBe(true);
    });
  }

  for (const command of DANGEROUS_LIST_ONLY) {
    it(`\`${command}\` ⇒ 由工具内建危险列表拦截（纵深防御层）`, async () => {
      const d = await finalDecision(command);
      expect(d.executed).toBe(false);
      expect(d.intercepted || d.approval).toBe(true);
    });
  }
});

describe('专项 A #7-③ 最终决策一致性：良性命令不误伤', () => {
  for (const command of BENIGN) {
    it(`\`${command}\` ⇒ 各层清白且真实执行`, async () => {
      const v = layerVerdicts(command);
      // 各层清白
      expect(v.astKind).toBe('simple');
      expect(v.astDangerous).toBe(false);
      expect(v.sandboxAllowed).toBe(true);
      expect(v.analyzerBehavior).toBe('allow');

      // 最终执行（无拦截 / 无审批）
      const d = await finalDecision(command);
      expect(d.executed).toBe(true);
    });
  }
});

describe('专项 A #7-③ 一致性不变量：执行 ⇒ 各层均无报警（单调）', () => {
  for (const command of [...DANGEROUS, ...BENIGN]) {
    it(`\`${command}\`：executed ⇒ 全部层清白（不允许"某层报危险却仍执行"）`, async () => {
      const v = layerVerdicts(command);
      const d = await finalDecision(command);
      if (d.executed) {
        expect(v.astKind).toBe('simple');
        expect(v.astDangerous).toBe(false);
        expect(v.analyzerBehavior).toBe('allow');
        expect(v.sandboxAllowed).toBe(true);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────
// 附：审批层与最终决策一致（已批准 ≠ 免硬拦截，A2 基线）
// ─────────────────────────────────────────────────────────────

describe('专项 A #7-附 审批层与最终决策一致（A2 基线）', () => {
  it('已批准的安全命令：审批放行 + 各层清白 ⇒ 执行', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    registries.push(reg);
    reg.approve('s-approved', hashCommand('echo approved-layer-ok'));
    const tool = new BashTool(reg);
    const r = await tool.execute(
      { command: 'echo approved-layer-ok' },
      makeContext('s-approved')
    );
    expect(r.metadata?.securityIntercepted).not.toBe(true);
    expect(r.success).toBe(true);
  });

  it('已批准的危险命令：A2 复检仍须过硬拦截（审批 != 免拦截）', async () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    registries.push(reg);
    reg.approve('s-approved-danger', hashCommand('echo format-test'));
    const tool = new BashTool(reg);
    const r = await tool.execute(
      { command: 'echo format-test' },
      makeContext('s-approved-danger')
    );
    expect(r.metadata?.securityIntercepted).toBe(true);
    expect(r.success).not.toBe(true);
  });
});
