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
 * S1 题源筛选（T1）的离线验证：机械筛（纯函数）+ 合成仓库上的**双实测闭环**（零模型）。
 *
 * 机械筛只做"粗筛"，**不产出结论** —— 能否成题由真实执行判定（起点必红 / 修复必绿），
 * 这正是本轮要测的第二个部分。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  discoverFixCommits,
  parseFixCommitLog,
  screenFixCandidates,
  selectFixCandidates,
} from '../../src/evals/fixTaskScreening';

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

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'user.email=eval@local', '-c', 'user.name=eval', ...args],
    { cwd, windowsHide: true, encoding: 'utf-8' }
  );
  return String(stdout);
}

/** `git log --name-status` 的真实输出形态（含重命名、含 `|` 的 subject、只动源码的提交） */
const FIXTURE_LOG = [
  '===abc123|fix(tools): 修复甲',
  'M\tapp/src/a.ts',
  'A\tapp/tests/a.test.ts',
  '',
  '===def456|feat(x): 新功能（不该被选）',
  'M\tapp/src/b.ts',
  'A\tapp/tests/b.test.ts',
  '',
  '===ghi789|fix(chat)|subject 里也有竖线',
  'M\tapp/src/c.ts',
  'R100\tapp/tests/old.test.ts\tapp/tests/c.test.ts',
  '',
  '===jkl012|fix(ai): 只动源码（不该被选）',
  'M\tapp/src/d.ts',
  '',
  '===mno345|fix(db): 三个源码文件 + 一个测试',
  'M\tapp/src/e1.ts',
  'M\tapp/src/e2.ts',
  'M\tapp/src/e3.ts',
  'M\tapp/tests/e.test.ts',
  '',
].join('\n');

describe('S1 题源筛选：机械筛（纯函数）', () => {
  test('解析：subject 含 `|` 不串位；重命名取**新**路径；空行被忽略', () => {
    const commits = parseFixCommitLog(FIXTURE_LOG);
    expect(commits).toHaveLength(5);

    expect(commits[0].commit).toBe('abc123');
    expect(commits[0].subject).toBe('fix(tools): 修复甲');
    expect(commits[0].files).toEqual([
      { status: 'M', path: 'app/src/a.ts' },
      { status: 'A', path: 'app/tests/a.test.ts' },
    ]);

    // subject 里含竖线：只切第一处
    expect(commits[2].subject).toBe('fix(chat)|subject 里也有竖线');
    // 重命名：取新路径
    expect(commits[2].files).toEqual([
      { status: 'M', path: 'app/src/c.ts' },
      { status: 'R100', path: 'app/tests/c.test.ts' },
    ]);
  });

  test('筛选：只要 `fix` 类且**同时**有源码与测试；小改动优先', () => {
    const picked = selectFixCandidates(parseFixCommitLog(FIXTURE_LOG));

    // def456（feat）与 jkl012（无测试）被剔除
    expect(picked.map((c) => c.commit)).toEqual([
      'abc123',
      'ghi789',
      'mno345',
    ]);
    expect(picked[0]).toEqual({
      commit: 'abc123',
      subject: 'fix(tools): 修复甲',
      sourcePaths: ['app/src/a.ts'],
      testPaths: ['app/tests/a.test.ts'],
    });
    // 小改动优先：1+1 的两条排在 3+1 之前
    expect(picked[2].sourcePaths).toHaveLength(3);
  });

  test('筛选：`maxSourceFiles` 上限生效（防"大改动"混入）', () => {
    const picked = selectFixCandidates(parseFixCommitLog(FIXTURE_LOG), {
      maxSourceFiles: 1,
    });
    expect(picked.map((c) => c.commit)).toEqual(['abc123', 'ghi789']);
  });
});

describe('S1 题源筛选：合成仓库上的双实测闭环（零模型）', () => {
  /** commit1 = 坏实现；commit2 = `fix` 修好 + 新增测试 */
  async function makeFixRepo(): Promise<string> {
    const root = scratch('s1-screen-repo-');
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
    writeFileSync(
      join(root, 'app', 'src', 'impl.ts'),
      'export function answer(): number {\n  return 2;\n}\n',
      'utf-8'
    );
    writeFileSync(
      join(root, 'app', 'tests', 'impl.test.ts'),
      "import { test, expect } from 'bun:test';\n" +
        "import { answer } from '../src/impl';\n" +
        "test('answer', () => {\n  expect(answer()).toBe(2);\n});\n",
      'utf-8'
    );
    await git(root, 'add', '-A');
    await git(root, 'commit', '-q', '-m', 'fix(tools): 让它返回 2');
    return root;
  }

  test('发现 → 双实测：起点 red / 修复 green ⇒ 准入通过（真实跑 git/tar/bun）', async () => {
    const repo = await makeFixRepo();

    const candidates = selectFixCandidates(await discoverFixCommits(repo));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourcePaths).toEqual(['app/src/impl.ts']);
    expect(candidates[0].testPaths).toEqual(['app/tests/impl.test.ts']);

    const results = await screenFixCandidates(candidates, { repoRoot: repo });
    expect(results).toHaveLength(1);
    const r = results[0];

    expect(r.startVerdict).toBe('red');
    expect(r.fixedVerdict).toBe('green');
    expect(r.eligible).toBe(true);
    expect(r.snapshotFiles).toBeGreaterThan(0);
    // 合成仓库没有 node_modules ⇒ 依赖供给如实报告（不静默）
    expect(r.depsNote ?? '').toContain('不存在');
  }, 120_000);
});
