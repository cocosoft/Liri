#!/usr/bin/env bun
/**
 * migrate-permission-rules.ts — P2-1 统一 Rule 模型迁移器（2026-11-03）
 *
 * 语义（`dev_docs/20261027/工具权限体系归一化方案-20261027.md` §5 P2-1）：
 * - **默认 dry-run**：只读四个来源（A `tool_rules.json` / settings 三件套 /
 *   B `permission.customRules.commandRules` / StandingRule 内存规则），打印统一后的
 *   规则与差异，**不写任何文件**；
 * - **`--migrate`**：先备份 `tool_rules.json`（若存在）与旧快照，再把统一规则写入
 *   `unified_rules.json` 快照。**不重写任何来源文件** —— 决策链切换属 P3，独立提交。
 *
 * 失败即退出（不得静默降级）：JSON 解析失败 / 目录不可读 ⇒ exit 1。
 *
 * 用法：
 *   bun run scripts/migrate-permission-rules.ts                 # dry-run
 *   bun run scripts/migrate-permission-rules.ts --migrate       # 写快照（含备份）
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePermissionsDir, resolveUserConfigPath } from '@openliri/infra/environment';
import {
  getUserSettingsPath,
  getProjectSettingsPath,
  getLocalSettingsPath,
} from '@openliri/infra/config';
import {
  PermissionRuleSource,
  permissionRulesToUnified,
  settingsToUnified,
  commandRulesToUnified,
  mergeUnifiedRules,
  diffUnifiedRules,
  groupBySource,
  type CommandRulesInput,
  type UnifiedRule,
  type PermissionRule,
} from '@openliri/infra/permission';

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    console.error(`❌ 无法解析 ${path}: ${(e as Error).message}`);
    process.exit(1);
  }
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const apply = process.argv.includes('--migrate');
const permissionsDir = argValue('--permissions-dir') ?? resolvePermissionsDir();
const ruleFile = join(permissionsDir, 'tool_rules.json');
const snapshotFile =
  argValue('--snapshot') ?? join(permissionsDir, 'unified_rules.json');
const configFile = argValue('--config-file') ?? resolveUserConfigPath();
const settingsPaths: Array<[string, PermissionRuleSource]> = [
  [argValue('--user-settings') ?? getUserSettingsPath(), PermissionRuleSource.USER_SETTINGS],
  [argValue('--project-settings') ?? getProjectSettingsPath(), PermissionRuleSource.PROJECT_SETTINGS],
  [argValue('--local-settings') ?? getLocalSettingsPath(), PermissionRuleSource.LOCAL_SETTINGS],
];

// ① A 体系：tool_rules.json
const rawRules = readJson(ruleFile);
const ruleStore: PermissionRule[] = Array.isArray(rawRules)
  ? (rawRules as PermissionRule[]).filter((r) => typeof r?.toolName === 'string')
  : [];

// ② settings 三件套
const settingsParts: UnifiedRule[][] = [];
for (const [path, source] of settingsPaths) {
  const raw = readJson(path) as { permissions?: Record<string, unknown> } | null;
  const p = raw?.permissions;
  if (!p) continue;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  settingsParts.push(
    settingsToUnified({
      source,
      allow: arr(p.allow),
      deny: arr(p.deny),
      ask: arr(p.ask),
    })
  );
}

// ③ B 体系：config.json 的命令黑白名单
const rawConfig = readJson(configFile) as
  | { permission?: { customRules?: { commandRules?: CommandRulesInput } } }
  | null;
const commandRules = rawConfig?.permission?.customRules?.commandRules;

// ④ StandingRule：内存规则不落盘（CLI 无法读取运行期实例，如实标注）
const parts: UnifiedRule[][] = [
  permissionRulesToUnified(ruleStore),
  ...settingsParts,
  ...(commandRules ? [commandRulesToUnified(commandRules)] : []),
];
const unified = mergeUnifiedRules(parts);

// ⑤ 与旧快照对比（dry-run 的核心交付物）
const rawSnapshot = readJson(snapshotFile) as { rules?: UnifiedRule[] } | null;
const before = Array.isArray(rawSnapshot?.rules) ? rawSnapshot.rules : [];
const diff = diffUnifiedRules(before, unified);

const groups = groupBySource(unified);
console.log(
  `[permission-rules] 来源统计：` +
    Object.entries(groups)
      .map(([k, v]) => `${k}=${v.length}`)
      .join(' / ')
);
console.log(
  `[permission-rules] 统一规则 ${unified.length} 条；相对旧快照：新增 ${diff.added.length} / 移除 ${diff.removed.length} / 变更 ${diff.changed.length}`
);
for (const r of unified.slice(0, 10)) {
  console.log(
    `  - [${r.source}/${r.scope}/${r.behavior}] ${JSON.stringify(r.matcher)}`
  );
}
if (unified.length > 10) console.log(`  … 其余 ${unified.length - 10} 条省略`);

if (!apply) {
  console.log(
    '[permission-rules] dry-run：未写盘。确认无误后加 --migrate 写入快照（会先备份来源文件）'
  );
  process.exit(0);
}

// ⑥ 写盘前备份（只备份，不改来源）
const backupSuffix = `.bak-${stamp()}`;
if (existsSync(ruleFile)) copyFileSync(ruleFile, `${ruleFile}${backupSuffix}`);
if (existsSync(snapshotFile)) {
  copyFileSync(snapshotFile, `${snapshotFile}${backupSuffix}`);
}

writeFileSync(
  snapshotFile,
  JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: 'scripts/migrate-permission-rules.ts',
      rules: unified,
    },
    null,
    2
  )
);
console.log(
  `[permission-rules] 已写入 ${snapshotFile}（备份后缀 ${backupSuffix}；来源文件未被改写）`
);
process.exit(0);
