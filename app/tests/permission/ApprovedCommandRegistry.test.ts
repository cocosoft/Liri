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
  hashEnvForApproval,
  computeScopeDigest,
  getBaseCommand,
  commandApprovalSignature,
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

  // B3（2026-10-30，issue #37）：审批签名收紧 —— 子命令 / 高危选项 / 目标路径
  it('B3：批准 `git status` 不覆盖 `git push --force`（指纹不同）', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    reg.approve('session-1', hashCommand('git status'), 'git status');
    expect(reg.isCommandNameApproved('session-1', 'git status')).toBe(true);
    expect(reg.isCommandNameApproved('session-1', 'git push --force')).toBe(
      false
    );
    expect(reg.isCommandNameApproved('session-1', 'git push')).toBe(false);
    reg.dispose();
  });

  it('B3：命令签名包含高危选项与目标路径（任一不同即重批）', () => {
    expect(commandApprovalSignature('git status')).not.toBe(
      commandApprovalSignature('git push --force')
    );
    expect(commandApprovalSignature('cat a/x.txt')).not.toBe(
      commandApprovalSignature('cat b/x.txt')
    );
    // 只读命令的"同名放行"语义保持不变（dir 不是子命令型 CLI）
    expect(commandApprovalSignature('dir /b x')).toBe(
      commandApprovalSignature('dir /b y')
    );
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

/**
 * S1-1（2026-10-11）：审批身份绑定升级
 * - 哈希改 SHA-256（替代 djb2 32 位）
 * - 作用域绑定（cwd / 调用方 env 摘要 / 平台）：作用域不一致 ⇒ 不复用批准（fail-closed）
 * - 审批快照 + 能力摘要预留字段
 */
describe('S1-1 哈希强度与作用域绑定', () => {
  it('hashCommand 为 SHA-256 前 128 bit（32 位十六进制），且不同命令不同', () => {
    const h = hashCommand('rm -rf /tmp/abc');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(hashCommand('rm -rf /tmp/abc')).toBe(h); // 确定性
    expect(hashCommand('rm -rf /tmp/abd')).not.toBe(h);
  });

  it('hashEnvForApproval：键序无关且稳定；空 env ⇒ undefined', () => {
    const a = hashEnvForApproval({ PATH: '/usr/bin', LANG: 'C' });
    const b = hashEnvForApproval({ LANG: 'C', PATH: '/usr/bin' });
    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(hashEnvForApproval({ PATH: '/usr/bin:evil' })).not.toBe(a);
    expect(hashEnvForApproval({})).toBeUndefined();
    expect(hashEnvForApproval(undefined)).toBeUndefined();
  });

  it('computeScopeDigest：同字段同摘要；字段变化即变化；空作用域 ⇒ undefined', () => {
    const s1 = { platform: 'win32', cwd: 'C:\\projA' };
    expect(computeScopeDigest(s1)).toBe(computeScopeDigest({ ...s1 }));
    expect(computeScopeDigest(s1)).not.toBe(
      computeScopeDigest({ ...s1, cwd: 'C:\\projB' })
    );
    expect(computeScopeDigest({})).toBeUndefined();
    expect(computeScopeDigest(undefined)).toBeUndefined();
  });

  it('作用域不一致 ⇒ 不复用批准（fail-closed）；一致 ⇒ 命中', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('echo scope-test');
    const scopeA = { platform: process.platform, cwd: 'C:\\projA' };
    reg.approve('session-1', hash, 'echo scope-test', { scope: scopeA });

    expect(reg.isApproved('session-1', hash, scopeA)).toBe(true);
    expect(
      reg.isApproved('session-1', hash, {
        platform: process.platform,
        cwd: 'C:\\projB',
      })
    ).toBe(false);
    // env 摘要不同 ⇒ 不命中
    expect(
      reg.isApproved('session-1', hash, { ...scopeA, envDigest: 'deadbeef' })
    ).toBe(false);
    reg.dispose();
  });

  it('记录未绑定作用域时，带 scope 查询 ⇒ 不命中（fail-closed）；不带 scope ⇒ 既有语义', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('echo legacy');
    reg.approve('session-1', hash, 'echo legacy'); // 旧路径：无作用域
    expect(
      reg.isApproved('session-1', hash, {
        platform: process.platform,
        cwd: 'C:\\projA',
      })
    ).toBe(false);
    expect(reg.isApproved('session-1', hash)).toBe(true);
    reg.dispose();
  });

  it('审批快照与能力摘要（预留）随批准记录落库', () => {
    const reg = new ApprovedCommandRegistry(60_000, false);
    const hash = hashCommand('echo /tmp/x');
    reg.approve('session-1', hash, 'echo /tmp/x', {
      scope: { platform: process.platform },
      capabilityDigest: 'process.execute|filesystem.write',
      snapshot: {
        originalCommand: 'echo /tmp/x',
        normalizedCommand: 'echo /tmp/x',
        rewrites: ['/tmp → %TEMP%'],
      },
    });
    const entry = reg.getApprovalEntry('session-1', hash);
    expect(entry?.capabilityDigest).toBe('process.execute|filesystem.write');
    expect(entry?.snapshot?.originalCommand).toBe('echo /tmp/x');
    expect(entry?.snapshot?.rewrites).toEqual(['/tmp → %TEMP%']);
    expect(entry?.scopeDigest).toBeDefined();
    reg.dispose();
  });
});
