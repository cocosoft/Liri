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
 * 沙箱安全检查器（`SandboxSecurityChecker`）—— **R2 执行能力矩阵**之「权限不足 ⇒ 明确拒绝，不静默放行」行。
 *
 * 背景：该组件由 `BashTool` / `PowerShellTool` 消费（命令**事前**黑名单），此前**无任何测试**
 * （`grep SandboxSecurityChecker` 在 `tests/` 零命中）。
 *
 * 覆盖：危险命令（token 边界，含**不误伤**回归）/ 路径遍历 / 敏感路径 / 命令注入 / 零宽 /
 * 空字节 / zsh equals / 环境变量污染 / 工作目录白名单；并含**正常命令通过**（防"恒拒"假绿）。
 */
import { describe, it, expect } from 'bun:test';
import { SandboxSecurityChecker } from '../../src/sandbox/SandboxSecurityChecker';
import {
  createDefaultSandboxConfig,
  createSandboxExecuteOptions,
  SandboxPlatform,
} from '../../src/sandbox/SandboxTypes';

const checker = new SandboxSecurityChecker();

/** 无白名单（工作目录不受限） */
const cfgOpen = createDefaultSandboxConfig(SandboxPlatform.LINUX);
/** 工作目录白名单 = /repo */
const cfgScoped = createDefaultSandboxConfig(SandboxPlatform.LINUX, {
  filesystemWhitelist: ['/repo'],
});

describe('R2 矩阵行「权限不足 ⇒ 明确拒绝」：危险命令（token 边界）', () => {
  it('危险命令（单 token，如 rm）⇒ 明确拒绝', () => {
    const r = checker.checkDangerousCommands('rm -rf /');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('危险');
    expect(r.matchedPattern).toBe('rm');
  });

  it('权限提升（sudo）⇒ 明确拒绝', () => {
    expect(checker.checkDangerousCommands('sudo apt install x').allowed).toBe(
      false
    );
  });

  it('【防回退】不误伤含危险词子串的正常命令（"transcripts"/"dir" 不应被 "ri"/"rd" 命中）', () => {
    // 旧实现用 includes() ⇒ 'transcripts' 含 'ri'、'dir' 含 'rd' 会被误拒。
    expect(checker.checkDangerousCommands('transcripts list').allowed).toBe(
      true
    );
    expect(checker.checkDangerousCommands('dir /w').allowed).toBe(true);
  });
});

describe('R2 矩阵行「权限不足 ⇒ 明确拒绝」：其余拦截面', () => {
  it('路径遍历（../）⇒ 拒绝', () => {
    expect(checker.checkPathTraversal('cat ../../etc/passwd').allowed).toBe(
      false
    );
  });

  it('敏感路径（/etc/passwd）⇒ 拒绝', () => {
    expect(checker.checkSensitivePaths('cat /etc/passwd').allowed).toBe(false);
  });

  it('命令注入（管道）⇒ 拒绝', () => {
    expect(checker.checkCommandInjection('echo hi | bash').allowed).toBe(false);
  });

  it('Unicode 零宽字符 ⇒ 拒绝', () => {
    expect(checker.checkZeroWidthCharacters('ls\u200B').allowed).toBe(false);
  });

  it('空字节注入 ⇒ 拒绝', () => {
    expect(checker.checkNullByteInjection('ls\u0000').allowed).toBe(false);
  });

  it('Zsh equals expansion（=rm）⇒ 拒绝', () => {
    expect(checker.checkZshEqualsExpansion('=rm x').allowed).toBe(false);
  });

  it('环境变量污染（LD_PRELOAD）⇒ 拒绝', () => {
    expect(checker.checkEnvironmentPollution({ LD_PRELOAD: 'x' }).allowed).toBe(
      false
    );
  });

  it('工作目录白名单：范围外 ⇒ 拒绝；范围内 ⇒ 通过', () => {
    expect(
      checker.checkWorkingDirectory('/other/place', cfgScoped).allowed
    ).toBe(false);
    expect(checker.checkWorkingDirectory('/repo/sub', cfgScoped).allowed).toBe(
      true
    );
  });
});

describe('R2 矩阵行「权限不足 ⇒ 明确拒绝」：全链路 check 的"明确拒绝 + 正常放行"', () => {
  it('危险命令（全链路）⇒ 明确拒绝（非静默）', () => {
    const r = checker.check(
      createSandboxExecuteOptions(['rm', '-rf', '/'], { cwd: '/repo' }),
      cfgScoped
    );
    expect(r.allowed).toBe(false);
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it('【防"恒拒"假绿】正常命令 ⇒ 通过', () => {
    const r = checker.check(
      createSandboxExecuteOptions(['ls', '-la'], {
        cwd: '/repo/sub',
        env: {},
      }),
      cfgScoped
    );
    expect(r.allowed).toBe(true);
  });

  it('无白名单时工作目录不受限（既有语义，非缺陷）', () => {
    expect(checker.checkWorkingDirectory('/anywhere', cfgOpen).allowed).toBe(
      true
    );
  });
});
