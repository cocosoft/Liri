/**
 * lint-orphan-gates.ts — 「门禁脚本必须有执行面」元门禁（2026-11-23）
 *
 * 背景（连续两轮实证）：`lint:tool-risk` / `lint:acceptance` / `lint:shadow-tools`
 * 都只定义在 `app/package.json`，**从未被 `ci` / GitHub Actions / pre-commit 调用**
 * ⇒ 门禁静默腐烂：`lint:tool-risk` 积压了 2 例「非 BaseTool 未声明 riskClass」无人看守。
 *
 * 判据（门禁类脚本名 = `lint:` / `check:` / `security-scan` / `prompts:` / `params:` /
 * `descriptions:` / `version:` / `i18n:` / `verify:` / `evidence:` / `gate` / `policy` /
 * `audit:` / `gen:` / `codegen` / `measure:` / `export`）：
 * 必须至少在一个**执行面**出现 ——
 *   ① `app/package.json#scripts.ci` 的 `bun run <name>`；
 *   ② `.github/workflows/*.yml` 的 `bun run <name>`；
 *   ③ `app/scripts/setup-git-hooks.ts`（pre-commit 模板，**不是** `.git/hooks/`，
 *      后者不在版本库内）：`bun run <name>` 或 `for GATE in … <name> …`。
 *
 * 确属「手动工具」（生成器 / 导出器 / 一次性取证 / 写基线）⇒ 必须登记在
 * `.trae/architecture/orphan-gate-allowlist.json` 并写明理由；
 * 已登记却实际已接线 ⇒ 报「陈旧条目」，防止台账腐化（与其它棘轮同口径）。
 *
 * 用法：`bun run lint:orphan-gates`（CI 与本地均可；静态只读，毫秒级）
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..', '..');
const APP_DIR = join(ROOT, 'app');
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');
const HOOK_TEMPLATE = join(APP_DIR, 'scripts', 'setup-git-hooks.ts');
const ALLOWLIST_PATH = join(
  ROOT,
  '.trae',
  'architecture',
  'orphan-gate-allowlist.json'
);

/** 视觉上属于"门禁/校验/生成/取证"的脚本名前缀 */
const GATE_LIKE =
  /^(lint|check|security-scan|prompts|params|descriptions|version|i18n|verify|evidence|gate|policy|audit|gen|codegen|measure|export)/;

interface AllowlistFile {
  note?: string;
  scripts?: Record<string, string>;
}

function fail(message: string): never {
  console.error(`[lint:orphan-gates] ❌ ${message}`);
  process.exit(1);
}

function readAllowlist(): Record<string, string> {
  if (!existsSync(ALLOWLIST_PATH)) {
    fail(
      `缺少台账 ${ALLOWLIST_PATH}（手动工具必须登记理由，不得靠"没有执行面"静默通过）`
    );
  }
  try {
    const raw = JSON.parse(
      readFileSync(ALLOWLIST_PATH, 'utf8')
    ) as AllowlistFile;
    return raw.scripts ?? {};
  } catch (error) {
    fail(`台账无法解析：${String(error)}`);
  }
}

function readScripts(): Record<string, string> {
  try {
    const pkg = JSON.parse(
      readFileSync(join(APP_DIR, 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch (error) {
    fail(`app/package.json 无法解析：${String(error)}`);
  }
}

function readWorkflowText(): string {
  if (!existsSync(WORKFLOW_DIR)) fail(`缺少 workflows 目录 ${WORKFLOW_DIR}`);
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => readFileSync(join(WORKFLOW_DIR, f), 'utf8'))
    .join('\n');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 只保留**可执行行**：注释与 `echo` 提示文案里的脚本名不算执行面。
 *
 * 实证：pre-commit 失败提示写着「修复: cd app && bun run gen:support-levels」——
 * 若把提示文案也算接线，生成器会被误判为"已执行"（门禁假绿）。
 */
export function executableLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed !== '' && !trimmed.startsWith('#') && !/\becho\b/.test(trimmed)
      );
    })
    .join('\n');
}

/** 判定某脚本名是否出现在任一执行面（① ci ② workflow ③ pre-commit 模板） */
function isReferenced(
  name: string,
  ciBody: string,
  workflowText: string,
  hookText: string
): boolean {
  if (ciBody.includes(`bun run ${name}`)) return true;
  if (new RegExp(`bun run ${escapeRegExp(name)}(?:\\s|$)`).test(workflowText)) {
    return true;
  }
  if (hookText.includes(`bun run ${name}`)) return true;
  // pre-commit 模板的 `for GATE in a b c; do` 批量清单
  return new RegExp(
    `for GATE in [^;\\n]*${escapeRegExp(name)}(?:\\s|;|$)`
  ).test(hookText);
}

