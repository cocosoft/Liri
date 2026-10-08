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
 * Agent 能力评测 CLI（D2 骨架）
 *
 * 用法（在 app/ 下）：
 *   bun run eval -- --model=<模型名>            # 全部任务，k=1
 *   bun run eval -- --model=<模型名> --k=4      # 每任务跑 4 次，采集 pass^k
 *   bun run eval -- --model=<模型名> --task=file-create
 *   bun run eval -- --model=<模型名> --repeat-fresh=2   # 每个 attempt 重建沙箱（A3-a；治"抖动"，成本高）
 *   bun run eval -- --model=<模型名> --fresh-per-task   # 每个任务重建沙箱（A3-b；治"状态污染"）
 *   bun run eval -- --model=<模型名> --check-order      # 正序+倒序各跑一轮并比对（A3-b；耗时翻倍）
 *   bun run eval -- --model=<模型名> --keep     # 保留沙箱目录（默认评测结束即删；沙箱内含凭据副本）
 *   bun run eval -- --model=<模型名> --gate     # R12-001 门禁：与基线比对，有回归则退出码 1
 *   bun run eval -- --model=<模型名> --baseline=<file.json>   # 指定基线（按模型分档时用）
 *   bun run eval -- --model=<模型名> --signal           # A5：信号质量检查（区分度；**仅观测**，不影响退出码）
 *   bun run eval -- --model=<模型名> --signal-baseline=<file.json>  # 指定**信号基线**（与门禁基线分开维护）
 *   bun run eval -- --model=<模型名> --adversarial --adversarial-proposals=<file.json>  # P1-1 形态 A：对抗提案相位（**确定性裁决，仅观测**，不影响退出码）
 *   bun run eval -- --model=<模型名> --adversarial --adversarial-model=<攻击者模型>    # 同上，但提案由 LLM 生成（@modules/ai 既有入口；≥1 次模型调用）
 *   #   可选调参：--adversarial-max-calls=5 ｜ --adversarial-timeout-ms=60000 ｜ --adversarial-max-tokens=16384
 *   #   ⚠️ 思考型（thinking）模型须上调：--adversarial-timeout-ms=180000（deepseek-v4-pro 实测 127s）
 *
 * 约束：模型名**必须显式传入**（按 model-usage 规则，代码中不得硬编码模型名或默认值）。
 * 退出码：0 = 全部任务符合预期、判分器自检通过、且门禁无回归；1 = 有任务不符合预期/自检失败/门禁回归；2 = 环境准备失败。
 * `--gate-only`（2026-09-26）：**忽略"有任务不符合预期"**（仍要求自检通过 + 门禁无回归 + 题集有效）
 *   —— 供**含低成功率题**的集合（如 `--fix-tasks`）做 CI 判据：那类题按设计就会失败，默认口径下退出码恒为 1。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveDbPath, resolvePyappHome } from '@modules/core/paths';
import { createSandbox } from './sandbox.js';
import type { EvalSandbox } from './sandbox.js';
import {
  forEachItemWithFreshSandbox,
  freshSandbox,
  sharedSandbox,
  type SandboxStrategy,
} from './sandboxStrategy.js';
import {
  compareOrderInvariance,
  formatOrderInvariance,
  type OrderInvarianceReport,
} from './orderInvariance.js';
import {
  checkInitialState,
  type InitialStateVerdict,
} from './initialStateCheck.js';
import { runTask } from './runner.js';
import { writeReport } from './report.js';
import { allTasks } from './tasks/index.js';
import { auditAssertions } from './assertionAudit.js';
import {
  discoverSourceCandidates,
  resolveEvalRepoRoot,
  runSourceTaskDryRun,
} from './sourceTask.js';
import { sourceTaskSpecs } from './tasks/source-derived.js';
import { collectShieldedPaths, verifyShieldApplied } from './shieldPlan.js';
// P1-1 形态 B（2026-09-28）：反作弊面自检（纯函数、零模型；默认仅观测，`--cheat-gate` 可门禁化）
import {
  auditAntiCheatSurface,
  type AntiCheatContext,
} from './antiCheatAudit.js';
// P1-1 形态 A（2026-10-04）：对抗提案相位（**确定性半**；提案由注入式接口/文件提供，不接 LLM）
import {
  adversarialToCheatFindings,
  buildProposerInput,
  dedupeProposalsById,
  parseAdversarialProposals,
  runAdversarialPhase,
  type AdversarialProposal,
} from './adversarialAgent.js';
// D-244①（2026-10-07）：诊断**类型**（空轮可见化）。**type-only import** ⇒ 运行期不引入
// `adversarialProposer`（该模块仍是**动态 import**，见 `reportAdversarialOnce`，
// 从而不把 `@modules/ai` 拉进 harness 的静态依赖图 —— spec §5.2）。
import type { ProposerDiagnostics } from './adversarialProposer.js';
import {
  ENV_EVAL_BASH_LANDLOCK,
  isEvalBashLandlockForced,
  readLandlockConfig,
} from '@modules/sandbox';
import {
  discoverFixCommits,
  screenFixCandidates,
  selectFixCandidates,
} from './fixTaskScreening.js';
import {
  ELIGIBLE_FIX_COMMITS,
  materializeFixTask,
} from './fixTaskMaterialize.js';
import { checkGate, summarizeRun, summarizeSignal } from './scoring.js';
import type { Baseline } from './scoring.js';
import type { EvalTask, EvalTaskResult } from './types.js';

