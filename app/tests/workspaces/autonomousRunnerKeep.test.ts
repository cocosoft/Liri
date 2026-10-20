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
 * 2026-10-20：`runAutonomousTask` 的**未回灌即保留**口径回归。
 *
 * 修复前：snapshot-copy 的 `publish` 返回占位串（`applied=false`），成功路径仍
 * `dispose(keep:false)` ⇒ 含成果的隔离目录被删掉。本文件锁定三条分支：
 * ① 占位 diff ⇒ 保留（keep=true）并在结果里给出 `keptIsolation` / `isolationPath`；
 * ② 真实 diff ⇒ 回灌成功，正常清理（keep=false）；
 * ③ publish 抛错 ⇒ 保留（keep=true），error 前缀 `apply-back failed`。
 */
import { describe, expect, it } from 'bun:test';

import { runAutonomousTask } from '../../src/workspaces/AutonomousRunner';
import type { WorkspaceProvider } from '../../src/workspaces/provider/WorkspaceProvider';

const ISOLATED_CWD = '/tmp/iso-run-1';

interface FakeOptions {
  /** publish 行为（缺省返回占位串，等价 snapshot-copy 无 diff 平台） */
  publish?: () => Promise<{ diff?: string }>;
}

function makeProvider(options: FakeOptions = {}): {
  provider: WorkspaceProvider;
  disposeCalls: Array<{ keep: boolean }>;
} {
  const disposeCalls: Array<{ keep: boolean }> = [];

  const provider: WorkspaceProvider = {
    id: 'snapshot-copy',
    priority: 2,
    isApplicable: async () => true,
    prepare: async (input) => ({
      runId: input.runId,
      projectKey: input.projectRoot,
      strategy: 'snapshot-copy',
      cwd: ISOLATED_CWD,
      metadata: {},
    }),
    publish:
      options.publish ??
      (async () => ({ diff: `snapshot at ${ISOLATED_CWD}` })),
    dispose: async (_handle, disposeOptions) => {
      disposeCalls.push({ keep: disposeOptions.keep });
    },
  };

  return { provider, disposeCalls };
}

describe('runAutonomousTask · 未回灌即保留隔离区', () => {
  it('占位 diff（snapshot-copy）⇒ applied=false 且保留隔离区', async () => {
    const { provider, disposeCalls } = makeProvider();
    const result = await runAutonomousTask({
      projectRoot: '/repo',
      runId: 'run-1',
      providers: [provider],
      execute: async (ctx) => {
        expect(ctx.cwd).toBe(ISOLATED_CWD);
      },
    });

    expect(result.applied).toBe(false);
    expect(result.keptIsolation).toBe(true);
    expect(result.isolationPath).toBe(ISOLATED_CWD);
    expect(disposeCalls).toEqual([{ keep: true }]);
  });

  it('真实 diff（回灌成功）⇒ 正常清理隔离区', async () => {
    const { provider, disposeCalls } = makeProvider({
      publish: async () => ({
        diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n',
      }),
    });
    const result = await runAutonomousTask({
      projectRoot: '/repo',
      runId: 'run-2',
      providers: [provider],
      execute: async () => {},
    });

    expect(result.applied).toBe(true);
    expect(result.keptIsolation).toBeUndefined();
    expect(result.isolationPath).toBeUndefined();
    expect(disposeCalls).toEqual([{ keep: false }]);
  });

  it('publish 抛错 ⇒ 保留隔离区并记 apply-back failed', async () => {
    const { provider, disposeCalls } = makeProvider({
      publish: async () => {
        throw new Error('patch failed');
      },
    });
    const result = await runAutonomousTask({
      projectRoot: '/repo',
      runId: 'run-3',
      providers: [provider],
      execute: async () => {},
    });

    expect(result.applied).toBe(false);
    expect(result.error).toContain('apply-back failed');
    expect(result.keptIsolation).toBe(true);
    expect(result.isolationPath).toBe(ISOLATED_CWD);
    expect(disposeCalls).toEqual([{ keep: true }]);
  });
});
