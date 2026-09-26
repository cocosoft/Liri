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
 * S1（真实修复类题源）**快照 + 判据**的离线验证（合成 git 仓库，零模型调用）。
 *
 * 覆盖 spec `eval-task-source-expansion.md` §4.1/§4.5 的三条硬约束：
 *  ① 快照必须**无 `.git`**（否则 `git show` 直接给答案）；
 *  ② 起始态必须**真红**（JUnit 有 `failures`）、修复态必须**绿**；
 *  ③ **"跑不起来"（缺模块/语法错）必须判 `unrunnable` 并拒绝准入** —— 这是 2026-09-26 实测到的
 *     真实故障形态（历史树可能 import 当时未入库的文件），若只看退出码就会把坏题静默放行。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  createRepoSapshot,
  overlayFromCommit,
  removeRepoSapshot,
  supplyDeps,
} from '../../src/evals/repoSnapshot';
import {
  classifyRepoTestRun,
  judgeS1Eligibility,
  parseJunitSummary,
  runRepoTest,
} from '../../src/evals/repoTestJudge';

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

/** 合成仓库里的 git 调用（显式注入身份，避免依赖全局 git config） */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'user.email=eval@local', '-c', 'user.name=eval', ...args],
    { cwd, windowsHide: true, encoding: 'utf-8' }
  );
  return String(stdout);
}

const FIXED_IMPL = 'export function answer(): number {\n  return 2;\n}\n';
const TEST_FILE =
  "import { test, expect } from 'bun:test';\n" +
  "import { answer } from '../src/impl';\n" +
  "test('answer', () => {\n  expect(answer()).toBe(2);\n});\n";

/**
 * 合成一个最小 git 仓库：`broken` 提交（坏实现）→ `fix` 提交（修好 + 新增测试）。
 * ⇒ 快照 = `HEAD^` 树 + `HEAD` 的测试文件。
 */
async function makeFixRepo(brokenSource: string): Promise<string> {
  const root = scratch('s1-repo-');
  mkdirSync(join(root, 'app', 'src'), { recursive: true });
  mkdirSync(join(root, 'app', 'tests'), { recursive: true });
  await git(root, 'init', '-q');
  writeFileSync(join(root, 'app', 'src', 'impl.ts'), brokenSource, 'utf-8');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-q', '-m', 'broken');
  writeFileSync(join(root, 'app', 'src', 'impl.ts'), FIXED_IMPL, 'utf-8');
  writeFileSync(join(root, 'app', 'tests', 'impl.test.ts'), TEST_FILE, 'utf-8');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-q', '-m', 'fix');
  return root;
}