/**
 * P0-4 ②（2026-10-04）：评测期**请求**「强制 bash 走 Landlock」。
 *
 * - 仅为**意图**（置位 env）：真正的 capability 门控在
 *   `tools/bash/bashLandlockExec.decideBashLandlockGate` —— 能力可用 ⇒ 真受限；
 *   不可用 ⇒ **回退 plain**（**绝不 `refuse`**），故不会打断 Windows/macOS/无 helper 机器上的评测。
 * - ⚠️ **需 Linux 真实评测运行验证**：开启后 bash 受 FS 白名单约束，
 *   须确认评测任务所需路径不被误拒。helper `landlock-run` 源码在**本仓**
 *   （`sandbox/landlock/native/main.c`），仅编译产物不入库。
 *   （2026-10-05 WSL2 真机复验：门控路由与拒绝面均正确，另见两处环境相关缺口记录。）
 */
process.env[ENV_EVAL_BASH_LANDLOCK] = '1';

/** CLI 输出（项目禁 console；与 WizardEngine/ProgressBar 一致走 stdout） */
const out = (line = ''): void => void process.stdout.write(`${line}\n`);
const err = (line: string): void => void process.stderr.write(`${line}\n`);

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/**
 * A3-a（2026-09-26）：`--repeat-fresh=<n>` = 每任务跑 n 次、且**每个 attempt 重建沙箱**。
 *
 * 它已含"跑 n 次"语义 ⇒ 与 `--k` **互斥**（否则"k 与 n 谁生效"会成为隐式优先级）。
 */
const repeatFreshRaw = argValue('repeat-fresh');
const repeatFresh = repeatFreshRaw ? parseInt(repeatFreshRaw, 10) : 0;
if (repeatFreshRaw !== undefined && !(repeatFresh >= 1)) {
  err(`--repeat-fresh 需为正整数，收到：${repeatFreshRaw}`);
  process.exit(2);
}
if (repeatFresh >= 1 && process.argv.some((a) => a.startsWith('--k='))) {
  err('--k 与 --repeat-fresh 互斥：--repeat-fresh=<n> 已含"每任务跑 n 次"语义');
  process.exit(2);
}
const k =
  repeatFresh >= 1
    ? repeatFresh
    : Math.max(1, parseInt(argValue('k') ?? '1', 10) || 1);

/**
 * 2026-09-26：`--task-timeout-ms=<n>` = **单次尝试等待上限覆盖**。
 *
 * 用于"某模型/供应商停摆率高"的场景（实测 `deepseek-v4-flash` 约 2/9 请求 180s 无首字节）：
 * 缩短上限只让**基建超时**更快暴露，**不改变任何任务判据**。取值应 ≥ 已观测到的
 * 最长**合法**尝试耗时（本仓实测 62.4s）并留余量；缺省 = 沿用题目的 `timeoutMs ?? 180000`。
 */
const taskTimeoutMs = ((): number | undefined => {
  const raw = argValue('task-timeout-ms');
  if (!raw) return undefined;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
})();

/**
 * 2026-09-26：`--retry-on-infra=<n>` = **基建失败（执行异常/超时）的额外重试次数**，
 * **不消耗 attempt 额度**（`pass^1` 的分母不变）。
 *
 * 背景：模型/供应商会**停摆**（本仓实测 `deepseek-v4-flash` 约 2/9 请求 180s 无首字节）。
 * 停摆若被记成失败，会把**基建问题算成能力问题**，进而在定基线时给出错误阈值。
 * 判据是**结构化字段** `EvalAttempt.failureKind`（见 `runner.ts#runAttemptWithInfraRetry`）——
 * 只对 `'infra'` 放行；模型"答错 / 未交付"（`'assert'`）**绝不重试**（那是能力信号）。
 * 缺省 `0` = 旧行为（一次定成败）。
 */
const retryOnInfra = Math.max(
  0,
  parseInt(argValue('retry-on-infra') ?? '0', 10) || 0
);

/**
 * A3-b（2026-09-26）：**任务级隔离**（每任务一份沙箱）—— 治"任务间状态污染"
 * （DB 快照 / 隔离 HOME / `/tmp` / 依赖 / 端口占用跨任务累积 ⇒ 顺序影响结论）。
 *
 * 与 `--repeat-fresh` 语义重叠（后者更强：每 attempt 一份）⇒ **互斥**。
 */
const freshPerTask = process.argv.includes('--fresh-per-task');
if (freshPerTask && repeatFresh >= 1) {
  err(
    '--fresh-per-task 与 --repeat-fresh 互斥：后者已按 attempt 隔离（粒度更细）'
  );
  process.exit(2);
}
/** A3-b：正序 + 倒序各跑一轮并比对结论（代价 = 评测耗时翻倍，默认关闭） */
const checkOrder = process.argv.includes('--check-order');
/**
 * P1-1 形态 A（2026-10-04，`.trae/specs/adversarial-agent-form-a.md`）：**对抗提案相位**开关。
 *
 * 默认**关**（D3）；开启需给提案来源（`--adversarial-proposals` 或 `--adversarial-model`，**二选一**）。
 * **仅观测**：机械裁决结果**不参与** fail-closed / 退出码（spec N1）。
 * 提案来源**二选一**：① `--adversarial-proposals=<file.json>`（离线提案集）；② `--adversarial-model=<模型名>`
 * ⇒ 经 `@modules/ai` 既有入口的 LLM 提案器（**动态 import**，不进入 harness 静态依赖图；通道口径见 spec §5.2）。
 */
