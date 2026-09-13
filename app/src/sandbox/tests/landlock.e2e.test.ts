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
 * landlock e2e（方案 §七 验收标准 6，P2）
 *
 * - 平台无关部分：exit 125 归因契约单测（postmortem 0004），任意平台运行。
 * - 真实内核部分：仅 Linux 且 helper 就位时运行（`describe.skipIf`），
 *   覆盖 read/write/exec deny、rule 路径缺失 → exit 125。
 *
 * 运行方式（Linux）：
 *   LANDLOCK_RUN_BIN=/path/to/landlock-run bun test src/sandbox/tests/landlock.e2e.test.ts
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxConfigBuilder } from '../SandboxConfigBuilder';
import { LandlockPolicyBuilder, MAX_SUPPORTED_ABI } from '../landlock';
import {
  runWithLandlock,
  isSandboxInitFailure,
} from '../landlock/runWithLandlock';

// ==================== 平台无关：exit 125 归因契约（postmortem 0004） ====================
describe('exit 125 归因（postmortem 0004）', () => {
  test('仅 exit 125 判定为沙箱初始化失败', () => {
    expect(isSandboxInitFailure(125)).toBe(true);
    expect(isSandboxInitFailure(0)).toBe(false);
    expect(isSandboxInitFailure(1)).toBe(false);
    expect(isSandboxInitFailure(2)).toBe(false);
  });
});

// ==================== 真实内核 e2e（仅 Linux + helper 就位） ====================
const isLinux = process.platform === 'linux';
const helperPath = process.env.LANDLOCK_RUN_BIN;

describe.skipIf(!isLinux || !helperPath)('landlock e2e（真实内核）', () => {
  const workspace = join(tmpdir(), `landlock-e2e-${Date.now()}`);
  const helper = helperPath as string;

  beforeAll(async () => {
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'ok.txt'), 'hello');
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  /** 只授予工作区完整权限 + 系统只读路径（terminalTool 语义） */
  function workspacePolicy() {
    const perms = SandboxConfigBuilder.terminalTool(workspace);
    return LandlockPolicyBuilder.build(perms, {
      cwd: workspace,
      abi: MAX_SUPPORTED_ABI,
    });
  }

  test('工作区内读写允许（exit 0）', async () => {
    const result = await runWithLandlock(
      workspacePolicy(),
      `cat ${join(workspace, 'ok.txt')}`,
      { helperPath: helper, cwd: workspace }
    );
    expect(result.sandboxInitFailed).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  test('工作区外读取被内核拒绝（/etc/passwd → 非 0 退出，非 125）', async () => {
    const result = await runWithLandlock(workspacePolicy(), 'cat /etc/passwd', {
      helperPath: helper,
      cwd: workspace,
    });
    // 权限拒绝是命令失败（EACCES），不是沙箱初始化失败 —— 归因必须区分
    expect(result.sandboxInitFailed).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('denied');
  });

  test('rule 路径不存在 → exit 125（沙箱初始化失败）', async () => {
    const perms = SandboxConfigBuilder.terminalTool(workspace);
    perms.filesystem.push({
      path: join(workspace, 'nonexistent-dir'),
      permissions: ['read', 'write', 'execute'],
      recursive: true,
    });
    const policy = LandlockPolicyBuilder.build(perms, {
      cwd: workspace,
      abi: MAX_SUPPORTED_ABI,
    });
    const result = await runWithLandlock(policy, 'echo hi', {
      helperPath: helper,
      cwd: workspace,
    });
    // add_rule 打开不存在的路径失败 → helper fail-closed exit 125
    expect(result.sandboxInitFailed).toBe(true);
    expect(result.exitCode).toBe(125);
  });
});