describe('S1：真实修复类快照 + 判据（合成仓库，零模型）', () => {
  test('闭环：起始态=red、修复态=green、准入通过；且快照不含 .git', async () => {
    const repo = await makeFixRepo(
      'export function answer(): number {\n  return 1;\n}\n'
    );
    const dest = scratch('s1-snap-');
    const snap = await createRepoSapshot({
      repoRoot: repo,
      commit: 'HEAD',
      destRoot: dest,
    });

    expect(snap.hasGitDir).toBe(false);
    expect(snap.files).toBeGreaterThan(0);

    await overlayFromCommit({
      repoRoot: repo,
      commit: 'HEAD',
      destRoot: dest,
      paths: ['app/tests/impl.test.ts'],
    });
    expect(existsSync(join(dest, 'app', 'tests', 'impl.test.ts'))).toBe(true);

    const start = await runRepoTest({
      appDir: snap.appDir,
      testPaths: ['tests/impl.test.ts'],
    });
    expect(start.verdict).toBe('red');
    expect(start.summary?.failures).toBeGreaterThan(0);

    // 模拟"被测 Agent 完成修复"
    writeFileSync(join(dest, 'app', 'src', 'impl.ts'), FIXED_IMPL, 'utf-8');
    const fixed = await runRepoTest({
      appDir: snap.appDir,
      testPaths: ['tests/impl.test.ts'],
    });
    expect(fixed.verdict).toBe('green');
    expect(fixed.summary?.failures).toBe(0);

    expect(
      judgeS1Eligibility({
        startVerdict: start.verdict,
        fixedVerdict: fixed.verdict,
      }).eligible
    ).toBe(true);
  }, 120_000);

  test('未净化对照：含 .git 的树可直接 `git show` 读到修复 ⇒ 证明必须用 git archive 净化', async () => {
    const repo = await makeFixRepo(
      'export function answer(): number {\n  return 1;\n}\n'
    );
    // 未净化（真实仓库）：答案一读即得
    expect(await git(repo, 'show', 'HEAD:app/src/impl.ts')).toContain(
      'return 2'
    );

    const dest = scratch('s1-snap-clean-');
    const snap = await createRepoSapshot({
      repoRoot: repo,
      commit: 'HEAD',
      destRoot: dest,
    });
    // 净化后：快照内无 .git（`git show` 无从取答案）
    expect(snap.hasGitDir).toBe(false);
    expect(existsSync(join(dest, '.git'))).toBe(false);
  }, 120_000);

  test('fail-closed：起始态因**缺模块**跑不起来 ⇒ 判 unrunnable 且拒绝准入', async () => {
    const repo = await makeFixRepo(
      "import { missing } from './nope';\n" +
        'export function answer(): number {\n  return missing;\n}\n'
    );
    const dest = scratch('s1-snap-broken-');
    const snap = await createRepoSapshot({
      repoRoot: repo,
      commit: 'HEAD',
      destRoot: dest,
    });
    await overlayFromCommit({
      repoRoot: repo,
      commit: 'HEAD',
      destRoot: dest,
      paths: ['app/tests/impl.test.ts'],
    });

    const start = await runRepoTest({
      appDir: snap.appDir,
      testPaths: ['tests/impl.test.ts'],
    });
    // 退出码确实非 0，但**报告不生成** ⇒ 不能据此认定"起始态必失败"
    expect(start.exitCode).not.toBe(0);
    expect(start.summary).toBeNull();
    expect(start.verdict).toBe('unrunnable');

    const gate = judgeS1Eligibility({
      startVerdict: start.verdict,
      fixedVerdict: 'green',
    });
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toContain('不可运行');
  }, 120_000);

  test('判据边界：无报告 / 零用例 / 非零退出但无断言失败 ⇒ 一律 unrunnable（fail-closed）', () => {
    expect(parseJunitSummary(null)).toBeNull();
    expect(classifyRepoTestRun({ exitCode: 1, junitXml: null })).toBe(
      'unrunnable'
    );
    expect(
      classifyRepoTestRun({
        exitCode: 0,
        junitXml: '<testsuites tests="0" failures="0"></testsuites>',
      })
    ).toBe('unrunnable');
    expect(
      classifyRepoTestRun({
        exitCode: 1,
        junitXml: '<testsuites tests="2" failures="0"></testsuites>',
      })
    ).toBe('unrunnable');
    expect(
      classifyRepoTestRun({
        exitCode: 1,
        junitXml: '<testsuites tests="2" failures="1"></testsuites>',
      })
    ).toBe('red');
    expect(
      classifyRepoTestRun({
        exitCode: 0,
        junitXml:
          '<testsuites tests="2" assertions="5" failures="0" skipped="0"></testsuites>',
      })
    ).toBe('green');
  });

  test('准入判据：起始态 green（零区分度）必须拒绝，理由可读', () => {
    const gate = judgeS1Eligibility({
      startVerdict: 'green',
      fixedVerdict: 'green',
    });
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toContain('零区分度');
  });

  test('依赖供给：win32 ⇒ junction；POSIX ⇒ **物理拷贝**（非链接 ⇒ 无 `..` 越界面）；体积闸 fail-closed', () => {
    const real = scratch('s1-real-');
    mkdirSync(join(real, 'node_modules'), { recursive: true });
    writeFileSync(join(real, 'node_modules', 'marker.txt'), 'm', 'utf-8');

    // POSIX ⇒ 物理拷贝：内容可读、且**不是链接**（若是链接，`..` 会穿出到真实仓库）
    const posixDest = scratch('s1-snap-posix-');
    mkdirSync(join(posixDest, 'app'), { recursive: true });
    const posix = supplyDeps(join(posixDest, 'app'), real, 'linux');
    expect(posix.ok).toBe(true);
    const copied = join(posixDest, 'app', 'node_modules');
    expect(existsSync(join(copied, 'marker.txt'))).toBe(true);
    expect(lstatSync(copied).isSymbolicLink()).toBe(false);
    removeRepoSapshot(posixDest);
    expect(existsSync(posixDest)).toBe(false);
    // 真实依赖必须仍在（拷贝语义 ⇒ 删快照不影响源）
    expect(existsSync(join(real, 'node_modules', 'marker.txt'))).toBe(true);

    // POSIX + 体积闸：阈值 0 ⇒ fail-closed 拒绝（且**不产生**拷贝）
    const guardedDest = scratch('s1-snap-guard-');
    mkdirSync(join(guardedDest, 'app'), { recursive: true });
    const guarded = supplyDeps(join(guardedDest, 'app'), real, 'linux', 0);
    expect(guarded.ok).toBe(false);
    expect(existsSync(join(guardedDest, 'app', 'node_modules'))).toBe(false);

    // win32 ⇒ junction（可读穿；删除**不跟随**链接）
    const winDest = scratch('s1-snap-win-');
    mkdirSync(join(winDest, 'app'), { recursive: true });
    const win = supplyDeps(join(winDest, 'app'), real, 'win32');
    expect(win.ok).toBe(true);
    expect(
      existsSync(join(winDest, 'app', 'node_modules', 'marker.txt'))
    ).toBe(true);
    removeRepoSapshot(winDest);
    expect(existsSync(winDest)).toBe(false);
    expect(existsSync(join(real, 'node_modules', 'marker.txt'))).toBe(true);
  });
});
