/**
 * 源码扫描根**单一事实源**（G1 拆包门禁方案 · 形态 A，2026-11-12）
 *
 * **背景**：58 条门禁里约 8 条各自维护一份"源码根列表"，且随着包迁出（kernel / infra / service）
 * 逐个补、屡次出现"迁出即脱离扫描面"的**静默盲区**——实证：
 * `scripts/lint-state-literal-ratchet.ts` 注释「P29–P32 迁入的 203 个文件此前不在扫描面内」。
 *
 * **本模块的职责（单一）**：回答"要扫哪些源码根"。`app/src` + 自动发现的 `packages/*\/src`。
 * 新增/迁出包时**不需要逐个改门禁**（自动纳入），门禁侧只消费本模块 —— 避免再次出现
 * 「包拆了、门禁没跟上」（AR-3：门禁不得因搬目录而静默失焦）。
 *
 * **边界（刻意不做的事）**：
 *  - 只做**发现**，不做过滤策略：各门禁仍自行决定跳过哪些子目录（`tests/` / `dist/` / `node_modules`）；
 *  - `packages/*` 下没有 `src` 的包（纯类型包等）自动跳过，不报错；
 *  - 顺序稳定（`app` 在前，`packages` 按名称升序）⇒ 便于日志阅读与"扫描文件数"前后对比。
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface SourceRoot {
  /** 逻辑名：`app` 或包名（如 `kernel` / `infra` / `service`） */
  name: string;
  /** 绝对路径：`<root>/app/src` 或 `<root>/packages/<pkg>/src` */
  path: string;
}

/**
 * 解析源码扫描根。
 *
 * @param projectDir 仓库根（`scripts/` 的父目录；调用方通常为 `join(import.meta.dir, '..')`，
 *                   带 `PYAPP_PROJECT_DIR` 覆盖的门禁则传其解析结果）
 */
export function resolveSourceRoots(projectDir: string): SourceRoot[] {
  const roots: SourceRoot[] = [];

  const appSrc = join(projectDir, 'app', 'src');
  if (existsSync(appSrc)) roots.push({ name: 'app', path: appSrc });

  const packagesDir = join(projectDir, 'packages');
  if (existsSync(packagesDir)) {
    const names = readdirSync(packagesDir)
      .filter((name) => {
        try {
          return statSync(join(packagesDir, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
    for (const name of names) {
      const src = join(packagesDir, name, 'src');
      if (existsSync(src)) roots.push({ name, path: src });
    }
  }

  return roots;
}

/** 便捷入口：多数门禁只需要路径列表 */
export function resolveSourceRootPaths(projectDir: string): string[] {
  return resolveSourceRoots(projectDir).map((root) => root.path);
}
