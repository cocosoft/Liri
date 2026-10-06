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
 * S1 题源（spec [`eval-task-source-expansion.md`](../../.trae/specs/eval-task-source-expansion.md) §4.2）
 * —— **从 git 历史挑"真实修复类"候选，并用真实执行筛除**。
 *
 * 与 O1（A7 从当前工作区派生纯函数）的分工：O1 的候选资格线是"零运行时 import 的纯函数"，
 * 结构上只能出简单题（已实测零区分度）；S1 的候选是**历史上真实修好的 bug**，天然带
 * 多文件改动与隐性不变量。
 *
 * **"能不能成题"不靠人判断**（同 A7 的取向）—— 每条候选都要过**双实测**：
 *  ① 起点（父提交树 + 该提交的测试文件）⇒ 必须判 **red**（真红，即 JUnit 有 `failures`）；
 *  ② 同一快照 + 覆盖该提交的**源码** ⇒ 必须判 **green**；
 * 任一不成立 ⇒ 拒绝并给原因（`unrunnable` 尤其要拒：那是"跑不起来"，不是"起始态必失败"）。
 */

import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  createRepoSapshot,
  overlayFromCommit,
  removeRepoSapshot,
  supplyDeps,
} from './repoSnapshot';
import {
  deriveF2pP2P,
  judgeS1Eligibility,
  runRepoTest,
  type RepoTestVerdict,
} from './repoTestJudge';

const execFileAsync = promisify(execFile);

/** `git log --name-status` 的一行（`status` 可能是 `M` / `A` / `R100` / `D` …） */
export interface FixCommitFile {
  status: string;
  path: string;
}

/** 解析后的提交（未筛选） */
export interface FixCommit {
  commit: string;
  subject: string;
  files: FixCommitFile[];
}

/** 通过机械筛的候选（可送去做双实测） */
export interface FixCandidate {
  commit: string;
  subject: string;
  /** 仓库相对路径（`app/src/**`，不含测试） */
  sourcePaths: string[];
  /** 仓库相对路径（测试 = 判据） */
  testPaths: string[];
}

/** 测试路径判定（`.test.ts` 后缀 **或** 位于 `tests/` 目录下） */
function isTestPath(path: string): boolean {
  return /\.test\.ts$/.test(path) || /(^|\/)tests?\//.test(path);
}

/**
 * 解析 `git log --no-merges --name-status --pretty=format:===%H|%s` 的输出（纯函数）。
 *
 * 容忍：空行、`\r`、重命名（`R100\told\tnew` ⇒ 取**新**路径）、subject 内含 `|`（只切第一处）。
 */
export function parseFixCommitLog(raw: string): FixCommit[] {
  const commits: FixCommit[] = [];
  let cur: FixCommit | null = null;

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('===')) {
      if (cur) commits.push(cur);
      const rest = line.slice(3);
      const sep = rest.indexOf('|');
      cur = {
        commit: sep >= 0 ? rest.slice(0, sep) : rest,
        subject: sep >= 0 ? rest.slice(sep + 1) : '',
        files: [],
      };
      continue;
    }
    if (!cur || line.trim().length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    cur.files.push({ status: parts[0], path: parts[parts.length - 1] });
  }
  if (cur) commits.push(cur);
  return commits;
}

/**
 * 机械筛（纯函数）：`fix` 类 subject + 同时触及**源码**与**测试**，且改动量在可用区间。
 *
 * 排序：**小改动优先**（更容易被测试判定，且双实测成本低）；同规模按 commit 稳定排序。
 * ⚠️ 本函数只做"机械筛"，**不产出结论** —— 能否成题由 {@link screenFixCandidate} 的真实执行判定。
 */
export function selectFixCandidates(
  commits: readonly FixCommit[],
  opts: { maxSourceFiles?: number } = {}
): FixCandidate[] {
  const maxSourceFiles = opts.maxSourceFiles ?? 6;
  const out: FixCandidate[] = [];

  for (const c of commits) {
    if (!/^fix/.test(c.subject)) continue;
    const touched = c.files.filter((f) => f.status !== 'D');
    const sourcePaths = touched
      .filter((f) => f.path.startsWith('app/src/') && !isTestPath(f.path))
      .map((f) => f.path);
    const testPaths = touched
      .filter((f) => isTestPath(f.path))
      .map((f) => f.path);
    if (sourcePaths.length === 0 || testPaths.length === 0) continue;
    if (sourcePaths.length > maxSourceFiles) continue;
    out.push({ commit: c.commit, subject: c.subject, sourcePaths, testPaths });
  }

  return out.sort(
    (a, b) =>
      a.sourcePaths.length +
        a.testPaths.length -
        (b.sourcePaths.length + b.testPaths.length) ||
      a.commit.localeCompare(b.commit)
  );
}

