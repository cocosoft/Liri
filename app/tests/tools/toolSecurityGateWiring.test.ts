/**
 * 工具安全门接线回归（2026-10-19，会话导出排查）。
 *
 * 1. **信任级别透传**：`BashSecurityAnalyzer.analyze(command, trustLevel)` 的信任分级
 *    （development/work 下非危险命令不硬拒）在 `BashTool` 路径上此前恒为 `undefined`
 *    —— `checkAstAndAnalyzer` 只传了 `command` ⇒ 受信任工作区里的 `node --version`
 *    仍被 allowlist 硬拒。本用例钉住"信任级别必须透传到分析器"。
 * 2. **PowerShell allowlist 语句级判定**：原实现取整段脚本第一个 token 做前缀匹配
 *    ⇒ `$f='x'; (Get-Item $f).Length` 与 `(Get-Item x).Length` 被判"不在允许列表"。
 * 3. **`BashSecurityAnalyzer` 可独立导入**：`SecurityIntegration` 的模块级单例曾因
 *    构造期 `new BashSecurityAnalyzer()` 与叶子模块的初始化顺序冲突而抛
 *    `Cannot access 'BashSecurityAnalyzer' before initialization`（TDZ）。
 */
import { describe, expect, it } from 'bun:test';

import {
  checkAstAndAnalyzer,
  checkBashDangerousCommand,
} from '../../src/tools/bash/bashSecurityGate.js';
import {
  describePowerShellFailure,
  evaluatePowerShellSecurity,
  isPowerShellCommandAllowed,
} from '../../src/tools/PowerShellTool/PowerShellTool.js';
import { BashSecurityAnalyzer } from '../../src/security/BashSecurityAnalyzer.js';
import type { ApprovalScope, ApprovalSnapshot } from '@modules/permission';

const approvalScope: ApprovalScope = {
  platform: process.platform,
  cwd: process.cwd(),
  envDigest: '',
};

const approvalSnapshot: ApprovalSnapshot = {
  originalCommand: '',
  normalizedCommand: '',
  rewrites: [],
};

describe('checkAstAndAnalyzer：信任级别透传', () => {
  it('把 trustLevel 原样传给分析器', () => {
    const seen: Array<string | undefined> = [];

    const block = checkAstAndAnalyzer({
      command: 'node --version',
      bypassAsk: false,
      approvalScope,
      approvalSnapshot,
      trustLevel: 'development',
      analyzer: {
        analyze: (_command, trustLevel) => {
          seen.push(trustLevel);
          return { behavior: 'allow' };
        },
      },
    });

    expect(seen).toEqual(['development']);
    expect(block).toBeNull();
  });

  /**
   * LRO-D3（2026-10-26）：口径已变 —— 未受信时"未知命令"由 **deny 改 ask**，
   * 且解释器的**版本查询**（`node --version`）本身已进只读白名单。
   * 本用例改用真正"未知"的命令（`git add`）继续钉"信任级别透传"这一原意。
   */
  it('未知命令：未受信 ⇒ ask（可审批），development 信任 ⇒ allow', () => {
    const analyzer = new BashSecurityAnalyzer();

    expect(analyzer.analyze('git add -A').behavior).toBe('ask');
    expect(analyzer.analyze('git add -A', 'development').behavior).toBe(
      'allow'
    );
    // 版本查询在两种信任级别下都不再被拦
    expect(analyzer.analyze('node --version').behavior).not.toBe('deny');
    expect(analyzer.analyze('node --version', 'development').behavior).toBe(
      'allow'
    );
  });
});

describe('硬拦截结果必须带 error（BUG-8，2026-10-19）', () => {
  it('危险命令拦截 ⇒ error / success=false（不再被误记为成功）', () => {
    const block = checkBashDangerousCommand('rm -rf /tmp/x');
    expect(block).not.toBeNull();
    expect(block?.error).toBeTruthy();
    expect(block?.success).toBe(false);
    expect(block?.metadata?.['securityIntercepted']).toBe(true);
  });
});