const adversarialEnabled = process.argv.includes('--adversarial');
/** 离线提案集（与 `--adversarial-model` **二选一**） */
const adversarialProposalsFile = argValue('adversarial-proposals') ?? '';
/** 攻击者模型名（经 `@modules/ai` 既有入口；**必须显式传入** —— model-usage 规则） */
const adversarialModel = argValue('adversarial-model') ?? '';
const adversarialMaxCalls = Math.max(
  1,
  parseInt(argValue('adversarial-max-calls') ?? '5', 10) || 5
);
const adversarialTimeoutMs = ((): number => {
  // R-1 调优（2026-10-07 实测）：默认 60000（flash 产出 12 条耗时 34.5s）；原 30000 必然截断。
  const parsed = parseInt(argValue('adversarial-timeout-ms') ?? '60000', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
})();
/**
 * 单次最大输出 token（**e2e 实证**：不显式给值时部分供应商默认 **4096** ⇒ 模型把预算耗在推理上，
 * 返回 `finish_reason=max_tokens` 且 `content` 为空 ⇒ 提案 0 条）。
 *
 * R-1 调优（2026-10-07 实测）：默认 8192 → **16384**（`deepseek-v4-flash`：8192 ⇒ 0 条；16384 ⇒ 12 条）。
 */
const adversarialMaxTokens = ((): number => {
  const parsed = parseInt(argValue('adversarial-max-tokens') ?? '16384', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16_384;
})();
if (adversarialEnabled) {
  if (adversarialProposalsFile === '' && adversarialModel === '') {
    err(
      '--adversarial 需要提案来源：--adversarial-proposals=<file.json>（离线提案集）或 --adversarial-model=<模型名>（LLM 提案器；通道 = @modules/ai，见 adversarial-agent-form-a.md §5.2）'
    );
    process.exit(2);
  }
  if (adversarialProposalsFile !== '' && adversarialModel !== '') {
    err('--adversarial-proposals 与 --adversarial-model 互斥（二选一）');
    process.exit(2);
  }
}
// 模型名**必须显式传入**：按 model-usage 规则，代码中不得硬编码模型名/默认值
const model = argValue('model');
const taskFilter = argValue('task')
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * A6（2026-09-26，《Liri 优化方案》）：**断言反向验证**（agent 检查器自检）。
 *
 * **不需要模型**（方案要求"先做不起 LLM 的版本"）⇒ 在模型校验之前处理并立即退出。
 * 对声明了参考解（`task.assertionAudit`）的题施加**等价变形**并重跑断言；变形后失败 ⇒ 过度约束。
 * **仅观测**：恒退出 0（它审计的是**我们自己的断言**，与模型能力无关）。
 */
if (process.argv.includes('--audit-assertions')) {
  const auditTasks = taskFilter
    ? allTasks.filter((t) => taskFilter.includes(t.id))
    : allTasks;
  const auditRoot = mkdtempSync(join(tmpdir(), 'liri-assertion-audit-'));
  try {
    const report = await auditAssertions(auditTasks, {
      workspace: join(auditRoot, 'ws'),
      home: join(auditRoot, 'home'),
      dataDir: join(auditRoot, 'data'),
    });
    out(
      `\n[断言自检 A6] 参与 ${report.audited.length} 题 ｜ 未登记参考解 ${report.skipped.length} 题 ｜ 检查 ${report.checks} 次`
    );
    if (report.skipped.length > 0) {
      out(
        `  · 未登记参考解（如实列出，**不判失败**）：${report.skipped.join(', ')}`
      );
    }
    for (const finding of report.findings) {
      out(
        `  ❌ 过度约束：${finding.taskId} ← ${finding.variant}（${finding.variantNote}）：${finding.reason}`
      );
    }
    if (report.findings.length === 0 && report.checks > 0) {
      out('  ✅ 已审计的断言在全部等价变形下均通过');
    }
  } finally {
    rmSync(auditRoot, { recursive: true, force: true });
  }
  process.exit(0);
}
/**
 * A7（2026-09-26，《Liri 优化方案》）：**题目来源自动化**干跑（dry-run）。
 *
 * 同样**不需要模型** ⇒ 在模型校验之前处理并立即退出。
 * 内容是：扫描候选任务源 + 对已登记规格做**真实执行自检**（golden / 起始点 / 泄漏面）。
 * **仅观测**：恒退出 0（它审计的是**题目材料**，与模型能力无关）。
 */
if (process.argv.includes('--list-source-tasks')) {
  const sourceRoot = resolveEvalRepoRoot();
  const candidates = discoverSourceCandidates(sourceRoot);
  out(
    `\n[任务源 A7] 候选（零运行时 import 的纯函数模块）${candidates.length} 个`
  );
  for (const candidate of candidates) {
    out(
      `  · ${candidate.path}（${candidate.lines} 行）→ ${candidate.exports.join(', ')}`
    );
  }

  const results = await runSourceTaskDryRun(sourceTaskSpecs, {
    root: sourceRoot,
  });
  out(
    `\n[任务源 A7] 已登记规格 ${results.length} 条（**未**接入 allTasks，见模块头注释）`
  );
  for (const { build } of results) {
    const goldenOk = build.goldens.filter((g) => g.ok).length;
    const stubOk = build.stub.filter((s) => s.ok).length;
    out(
      `  · ${build.id}：${build.status === 'ready' ? '✅ ready' : '❌ rejected'} ｜ 用例 ${build.goldens.length} ｜ golden 成功 ${goldenOk}/${build.goldens.length} ｜ 起始点成功 ${stubOk}（应为 0）`
    );
    for (const reason of build.reasons) out(`      ↳ 拒绝原因：${reason}`);
    for (const leak of build.leaks) {
      out(`      ⚠️ 泄漏面[${leak.kind}] ${leak.path}：${leak.detail}`);
    }
  }
  process.exit(0);
}

/**
 * S1（2026-09-26）：`--screen-fix-tasks` —— **真实修复类题源**的机械筛 + **双实测**。
 *
 * 与 `--list-source-tasks` 同取向：**不需要模型** ⇒ 在模型校验之前处理并立即退出；**仅观测**（恒退出 0）。
 * 但每条候选的判决都由**真实执行**给出：起点（父提交树 + 该提交测试）必须 `red`（真红）、
 * 覆盖该提交源码后必须 `green` ⇒ 否则拒绝（`unrunnable` 尤其要拒，见 `repoTestJudge.ts`）。
 *
 * `--scan-limit=<n>`（默认 400）扫描的提交数；`--limit=<n>`（默认 10）做双实测的候选数；
 * `--skip=<n>`（默认 0）跳过前 n 条候选（**分批补筛**用：已筛过的批次无需重复付出实测开销）；
 * 单次测试等待上限沿用 `--task-timeout-ms`（默认 300s）。
 */
if (process.argv.includes('--screen-fix-tasks')) {
  const scanLimit = Math.max(
    1,
    parseInt(argValue('scan-limit') ?? '400', 10) || 400
  );
  const limit = Math.max(1, parseInt(argValue('limit') ?? '10', 10) || 10);
  /** `--skip=<n>`：跳过前 n 条候选（分批补筛；已跑过的批次不必重复实测） */
  const skip = Math.max(0, parseInt(argValue('skip') ?? '0', 10) || 0);
  const root = resolveEvalRepoRoot();

  const commits = await discoverFixCommits(root, scanLimit);
  const all = selectFixCandidates(commits);
  const picked = all.slice(skip, skip + limit);
  out(
    `\n[题源 S1] 扫 ${commits.length} 个提交 ⇒ 机械筛得 ${all.length} 条候选（fix 类 + 同时动源码与测试），` +
      `取第 ${picked.length === 0 ? '(空)' : `${skip + 1}–${skip + picked.length}`} 条做双实测`
  );

  const results = await screenFixCandidates(picked, {
    repoRoot: root,
    timeoutMs: taskTimeoutMs,
    onProgress: (r) => {
      out(
        `  · ${r.candidate.commit.slice(0, 8)} ｜ 起点=${r.startVerdict}（${r.startDetail}）` +
          ` ｜ 修复=${r.fixedVerdict}（${r.fixedDetail}）` +
          ` ｜ ${r.eligible ? '✅ 准入' : `❌ 拒绝：${r.reason}`}`
      );
      out(`      ↳ ${r.candidate.subject}`);
      if (r.depsNote) out(`      ⚠️ 依赖供给：${r.depsNote}`);
    },
  });

  const ok = results.filter((r) => r.eligible).length;
  out(`\n[题源 S1] 准入 ${ok}/${results.length} 条`);
  process.exit(0);
}

const repoRoot = resolveEvalRepoRoot().replace(/\\/g, '/');
const outDir = argValue('out') ?? resolve(repoRoot, 'dev_docs', 'evals');

if (!model) {
  err(
    '缺少 --model=<模型名>：评测必须显式指定模型（不硬编码默认值）。可用模型见 `GET /v1/models`。'
  );
  process.exit(2);
}

/**
 * A7（2026-09-26）：`--source-tasks` —— 把**本仓派生的任务源**纳入本次运行。
 *
 * 为什么要显式开关：源任务**不在 `allTasks`**（见 `tasks/source-derived.ts` 头注释）——
 * 默认题集不能因它变化，否则回归门禁/信号基线的分母被静默改写。
 * 纳入口径与 CLI 干跑一致：`buildSourceTask()` 走**真实执行**自检，非 `ready` 一律拒跑（fail-closed）。
 * 纳入后各任务的 `shieldedPaths` 会经 `collectShieldedPaths` 汇总注入沙箱（防泄题）。
 */
const includeSourceTasks = process.argv.includes('--source-tasks');
const sourceTaskPool: EvalTask[] = [];
if (includeSourceTasks) {
  const mats = await runSourceTaskDryRun(sourceTaskSpecs, { root: repoRoot });
  const notReady = mats.filter((m) => m.build.status !== 'ready');
  if (notReady.length > 0) {
    err(
      `任务源未全部 ready（拒绝运行）：${notReady
        .map((m) => `${m.build.id}（${m.build.reasons.join('；')}）`)
        .join(' ｜ ')}`
    );
    process.exit(2);
  }
  for (const m of mats) {
    if (m.task) sourceTaskPool.push(m.task);
  }
  out(`  任务源纳入 ${sourceTaskPool.length} 条（--source-tasks）`);
}

/**
 * S1（2026-09-26）：`--fix-tasks` —— 把**已通过双实测**的真实修复候选纳入本次运行。
 *
 * 与 `--source-tasks` 同取向：**默认题集不变**（否则门禁分母被静默改写）。
 * 候选取自 `ELIGIBLE_FIX_COMMITS`（实测准入清单 ⇒ fail-closed，不接受任意 commit）；
 * `--fix-task=<hash>` 只纳入其中若干条（逗号分隔，支持短 hash）。
 */
if (process.argv.includes('--fix-tasks')) {
  const only = argValue('fix-task');
  const wanted = only
    ? ELIGIBLE_FIX_COMMITS.filter((c) =>
        only
          .split(',')
          .some((x) => c.startsWith(x.trim()) || x.trim().startsWith(c))
      )
    : ELIGIBLE_FIX_COMMITS;
  if (wanted.length === 0) {
    err(`--fix-task 未匹配到准入清单内的提交：${only}`);
    process.exit(2);
  }
  for (const commit of wanted) {
    sourceTaskPool.push(await materializeFixTask(repoRoot, commit));
  }
  out(`  真实修复任务纳入 ${wanted.length} 条（--fix-tasks）`);
}

const pool =
  sourceTaskPool.length > 0 ? [...allTasks, ...sourceTaskPool] : allTasks;
const tasks = taskFilter ? pool.filter((t) => taskFilter.includes(t.id)) : pool;

if (tasks.length === 0) {
  err(`未匹配到任何任务：--task=${taskFilter?.join(',')}`);
  process.exit(2);
}

/**
 * A7 防泄题：本次运行涉及的**题源路径并集**（来自各任务的 `shieldedPaths`）。
 * 声明了就必须被沙箱接受——见 `assertShieldApplied`（fail-closed）。
 *
 * 另加 **报告目录**（同根第二泄漏面，spec §4.8 D）：评测报告落盘在**仓库内**、且失败原因里
 * 带期望值 ⇒ `k>1` 时后续 attempt 可经报告读到答案。评测运行期间 Agent 无正当理由读它，
 * 故复用同一屏蔽机制把整个报告目录挡住。
 */
const declaredShieldedPaths = collectShieldedPaths(tasks);
const shieldTargets = [...declaredShieldedPaths, outDir];

out('Agent 能力评测（D2 骨架）');
out(`  模型=${model} ｜ k=${k} ｜ 任务=${tasks.map((t) => t.id).join(', ')}`);
out(`  仓库根=${repoRoot}`);

const sandboxOpts = {
  repoRoot,
  realDbPath: resolveDbPath(),
  realHome: resolvePyappHome(),
  // A7 防泄题：非空时注入 PERMISSION_SHIELDED_PATHS，挡住对题源与报告目录的读取
  shieldedPaths: shieldTargets,
};
/** 本轮创建过的**全部**沙箱根目录（收尾统一清理；沙箱内含**真实凭据副本**，一个都不能漏） */
const createdRoots: string[] = [];
/**
 * A7 防泄题 **fail-closed 校验**：任务声明了题源路径，沙箱就必须真的屏蔽上。
 * 缺一条即拒绝本次运行 —— 否则评测**静默变成泄题**（通过率虚高且无人察觉）。
 */
const assertShieldApplied = (sandbox: EvalSandbox): void => {
  const verdict = verifyShieldApplied(shieldTargets, sandbox.shieldedPaths);
  if (!verdict.ok) {
    err(
      `沙箱未应用全部题源屏蔽路径（缺 ${verdict.missing.length} 条）：${verdict.missing.join(', ')}`
    );
    process.exit(2);
  }
};

/**
 * P1-1 形态 B（2026-09-28）：**反作弊面自检**开关。
 *
 * 默认**仅观测**（与 A2 / A5 / S2 同取向：先取干净基线，再议门禁化）；
 * 加 `--cheat-gate` 时"**必须挡但没挡**"（`exposed`）即**拒绝本次运行**（fail-closed）。
 * `knownGap`（**已登记的已知缺口**）**刻意不参与** fail-closed —— 否则 D-5 会让所有题立即全废。
 */
const cheatGate = process.argv.includes('--cheat-gate');
let antiCheatReported = false;

/**
 * P1-1 形态 A（2026-10-04）：**对抗提案相位** —— 取提案（离线文件 **或** LLM 提案器）⇒ **机械裁决**
 * ⇒ 并入同一 cheatReport 的展示面。**判据侧零模型**（复用 `auditAntiCheatSurface`）；**不参与** fail-closed。
 */
const reportAdversarialOnce = async (ctx: AntiCheatContext): Promise<void> => {
  let proposals: AdversarialProposal[] = [];
  if (adversarialProposalsFile !== '') {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(adversarialProposalsFile, 'utf-8'));
    } catch (e) {
      err(
        `--adversarial-proposals 读取/解析失败：${adversarialProposalsFile}（${e instanceof Error ? e.message : String(e)}）`
      );
      process.exit(2);
    }
    const parsed = parseAdversarialProposals(raw);
    // D-244③b（2026-10-08）：离线提案集的 id 由文件自持 ⇒ **唯一性守卫**（契约要求"本次运行内唯一"；
    // 重复 id 会让 `A-${id}` 撞键、报告不可追溯）。保留首次出现，其余丢弃并告警。
    const deduped = dedupeProposalsById(parsed.proposals);
    proposals = deduped.proposals;
    if (parsed.rejected.length > 0) {
      out(
        `  ⚠️ 提案集 ${parsed.rejected.length} 条非法项已丢弃：${parsed.rejected.join('；')}`
      );
    }
    if (deduped.duplicates.length > 0) {
      out(
        `  ⚠️ 提案集存在重复 id（契约要求唯一），已保留首次出现、丢弃 ${deduped.duplicates.length} 条：${[...new Set(deduped.duplicates)].join('；')}`
      );
    }
  } else {
    // LLM 提案器：**动态 import** —— 不把 `@modules/ai` 拉进 harness 静态依赖图（spec §5.2）
    const { createLlmProposer } = await import('./adversarialProposer.js');
    out(
      `  对抗提案器（LLM）：模型=${adversarialModel} ｜ 调用上限 ${adversarialMaxCalls} 次 ｜ 超时 ${adversarialTimeoutMs}ms ｜ max_tokens ${adversarialMaxTokens}`
    );
    // D-244①（2026-10-07）：诊断经 `onDiagnostics` 回传（**不改提案器接口**）；用"盒"承接
    // 以避免 TS 对闭包内赋值的窄化问题。
    const diagBox: { value?: ProposerDiagnostics } = {};
    try {
      proposals = await createLlmProposer({
        model: adversarialModel,
        maxCalls: adversarialMaxCalls,
        timeoutMs: adversarialTimeoutMs,
        maxTokens: adversarialMaxTokens,
        onDiagnostics: (d) => {
          diagBox.value = d;
        },
      })(buildProposerInput(ctx));
    } catch (e) {
      err(
        `对抗提案器调用失败：${e instanceof Error ? e.message : String(e)}（模型=${adversarialModel}）`
      );
      process.exit(2);
    }
    // D-244①：**空轮可见化** —— 此前"某轮无产出"只在日志里，汇总行照旧打印总条数
    // ⇒ 使用者看不出覆盖率被高估（静默丢轮）。
    const diag = diagBox.value;
    if (diag) {
      out(
        `  提案器诊断：轮 ${diag.rounds} ｜ 有产出 ${diag.productiveRounds} ｜ **空轮 ${diag.emptyRounds}**（空输出 ${diag.parseFailures.emptyContent} · 不可解析 ${diag.parseFailures.unparsable}）｜ 停止原因 ${diag.stoppedBy}`
      );
    }
  }
  const report = runAdversarialPhase({ ctx, proposals });
  out(
    `  对抗提案相位（形态 A）：提案 ${report.proposals.length} 条 ｜ 机械确认暴露 ${report.exposed.length} ｜ 已知缺口 ${report.knownGaps.length} ｜ 无法机械判定 ${report.unmachineable.length}`
  );
  // §10.2-C 闭环（2026-10-08）：**按 target 的落点分布** —— 此前只打印 exposed / unmachineable
  // 明细，`knownGap` 落点**不可见** ⇒ 无法回答"新登记的路径改写向量（C-6…C-9）是否真被 LLM 触及"。
  // 单行自证：`C-8×7(knownGap)`。kind 与 target 一一对应（裁决由向量派生）。
  const byTarget = new Map<string, { n: number; kind: string }>();
  for (const v of report.verdicts) {
    const cur = byTarget.get(v.target) ?? { n: 0, kind: v.kind };
    cur.n += 1;
    byTarget.set(v.target, cur);
  }
  if (byTarget.size > 0) {
    out(
      `    按 target 分布：${[...byTarget.entries()]
        .map(([t, x]) => `${t}×${x.n}(${x.kind})`)
        .join('  ')}`
    );
  }
  for (const e of report.exposed) {
    out(`    · [对抗暴露 A-${e.proposalId}] ${e.detail}`);
  }
  for (const u of report.unmachineable) {
    out(`    · [无法机械判定 A-${u.proposalId}] ${u.detail}`);
  }
  const merged = adversarialToCheatFindings(report);
  if (merged.length > 0) {
    out(
      `    已并入 cheatReport：${merged.map((f) => f.id).join(', ')}（**不参与 fail-closed**）`
    );
  }
};

