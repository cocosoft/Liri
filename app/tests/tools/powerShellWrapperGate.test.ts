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
 * G-07（2026-10-19）：`powershell/pwsh -Command "…"` 内层脚本安全判定。
 *
 * 契约：
 * - 内层脚本与**直接执行**（`evaluatePowerShellSecurity`）判定一致；
 * - `-EncodedCommand` / 空脚本等无法静态检查的形态 ⇒ fail-closed；
 * - 未包裹或在**普通位置**出现（如 `echo powershell …`）⇒ 不误报。
 */
import { describe, expect, test } from 'bun:test';
import {
  checkPowerShellWrapper,
  inspectPowerShellWrapper,
} from '../../src/tools/bash/powerShellWrapper';
import { evaluatePowerShellSecurity } from '../../src/tools/PowerShellTool/PowerShellTool';

describe('inspectPowerShellWrapper：识别与解包', () => {
  test('双引号 / 单引号 / pwsh 短别名', () => {
    expect(
      inspectPowerShellWrapper('powershell -Command "Get-ChildItem ."').scripts
    ).toEqual(['Get-ChildItem .']);
    expect(
      inspectPowerShellWrapper("pwsh -c 'Get-ChildItem .'").scripts
    ).toEqual(['Get-ChildItem .']);
    expect(
      inspectPowerShellWrapper(
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem ."'
      ).scripts
    ).toEqual(['Get-ChildItem .']);
  });

  test('链式命令中每个语句位置的调用都被解包', () => {
    const r = inspectPowerShellWrapper(
      'echo ok && powershell -Command "Get-ChildItem ." ; pwsh -c "Get-Process"'
    );
    expect(r.matched).toBe(true);
    expect(r.scripts).toEqual(['Get-ChildItem .', 'Get-Process']);
  });

  test('`-EncodedCommand` ⇒ opaque（不可静态检查）', () => {
    const r = inspectPowerShellWrapper('powershell -EncodedCommand AAAA');
    expect(r.matched).toBe(true);
    expect(r.opaque).toBe(true);
  });

  test('普通命令 / 非语句位置出现 ⇒ 不命中（不误报）', () => {
    expect(inspectPowerShellWrapper('echo hello').matched).toBe(false);
    expect(
      inspectPowerShellWrapper('echo powershell -Command "x"').matched
    ).toBe(false);
  });
});

describe('checkPowerShellWrapper：内层串与直接执行判定一致（G-07）', () => {
  test('只读命令：包裹与直判都放行', () => {
    const inner = 'Get-Process';
    expect(evaluatePowerShellSecurity(inner).allowed).toBe(true);
    expect(checkPowerShellWrapper(`powershell -Command "${inner}"`)).toBeNull();
  });

  test('递归删除：直判为 ask ⇒ 包裹同样拦截（requireApproval）', () => {
    const inner = 'Remove-Item -Recurse -Force C:\\temp\\build';
    const direct = evaluatePowerShellSecurity(inner);
    expect(direct.allowed).toBe(false);
    expect(direct.behavior).toBe('ask');

    const blocked = checkPowerShellWrapper(`powershell -Command "${inner}"`);
    expect(blocked).not.toBeNull();
    expect(blocked?.requireApproval).toBe(true);
  });

  test('iex：直判为 deny ⇒ 包裹同样拒绝', () => {
    const inner = "Invoke-Expression 'calc'";
    expect(evaluatePowerShellSecurity(inner).behavior).toBe('deny');

    const blocked = checkPowerShellWrapper(`powershell -Command "${inner}"`);
    expect(blocked).not.toBeNull();
    expect(blocked?.requireApproval).not.toBe(true);
    expect(blocked?.metadata?.['securityIntercepted']).toBe(true);
  });

  test('白名单外动词（无 analyzer 命中）：直判 deny ⇒ 包裹同样拒绝', () => {
    const inner = 'Stop-Service Spooler';
    const direct = evaluatePowerShellSecurity(inner);
    expect(direct.allowed).toBe(false);
    expect(direct.code).toBe('COMMAND_NOT_ALLOWED');

    expect(
      checkPowerShellWrapper(`powershell -Command "${inner}"`)
    ).not.toBeNull();
  });

  test('`-EncodedCommand` ⇒ fail-closed', () => {
    const blocked = checkPowerShellWrapper('powershell -EncodedCommand AAAA');
    expect(blocked).not.toBeNull();
    expect(blocked?.metadata?.['reason']).toBe('powershell_wrapper_opaque');
  });

  test('未包裹 ⇒ 本门不介入（null）', () => {
    expect(checkPowerShellWrapper('echo hello')).toBeNull();
  });
});
