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
 * S1 题源（spec [`eval-task-source-expansion.md`](../../.trae/specs/eval-task-source-expansion.md) §4.3）
 * —— 把一条**已通过双实测**的修复候选，物化成可跑的 `EvalTask`。
 *
 * 三条硬约束（均由实现保证，不靠提示词约束）：
 *  1. **防泄题**：工作区是 `git archive` 导出的**净化快照**（无 `.git`）；真实仓库整根**屏蔽**
 *     （`shieldedPaths` ⇒ 工具执行层分派前拒绝一切引用它的调用）。
 *  2. **判据不可篡改**：`assert` 在跑测试前**重放该提交的测试文件**（覆盖被测者对测试的任何改动）
 *     —— 与 SWE-bench 的做法一致：测试是判据，不是解题材料。
 *  3. **判据三态**：`green` 才通过；`red` / `unrunnable` 都不通过（"跑不起来"绝不等于通过，
 *     见 `repoTestJudge.ts` 的实测依据）。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  discoverFixCommits,
  screenFixCandidate,
  selectFixCandidates,
  type FixCandidate,
} from './fixTaskScreening';
import {
  createRepoSapshot,
  overlayFromCommit,
  supplyDeps,
} from './repoSnapshot';
import { junitCaseKey, runRepoTest } from './repoTestJudge';
import type { EvalTask } from './types';

/**
 * 已通过**双实测**（起点真红 / 修复绿）的候选提交（2026-09-26，零模型，`--screen-fix-tasks` 产出）。
 * 只允许从这份**实测清单**物化 —— 防止手滑传入任意 commit（fail-closed）。
 */
export const ELIGIBLE_FIX_COMMITS: readonly string[] = [
  '04a0102e',
  '254b4776',
  '4fc17ee1',
  '50576842',
  '15cd75b2',
  '35e61220',
  'd00dced1',
  'dd0a755c',
  '1ddf7725',
  '60608c62',
  '7035f271',
];

/** 按短/全长 hash 在工作区里解析出候选（复用机械筛，不另写一套判据） */
export async function resolveFixCandidate(
  repoRoot: string,
  commit: string
): Promise<FixCandidate> {
  const all = selectFixCandidates(await discoverFixCommits(repoRoot, 1500));
  const hit = all.find((c) => c.commit.startsWith(commit));
  if (!hit) {
    throw new Error(
      `未找到匹配 "${commit}" 的修复候选（该提交需同时触及 app/src 与测试）`
    );
  }
  return hit;
}

/** 任务 id（短 hash，稳定且可读） */
export function fixTaskId(commit: string): string {
  return `fix-${commit.slice(0, 8)}`;
}

/**
 * 物化一条 S1 任务。`repoRoot` = 真实仓库根（快照来源；**同时作为屏蔽目标**）。
 */
export async function materializeFixTask(
  repoRoot: string,
  commit: string
): Promise<EvalTask> {
  if (!ELIGIBLE_FIX_COMMITS.some((c) => commit.startsWith(c))) {
    throw new Error(
      `commit ${commit} 不在双实测准入清单内 —— 请先跑 \`--screen-fix-tasks\` 取得准入（fail-closed）`
    );
  }
  const candidate = await resolveFixCandidate(repoRoot, commit);

  // A2/G2（D1=a）：用**双实测**派生 F2P/P2P，并随题物化**固化**。
  // 代价：物化期多 2 次测试运行（**每任务一次**，非每次 attempt）——已于 spec §9 如实登记。
  const destRoot = mkdtempSync(join(tmpdir(), 'liri-s1-lists-'));
  try {
    const screen = await screenFixCandidate(candidate, { repoRoot, destRoot });
    if (!screen.eligible) {
      throw new Error(
        `S1 复核未通过（${screen.reason ?? '未知原因'}）⇒ 拒绝物化（fail-closed）`
      );
    }
    if (!screen.f2p || screen.f2p.length === 0) {
      throw new Error(
        'F2P 清单为空 —— 该题无 fail→pass 用例，不是"修复类" ⇒ 拒绝物化'
      );
    }
    return buildFixTask(candidate, repoRoot, {
      f2p: screen.f2p,
      p2p: screen.p2p ?? [],
    });
  } finally {
    rmSync(destRoot, { recursive: true, force: true });
  }
}

