/**
 * 提示词资源门禁的**接线钉死**守卫（2026-10-18）。
 *
 * 为什么需要：本批接线时真实踩中过一次「条件写错 = 永不执行」——
 * 给 `static-check`（**无 matrix**）的步骤加了 `if: matrix.os == 'ubuntu-latest'`，
 * 该条件恒为 false，步骤会被静默跳过（与 AR-3「检查器崩溃被当成通过」同级）。
 *
 * 判据：
 * - `app/package.json#ci` 聚合脚本包含 6 项资源门禁 + 1 项源码阻断门禁；
 * - `.github/workflows/ci.yml` 的 `static-check` 作业内存在同名步骤，且：
 *   · **不带 `if:`**（否则可能被静默跳过）；
 *   · `working-directory: app`；
 *   · 逐条调用 7 项命令（与本地同口径）。
 *
 * 说明：按文本块解析而非 YAML 库 —— CI 的 Bun 版本（1.3.x）不保证有 `Bun.YAML`。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

/** 6 项**资源**门禁（顺序即执行顺序；CI 与本地同口径） */
const RESOURCE_GATES = [
  'prompts:check',
  'params:check',
  'descriptions:check',
  'lint:prompt-parity',
  'lint:prompt-budget',
  'lint:prompt-t1',
] as const;

/**
 * 源码侧**阻断**门禁（2026-10-18 由用户裁定提前切换）：
 * `lint:prompt-hardcoded` 在 `package.json` 内以 `--strict` 运行 ⇒ warning 也阻断；
 * 因此不再「恒 exit 0」，必须同时进 GitHub CI（否则 PR 上只有本地能拦）。
 */
const BLOCKING_GATES = ['lint:prompt-hardcoded'] as const;

const STEP_NAME = '- name: Prompt resource gates';

function readWorkflow(): string {
  return readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'ci.yml'),
    'utf8'
  );
}

/** 取 `static-check` 作业到下一个作业头之间的文本 */
function staticCheckJob(ci: string): string {
  const jobStart = ci.indexOf('\n  static-check:');
  expect(jobStart).toBeGreaterThan(-1);
  const rest = ci.slice(jobStart + 1);
  const nextJobOffset = rest.search(/\n  [a-z][\w-]*:/);
  return nextJobOffset === -1 ? rest : rest.slice(0, nextJobOffset);
}

/** 取该步骤自身文本（到下一个 `- name:` 步骤为止） */
function promptGatesStep(job: string): string {
  const start = job.indexOf(STEP_NAME);
  expect(start).toBeGreaterThan(-1);
  const rest = job.slice(start);
  const nextStep = rest.indexOf('\n    - name:', 1);
  return nextStep === -1 ? rest : rest.slice(0, nextStep);
}

describe('提示词资源门禁接线钉死', () => {
  it('`app/package.json#ci` 聚合链包含 6 项资源门禁 + 1 项阻断门禁', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'app', 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };
    for (const gate of [...RESOURCE_GATES, ...BLOCKING_GATES]) {
      expect(pkg.scripts[gate], `缺少脚本 ${gate}`).toBeDefined();
      expect(pkg.scripts.ci, `ci 聚合链缺少 ${gate}`).toContain(gate);
    }
    // 阻断口径钉死：脚本本身必须带 `--strict`（否则 warning 不阻断）
    expect(pkg.scripts['lint:prompt-hardcoded']).toContain('--strict');
  });

  it('CI `static-check` 内的步骤逐条调用 7 项门禁，cwd=app', () => {
    const step = promptGatesStep(staticCheckJob(readWorkflow()));
    expect(step).toContain('working-directory: app');
    for (const gate of [...RESOURCE_GATES, ...BLOCKING_GATES]) {
      expect(step, `步骤缺少 bun run ${gate}`).toContain(`bun run ${gate}`);
    }
  });

  it('该步骤**不得带 `if:`**（无 matrix 的作业上写 matrix 条件 = 永远跳过）', () => {
    const step = promptGatesStep(staticCheckJob(readWorkflow()));
    expect(step).not.toMatch(/^\s+if:/m);
  });
});