/** 读 git 历史（`core.quotepath=false` ⇒ 中文路径原样返回，便于后续 pathspec 使用） */
export async function discoverFixCommits(
  repoRoot: string,
  scanLimit = 400
): Promise<FixCommit[]> {
  const { stdout } = await execFileAsync(
    'git',
    [
      '-c',
      'core.quotepath=false',
      'log',
      '--no-merges',
      '--name-status',
      '--pretty=format:===%H|%s',
      '-n',
      String(scanLimit),
    ],
    {
      cwd: repoRoot,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf-8',
    }
  );
  return parseFixCommitLog(String(stdout));
}

export interface FixScreenResult {
  candidate: FixCandidate;
  snapshotFiles: number;
  /** 起点（父提交树 + 该提交测试）的判决 */
  startVerdict: RepoTestVerdict;
  startDetail: string;
  /** 同一快照 + 覆盖该提交源码后的判决 */
  fixedVerdict: RepoTestVerdict;
  fixedDetail: string;
  eligible: boolean;
  reason?: string;
  /** 依赖供给的说明（不 ok 时为拒绝原因；供如实报告） */
  depsNote?: string;
  /**
   * A2（2026-10-06）：由**同一次双实测**自动派生的 F2P / P2P 双清单
   * （起点红 ⇒ F2P；起点绿 ⇒ P2P；起点 `skipped` 两不入）。
   * 任一侧逐用例结果缺失 ⇒ `undefined`（fail-closed，不猜）。
   */
  f2p?: string[];
  p2p?: string[];
}

/**
 * 单条候选的**双实测**（真实执行 git/tar/bun；不删 `destRoot`，由调用方负责清理）。
 */
export async function screenFixCandidate(
  candidate: FixCandidate,
  deps: { repoRoot: string; destRoot: string; timeoutMs?: number }
): Promise<FixScreenResult> {
  const snapshot = await createRepoSapshot({
    repoRoot: deps.repoRoot,
    commit: candidate.commit,
    destRoot: deps.destRoot,
  });
  // 测试文件是**判据**：从该提交覆盖进来（源码仍保持父提交状态 ⇒ 起点必然是红的）
  await overlayFromCommit({
    repoRoot: deps.repoRoot,
    commit: candidate.commit,
    destRoot: deps.destRoot,
    paths: candidate.testPaths,
  });

  const dep = supplyDeps(snapshot.appDir, join(deps.repoRoot, 'app'));
  const depsNote = dep.ok ? undefined : dep.reason;
  const testPaths = candidate.testPaths.map((p) => p.replace(/^app\//, ''));

  const start = await runRepoTest({
    appDir: snapshot.appDir,
    testPaths,
    timeoutMs: deps.timeoutMs,
  });

  // 覆盖该提交的源码 ⇒ 得到"修复态"（仅用于自检判据；不参与被测 Agent 的起点）
  await overlayFromCommit({
    repoRoot: deps.repoRoot,
    commit: candidate.commit,
    destRoot: deps.destRoot,
    paths: candidate.sourcePaths,
  });
  const fixed = await runRepoTest({
    appDir: snapshot.appDir,
    testPaths,
    timeoutMs: deps.timeoutMs,
  });

  const gate = judgeS1Eligibility({
    startVerdict: start.verdict,
    fixedVerdict: fixed.verdict,
  });

  // A2/G2：F2P/P2P 由**同一次双实测**机械派生（起点红⇒F2P、起点绿⇒P2P）
  const lists = deriveF2pP2P(start.cases, fixed.cases);

  return {
    candidate,
    snapshotFiles: snapshot.files,
    startVerdict: start.verdict,
    startDetail: start.detail,
    fixedVerdict: fixed.verdict,
    fixedDetail: fixed.detail,
    eligible: gate.eligible,
    reason: gate.eligible ? undefined : gate.reason,
    depsNote,
    ...(lists ? { f2p: lists.f2p, p2p: lists.p2p } : {}),
  };
}

/**
 * 批量筛选（**串行**：每条约 1 份快照 + 2 次测试运行，避免资源争抢）。
 * 每条候选独立建/删临时快照，互不影响。
 */
export async function screenFixCandidates(
  candidates: readonly FixCandidate[],
  deps: {
    repoRoot: string;
    timeoutMs?: number;
    onProgress?: (result: FixScreenResult) => void;
  }
): Promise<FixScreenResult[]> {
  const results: FixScreenResult[] = [];
  for (const candidate of candidates) {
    const destRoot = mkdtempSync(join(tmpdir(), 'liri-s1-'));
    try {
      const result = await screenFixCandidate(candidate, {
        repoRoot: deps.repoRoot,
        destRoot,
        timeoutMs: deps.timeoutMs,
      });
      results.push(result);
      deps.onProgress?.(result);
    } finally {
      removeRepoSapshot(destRoot);
    }
  }
  return results;
}
