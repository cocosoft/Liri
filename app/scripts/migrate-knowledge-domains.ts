// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * migrate-knowledge-domains.ts — S3 / issue #11（2026-10-29）
 *
 * 把**全局**知识库内容迁入域目录 `domains/default/`：
 *   `wiki/` · `index.md` · `log.md` · `.schema/`
 *
 * 语义（与 issue #11 正文一致）：
 * - 内容**复制**到 `domains/default/<item>`，原全局项**移动**到
 *   `knowledge/legacy/<时间戳>/<item>` —— **不删除**，可整体回滚；
 * - **默认 dry-run**，只有 `--apply` 才落盘；
 * - **幂等**：目标已存在的项不参与（重复 `--apply` ⇒ 0 变更、不新建 legacy 目录）。
 *
 * 用法：
 *   bun run scripts/migrate-knowledge-domains.ts            # dry-run（默认）
 *   bun run scripts/migrate-knowledge-domains.ts --apply    # 落盘
 */

import { cpSync, existsSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { resolveDomainDir, resolveKnowledgeDir } from '@modules/environment';

/** 参与迁移的全局项（顺序即列出顺序） */
export const MIGRATION_ITEMS = ['wiki', 'index.md', 'log.md', '.schema'] as const;

export interface MigrationItem {
  /** 项名（相对 knowledgeRoot） */
  name: string;
  /** 全局源路径 */
  from: string;
  /** 域内目标路径 */
  to: string;
}

export interface MigrationPlan {
  knowledgeRoot: string;
  defaultDomainDir: string;
  /** 需要迁移的项（已排除目标已存在 / 源不存在者） */
  items: MigrationItem[];
  /** 目标已存在而被跳过的项（供 dry-run 输出解释「为什么 0 变更」） */
  skipped: string[];
}

/** 计算迁移计划（**无副作用**） */
export function planKnowledgeDomainMigration(): MigrationPlan {
  const knowledgeRoot = resolveKnowledgeDir();
  const defaultDomainDir = resolveDomainDir('default');

  const items: MigrationItem[] = [];
  const skipped: string[] = [];

  for (const name of MIGRATION_ITEMS) {
    const from = join(knowledgeRoot, name);
    const to = join(defaultDomainDir, name);
    if (!existsSync(from)) continue;
    if (existsSync(to)) {
      skipped.push(name);
      continue;
    }
    items.push({ name, from, to });
  }

  return { knowledgeRoot, defaultDomainDir, items, skipped };
}

export interface MigrationResult {
  /** 已迁移项名 */
  moved: string[];
  /** 本次 legacy 备份目录（无变更 ⇒ `null`） */
  legacyDir: string | null;
}

/**
 * 执行迁移。
 *
 * @param plan `planKnowledgeDomainMigration()` 的结果
 * @param stamp legacy 子目录名（默认当前时间戳；测试注入固定值）
 */
export function applyKnowledgeDomainMigration(
  plan: MigrationPlan,
  stamp: string = new Date().toISOString().replaceAll(':', '-')
): MigrationResult {
  if (plan.items.length === 0) return { moved: [], legacyDir: null };

  const legacyDir = join(plan.knowledgeRoot, 'legacy', stamp);
  mkdirSync(legacyDir, { recursive: true });

  const moved: string[] = [];
  for (const item of plan.items) {
    mkdirSync(dirname(item.to), { recursive: true });
    // 先复制到域目录（保留原内容），再把原全局项移到 legacy（不删除）
    cpSync(item.from, item.to, { recursive: true });
    renameSync(item.from, join(legacyDir, item.name));
    moved.push(item.name);
  }

  return { moved, legacyDir };
}

/** 打印计划（CLI 与测试共用同一文案口径） */
export function formatMigrationPlan(plan: MigrationPlan): string[] {
  const lines: string[] = [
    `知识库根：${plan.knowledgeRoot}`,
    `默认域目录：${plan.defaultDomainDir}`,
  ];
  if (plan.items.length === 0) {
    lines.push('待迁移项：0（已是目标状态）');
  } else {
    lines.push(`待迁移项：${plan.items.length}`);
    for (const item of plan.items) {
      lines.push(`  - ${item.name}`);
    }
  }
  if (plan.skipped.length > 0) {
    lines.push(`已跳过（目标已存在）：${plan.skipped.join(', ')}`);
  }
  return lines;
}

if (import.meta.main) {
  const apply = process.argv.includes('--apply');
  const plan = planKnowledgeDomainMigration();
  for (const line of formatMigrationPlan(plan)) console.log(line);

  if (plan.items.length === 0) {
    console.log('无变更。');
    process.exit(0);
  }
  if (!apply) {
    console.log('dry-run：未做任何变更（加 --apply 落盘）');
    process.exit(0);
  }

  const result = applyKnowledgeDomainMigration(plan);
  console.log(`已迁移 ${result.moved.length} 项 → ${result.legacyDir}`);
}
