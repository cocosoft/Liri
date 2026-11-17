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
 * auto 档只读短路的**缺口回归**（2026-11-17，真机会话 `session_mwk2fakzf30b34b448`）。
 *
 * 实证（19 张审批卡）：`type` 未收录进 `AUTO_MODE_READONLY_COMMANDS`（Windows 的 `cat` 等价物）
 * ⇒ 单条 `type x` 与 `cd /d X && type y` 全部落「未知命令 ⇒ ask」（10 张）；
 * `Get-CimInstance` / `Get-PSDrive` 等纯查询 cmdlet 同样未收录（2 张）。
 *
 * 本文件双向钉住口径：
 *  ① 结构可判定的只读形态必须**不再 ask**（缺口已补）；
 *  ② `for` / `if` 控制流、`$env:` 变量展开、危险命令仍**必须 ask / deny**（防"顺手全放开"）。
 *
 * 判据走与生产同一入口：`checkReadonlyCommand`（`handleAuto` §2.5 短路）+ `AutoModeClassifier`。
 */
import { describe, expect, it } from 'bun:test';

import { AutoModeClassifier } from '../../../packages/infra/src/permission/classifiers/AutoModeClassifier';
import { checkReadonlyCommand } from '../../../packages/infra/src/permission/classifiers/readonly-command-allowlist';

const classifier = new AutoModeClassifier();

async function decide(command: string): Promise<{
  ask: boolean;
  block: boolean;
  reason?: string;
}> {
  const d = await classifier.classify('bash', { command }, []);
  return {
    ask: d.requiresApproval === true,
    block: d.shouldBlock,
    reason: d.reason,
  };
}

describe('auto 只读短路：type / 复合只读链不再弹审批', () => {
  const allowedCommands = [
    'type package.json',
    'type "C:\\Users\\csdnc\\Documents\\LiriProjects\\proj_1794883425921_5a056c\\.workspace.json"',
    'type "%USERPROFILE%\\.pyapp\\settings.json"',
    'type E:\\PY\\Documents\\CODES\\PY_APP\\app\\package.json',
    'cd /d E:\\PY\\Documents\\CODES\\PY_APP\\app && type package.json',
    'cd /d E:\\PY\\Documents\\CODES\\PY_APP && dir /b && echo ---- && type package.json',
    'cd /d "C:\\Users\\csdnc\\Documents\\LiriProjects\\proj_1794882283567_c3eaad" && dir output & echo ---- & type .workspace.json',
    'dir /b /ad "C:\\x" & echo ==== & type "C:\\x\\.workspace.json" 2>nul',
    'Get-PSDrive -PSProvider FileSystem',
    'Get-CimInstance Win32_Process -Filter "Name like \'%node%\'" | Select-Object ProcessId,Name',
  ];

  for (const command of allowedCommands) {
    it(`放行：${command.slice(0, 60)}`, async () => {
      const d = await decide(command);
      expect(d.block).toBe(false);
      expect(d.ask).toBe(false);
    });
  }

  it('checkReadonlyCommand：type 判结构只读（复合链由分类器按段判定）', () => {
    expect(checkReadonlyCommand('type package.json').allowed).toBe(true);
    expect(
      checkReadonlyCommand('type "%USERPROFILE%\\.pyapp\\settings.json"')
        .allowed
    ).toBe(true);
    // 单一命令判据本身不拆复合（`handleAuto` 的复合放行在分类器内按段判定，见上方用例）
    expect(
      checkReadonlyCommand(
        'cd /d E:\\PY\\Documents\\CODES\\PY_APP && type package.json'
      ).allowed
    ).toBe(false);
  });
});

describe('auto 只读短路：安全边界不回退（这些仍须 ask / deny）', () => {
  const stillAsk = [
    // 批处理控制流：段级只读判定无法覆盖（结构上不是简单命令）
    'for %f in (output\\*.md) do @echo %~nxf %~zf bytes',
    'for /d %d in (packages\\*) do @(echo === %d & dir /b %d\\src 2>nul | findstr /v node_modules)',
    'if exist "E:\\PY\\Documents\\CODES\\PY_APP" (echo EXISTS) else (echo MISSING)',
    // 变量展开：会让"字面只读"变成"任意路径只读"（白名单不可静态审计）
    'Get-ChildItem -Path $env:USERPROFILE -Directory | Select-Object -ExpandProperty FullName',
    // 外层包装器 + 复合前缀：段级判定只看外层首词，仍转人工
    'cd /d E:\\PY\\Documents\\CODES\\PY_APP && powershell -NoProfile -Command "Get-Content app\\package.json -TotalCount 60"',
    // 未收录命令：仍走"未知 ⇒ ask"
    'some-unknown-cli --do-something',
  ];

  for (const command of stillAsk) {
    it(`仍须审批：${command.slice(0, 60)}`, async () => {
      const d = await decide(command);
      expect(d.ask).toBe(true);
      expect(d.block).toBe(false);
    });
  }

  it('危险命令仍为 deny（不放宽）', async () => {
    expect((await decide('rm -rf /')).block).toBe(true);
    expect(checkReadonlyCommand('rm -rf /').allowed).toBe(false);
  });
});
