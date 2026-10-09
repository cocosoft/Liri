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

  it('规范化：引号外空白折叠；**大小写不再折叠**（第九轮审查 #3）', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('rm -rf /tmp/abc');
    reg.approve('session-1', hash);
    // ① 引号外空白差异 ⇒ 仍规范化等价（命中，零行为变更）
    expect(normalizeCommand('rm  -rf   /tmp/abc')).toBe(
      normalizeCommand('rm -rf /tmp/abc')
    );
    expect(reg.isApproved('session-1', hashCommand('rm  -rf   /tmp/abc'))).toBe(
      true
    );
    // ② 大小写差异 ⇒ **不再等价**（原实现 `RM`/`rm` 同 hash —— 第九轮审查 §十-3 缺陷 #3）
    expect(normalizeCommand('RM -RF /TMP/ABC')).not.toBe(
      normalizeCommand('rm -rf /tmp/abc')
    );
    expect(reg.isApproved('session-1', hashCommand('RM -RF /TMP/ABC'))).toBe(
      false
    );
    reg.dispose();
  });

  it('规范化：**引号内空白保留**（第九轮审查 #3：语义不同不得同 hash）', () => {
    // 引号内空白是语义：`echo "a  b"` 与 `echo "a b"` 是不同参数
    expect(normalizeCommand('echo "a  b"')).not.toBe(
      normalizeCommand('echo "a b"')
    );
    expect(hashCommand('echo "a  b"')).not.toBe(hashCommand('echo "a b"'));
  });

  it('命令实质变化不命中（防张冠李戴）', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('rm -rf /tmp/abc');
    reg.approve('session-1', hash);
    expect(reg.isApproved('session-1', hashCommand('rm -rf /tmp/def'))).toBe(
      false
    );
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
  it('提取首个 token（规范化后；第九轮审查 #3：**保留大小写**）', () => {
    // 原实现经 normalizeCommand 转小写 ⇒ 'DIR'→'dir'；第九轮 §十-3 修复后不再转小写
    expect(getBaseCommand('DIR   /b  X')).toBe('DIR');
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
    expect(reg.isCommandNameApproved('session-1', 'rm -rf /tmp/b')).toBe(false);
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

describe('A5 批准严格模式 BASH_APPROVAL_STRICT（2026-10-09，默认关）', () => {
  const KEY = 'FEATURE_BASH_APPROVAL_STRICT';
  const prev = process.env[KEY];
  afterEach(() => {
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
  });

  it('默认关：命令名级放行生效（既有行为不变）', () => {
    delete process.env[KEY];
    const reg = new ApprovedCommandRegistry(60_000, false);
    reg.approve('session-1', hashCommand('dir /b x'), 'dir /b x');
    expect(reg.isCommandNameApproved('session-1', 'dir /b y')).toBe(true);
    reg.dispose();
  });

  it('开关开：命令名级放行被禁用，仅精确 hash 命中', () => {
    process.env[KEY] = 'true';
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('dir /b x');
    reg.approve('session-1', hash, 'dir /b x');
    // 命令名级放行被门控 → 同名不同参不命中
    expect(reg.isCommandNameApproved('session-1', 'dir /b y')).toBe(false);
    // 精确 hash 仍放行
    expect(reg.isApproved('session-1', hash)).toBe(true);
    reg.dispose();
  });
});
