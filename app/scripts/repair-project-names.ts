// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * repair-project-names.ts — #22（2026-10-30）
 *
 * 一次性修复 `project.json` 里"历史遗留的坏项目名"（引用块/路径被截进名称、
 * 括号未闭合），只改 `name`，**项目 id 与关联会话不变**。
 *
 * 真机证据（`~/.pyapp/data/projects/<projectId>/project.json`）：
 * - `【E:\PY\Documents\CODES\PY_APP\`
 * - `我与gemini进行了一轮沟通，见【E:\PY\Docume`
 *
 * 语义：
 * - 复用 `create_project` 的同一套清洗（`resolveProjectIdentity`），不写第二套口径；
 * - **默认 dry-run**，只有 `--apply` 才落盘；
 * - 落盘前把原文件备份为 `project.json.bak-<时间戳>`（**不删除**任何内容，可手工回滚）；
 * - 幂等：再跑一次 ⇒ 0 变更。
 *
 * 用法：
 *   bun run scripts/repair-project-names.ts            # dry-run
 *   bun run scripts/repair-project-names.ts --apply    # 落盘
 */

import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@modules/environment';
import { resolveProjectIdentity } from '../src/tools/CreateProjectTool/projectName.js';

export const PROJECTS_DIR = 'projects';

export interface ProjectNameRepair {
  id: string;
  file: string;
  before: string;
  after: string;
}

/**
 * 计算修复计划（**无副作用**）。
 *
 * @param projectsRoot `resolveDataDir()/projects`
 * @param now 默认名用的时钟（测试注入固定时刻）
 */
export function planProjectNameRepair(
  projectsRoot: string,
  now: Date = new Date()
): ProjectNameRepair[] {
  if (!existsSync(projectsRoot)) return [];
  const plan: ProjectNameRepair[] = [];
  for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(projectsRoot, entry.name, 'project.json');
    if (!existsSync(file)) continue;
    let raw: { name?: unknown };
    try {
      raw = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown };
    } catch {
      // 坏 JSON 不参与修复（避免把文件写坏）；单独提示交由人工处理
      console.warn(`跳过（JSON 解析失败）：${file}`);
      continue;
    }
    const before = typeof raw.name === 'string' ? raw.name : '';
    const after = resolveProjectIdentity(before, { now }).name;
    if (after === before) continue;
    plan.push({ id: entry.name, file, before, after });
  }
  return plan;
}

/**
 * 执行修复（先备份再写）。
 *
 * @param stamp 备份后缀（默认当前时间；测试注入固定值）
 */
export function applyProjectNameRepair(
  plan: ProjectNameRepair[],
  stamp: string = new Date().toISOString().replaceAll(':', '-')
): { repaired: number; backups: string[] } {
  const backups: string[] = [];
  for (const item of plan) {
    const backup = `${item.file}.bak-${stamp}`;
    copyFileSync(item.file, backup);
    backups.push(backup);
    const current = JSON.parse(readFileSync(item.file, 'utf8')) as Record<
      string,
      unknown
    >;
    writeFileSync(
      item.file,
      `${JSON.stringify({ ...current, name: item.after }, null, 2)}\n`,
      'utf8'
    );
  }
  return { repaired: plan.length, backups };
}

/** 打印计划（CLI 与测试共用同一文案口径） */
export function formatProjectNameRepair(plan: ProjectNameRepair[]): string[] {
  if (plan.length === 0) return ['待修复项目名：0（已是目标状态）'];
  const lines = [`待修复项目名：${plan.length}`];
  for (const item of plan) {
    lines.push(`  - ${item.id}`);
    lines.push(`      原：${item.before.replace(/\n/g, ' ')}`);
    lines.push(`      新：${item.after}`);
  }
  return lines;
}

if (import.meta.main) {
  const apply = process.argv.includes('--apply');
  const projectsRoot = join(resolveDataDir(), PROJECTS_DIR);
  const plan = planProjectNameRepair(projectsRoot);
  console.log(`项目目录：${projectsRoot}`);
  for (const line of formatProjectNameRepair(plan)) console.log(line);

  if (plan.length === 0) {
    console.log('无变更。');
    process.exit(0);
  }
  if (!apply) {
    console.log('dry-run：未做任何变更（加 --apply 落盘）');
    process.exit(0);
  }
  const result = applyProjectNameRepair(plan);
  console.log(`已修复 ${result.repaired} 个项目名，备份 ${result.backups.length} 份。`);
}
