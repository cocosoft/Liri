/**
 * 入口脚本显式退出检查器（Script Explicit Exit Linter）
 *
 * **背景**（台账 N-16 / N-49 —— 同一类缺陷已复发两次）：
 * `export-dependency-snapshot.ts` 与 `i18n-snapshot.ts` 的**正常路径**均缺少
 * `process.exit`，而它们经依赖链间接拉起了 DB 建表 / `OAuthService` /
 * `TaskComplexityClassifier` 等**持有定时器与句柄**的初始化 ⇒ 逻辑跑完后进程
 * 不会自行退出，表现为"**命令卡住不返回**"（使用者无法区分"卡死"与"已完成"）。
 * `development-workflow §2.15` 已有该规则，但**从未被自动校验**。
 *
 * **检查范围（关键设计）**：只检查 `package.json#scripts` 中**被引用的入口脚本**。
 * 为什么不是扫 `scripts/` 下全部文件 —— 目录里含**被其他脚本 `import` 的 helper**
 * （如 `app/scripts/resolve-module-aliases.ts`）；给 helper 加 `process.exit`
 * 会**杀掉宿主进程**，故判定范围必须收敛到"确定的入口"。
 *
 * **豁免**：`src/scripts/**`（运行时代码目录，非构建脚本入口）不在检查范围。
 *
 * 运行：cd app && bun run lint:exit（cwd = app/，项目根 = ../）
 * 实现约束：Windows 无系统 grep，全部用 Bun/Node 内置 API。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 项目根目录（scripts/ 的父目录） */
const PROJECT_ROOT = join(import.meta.dir, '..');

/** 待检查的 package.json（相对项目根；根 package.json 可选存在） */
const PACKAGE_FILES = ['app/package.json', 'package.json'];

/** 从 script 命令中提取被引用的脚本路径（`scripts/x.ts` 或 `../scripts/x.ts`） */
const SCRIPT_REF = /(?:^|[\s&|])((?:\.\.\/)?scripts\/[A-Za-z0-9_\-.]+\.tsx?)/g;

/** 合法的显式退出写法：`process.exit(...)` 或 `process.exitCode = ...` */
const EXIT_PATTERN = /process\.exit\(|process\.exitCode\s*=/;

/**
 * 剥离注释后再匹配。
 *
 * 必要性（本检查器自身踩过的坑）：说明性注释里经常出现 `process.exit(1)` 字样
 * （例如"错误分支的 process.exit(1) 不受影响"）—— 若把注释算作合规，
 * **检查就会被注释绕过**（明明没实现，写句注释即可通过）。
 *
 * 剥离策略偏保守：宁可多剥（导致"有实现但被判违规"的误报），也不漏剥
 * （导致"无实现却被放过"的漏报）。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

interface Violation {
  /** 可读来源：`<pkg>#<scriptName> → <ref>` */
  origin: string;
  file: string;
}

function main(): void {
  const violations: Violation[] = [];
  /** 已检查的脚本文件（去重：同一脚本可能被多个 script 引用） */
  const checked = new Set<string>();

  for (const pkgRel of PACKAGE_FILES) {
    const pkgPath = join(PROJECT_ROOT, pkgRel);
    if (!existsSync(pkgPath)) continue;

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    // `app/package.json` → 上级即 `app/`；`package.json` → 上级即项目根
    const pkgDir = join(pkgPath, '..');

    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      for (const match of cmd.matchAll(SCRIPT_REF)) {
        const ref = match[1];
        // 运行时代码目录下的脚本不在本检查职责内
        if (ref.startsWith('../src/') || ref.includes('src/scripts/')) continue;

        const file = join(pkgDir, ref);
        if (!existsSync(file)) continue; // 引用了不存在的文件属另一类问题，见台账

        const key = file.toLowerCase();
        if (checked.has(key)) continue;
        checked.add(key);

        if (!EXIT_PATTERN.test(stripComments(readFileSync(file, 'utf-8')))) {
          violations.push({ origin: `${pkgRel}#${name} → ${ref}`, file });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      '❌ 以下入口脚本缺少显式退出（`process.exit(...)` / `process.exitCode =`）：'
    );
    for (const v of violations) {
      console.error(`  - ${v.origin}`);
    }
    console.error(
      '\n原因：入口脚本若经依赖拉起长驻句柄（定时器 / DB / OAuth 等），逻辑跑完后' +
        '进程不会自行退出，表现为"命令卡住不返回"（台账 N-16 / N-49）。' +
        '\n修法：在入口末尾补 `process.exit(0)`；原有错误分支的 `exit(1)` 保持不变。'
    );
    process.exit(1);
  }

  console.log(
    `✅ 入口脚本显式退出检查通过（已检查 ${checked.size} 个入口脚本）`
  );
  process.exit(0);
}

main();