/**
 * 由候选装配 `EvalTask`。**不做准入校验**（准入由 {@link materializeFixTask} / CLI 把关）——
 * 这样合成仓库也能**离线**验证装配逻辑（真实准入依赖真实仓库的历史）。
 */
export function buildFixTask(
  candidate: FixCandidate,
  repoRoot: string,
  /** A2/G2：由双实测派生的 F2P/P2P 双清单（缺省 ⇒ 不声明，行为与改造前一致） */
  lists?: { f2p: string[]; p2p: string[] }
): EvalTask {
  /** 快照在工作区内的落点：`<workspace>/repo` */
  const repoDirOf = (workspace: string): string => join(workspace, 'repo');
  const testPaths = candidate.testPaths.map((p) => p.replace(/^app\//, ''));

  return {
    id: fixTaskId(candidate.commit),
    name: `S1 真实修复：${candidate.subject}`,
    level: 'L1',
    assertionPolarity: 'positive',
    // A2/G2：F2P/P2P 随题固化（缺省不声明 ⇒ scoring 不产出 resolved/breaking/no-op 段）
    ...(lists ? { f2p: lists.f2p, p2p: lists.p2p } : {}),
    // 防泄题：真实仓库整根屏蔽（答案是它的当前状态 + `.git` 历史）
    shieldedPaths: [repoRoot],
    prompt: (ws) =>
      [
        `工作区 ${ws}/repo 是本项目**某次真实修复之前**的一份代码快照（不含 \`.git\`）。`,
        '',
        '请修改快照内的**源码**，使其通过下列测试（判据）：',
        ...testPaths.map((p) => `  · app/${p}`),
        '',
        '约束：',
        '  · 只能改 `repo/` 内的**源码**；**不得**修改测试文件（评测前会重放原始测试文件）；',
        '  · 不得引入网络依赖或读取仓库外的任何文件；',
        '  · 完成后回复「已完成」。',
      ].join('\n'),
    setup: async ({ workspace }) => {
      const repoDir = repoDirOf(workspace);
      await createRepoSapshot({
        repoRoot,
        commit: candidate.commit,
        destRoot: repoDir,
      });
      await overlayFromCommit({
        repoRoot,
        commit: candidate.commit,
        destRoot: repoDir,
        paths: candidate.testPaths,
      });
      // 依赖供给不 ok 时会体现为 assert 的 `unrunnable`（不静默降级为"通过"）
      supplyDeps(join(repoDir, 'app'), join(repoRoot, 'app'));
    },
    async assert({ workspace }) {
      const repoDir = repoDirOf(workspace);
      // 判据不可篡改：跑测试前**重放**该提交的测试文件（覆盖被测者的任何改动）
      await overlayFromCommit({
        repoRoot,
        commit: candidate.commit,
        destRoot: repoDir,
        paths: candidate.testPaths,
      });
      const run = await runRepoTest({
        appDir: join(repoDir, 'app'),
        testPaths,
      });
      // A2/G3：回传**逐用例通过键** ⇒ `scoring.ts` 可判 resolved / breaking / no-op
      const passedCases = run.cases
        ?.filter((c) => c.status === 'passed')
        .map(junitCaseKey);
      if (run.verdict === 'green') {
        return { pass: true, ...(passedCases ? { passedCases } : {}) };
      }
      return {
        pass: false,
        reason: `测试未通过（verdict=${run.verdict}）：${run.detail}`,
        ...(passedCases ? { passedCases } : {}),
      };
    },
  };
}
