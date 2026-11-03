/**
 * G1-沙箱（2026-11-03，cwd 方案 §7.2）：`LocalWorkspace.execute` 的 **cwd 先验**
 *
 * 背景：`LocalWorkspace` 是 win32 / macOS / unknown 平台的默认沙箱适配器
 * （`WorkspaceManager.createAdapter`），其 `execute()` 走**宿主** `exec`。
 * 工作目录无效时 libuv 在 `chdir` 阶段失败，却把错误包装成
 * `ENOENT … uv_spawn 'cmd.exe'` ⇒ 被读成"可执行文件缺失"。
 *
 * 覆盖：
 * ① 显式 `options.cwd` 不存在 ⇒ 不 spawn，返回可操作错误；
 * ② `config.workingDirectory` 指向文件 ⇒ 拒绝（存在 ≠ 可作 cwd）；
 * ③ 有效目录 ⇒ 正常执行（零回归）。
 *
 * 刻意不覆盖：DockerWorkspace / SSHWorkspace —— 它们的 cwd 是**容器内 / 远端**路径，
 * 宿主上不存在属正常语义，加了判定会把正常调用误拒（CD07：关键模块改动须有明确边界）。
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalWorkspace } from '../../src/sandbox/adapters/LocalWorkspace';
import {
  SandboxPlatform,
  createDefaultSandboxConfig,
} from '../../src/sandbox/SandboxTypes';

function makeWorkspace(workingDirectory?: string): LocalWorkspace {
  return new LocalWorkspace(
    createDefaultSandboxConfig(SandboxPlatform.WINDOWS, {
      ...(workingDirectory ? { workingDirectory } : {}),
    })
  );
}

function missingDir(): string {
  return join(
    tmpdir(),
    `liri-sandbox-no-such-cwd-${Date.now()}-${Math.random()}`
  );
}

describe('G1-沙箱：LocalWorkspace.execute 的 cwd 先验', () => {
  it('显式 cwd 不存在 ⇒ 不 spawn，错误点名工作目录且不是可执行文件缺失', async () => {
    const workspace = makeWorkspace();
    const result = await workspace.execute('echo probe', {
      cwd: missingDir(),
    });

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('沙箱工作目录');
    expect(result.stderr).toContain('不是可执行文件缺失');
    expect(result.error).toContain('沙箱工作目录');
    expect(result.stdout).toBe('');
  });

  it('config.workingDirectory 是文件 ⇒ 拒绝（存在 ≠ 可作 cwd）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-sandbox-cwd-file-'));
    try {
      const filePath = join(dir, 'not-a-dir.txt');
      writeFileSync(filePath, 'x', 'utf8');
      const workspace = makeWorkspace(filePath);
      const result = await workspace.execute('echo probe');

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('不是目录');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('有效 cwd ⇒ 正常执行（零回归）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-sandbox-cwd-ok-'));
    try {
      const workspace = makeWorkspace(dir);
      const result = await workspace.execute('echo sandbox-cwd-ok');

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('sandbox-cwd-ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