/** 判定结果（纯函数返回，供门禁本体与门禁自证用例共用） */
export interface OrphanGateReport {
  gateLikeCount: number;
  wiredCount: number;
  allowlistedCount: number;
  missing: string[];
  staleAllowlistEntries: string[];
  wiredButAllowlisted: string[];
}

/**
 * 判据（**纯函数**，供门禁自证/负向夹具复用）：
 * 门禁类脚本必须出现在执行面，或登记为手动工具；台账不得含陈旧/已接线条目。
 */
export function findOrphanGates(input: {
  scripts: Readonly<Record<string, string>>;
  ciBody: string;
  workflowText: string;
  hookText: string;
  allowlist: Readonly<Record<string, string>>;
}): OrphanGateReport {
  const { scripts, ciBody, workflowText, hookText, allowlist } = input;
  const gateLike = Object.keys(scripts).filter(
    (name) => GATE_LIKE.test(name) && name !== 'ci'
  );

  const missing: string[] = [];
  const wiredButAllowlisted: string[] = [];
  let allowlistedCount = 0;

  for (const name of gateLike) {
    const referenced = isReferenced(name, ciBody, workflowText, hookText);
    const hasReason = Boolean(allowlist[name]);
    if (!referenced && !hasReason) missing.push(name);
    else if (referenced && hasReason) wiredButAllowlisted.push(name);
    else if (!referenced && hasReason) allowlistedCount += 1;
  }

  const staleAllowlistEntries = Object.keys(allowlist).filter(
    (name) => !(name in scripts)
  );

  return {
    gateLikeCount: gateLike.length,
    wiredCount: gateLike.length - allowlistedCount - missing.length,
    allowlistedCount,
    missing,
    staleAllowlistEntries,
    wiredButAllowlisted,
  };
}

function main(): void {
  const scripts = readScripts();
  const allowlist = readAllowlist();
  const ciBody = scripts['ci'] ?? '';
  if (!ciBody) fail('app/package.json#scripts.ci 不存在（无法判定执行面）');

  const workflowText = executableLines(readWorkflowText());
  if (!existsSync(HOOK_TEMPLATE)) fail(`缺少 pre-commit 模板 ${HOOK_TEMPLATE}`);
  const hookText = executableLines(readFileSync(HOOK_TEMPLATE, 'utf8'));

  const report = findOrphanGates({
    scripts,
    ciBody,
    workflowText,
    hookText,
    allowlist,
  });

  console.log(
    `[lint:orphan-gates] 门禁类脚本 ${report.gateLikeCount} · 已接线 ${report.wiredCount} · ` +
      `登记为手动工具 ${report.allowlistedCount} · 无执行面且未登记 ${report.missing.length}`
  );

  if (report.missing.length > 0) {
    console.error(
      '[lint:orphan-gates] ❌ 下列门禁类脚本既无执行面、也未登记为手动工具（门禁静默腐烂）：'
    );
    for (const name of report.missing) console.error(`   - ${name}`);
    console.error(
      '   处置（三选一）：① 接入 ci + workflows（本地还要进 pre-commit 模板）；' +
        `② 确属手动工具 ⇒ 写入 ${ALLOWLIST_PATH} 并写明理由；③ 删除该脚本。`
    );
    process.exit(1);
  }

  if (report.staleAllowlistEntries.length > 0) {
    console.error(
      '[lint:orphan-gates] ❌ 台账存在**已不存在的脚本**（陈旧条目，防台账腐化）：'
    );
    for (const name of report.staleAllowlistEntries) {
      console.error(`   - ${name}`);
    }
    process.exit(1);
  }

  if (report.wiredButAllowlisted.length > 0) {
    console.error(
      '[lint:orphan-gates] ❌ 下列脚本**已接线却仍登记为手动工具**（请从台账移除）：'
    );
    for (const name of report.wiredButAllowlisted) {
      console.error(`   - ${name}`);
    }
    process.exit(1);
  }

  console.log('[lint:orphan-gates] ✅ 通过 / passed');
}

// 仅**直接运行**时执行（被测试 import 时不触发 ⇒ 便于复用纯判据做门禁自证）
if (import.meta.main) {
  main();
}
