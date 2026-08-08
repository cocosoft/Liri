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
 * 工具执行审批链路 P2-3 — ApprovedCommandRegistry 单元测试
 *
 * 覆盖：
 * - approve/isApproved 命中
 * - session 隔离（跨会话不共享）
 * - hash 精确匹配（规范化后等价命令命中，实质变化不命中）
 * - TTL 过期（超时后不再放行）
 * - cleanup / clearSession / dispose
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  ApprovedCommandRegistry,
  normalizeCommand,
  hashCommand,
  hashCommandForExecution,
  getBaseCommand,
} from '../../src/permission/ApprovedCommandRegistry.js';

describe('ApprovedCommandRegistry 放行缓存', () => {
  afterEach(() => {
    // 手动实例不残留定时器
  });

  it('approve 后 isApproved 命中（TTL 内）', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('rm -rf /tmp/abc');
    reg.approve('session-1', hash);
    expect(reg.isApproved('session-1', hash)).toBe(true);
    reg.dispose();
  });

  it('未批准的命令 hash 不命中', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const approved = hashCommand('rm -rf /tmp/abc');
    const other = hashCommand('rm -rf /tmp/other');
    reg.approve('session-1', approved);
    expect(reg.isApproved('session-1', other)).toBe(false);
    reg.dispose();
  });

  it('session 隔离：跨会话不共享放行', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('rm -rf /tmp/abc');
    reg.approve('session-A', hash);
    expect(reg.isApproved('session-A', hash)).toBe(true);
    expect(reg.isApproved('session-B', hash)).toBe(false);
    reg.dispose();
  });

  it('规范化等价命令命中（空白/大小写差异）', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('rm -rf /tmp/abc');
    reg.approve('session-1', hash);
    // 额外空白 + 大小写差异 → 规范化后相同（引号保留，统一为双引号）
    expect(normalizeCommand('RM -RF   /TMP/ABC')).toBe(
      normalizeCommand('rm -rf /tmp/abc')
    );
    expect(hashCommand('RM -RF   /TMP/ABC')).toBe(hash);
    expect(reg.isApproved('session-1', hashCommand('RM -RF   /TMP/ABC'))).toBe(
      true
    );
    reg.dispose();
  });

  it('命令实质变化不命中（防张冠李戴）', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('rm -rf /tmp/abc');
    reg.approve('session-1', hash);
    expect(
      reg.isApproved('session-1', hashCommand('rm -rf /tmp/def'))
    ).toBe(false);
    reg.dispose();
  });

  it('TTL 过期后不再放行', async () => {
    const reg = new ApprovedCommandRegistry(20, false); // 20ms TTL
    const hash = hashCommand('rm -rf /tmp/abc');
    reg.approve('session-1', hash);
    expect(reg.isApproved('session-1', hash)).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    expect(reg.isApproved('session-1', hash)).toBe(false);
    reg.dispose();
  });

  it('cleanup 清除过期条目，clearSession 清空会话', () => {
    const reg = new ApprovedCommandRegistry(20, false);
    const hash = hashCommand('rm -rf /tmp/abc');
    reg.approve('session-1', hash);
    reg.approve('session-2', hash);
    reg.clearSession('session-1');
    expect(reg.isApproved('session-1', hash)).toBe(false);
    expect(reg.isApproved('session-2', hash)).toBe(true);
    reg.dispose();
  });
});

describe('hashCommandForExecution（P0-2 执行级统一 hash）', () => {
  it('无路径转换命令：与 hashCommand 一致（平台无关）', () => {
    expect(hashCommandForExecution('echo format-test')).toBe(
      hashCommand('echo format-test')
    );
    expect(hashCommandForExecution('net user %username%')).toBe(
      hashCommand('net user %username%')
    );
  });

  it('Windows：原始 /tmp 命令与 BashTool 预处理后命令 hash 一致', () => {
    // BashTool 预处理会把 /tmp 翻译为 %TEMP%；两端都用 hashCommandForExecution
    // 应命中同一 hash（提交端原始命令 vs 执行端预处理命令）。
    if (process.platform !== 'win32') return; // 仅 Windows 有路径转换
    const raw = hashCommandForExecution('rm -rf /tmp/abc');
    const preprocessed = hashCommandForExecution('rm -rf %TEMP%/abc');
    expect(raw).toBe(preprocessed);
  });

  it('Windows：/dev/null 与 NUL 等价', () => {
    if (process.platform !== 'win32') return;
    expect(hashCommandForExecution('echo hi > /dev/null')).toBe(
      hashCommandForExecution('echo hi > NUL')
    );
  });
});

describe('getBaseCommand（P0-3 命令名提取）', () => {
  it('提取首个 token（规范化后）', () => {
    expect(getBaseCommand('DIR   /b  X')).toBe('dir');
    expect(getBaseCommand('  net user %username% ')).toBe('net');
    expect(getBaseCommand('')).toBe('');
  });
});

describe('命令名级放行 isCommandNameApproved（P0-3）', () => {
  it('批准非危险命令 → 同命令名参数漂移放行', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('dir /b x');
    reg.approve('session-1', hash, 'dir /b x');
    // 精确 hash miss（参数不同），命令名级命中
    expect(reg.isApproved('session-1', hashCommand('dir /b y'))).toBe(false);
    expect(reg.isCommandNameApproved('session-1', 'dir /b y')).toBe(true);
    reg.dispose();
  });

  it('危险命令名（rm）不允许命令名级放行，仅精确 hash', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('rm -rf /tmp/a');
    reg.approve('session-1', hash, 'rm -rf /tmp/a');
    // 同命令名不同参数 → 精确 miss + 命令名级被门控 → 不放行
    expect(reg.isApproved('session-1', hashCommand('rm -rf /tmp/b'))).toBe(
      false
    );
    expect(reg.isCommandNameApproved('session-1', 'rm -rf /tmp/b')).toBe(
      false
    );
    // 精确同 hash → 放行
    expect(reg.isApproved('session-1', hash)).toBe(true);
    reg.dispose();
  });

  it('命令名级放行 session 隔离', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    reg.approve('session-A', hashCommand('dir'), 'dir');
    expect(reg.isCommandNameApproved('session-A', 'dir /b')).toBe(true);
    expect(reg.isCommandNameApproved('session-B', 'dir /b')).toBe(false);
    reg.dispose();
  });

  it('未携带 command 的批准记录不启用命令名级放行', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    reg.approve('session-1', hashCommand('dir'));
    expect(reg.isCommandNameApproved('session-1', 'dir /b')).toBe(false);
    reg.dispose();
  });

  it('命令名级放行 TTL 过期后失效', async () => {
    const reg = new ApprovedCommandRegistry(20, false);
    reg.approve('session-1', hashCommand('dir'), 'dir');
    expect(reg.isCommandNameApproved('session-1', 'dir')).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    expect(reg.isCommandNameApproved('session-1', 'dir')).toBe(false);
    reg.dispose();
  });
});
