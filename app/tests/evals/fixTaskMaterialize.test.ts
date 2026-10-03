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
 * S1 物化（T5 第一步）的离线验证：**合成仓库**上跑 `setup` → `assert` 闭环（零模型）。
 *
 * 覆盖三条硬约束：净化快照（无 `.git`）、起始态必失败、**判据不可篡改**（重放测试文件）。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { buildFixTask } from '../../src/evals/fixTaskMaterialize';
import {
  discoverFixCommits,
  selectFixCandidates,
} from '../../src/evals/fixTaskScreening';
import type { EvalContext, EvalTask } from '../../src/evals/types';

const execFileAsync = promisify(execFile);
const scratchRoots: string[] = [];

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchRoots) rmSync(dir, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync(
    'git',
    ['-c', 'user.email=eval@local', '-c', 'user.name=eval', ...args],
    { cwd, windowsHide: true, encoding: 'utf-8' }
  );
}

const FIXED_IMPL = 'export function answer(): number {\n  return 2;\n}\n';
const TEST_FILE =
  "import { test, expect } from 'bun:test';\n" +
  "import { answer } from '../src/impl';\n" +
  "test('answer', () => {\n  expect(answer()).toBe(2);\n});\n";

/** commit1 = 坏实现；commit2 = `fix` 修好 + 新增测试 */
async function makeFixRepo(): Promise<string> {
  const root = scratch('s1-mat-repo-');
  mkdirSync(join(root, 'app', 'src'), { recursive: true });
  mkdirSync(join(root, 'app', 'tests'), { recursive: true });
  await git(root, 'init', '-q');
  writeFileSync(
    join(root, 'app', 'src', 'impl.ts'),
    'export function answer(): number {\n  return 1;\n}\n',
    'utf-8'
  );
  await git(root, 'add', '-A');
  await git(root, 'commit', '-q', '-m', 'broken');
  writeFileSync(join(root, 'app', 'src', 'impl.ts'), FIXED_IMPL, 'utf-8');
  writeFileSync(join(root, 'app', 'tests', 'impl.test.ts'), TEST_FILE, 'utf-8');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-q', '-m', 'fix(tools): 让它返回 2');
  return root;
}

function ctxFor(workspace: string): EvalContext {
  return {
    workspace,
    home: join(workspace, 'home'),
    dataDir: join(workspace, 'data'),
    finalText: '',
    toolCalls: [],
    sessionId: 's1-materialize-test',
    model: 'n/a',
  };
}

async function buildTaskFromSyntheticRepo(): Promise<{
  task: EvalTask;
  repo: string;
  workspace: string;
}> {
  const repo = await makeFixRepo();
  const [candidate] = selectFixCandidates(await discoverFixCommits(repo));
  const task = buildFixTask(candidate, repo);
  const workspace = scratch('s1-mat-ws-');
  await task.setup?.({
    workspace,
    home: join(workspace, 'home'),
    dataDir: join(workspace, 'data'),
  });
  return { task, repo, workspace };
}

describe('S1 物化：setup/assert 闭环（合成仓库，零模型）', () => {
  test('净化快照 + 屏蔽真实仓库 + 起始态必失败 + 修复后通过', async () => {
    const { task, repo, workspace } = await buildTaskFromSyntheticRepo();

    // 屏蔽目标是**真实仓库整根**（答案是它的当前状态 + `.git` 历史）
    expect(task.shieldedPaths).toEqual([repo]);
    expect(task.id.startsWith('fix-')).toBe(true);

    const repoDir = join(workspace, 'repo');
    // 快照已净化：无 `.git`；测试文件已就位（判据）
    expect(existsSync(join(repoDir, '.git'))).toBe(false);
    expect(existsSync(join(repoDir, 'app', 'tests', 'impl.test.ts'))).toBe(
      true
    );

    const ctx = ctxFor(workspace);
    expect((await task.assert(ctx)).pass).toBe(false); // 起点必红

    // 模拟被测者完成修复
    writeFileSync(join(repoDir, 'app', 'src', 'impl.ts'), FIXED_IMPL, 'utf-8');
    expect((await task.assert(ctx)).pass).toBe(true); // 修复 ⇒ 绿
  }, 120_000);

  test('判据不可篡改：把测试改成恒通过并不修源码 ⇒ 仍判失败（assert 重放原始测试）', async () => {
    const { task, workspace } = await buildTaskFromSyntheticRepo();
    const repoDir = join(workspace, 'repo');

    // 被测者"作弊"：把测试改成空测试（恒通过），源码不动
    writeFileSync(
      join(repoDir, 'app', 'tests', 'impl.test.ts'),
      "import { test } from 'bun:test';\ntest('nothing', () => {});\n",
      'utf-8'
    );

    const result = await task.assert(ctxFor(workspace));
    expect(result.pass).toBe(false);
  }, 120_000);
});
