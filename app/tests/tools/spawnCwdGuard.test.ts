/**
 * G1（2026-11-03）：其余 spawn 执行链的 **cwd 先验**
 *
 * 背景：`dev_docs/20261103/工具cwd无效根因与修复方案-20261103.md` §7.2。BashTool / PowerShellTool
 * 已在 spawn 前判定 cwd；但 `LocalBashTask`（长程任务）、`CliRunner`（子 agent CLI）、
 * `LSPClient`（LSP server）、`REPLToolImpl` 仍直接 `spawn(…, { cwd })` ⇒ 同一无效目录会被
 * libuv 报成 `ENOENT … uv_spawn '<shell>'`（"可执行文件缺失"），把排查方向带偏。
 *
 * 本文件 pin 住：**单一判定实现**（`describeUnusableSpawnCwd`）+ 三条链的拒绝形态。
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeUnusableSpawnCwd } from '@openliri/infra/utils/cwd';
import { CliRunner } from '../../src/agent/cli-runner/index';
import { createLSPClient } from '../../src/lsp/LSPClient';
import { REPLToolImpl } from '../../src/tools/repl/REPLToolImpl';

function missingDir(): string {
  return join(tmpdir(), `liri-no-such-cwd-${Date.now()}-${Math.random()}`);
}

describe('G1：describeUnusableSpawnCwd（spawn 前单一判定）', () => {
  it('未显式指定 cwd ⇒ 不判（由平台默认接管）', () => {
    expect(describeUnusableSpawnCwd(undefined)).toBeNull();
    expect(describeUnusableSpawnCwd('')).toBeNull();
  });

  it('目录不存在 ⇒ 报"不存在"并明确不是可执行文件缺失', () => {
    const message = describeUnusableSpawnCwd(missingDir(), '测试工作目录');
    expect(message).not.toBeNull();
    expect(message!).toContain('测试工作目录');
    expect(message!).toContain('不是可执行文件缺失');
  });

  it('路径存在但是文件 ⇒ 报"不是目录"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-cwd-file-'));
    try {
      const filePath = join(dir, 'not-a-dir.txt');
      writeFileSync(filePath, 'x', 'utf8');
      const message = describeUnusableSpawnCwd(filePath, '测试工作目录');
      expect(message).not.toBeNull();
      expect(message!).toContain('不是目录');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('有效目录 ⇒ null（零回归）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-cwd-ok-'));
    try {
      expect(describeUnusableSpawnCwd(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('G1：各 spawn 链的拒绝形态', () => {
  it('CliRunner.execute ⇒ exitCode=-1，stderr 点名工作目录（不 spawn）', async () => {
    const runner = new CliRunner();
    const result = await runner.execute('echo hi', { cwd: missingDir() });
    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('子进程工作目录');
    expect(result.stderr).toContain('不是可执行文件缺失');
  });

  it('LSPClient.start ⇒ 在 spawn 前 reject 可操作错误', async () => {
    const client = createLSPClient('guard-test');
    await expect(
      client.start('bun', ['--version'], { cwd: missingDir() })
    ).rejects.toThrow(/LSP 工作目录/);
  });

  it('REPLToolImpl.startREPL ⇒ 在 spawn 前抛出可操作错误', async () => {
    const tool = new REPLToolImpl();
    await expect(
      tool.startREPL('python', { cwd: missingDir(), timeout: 3000 })
    ).rejects.toThrow(/REPL 工作目录/);
  });
});