/** 自检 + 打印（**只跑一次**：向量与 attempt 无关，只依赖本次运行配置） */
const reportAntiCheatOnce = async (sandbox: EvalSandbox): Promise<void> => {
  if (antiCheatReported) return;
  antiCheatReported = true;
  const ctx: AntiCheatContext = {
    declaredShields: shieldTargets,
    appliedShields: sandbox.shieldedPaths,
    reportDir: outDir,
    sandboxRoot: sandbox.root,
    platform: process.platform,
    // P0-4 ②：评测期强制时，bash 的 Landlock **意图**为 on（实际是否生效由 capability 门控）
    bashLandlockEnabled:
      readLandlockConfig().bashEnabled || isEvalBashLandlockForced(),
  };
  const report = auditAntiCheatSurface(ctx);
  const blocked =
    report.findings.length - report.knownGaps.length - report.exposed.length;
  out(
    `  反作弊面自检：${report.findings.length} 条向量 ｜ 已挡 ${blocked} ｜ 已知缺口 ${report.knownGaps.length} ｜ 暴露 ${report.exposed.length}`
  );
  for (const g of report.knownGaps) out(`    · [已知缺口 ${g.id}] ${g.title}`);
  for (const e of report.exposed) out(`    · [暴露 ${e.id}] ${e.detail}`);
  if (report.exposed.length > 0) {
    if (cheatGate) {
      err(
        `反作弊面自检未通过（--cheat-gate）：${report.exposed.map((e) => e.id).join(', ')}`
      );
      process.exit(2);
    }
    out('    ⚠️ 暴露项未开启 --cheat-gate ⇒ 本次仅记录（不影响判定）');
  }
  // P1-1 形态 A：对抗提案相位（仅观测；**不参与**上面的 fail-closed 判定 —— spec N1）
  if (adversarialEnabled) await reportAdversarialOnce(ctx);
};

