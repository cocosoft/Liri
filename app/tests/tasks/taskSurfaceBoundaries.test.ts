/**
 * M10-C / M12-B（2026-10-30，用户裁定）：任务域**边界**守卫。
 *
 * 裁定（一致性核查 M10/M12）：
 * - M10-C：保留双表，**只明确边界** —— `tasks` = 项目人工任务节点（`TaskStore` 唯一写入方）；
 *   `workitems` = PDCA 执行项（`PdcaWorkItemBridge` 唯一写入方）。不迁移数据、不合并表。
 * - M12-B：保留两套入口 —— 项目内「编排」= pdca（`/v1/tasks/pdca/*`）；全局「定时任务」= cron
 *   （`/v1/cron`，`/plans` 仍重定向到 `/cron`）。全局导航**不得**出现指向 pdca 的「计划」入口。
 *
 * 本用例钉住上述边界，防止后续再"顺手"长出第三套写入方或第二个全局入口。
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP = resolve(import.meta.dir, '../..');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

/** 递归列出 `app/src` 下的 .ts 文件（跳过测试目录） */
function listSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...listSrcFiles(full));
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('M10-C 任务域双表边界', () => {
  test('`tasks`（人工任务节点）只由 workspace/TaskStore 写', () => {
    const store = read('src/workspace/TaskStore.ts');
    expect(store).toContain("const TASKS_TABLE_NAME = 'tasks'");
    expect(store).not.toContain('workitems');
  });

  test('`workitems`（PDCA 执行项）只由 tasks/PdcaWorkItemBridge 写', () => {
    const bridge = read('src/tasks/PdcaWorkItemBridge.ts');
    expect(bridge).toContain("const WORKITEM_TABLE = 'workitems'");
    expect(bridge).not.toMatch(/\b(tasks)\b\s*(?:\(|SET|WHERE)/);
  });

  test('全仓只有一处定义各表名常量（防第三套写入方）', () => {
    const files = listSrcFiles(join(APP, 'src'));
    const count = (re: RegExp) =>
      files.filter((f) => re.test(readFileSync(f, 'utf8'))).length;
    expect(count(/TASKS_TABLE_NAME\s*=\s*'tasks'/)).toBe(1);
    expect(count(/WORKITEM_TABLE\s*=\s*'workitems'/)).toBe(1);
  });
});

describe('M12-B 编排 / 定时任务入口区分', () => {
  test('`/plans` 仍重定向到 cron 规范路径（全局「计划」不存在独立页）', () => {
    const routes = read('../client/src/routes/index.tsx');
    expect(routes).toMatch(
      /\{\s*path:\s*"\/plans",\s*element:\s*<Navigate to="\/cron" replace \/>\s*\}/
    );
  });

  test('全局导航不提供指向 pdca 的「计划」入口（项目内「编排」不上升为全局入口）', () => {
    const nav = read('../client/src/config/navRegistry.ts');
    expect(nav).not.toContain('labelKey: "nav.plans"');
    expect(nav).not.toContain('path: "/plans"');
  });
});
