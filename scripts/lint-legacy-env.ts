/**
 * 旧名 env 裸读检查器（Legacy Env Linter）
 *
 * 对应 会话系统历史记录不显示与分区错位优化方案.md P1-2：
 *  - 运行时域（app/src）禁止新增 `PYAPP_PROJECT_DIR` 裸读——分区键源已收敛为
 *    单一真源 `resolveProjectRoot()`（`LIRI_PROJECT_DIR`），旧名仅允许
 *    `core/paths.ts` 内 `resolveWorktreeHash` 回退分支合法使用（白名单豁免）
 *  - 工具链域（scripts/）保持旧名（稳定约定），不受本检查约束
 *
 * 运行：cd app && bun run lint:legacy-env（cwd = app/，项目根 = ../）
 * 实现约束：Windows 无系统 grep，全部用 Bun 内置 API（Bun.file/readdirSync/正则）。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

// ============ 配置 ============

/** 项目根目录（scripts/ 的父目录） */
const PROJECT_ROOT = join(import.meta.dir, '..');
/** 扫描目录：仅运行时域 app/src */
const SCAN_DIR = join(PROJECT_ROOT, 'app', 'src');
/** 检查的文件扩展名 */
const CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
/** 旧名匹配 */
const LEGACY_ENV_PATTERN = /PYAPP_PROJECT_DIR/;
/** 白名单路径（`/` 分隔，rel 已归一化）：P1 方案明确仅 paths.ts 回退分支合法 */
const LEGAL_FILE_FRAGMENTS = ['core/paths.ts'];

interface Violation {
  file: string;
  line: number;
  text: string;
}

/** 递归收集待扫描文件 */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full));
    } else {
      const dot = entry.name.lastIndexOf('.');
      if (dot !== -1 && CHECK_EXTENSIONS.has(entry.name.slice(dot))) {
        out.push(full);
      }
    }
  }
  return out;
}

function main(): void {
  const violations: Violation[] = [];

  for (const file of collectFiles(SCAN_DIR)) {
    const rel = file
      .slice(PROJECT_ROOT.length + 1)
      .split(sep)
      .join('/');
    if (LEGAL_FILE_FRAGMENTS.some((f) => rel.includes(f))) continue;

    const lines = readFileSync(file, 'utf-8').split('\n');
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      let code = raw;

      // 多行注释块内：跳过直到 */ 闭合
      if (inBlockComment) {
        const end = code.indexOf('*/');
        if (end === -1) continue;
        code = code.slice(end + 2);
        inBlockComment = false;
      }

      // 剥掉行注释（// 之后）
      const slash = code.indexOf('//');
      if (slash !== -1) code = code.slice(0, slash);

      const hit = LEGACY_ENV_PATTERN.test(code);

      // 行内开启未闭合的块注释（JSDoc 等）
      const start = raw.indexOf('/*');
      if (start !== -1 && raw.indexOf('*/', start + 2) === -1) {
        inBlockComment = true;
      }

      if (hit) {
        violations.push({ file: rel, line: i + 1, text: raw.trim() });
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `[lint:legacy-env] 运行时域（app/src）发现 ${violations.length} 处 PYAPP_PROJECT_DIR 裸读：`
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.text}`);
    }
    console.error(
      '  分区键源已收敛为 resolveProjectRoot()（LIRI_PROJECT_DIR）。旧名仅允许 core/paths.ts 回退分支，禁止新增裸读。'
    );
    process.exit(1);
  }
  console.log('[lint:legacy-env] 通过：运行时域无 PYAPP_PROJECT_DIR 裸读。');
}

main();
