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
 * 第九轮审查「专项 A」安全加固回归测试（2026-10-09）
 *
 * 覆盖缺陷：
 * - **#1** `BashAST.lazyInitNative` 哨兵判断失效（原生解析器从未加载）
 * - **#2** TS 降级解析器 `||` 分割缺口（`safe || rm -rf /` 绕过危险命令检测）
 * - **#5** 子进程 env 合并顺序（调用方 env 覆盖已剥离项）
 *
 * 依据：`dev_docs/20261009/openai 建议.md` §十 / §八。
 */

import { describe, expect, it } from 'bun:test';
import {
  parseForSecurity,
  isDangerousCommand,
  getBashAstStats,
  resetBashAstForTest,
  type SimpleCommand,
} from '../../src/security/bash/BashAST.js';
import {
  isSensitiveEnvKey,
  isExecutionControlEnvKey,
  sanitizeCallerEnv,
} from '../../src/security/sensitiveEnv.js';

function commandsOf(command: string): SimpleCommand[] {
  const r = parseForSecurity(command);
  if (r.kind !== 'simple') {
    throw new Error(`expected simple, got ${r.kind} (${command})`);
  }
  return r.commands;
}

describe('#1 原生解析器懒加载（哨兵修正）', () => {
  it('parseForSecurity 会**真的尝试**加载原生（不再恒 null 短路）', () => {
    resetBashAstForTest();
    parseForSecurity('ls -la');
    const s = getBashAstStats();
    // 修正前：哨兵 `=== undefined` 恒假 ⇒ nativeLoaded=false 且 nativeLoadFailed=false（从未尝试）
    // 修正后：两条路径必居其一 —— 加载成功（nativeLoaded）或明确失败（nativeLoadFailed）
    expect(s.nativeLoaded || s.nativeLoadFailed).toBe(true);
  });

  it('原生加载状态可观测（nativeCallCount / tsFallbackCount 至少一侧被记账）', () => {
    resetBashAstForTest();
    parseForSecurity('ls -la');
    const s = getBashAstStats();
    expect(s.nativeCallCount + s.tsFallbackCount).toBeGreaterThan(0);
  });
});

describe('#2 TS 降级解析器 Shell 语法（`||` 缺口）', () => {
  it('`||` 现被分割：危险命令不再被 argv[0] 掩盖', () => {
    const cmds = commandsOf('echo safe || rm -rf /');
    expect(cmds.length).toBe(2);
    expect(cmds.some((c) => isDangerousCommand(c.argv))).toBe(true);
  });

  it('`|` 管道仍正确分割', () => {
    const cmds = commandsOf('cat a.txt | grep x');
    expect(cmds.length).toBe(2);
  });

  it('`&&` 仍正确分割且能识别链中危险命令', () => {
    const cmds = commandsOf('true && rm -rf /tmp/x');
    expect(cmds.some((c) => isDangerousCommand(c.argv))).toBe(true);
  });

  it('引号内的 `||` 不被当作分隔符', () => {
    const cmds = commandsOf('echo "a || b"');
    expect(cmds.length).toBe(1);
  });
});

describe('#5 调用方 env 清理（执行控制键 + 敏感键）', () => {
  it('执行控制键被识别（大小写不敏感）', () => {
    expect(isExecutionControlEnvKey('PATH')).toBe(true);
    expect(isExecutionControlEnvKey('node_options')).toBe(true);
    expect(isExecutionControlEnvKey('LD_PRELOAD')).toBe(true);
    expect(isExecutionControlEnvKey('FOO')).toBe(false);
  });

  it('调用方 env 不得覆盖受保护键；普通键保留', () => {
    const r = sanitizeCallerEnv({
      PATH: '/evil',
      NODE_OPTIONS: '--require /evil.js',
      PYTHONPATH: '/evil',
      MY_SECRET: 's',
      MY_API_KEY: 'k',
      FOO: 'bar',
    });
    expect(r.env).toEqual({ FOO: 'bar' });
    expect(r.stripped.sort()).toEqual(
      ['MY_API_KEY', 'MY_SECRET', 'NODE_OPTIONS', 'PATH', 'PYTHONPATH'].sort()
    );
  });

  it('敏感键识别与父进程剥离同一口径', () => {
    expect(isSensitiveEnvKey('AWS_SECRET_ACCESS_KEY')).toBe(true);
    expect(isSensitiveEnvKey('GITHUB_TOKEN')).toBe(true);
    expect(isSensitiveEnvKey('FOO')).toBe(false);
  });
});
