#!/usr/bin/env bun
/**
 * lint-gate-parity.ts — 「`app/package.json#ci` ↔ GitHub Actions」**门禁对等**检查（元门禁）
 *
 * 为什么需要它（2026-10-31 实证）：`lint:status` / `lint:support-levels` 只登记在
 * `package.json#ci` 与 pre-commit，而 `.github/workflows/*.yml` 是**另写一份** step 列表
 * ⇒ 新增门禁漏登记时 CI 永远绿、pre-commit 又可被 `--no-verify` 绕过，门禁从守护退化成装饰。
 * 同一缺陷不是个案：本次实测 54 条 `ci` 门禁里有 **11 条**在 workflows 中零命中。
 *
 * 判据（fail-closed）：
 *   1. 解析 `app/package.json#ci` 中每一处 `bun run <script>`；
 *   2. 该脚本「已在 CI」当且仅当 workflow 文本里出现 `bun run <script>`，
 *      **或**出现该脚本的实现文件（如 `scripts/lint-architecture.ts`，兼容 `../` 与 `app/` 前缀）；
 *   3. 两者皆无 ⇒ 必须出现在豁免表 `.trae/architecture/gate-parity-allowlist.json`
 *      且**理由非空**（空理由即 exit 1，与 `INTENTIONALLY_MODEL_LESS` 同口径）；
 *   4. 任何输入缺失 / 解析失败 ⇒ exit 1（不得静默降级为「0 缺失」）。
 *
 * 用法：`bun run scripts/lint-gate-parity.ts`（CI 静态检查 job 与 `bun run ci` 均调用）
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// `PYAPP_PROJECT_DIR` 仅用于**单测夹具**（指向临时工程树）；生产/CI 走脚本自身位置。
const REPO_ROOT = process.env.PYAPP_PROJECT_DIR
  ? resolve(process.env.PYAPP_PROJECT_DIR)
  : resolve(import.meta.dir, '..');
const PKG_FILE = join(REPO_ROOT, 'app', 'package.json');
const WF_DIR = join(REPO_ROOT, '.github', 'workflows');
const ALLOW_FILE = join(
  REPO_ROOT,
  '.trae',
  'architecture',
  'gate-parity-allowlist.json'
);

function fail(msg: string): never {
  console.error(`❌ [gate-parity] ${msg}`);
  process.exit(1);
}

interface PackageJson {
  scripts?: Record<string, string>;
}

if (!existsSync(PKG_FILE)) fail(`缺少 ${PKG_FILE}`);
if (!existsSync(WF_DIR)) fail(`缺少 workflows 目录 ${WF_DIR}`);

const pkg = JSON.parse(readFileSync(PKG_FILE, 'utf-8')) as PackageJson;
const scripts = pkg.scripts ?? {};
const ciBody = scripts.ci;
if (!ciBody) fail('app/package.json#scripts.ci 不存在（无法判定对等）');

/** `ci` 中实际调用的脚本名（保序去重） */
const gates = [
  ...new Set(
    [...ciBody.matchAll(/bun run ([A-Za-z0-9:_.-]+)/g)].map((m) => m[1]!)
  ),
];
if (gates.length === 0)
  fail('ci 脚本中未解析出任何 `bun run <script>`（解析失败）');

const workflowText = readdirSync(WF_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => readFileSync(join(WF_DIR, f), 'utf-8'))
  .join('\n');
if (workflowText.trim() === '') fail('workflows 目录为空（无法判定对等）');

/** 脚本实现文件（`scripts/x.ts` / `../scripts/x.ts` → `scripts/x.ts`） */
function implFiles(name: string): string[] {
  const body = scripts[name];
  if (!body) return [];
  return [
    ...body.matchAll(/(?:\.\.\/)?scripts\/[A-Za-z0-9/_.-]+\.(?:ts|js)/g),
  ].map((m) => m[0].replace(/^\.\.\//, ''));
}

function referencedInCi(name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`bun run ${escaped}(?:\\s|$)`).test(workflowText)) return true;
  return implFiles(name).some(
    (p) =>
      workflowText.includes(p) ||
      workflowText.includes(`../${p}`) ||
      workflowText.includes(`app/${p}`)
  );
}

/** 豁免表：`{ "<script>": "<理由>" }`；理由非空为硬约束 */
function loadAllowlist(): Record<string, string> {
  if (!existsSync(ALLOW_FILE)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(ALLOW_FILE, 'utf-8'));
  } catch (err) {
    fail(`豁免表解析失败（fail-closed）: ${String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('豁免表必须是对象 { "<script>": "<理由>" }');
  }
  const out: Record<string, string> = {};
  for (const [key, reason] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      fail(`豁免项「${key}」理由为空（必须写明为何不在 CI 执行）`);
    }
    out[key] = reason;
  }
  return out;
}

const allowlist = loadAllowlist();
const missing: string[] = [];
const exempted: string[] = [];

for (const gate of gates) {
  if (referencedInCi(gate)) continue;
  if (allowlist[gate]) {
    exempted.push(gate);
    continue;
  }
  missing.push(gate);
}

for (const gate of exempted) {
  console.log(
    `⚪ 豁免（已登记「不在 CI 执行」）：${gate} —— ${allowlist[gate]}`
  );
}

if (missing.length > 0) {
  console.error(
    '❌ [gate-parity] 下列门禁只在 app/package.json#ci / pre-commit，CI 未执行：'
  );
  for (const gate of missing) console.error(`   - ${gate}`);
  console.error(
    '   处置（二选一）：① 在 .github/workflows/*.yml 中补 `bun run <script>` 步骤；' +
      '② 若确为本地专属，写入 .trae/architecture/gate-parity-allowlist.json 并写明理由。'
  );
  process.exit(1);
}

console.log(
  `✅ [gate-parity] ci 门禁 ${gates.length} 条：CI 覆盖 ${gates.length - exempted.length} · 已登记豁免 ${exempted.length} · 缺失 0`
);
process.exit(0);
