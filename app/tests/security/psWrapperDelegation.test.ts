/**
 * FIX-15（2026-10-27）：bash 里**单条** `powershell|pwsh -Command "…"` 的两道闸结论必须一致。
 *
 * 真机现场（会话 `session_mvq91mtme1e76c5808`，10:13:59Z / 10:14:03Z）：
 *   `powershell -Command "Get-ChildItem C:\ -Directory … | Select-Object …"`
 *   → G-07 的 PowerShell 安全链判 **allow**（`evaluatePowerShellSecurity` 实测 allowed=true）
 *   → 紧接着 `BashSecurityAnalyzer` 用 bash 只读族复判整串，`powershell` 不在只读族 ⇒ **deny**
 *   同一语义的命令走 `powershell` 工具可执行、走 `bash` 被硬拒。
 *
 * 修法：仅当整条命令**只有**这一条语句时，把结论委托给 PowerShell 链；多段形态保持原 deny。
 */
import { describe, expect, it } from 'bun:test';

import { BashSecurityAnalyzer } from '../../src/security/BashSecurityAnalyzer.js';
import { checkAstAndAnalyzer } from '../../src/tools/bash/bashSecurityGate.js';
import { isSinglePowerShellWrapperCommand } from '../../src/tools/bash/powerShellWrapper.js';
import type { ApprovalScope, ApprovalSnapshot } from '@modules/permission';

const SINGLE =
  'powershell -Command "Get-ChildItem C:\\ -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name"';

const approvalScope: ApprovalScope = {
  platform: process.platform,
  cwd: process.cwd(),
  envDigest: '',
};

const approvalSnapshot: ApprovalSnapshot = {
  originalCommand: SINGLE,
  normalizedCommand: SINGLE,
  rewrites: [],
};

describe('isSinglePowerShellWrapperCommand', () => {
  it('单条包裹（内层管道在引号内）⇒ true', () => {
    expect(isSinglePowerShellWrapperCommand(SINGLE)).toBe(true);
    expect(
      isSinglePowerShellWrapperCommand(
        `pwsh -c "Get-ChildItem . | Select-Object -First 3"`
      )
    ).toBe(true);
  });

  it('语句外还有串联段 ⇒ false（兄弟段未经验证，不得顺带放行）', () => {
    expect(
      isSinglePowerShellWrapperCommand(
        `powershell -Command "Get-ChildItem ." && del /f important.txt`
      )
    ).toBe(false);
    expect(
      isSinglePowerShellWrapperCommand(`powershell -Command "1"; whoami`)
    ).toBe(false);
  });

  it('非 PowerShell 包裹 ⇒ false', () => {
    expect(isSinglePowerShellWrapperCommand('dir /b')).toBe(false);
    expect(
      isSinglePowerShellWrapperCommand('echo powershell -Command "x"')
    ).toBe(false);
  });
});

describe('BashSecurityAnalyzer.analyze：委托选项', () => {
  it('不授权委托 ⇒ 维持原 deny（回归保护）', () => {
    const r = new BashSecurityAnalyzer().analyze(SINGLE);
    expect(r.behavior).toBe('deny');
  });

  it('授权委托 ⇒ allow（内层脚本已由 PowerShell 链判定）', () => {
    const r = new BashSecurityAnalyzer().analyze(SINGLE, undefined, {
      delegatedSinglePowerShell: true,
    });
    expect(r.behavior).toBe('allow');
    expect(r.matchedPatterns).toContain('powershell-wrapper-delegated');
  });
});

describe('checkAstAndAnalyzer：单条 PS 包裹放行、多段仍拦', () => {
  const base = {
    bypassAsk: true,
    approvalScope,
    approvalSnapshot,
    analyzer: new BashSecurityAnalyzer(),
  };

  it('单条且已委托 ⇒ 不拦', () => {
    expect(
      checkAstAndAnalyzer({
        ...base,
        command: SINGLE,
        delegatedSinglePowerShell: true,
      })
    ).toBeNull();
  });

  it('未委托（多段形态的调用方口径）⇒ 仍拦', () => {
    const blocked = checkAstAndAnalyzer({
      ...base,
      command: `powershell -Command "Get-ChildItem ." && del /f important.txt`,
      delegatedSinglePowerShell: false,
    });
    expect(blocked).not.toBeNull();
  });
});
