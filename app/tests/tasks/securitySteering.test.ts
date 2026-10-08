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
 * 「安全拦截 ⇒ 注入 steering 令其改道」的纯函数守卫（2026-10-08）。
 *
 * 背景：真机实测执行器有时用 shell（`mkdir` 等）做文件操作，被安全策略硬拒
 * （`security_analyzer_deny` / `COMMAND_NOT_ALLOWED`）⇒ 该轮无副作用 ⇒ 步骤 failed。
 * 处置：**不中断**当前步，只注入一条改道指令，令模型下一轮改用专用工具。
 *
 * 本守卫锁三件事：① 拦截判定**只认显式标记**（不做错误文案匹配，CS02）；
 * ② 文案满足 `TAORLoop.injectSteering` 的**硬约束**（长度 <2000、不含 `system:` /
 * `<|im_start|>`、不自带 `[STEERING]` 前缀——前缀由骨架片段渲染给出）；③ 上限常量存在。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildSecuritySteeringMessage,
  isSecurityIntercepted,
  MAX_SECURITY_STEERS_PER_STEP,
} from '../../src/tasks/LongRunningTaskOrchestrator';

describe('isSecurityIntercepted：只认显式标记，不做文案匹配', () => {
  it('metadata.securityIntercepted === true ⇒ true（各拦截分支的统一标记）', () => {
    expect(
      isSecurityIntercepted({
        success: false,
        error: '安全检查: PowerShell 命令 "if" 不在允许列表中',
        metadata: {
          securityIntercepted: true,
          errorCode: 'COMMAND_NOT_ALLOWED',
        },
      })
    ).toBe(true);
  });

  it('无标记 / 显式 false / 非对象 ⇒ false（普通失败不得被误判为拦截）', () => {
    expect(
      isSecurityIntercepted({ success: false, error: 'Command failed: dir x' })
    ).toBe(false);
    expect(
      isSecurityIntercepted({ metadata: { securityIntercepted: false } })
    ).toBe(false);
    expect(isSecurityIntercepted(null)).toBe(false);
    expect(isSecurityIntercepted(undefined)).toBe(false);
    expect(isSecurityIntercepted('安全检查失败')).toBe(false);
  });
});

describe('buildSecuritySteeringMessage：改道文案', () => {
  it('点名被拦工具（去重）+ 指向专用工具 + 写后读回', () => {
    const msg = buildSecuritySteeringMessage(['bash', 'bash', 'powershell']);
    expect(msg).toContain('bash');
    expect(msg).toContain('powershell');
    for (const tool of [
      'file_write',
      'file_read',
      'file_edit',
      'glob',
      'grep',
    ]) {
      expect(msg).toContain(tool);
    }
    expect(msg).toContain('读回');
    // 重复工具名去重（文案里只出现一次括号列表）
    expect(buildSecuritySteeringMessage(['bash', 'bash'])).toContain(
      '（bash）'
    );
  });

  it('满足 TAORLoop.injectSteering 过滤器的硬约束', () => {
    const msg = buildSecuritySteeringMessage(['bash']);
    expect(msg.length).toBeLessThan(2000);
    expect(/system:\s*/i.test(msg)).toBe(false);
    expect(msg).not.toContain('<|im_start|>');
    // 前缀由骨架的 steering 片段渲染给出 ⇒ 此处不得手写（避免双轨）
    expect(msg).not.toContain('[STEERING]');
  });

  it('每步注入上限为有限正数（防 runaway）', () => {
    expect(Number.isInteger(MAX_SECURITY_STEERS_PER_STEP)).toBe(true);
    expect(MAX_SECURITY_STEERS_PER_STEP).toBeGreaterThan(0);
  });
});
