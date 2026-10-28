/**
 * HD-P1-3（硬编码治理方案 §4.1 A5 取证结论 / §7.2）——
 * **工作区级 `.liri` 名的单一事实源守卫**。
 *
 * **层级区分（本文件的第一道断言，防"把它并进用户级根"的历史误判）**：
 * - `.liri` 是**工作区级**（用户**项目内**、随项目走）⇒ 真源 = `core/paths.ts` 的
 *   `WORKSPACE_CONFIG_DIR_NAME`；
 * - `~/.pyapp` 是**用户级根**（第三层，`resolvePyappHome()`）—— **不同层，不可合并**；
 * - 与之同层的历史 `~/.liri` **迁移已完成**，其残留仅在开发探针脚本里（非产品代码）。
 *
 * 另注（**有意不合并**，见方案 §5）：`~/.pyapp/data/.liri.lock`（`main.ts` 的单实例锁
 * **文件名**）与 `com.liri.client`（Tauri **bundle id**）都只是"名字里带 liri"，属**不同事实源**。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

import {
  WORKSPACE_CONFIG_DIR_NAME,
  resolvePyappHome,
} from '@modules/environment';

/** `app/`（`app/tests/workspace/` → 上两级） */
const APP = join(import.meta.dir, '..', '..');
const APP_SRC = join(APP, 'src');
/** 内核已物理迁出 `app/src/core` ⇒ 仓库根 `packages/kernel/src/core`（方案 §4-P4） */
const KERNEL_SRC = join(APP, '..', 'packages', 'kernel', 'src', 'core');

function collectProductionTs(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      collectProductionTs(join(dir, e.name), out);
    } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
}

const rel = (abs: string): string => relative(APP, abs).split('\\').join('/');

/** 引号**精确**匹配 `'.liri'` / `".liri"` / `` `.liri` ``（不匹配 `.liri/x`、也不匹配 `.liri.lock`） */
const QUOTED_WORKSPACE_DIR = /(['"`])\.liri\1/;

/**
 * **注释行**判据（行首为 `//` / `*` / `/*`）—— 用于排除注释里的引用。
 *
 * ⚠️ 为什么不"先剥 `//` 注释再匹配"（`HD-P0-3` 实测踩过的同款坑）：朴素的 `//` 剥离会把
 * `http://…` 里的 `//` 当注释起点 ⇒ 造成**假绿**（把真字面量一起剥掉）。按**行首**判定则无此问题：
 * 代码行上的字面量仍会被命中（含行尾行内注释那种）—— 只会**宁可多报**，不会漏报。
 */
function isCommentLine(line: string): boolean {
  const s = line.trimStart();
  return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
}

/** 匹配 `CONFIG_DIR_NAME`，但**排除** `WORKSPACE_CONFIG_DIR_NAME`（前缀是 `_`） */
const BARE_CONFIG_DIR_NAME = /(?<!_)CONFIG_DIR_NAME/;

describe('HD-P1-3 · 工作区级 `.liri` 名单一真源', () => {
  it('① 真源取值 + 层级口径：工作区级 `.liri`；用户级根**默认仍是** `~/.pyapp`', () => {
    expect(WORKSPACE_CONFIG_DIR_NAME).toBe('.liri');
    // 2026-10-24 Q3 去产品化：默认值改为「由注入的产品身份派生」，
    // 故这里断言**行为**（默认值不变）而不是源码里的字面量写法。
    // 传空 env 以排除 CI 里 LIRI_HOME 的影响。
    expect(resolvePyappHome({})).toBe(join(homedir(), '.pyapp'));
  });

  it('② 生产代码内 `.liri` 字面量**只允许**出现在真源（消费方一律引用常量）', () => {
    const files: string[] = [];
    collectProductionTs(APP_SRC, files);
    collectProductionTs(KERNEL_SRC, files);
    const hits: string[] = [];
    for (const abs of files) {
      const r = rel(abs);
      // P1（2026-10-28）：真源随内核去 I/O 迁至 `@modules/environment`（paths.ts）
      if (r === 'src/environment/paths.ts') continue; // 真源本身
      readFileSync(abs, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (isCommentLine(line)) return; // 注释里的引用不计（如"工作区级 `.liri` 名"）
          if (QUOTED_WORKSPACE_DIR.test(line)) {
            hits.push(`${r}:${i + 1}  ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });

  it('③ 零消费者假真源 `CONFIG_DIR_NAME` 已移除且未回流', () => {
    const files: string[] = [];
    collectProductionTs(APP_SRC, files);
    collectProductionTs(KERNEL_SRC, files);
    const hits = files.filter((abs) =>
      BARE_CONFIG_DIR_NAME.test(readFileSync(abs, 'utf-8'))
    );
    expect(hits.map(rel)).toEqual([]);
  });

  it('④ 三处消费方确实**引用真源**（而非各写一份）', () => {
    for (const r of [
      'src/workspace/LiriConfigManager.ts',
      'src/workspace/RuleEngine.ts',
      'src/infrastructure/http/handlers/team-handlers.ts',
    ]) {
      const src = readFileSync(join(APP, r), 'utf-8');
      expect(src, `${r} 未引用 WORKSPACE_CONFIG_DIR_NAME`).toContain(
        'WORKSPACE_CONFIG_DIR_NAME'
      );
      expect(src, `${r} 仍从 @modules/core 之外引入`).not.toMatch(
        /['"]\.liri['"]/
      );
    }
  });
});