describe('危险命令判据：token 边界匹配（预存台账批次 A #1）', () => {
  it.each([
    ['echo result', 'result 含 su'],
    ['git add .', 'add 含 dd'],
    ['npm run format-test', 'format-test 含 format'],
    ['node skill.js', 'skill.js 含 kill'],
  ])('正常命令不误伤：%s（%s）', (command) => {
    expect(checkBashDangerousCommand(command)).toBeNull();
  });

  it.each([
    ['sudo ls', 'sudo'],
    ['kill 1234', 'kill'],
    ['echo hi; kill 1', 'kill'],
    ['RM -RF /tmp/x', 'rm -rf'],
    ['dd if=/dev/zero of=/dev/sda', 'dd'],
  ])('危险命令仍拦截：%s', (command, expected) => {
    const block = checkBashDangerousCommand(command);
    expect(block).not.toBeNull();
    expect(block?.success).toBe(false);
    expect(String(block?.metadata?.['matchedCommand']).toLowerCase()).toContain(
      expected
    );
  });
});

describe('PowerShell allowlist：按语句动词判定', () => {
  it('允许带赋值前缀的只读脚本', () => {
    expect(isPowerShellCommandAllowed("$f='a.md'; (Get-Item $f).Length")).toBe(
      true
    );
  });

  it('允许括号包裹的只读表达式', () => {
    expect(isPowerShellCommandAllowed('(Get-Item a.md).Length')).toBe(true);
  });

  it('拒绝脚本中任意一条非白名单语句', () => {
    expect(isPowerShellCommandAllowed("$f='a.md'; Remove-Item $f")).toBe(false);
    expect(
      isPowerShellCommandAllowed('Get-Content a.md; Set-Content b.md x')
    ).toBe(false);
  });

  it('拒绝括号后的方法调用（fail-closed）', () => {
    expect(isPowerShellCommandAllowed('(Get-Item a.md).Delete()')).toBe(false);
  });

  it('纯赋值语句不构成可执行命令', () => {
    expect(isPowerShellCommandAllowed("$f='a.md'")).toBe(false);
  });

  // 2026-10-19 真机回归：`& node …` 的调用运算符此前使动词解析为 null ⇒
  // 整条脚本被误判"不在允许列表" ⇒ 连续 3 轮全失败触发 circuit_breaker。
  it('允许调用运算符 & + 白名单可执行（& node …）', () => {
    expect(
      isPowerShellCommandAllowed(
        "$s='E:\\src'; $out='C:\\out.txt'; & node 'C:\\script.js'"
      )
    ).toBe(true);
    expect(
      isPowerShellCommandAllowed('& "C:\\Program Files\\nodejs\\node.exe" x.js')
    ).toBe(true);
  });

  it('允许目录导航命令（每次调用新进程，无持久副作用）', () => {
    expect(isPowerShellCommandAllowed('cd C:\\tmp; Get-ChildItem')).toBe(true);
    expect(isPowerShellCommandAllowed('Set-Location C:\\tmp')).toBe(true);
  });

  it('拒绝 .ps1 脚本调用与静态方法调用（fail-closed）', () => {
    expect(isPowerShellCommandAllowed("& 'C:\\evil\\node.ps1'")).toBe(false);
    expect(
      isPowerShellCommandAllowed("$x = [System.IO.File]::Delete('a')")
    ).toBe(false);
  });

  // F4（2026-10-27）：拒绝报文必须指向**真实原因**，不能再拿首词背锅
  //（真机实测 83 次都写成「PowerShell 命令 "Select-String" 不在允许列表」）。
  // §12.4 方案 B（2026-10-27 安全评审）：只读字符串方法**放行**（真机 3 例
  // `$_.Line.Substring(…)` 全部因此失败），其余方法仍 fail-closed。
  it('§12.4-B：只读字符串方法放行（Substring/Trim/Split 链）', async () => {
    const { explainPowerShellNotAllowed } =
      await import('../../src/tools/PowerShellTool/PowerShellTool.js');
    const command =
      "$f='a.md'; Select-String -Path $f -Pattern x | % { $_.Line.Substring(0,260).Trim() }";
    expect(explainPowerShellNotAllowed(command)).toBeNull();
    expect(isPowerShellCommandAllowed(command)).toBe(true);
    expect(
      isPowerShellCommandAllowed("Get-Content a.md | % { $_.Split(',')[0] }")
    ).toBe(true);
  });

  it('§12.4-B：非白名单方法仍拒，且报文**点名**该方法', async () => {
    const { explainPowerShellNotAllowed } =
      await import('../../src/tools/PowerShellTool/PowerShellTool.js');
    const cases: Array<[string, string]> = [
      ['(Get-Item a.md).Delete()', 'delete'],
      ["Get-Item a.md | % { $_.MoveTo('b.md') }", 'moveto'],
      // 反射链：`GetType()` 不在白名单 ⇒ 整条拒绝（防 `GetMethod('Delete').Invoke(…)`）
      [
        "(Get-Item a.md).GetType().GetMethod('Delete').Invoke($null, $null)",
        'gettype',
      ],
    ];
    for (const [command, method] of cases) {
      const why = explainPowerShellNotAllowed(command);
      expect(why).not.toBeNull();
      expect(why!.reason).toContain('方法调用');
      expect(why!.reason.toLowerCase()).toContain(method);
      expect(isPowerShellCommandAllowed(command)).toBe(false);
    }
  });

  it('F4：动词不在白名单时，报文给出**命中的语句与动词**', async () => {
    const { explainPowerShellNotAllowed } =
      await import('../../src/tools/PowerShellTool/PowerShellTool.js');
    const why = explainPowerShellNotAllowed(
      'Get-Content a.md; Set-Content b.md x'
    );
    expect(why).not.toBeNull();
    expect(why!.verb).toBe('set-content');
    expect(why!.statement).toContain('Set-Content');
    expect(why!.reason).toContain('命令「set-content」不在允许列表');
  });

  it('真机失败脚本通过**完整**安全链（allowlist → analyzer → sandbox）', () => {
    const command =
      "$s='E:\\PY\\Documents\\CODES\\PY_APP\\app\\src'; " +
      "$out='C:\\Users\\csdnc\\Documents\\LiriProjects\\proj_1792339340147_ca7ac3\\01_work\\_ctx_out.txt'; " +
      "& node 'C:\\script.js'";
    expect(evaluatePowerShellSecurity(command).allowed).toBe(true);
  });
});

