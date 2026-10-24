#!/usr/bin/env bun
/**
 * lint-workflows.ts — GitHub Actions YAML **可解析 + 结构完整** 门禁。
 *
 * 为什么存在（2026-10-24 实证）：把步骤名写成
 *   `- name: Package build (tsc: barrel + per-module output)`
 * 未加引号的 `: ` 让 YAML 把标量当成映射 ⇒ **GitHub 直接判定整个 workflow 无效**。
 * 表现极具误导性：Actions 里出现一条 **0 job**、名字是文件路径的失败记录，
 * 而本地 `typecheck` / `eslint` / pre-commit 全绿（它们都不解析 workflow）。
 * 代价是一轮「推上去才发现、改一行再推」——故前移到提交前。
 *
 * 扫描面：
 *   - `.github/workflows/*.yml|*.yaml`（断言有 `jobs`）
 *   - `.github/actions/**\/action.yml|action.yaml`（断言有 `runs`）
 *
 * fail-closed（AR-3）：目录不存在 / 一个文件都没扫到 ⇒ 也失败（避免"路径错了但显示通过"）。
 *
 * 用法：
 *   bun app/scripts/lint-workflows.ts                 # 默认根 = 本仓库根
 *   bun app/scripts/lint-workflows.ts --root <dir>    # 门禁自证用（临时夹具）
 *
 * 退出码：0 = 合规；1 = 解析失败 / 结构缺失 / 扫描面为空。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

/** 本脚本位于 `<repo>/app/scripts/` */
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function parseRoot(argv: readonly string[]): string {
  const index = argv.indexOf('--root');
  if (index === -1) return DEFAULT_ROOT;
  const value = argv[index + 1];
  if (!value) {
    console.error('❌ --root 缺少参数值');
    process.exit(1);
  }
  return resolve(value);
}

function walkYaml(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkYaml(full, out);
    else if (/\.ya?ml$/.test(name)) out.push(full);
  }
  return out;
}

interface Finding {
  file: string;
  message: string;
}

function checkFile(abs: string, root: string, isAction: boolean): Finding[] {
  const rel = relative(root, abs).split('\\').join('/');
  let parsed: unknown;
  try {
    parsed = yaml.load(readFileSync(abs, 'utf-8'));
  } catch (error) {
    const err = error as { message?: string; mark?: { line?: number } };
    const line = err.mark?.line === undefined ? '' : `:${err.mark.line + 1}`;
    return [
      {
        file: `${rel}${line}`,
        message: (err.message ?? String(error)).split('\n')[0]!,
      },
    ];
  }
  if (parsed === null || typeof parsed !== 'object') {
    return [{ file: rel, message: '内容为空或不是映射（YAML 结构不完整）' }];
  }
  const doc = parsed as Record<string, unknown>;
  const required = isAction ? 'runs' : 'jobs';
  if (!doc[required] || typeof doc[required] !== 'object') {
    return [{ file: rel, message: `缺少 \`${required}\` 段（workflow 无 job ⇒ GitHub 会判无效）` }];
  }
  return [];
}

function main(): number {
  const root = parseRoot(process.argv.slice(2));
  const workflowsDir = join(root, '.github', 'workflows');
  const actionsDir = join(root, '.github', 'actions');

  if (!existsSync(workflowsDir)) {
    console.error(`❌ 找不到 workflow 目录：${workflowsDir}（fail-closed，不视为通过）`);
    return 1;
  }

  const targets: Array<{ abs: string; isAction: boolean }> = walkYaml(workflowsDir).map(
    (abs) => ({ abs, isAction: false })
  );
  if (existsSync(actionsDir)) {
    for (const abs of walkYaml(actionsDir)) {
      targets.push({ abs, isAction: /^action\.ya?ml$/.test(abs.split(/[\\/]/).pop() ?? '') });
    }
  }

  if (targets.length === 0) {
    console.error('❌ 一个 workflow / action 文件都没扫到（fail-closed，不视为通过）');
    return 1;
  }

  const findings = targets.flatMap((t) => checkFile(t.abs, root, t.isAction));
  if (findings.length > 0) {
    console.error('❌ GitHub Actions YAML 门禁失败：');
    for (const f of findings) console.error(`  - ${f.file}  ${f.message}`);
    console.error(
      '（常见原因：未加引号的 `name: xxx (a: b)` —— YAML 会把 `: ` 当成映射；把整行加引号即可）'
    );
    return 1;
  }

  console.log(
    `✅ ${targets.length} 个 GitHub Actions YAML 均可解析且结构完整（workflows=${walkYaml(workflowsDir).length}）`
  );
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  // 检查器自身失败不得当成通过（AR-3）
  console.error(`❌ workflow 门禁执行失败（不视为通过）: ${String(error)}`);
  process.exit(1);
}