/** 新建沙箱并登记根目录（两条 fresh 路径共用） */
const createTrackedSandbox = async (): Promise<EvalSandbox> => {
  const created = await createSandbox(sandboxOpts);
  createdRoots.push(created.root);
  assertShieldApplied(created);
  await reportAntiCheatOnce(created);
  return created;
};

/**
 * 沙箱模式（三选一）
 * - `shared`：全程一份（默认；与改造前一致）
 * - `fresh-per-attempt`：每 attempt 一份（A3-a `--repeat-fresh`）
 * - `fresh-per-task`：每任务一份（A3-b `--fresh-per-task`）
 */
type SandboxMode =
  | { mode: 'shared'; strategy: SandboxStrategy }
  | { mode: 'fresh-per-attempt'; strategy: SandboxStrategy }
  | { mode: 'fresh-per-task' };

let baseSandbox: EvalSandbox | undefined;
let sandboxMode: SandboxMode;

if (repeatFresh >= 1) {
  // A3-a：fresh 模式**不预创建**沙箱（否则启动次数会变成 n+1，与"n 次尝试 = n 次启动"不符）
  out(
    `  ⚠️ --repeat-fresh=${repeatFresh}：每个 attempt 重建沙箱（每套 daemon + DB 快照，启动耗时与磁盘开销显著）`
  );
  sandboxMode = {
    mode: 'fresh-per-attempt',
    strategy: freshSandbox(createTrackedSandbox),
  };
} else if (freshPerTask) {
  // A3-b：同样不预创建 —— 首份沙箱在第一个任务开始时才建（任务间**完全隔离**）
  out(
    '  ⚠️ --fresh-per-task：每个任务重建沙箱（任务间完全隔离；每任务一套 daemon + DB 快照）'
  );
  sandboxMode = { mode: 'fresh-per-task' };
} else {
  try {
    // 统一走 createTrackedSandbox（登记根目录 + 防泄题 fail-closed 校验，不重复实现）
    baseSandbox = await createTrackedSandbox();
  } catch (e) {
    err(`沙箱准备失败：${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  out(`  沙箱=${baseSandbox.root}（隔离 HOME/数据目录，DB 为真实库快照）`);
  if (baseSandbox.shieldedPaths.length > 0) {
    out(`  路径屏蔽（防泄题）=${baseSandbox.shieldedPaths.length} 条`);
  }
  out(`  后端=${baseSandbox.baseUrl}`);
  if (!baseSandbox.hasCredentials) {
    out(
      '  ⚠️ 未找到 <LIRI_HOME>/credentials.json —— 模型密钥缺失，调用很可能返回 401'
    );
  }
  sandboxMode = { mode: 'shared', strategy: sharedSandbox(baseSandbox) };
}

/**
 * 跑**一遍**题集（A3-b 的"正序 / 倒序"各调一次本函数）。
 *
 * 注意：`shared` 模式下两遍**复用同一沙箱**（即"不隔离"的既有行为）；需要任务间隔离请加
 * `--fresh-per-task`。
 */
const runPass = async (order: EvalTask[]): Promise<EvalTaskResult[]> => {
  if (sandboxMode.mode === 'fresh-per-task') {
    return forEachItemWithFreshSandbox(
      order,
      createTrackedSandbox,
      async (task, perTaskStrategy) => {
        out(`\n[任务] ${task.id} — ${task.name}`);
        return runTask(task, perTaskStrategy, {
          k,
          model,
          timeoutOverrideMs: taskTimeoutMs,
          retryOnInfra,
        });
      }
    );
  }
  const strategy = sandboxMode.strategy;
  const passResults: EvalTaskResult[] = [];
  for (const task of order) {
    out(`\n[任务] ${task.id} — ${task.name}`);
    passResults.push(
      await runTask(task, strategy, {
        k,
        model,
        timeoutOverrideMs: taskTimeoutMs,
        retryOnInfra,
      })
    );
  }
  return passResults;
};

/**
 * A4（2026-09-26，《Liri 优化方案》）：**起始态必失败校验**（fail-closed）——
 * 用"零动作"上下文跑一次 `setup + assert`（**不调模型**）。
 *
 * 用**独立沙箱**（不复用运行期沙箱）：`setup` 会写工作区与隔离目录，避免污染正式那一轮的
 * 起始状态；代价是多一次沙箱启动。`negative` 题按设计跳过（见 `initialStateCheck.ts`）。
 */
out('\n[起始态校验 A4] 零动作上下文跑断言（不调模型）…');
const checkSandbox = await createTrackedSandbox();
let initialStateVerdicts: InitialStateVerdict[] = [];
try {
  for (const task of tasks) {
    initialStateVerdicts.push(await checkInitialState(task, checkSandbox));
  }
} finally {
  await checkSandbox.stop();
}
for (const v of initialStateVerdicts) {
  out(`  ${v.ok ? '✅' : '❌'} ${v.taskId}（${v.polarity}）：${v.detail}`);
}
const initialStateFailures = initialStateVerdicts.filter((v) => !v.ok);
if (initialStateFailures.length === 0) {
  out(
    '  ✅ 起始态校验全部通过（positive 题起始态均失败 / negative 题按设计跳过）'
  );
}

const startedAt = new Date().toISOString();
let results: EvalTaskResult[] = [];
let orderReport: OrderInvarianceReport | undefined;

try {
  results = await runPass(tasks);
  // A3-b：顺序无关性校验 —— 倒序再跑一轮并逐题比对（默认关闭；代价 = 评测耗时翻倍）
  if (checkOrder) {
    out('\n[顺序无关性] 开始倒序第二轮（--check-order）…');
    const reversedResults = await runPass([...tasks].reverse());
    orderReport = compareOrderInvariance(results, reversedResults);
    for (const line of formatOrderInvariance(orderReport)) out(line);
  }
} finally {
  // 共享模式：沙箱由本文件统一收尾；两条 fresh 路径已在各自边界 stop()
  if (baseSandbox) await baseSandbox.stop();
}

const summary = summarizeRun({
  startedAt,
  finishedAt: new Date().toISOString(),
  model,
  k,
  tasks: results,
  // 用 --task= 只跑子集时，子集里没有控制任务属正常，不应判为"判分器自检失败"
  expectControls: !taskFilter,
});

const { jsonPath, mdPath } = writeReport(summary, outDir);

out('\n================ 汇总 ================');
out(
  `pass^k 全通过：${results.filter((r) => r.passK).length}/${results.length}` +
    ` ｜ pass^1 均值：${(summary.pass1Mean * 100).toFixed(1)}%` +
    ` ｜ 判分器自检：${summary.judgeSanityOk ? '通过' : '未通过'}`
);
for (const r of results) {
  out(
    `  ${r.task.id}: 断言通过 ${r.assertPassCount}/${r.attempts.length}` +
      ` ｜ pass^1 ${(r.pass1 * 100).toFixed(0)}% ｜ pass^k ${r.passK ? '✅' : '❌'}`
  );
}
// 论文 A1（2026-10-06）：可靠性曲线（**仅当 ≥2 个点**，避免 k=1 的单点噪声）
if (summary.reliabilityCurve && summary.reliabilityCurve.length >= 2) {
  out(
    `可靠性曲线（论文 A1）：` +
      summary.reliabilityCurve
        .map((p) => `pass^${p.k}=${(p.value * 100).toFixed(0)}%`)
        .join(' → ')
  );
}
if (summary.security) {
  const sec = summary.security;
  // A4：ASR 分母 = 已完成 attempt；为 0 时显式 n/a
  const asrText =
    sec.attackCompleted === 0
      ? 'n/a（无已完成 attempt）'
      : `${(sec.asr * 100).toFixed(0)}%`;
  out(
    `安全（D9）：成对 ${sec.pairs} ｜ ASR ${asrText}` +
      `（分母=已完成 ${sec.attackCompleted} / 未完成 ${sec.attackIncomplete} 不进分母）` +
      ` ｜ 聚合 ASR ${(sec.aggregatedAsr * 100).toFixed(0)}%（论文 A3·Max 口径：${sec.aggregatedWon}/${sec.pairs} 场景被攻破）` +
      ` ｜ benign utility ${(sec.benignPassRate * 100).toFixed(0)}%`
  );
}
out(`\n报告：${mdPath}\n      ${jsonPath}`);

// R12-001 门禁：--gate 或 --baseline=<path> 时与基线比对（默认基线 = 本目录 baseline.json）
const baselinePath = argValue('baseline');
const gateEnabled = process.argv.includes('--gate') || Boolean(baselinePath);
const gateFailures: string[] = [];
if (gateEnabled) {
  const baselineFile =
    baselinePath ?? resolve(import.meta.dir, 'baseline.json');
  out(`\n[门禁 R12-001] 基线=${baselineFile}`);
  try {
    const baseline = JSON.parse(
      readFileSync(baselineFile, 'utf-8')
    ) as Baseline;
    gateFailures.push(...checkGate(summary, baseline));
  } catch (e) {
    gateFailures.push(
      `基线不可读/不可解析：${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (gateFailures.length === 0) {
    out('  ✅ 无回归');
  } else {
    for (const failure of gateFailures) err(`  ❌ ${failure}`);
  }
}

// A5（2026-09-26，《Liri 优化方案》）：**信号质量**检查（与回归门禁**分开维护**）。
// **仅观测**：不参与退出码 —— 回归门禁求"不许退化"（严），信号基线求"能把强弱区分开"。
const signalBaselinePath = argValue('signal-baseline');
const signalEnabled =
  process.argv.includes('--signal') || Boolean(signalBaselinePath);
if (signalEnabled) {
  const signalFile =
    signalBaselinePath ?? resolve(import.meta.dir, 'signal-baseline.json');
  out(`\n[信号质量 A5] 信号基线=${signalFile}`);
  let signalBaseline: Baseline | undefined;
  try {
    signalBaseline = JSON.parse(readFileSync(signalFile, 'utf-8')) as Baseline;
  } catch (e) {
    out(
      `  ⚠️ 信号基线不可读/不可解析（将只做**零数据**判定：全过/全挂）：${e instanceof Error ? e.message : String(e)}`
    );
  }
  const signal = summarizeSignal(summary, signalBaseline);
  if (signal.kTooSmall) {
    out(
      '  ⚠️ k<2 ⇒ pass^1 只能是 0/1，**区分度判定无意义**（请用 --k=4 之类再采信号）'
    );
  }
  out(
    `  全过（无区分度）${signal.saturated} 题 ｜ 全挂 ${signal.floored} 题 ｜ 关注项 ${signal.findings.length}`
  );
  for (const f of signal.findings) {
    out(
      `  · ${f.taskId}（${f.label}，pass^1 ${(f.pass1 * 100).toFixed(0)}%）：${f.detail}`
    );
  }
  if (signal.findings.length === 0) {
    out('  ✅ 本次未发现"无区分度 / 全挂 / 越界"的题');
  }
}

// 沙箱含真实凭据副本 → 默认删除；需要排查时用 --keep（A3-a：fresh 模式下会有多个根目录）
if (process.argv.includes('--keep')) {
  for (const root of createdRoots) out(`沙箱保留（--keep）：${root}`);
} else {
  for (const root of createdRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (e) {
      out(
        `沙箱删除失败（可手动清理）：${root} —— ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  out(
    `沙箱已删除 ${createdRoots.length} 个（含凭据副本；需要保留请加 --keep）`
  );
}

const failed = results.filter((r) => !r.passK);
// A3-b：--check-order 检测到顺序依赖即判失败（须先定位污染源再采基线）
const orderFailed = orderReport ? !orderReport.invariant : false;
// A4：起始态校验失败（positive 题起始态就通过 / 断言抛错）即判失败（题集无效）
/**
 * `--gate-only`（2026-09-26）：**只把"门禁 / 自检 / 题集有效性"计入退出码**，忽略"任务级不符合预期"。
 *
 * **为什么需要**：S1 题源（真实修复类）按设计就含**低成功率题**（实测 12.5% 量级）⇒
 * 默认口径下"有任务不符合预期"恒成立 ⇒ 退出码**恒为 1**，无法当 CI 判据。
 * 该开关把判据收敛到"**不许退化**"这一件事上（与 `--signal` 的"仅观测"取向互补）。
 * ⚠️ 它**不**放松任何任务判据：任务级失败仍照常显示，只是**不再单独决定退出码**。
 */
const gateOnly = process.argv.includes('--gate-only');
process.exit(
  (gateOnly || failed.length === 0) &&
    summary.judgeSanityOk &&
    gateFailures.length === 0 &&
    !orderFailed &&
    initialStateFailures.length === 0
    ? 0
    : 1
);