/**
 * F7b（2026-10-27）：失败报文可诊断性。
 *
 * 真机实测（Liri 报告 P2-1）：失败报文只剩 `pwsh … -EncodedCommand <base64>`，
 * 既看不到脚本也看不到 stderr。此前这段逻辑内联在 `execute` 的 catch 里，
 * **只能等真机失败才能看** ⇒ 抽成纯函数后由本组用例钉住格式。
 */
describe('F7b：PowerShell 失败报文（base64 → 脚本预览 + stderr 末 40 行）', () => {
  const encodedError =
    'Command failed: pwsh -NoProfile -ExecutionPolicy Bypass -EncodedCommand JABmAD0A';

  it('把 -EncodedCommand 的 base64 换成真实脚本预览', () => {
    const detail = describePowerShellFailure(encodedError, '$f = "a.md"');
    expect(detail).not.toContain('JABmAD0A');
    expect(detail).toContain('-Command "<脚本预览: $f = "a.md">"');
  });

  it('脚本预览压缩空白并截断 120 字', () => {
    const longCommand = `Get-Item\n\n   ${'x'.repeat(200)}`;
    const detail = describePowerShellFailure(encodedError, longCommand);
    const preview = detail.match(/-Command "<脚本预览: ([^"]*)>"/)![1];
    expect(preview).not.toContain('\n');
    expect(preview.length).toBe(120);
  });

  it('回填 stderr 末 40 行（60 行输入只留后 40 行）', () => {
    const stderr = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`).join(
      '\r\n'
    );
    const detail = describePowerShellFailure(encodedError, 'Get-Item x', {
      stderr,
    });
    const tail = detail.split('\n[stderr]\n')[1].split('\n');
    expect(tail).toHaveLength(40);
    expect(tail[0]).toBe('line-21');
    expect(tail[39]).toBe('line-60');
  });

  it('取不到 stderr 时不追加 [stderr] 段（不臆造）', () => {
    expect(
      describePowerShellFailure(encodedError, 'Get-Item x', {})
    ).not.toContain('[stderr]');
    expect(
      describePowerShellFailure(encodedError, 'Get-Item x', { stderr: '   ' })
    ).not.toContain('[stderr]');
  });

  it('报文不含 -EncodedCommand 时保留原文并追加 stderr', () => {
    const detail = describePowerShellFailure(
      'Command failed: 权限不足',
      'Get-Item x',
      {
        stderr: 'Access is denied.',
      }
    );
    expect(detail.startsWith('Command failed: 权限不足')).toBe(true);
    expect(detail).toContain('[stderr]\nAccess is denied.');
  });
});
