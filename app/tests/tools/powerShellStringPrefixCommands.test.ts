/**
 * P1-2④（2026-11-05）：PowerShell「标签字符串 + 命令」语句的白名单误杀。
 *
 * 真机证据（会话 `session_mvwkdol840f68a0ebe`，来自 19 条 `powershell:allowlist` 误拒）：
 * ```
 * "node: " + (Get-Command node -ErrorAction SilentlyContinue).Source; "bun: " + (Get-Command bun …)
 * ```
 * 旧实现遇引号开头即判「不是命令」⇒ 唯一真实命令 `Get-Command` 从未进入白名单校验，
 * 整条脚本又因「零动词」被拒，报文还是「命令「node: 」不在允许列表」——模型无从自纠。
 *
 * 锁定：只剥「引号字符串 + `+`」前缀；剥完照样按命令校验（安全面不缩小）。
 */
import { describe, expect, it } from 'bun:test';

import {
  explainPowerShellNotAllowed,
  isPowerShellCommandAllowed,
} from '../../src/tools/PowerShellTool/PowerShellTool.js';

describe('G4 前导标签字符串 + 命令', () => {
  it('"node: " + (Get-Command node).Source ⇒ 放行（真机原语句）', () => {
    const cmd =
      '"node: " + (Get-Command node -ErrorAction SilentlyContinue).Source; ' +
      '"bun: " + (Get-Command bun -ErrorAction SilentlyContinue).Source';
    expect(isPowerShellCommandAllowed(cmd)).toBe(true);
  });

  it('分隔线语句 "---" 夹在只读命令之间 ⇒ 不再整条拒绝', () => {
    const cmd =
      'Get-ChildItem "C:\\Users" -Directory | Select-Object FullName; "---"; ' +
      'Get-ChildItem "C:\\Users" -Directory | Select-Object -First 5 Name';
    expect(isPowerShellCommandAllowed(cmd)).toBe(true);
  });

  it('安全面不缩小："x" + (Remove-Item …) 仍然拒绝', () => {
    const cmd = '"x" + (Remove-Item -Recurse C:\\temp)';
    expect(isPowerShellCommandAllowed(cmd)).toBe(false);
  });

  it('安全面不缩小：字符串内的命令替换仍拒绝', () => {
    expect(
      isPowerShellCommandAllowed('"safe" + $(Remove-Item -Recurse C:\\temp)')
    ).toBe(false);
  });

  it('回归：G3 的格式化表达式仍放行（`-f` 分支不被本修复影响）', () => {
    expect(isPowerShellCommandAllowed("'{0} | {1}' -f $a,$b")).toBe(true);
  });

  it('回归：调用运算符 + 引号可执行文件仍按被调用程序判定', () => {
    expect(
      isPowerShellCommandAllowed(
        '& "C:\\Program Files\\nodejs\\node.exe" script.js'
      )
    ).toBe(true);
  });

  it('拒绝原因指向真实动词（不再是「node: 」这种标签名）', () => {
    const why = explainPowerShellNotAllowed(
      '"x" + (Remove-Item -Recurse C:\\temp)'
    );
    expect(why).not.toBeNull();
    expect(why!.reason).not.toContain('node:');
    expect(why!.reason.toLowerCase()).toContain('remove-item');
  });
});
