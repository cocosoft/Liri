/**
 * check-paths.ts — 路径使用安全检查脚本
 *
 * 扫描 src/ 下所有代码文件，检查是否存在违反路径使用规范的情况：
 *   1. `__dirname` 使用（仅允许在已标注的风险文件中出现）
 *   2. `process.cwd()` 用于路径拼接（潜在的持久化风险）
 *
 * 用法: bun run scripts/check-paths.ts
 * 集成: 已加入 bun run ci 流程
 *
 * 关联规范: .trae/rules/paths.md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_DIR = path.resolve(__dirname, '..', 'src');

/** 允许使用 __dirname 的文件（相对 src/ 的路径），必须是已知风险且仅用于开发场景 */
const DIRNAME_ALLOWLIST: string[] = [
  'tools/DependencyGraphScanner.ts',
  'agent/utils/__tests__/directoryWatcher.test.ts',
];

/**
 * 允许使用 process.cwd() 路径拼接的文件（相对 src/ 的路径）
 *
 * 这些文件因其特殊角色无法使用 config/paths.ts：
 *   - pyapp.ts: 引导层，在 config/paths 加载前执行，已有六道防线保障 exe 环境
 *   - __tests__ 目录下的文件: 测试文件不会被编译进 exe，process.cwd() 指向项目根即可
 */
const CWD_ALLOWLIST: string[] = [
  'pyapp.ts',
  'runtime/config/__tests__/ConfigHotReload.test.ts',
  'sandbox/__tests__/WorkspaceManager.test.ts',
  'security/files/__tests__/FileSafety.test.ts',
  'tools/__tests__/FileReadIntegration.test.ts',
  '__tests__/end-to-end-smoke.test.ts',
];

/** 需要排除的目录 */
const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
]);

interface Violation {
  file: string;
  line: number;
  content: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
}

/**
 * 递归遍历目录，收集所有代码文件
 */
function walkDir(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (/\.(ts|js|tsx|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * 检查单文件中是否存在路径使用违规
 */
function checkFile(filePath: string, relPath: string): Violation[] {
  const violations: Violation[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const isDirnameAllowlisted = DIRNAME_ALLOWLIST.includes(relPath);
  const isCwdAllowlisted = CWD_ALLOWLIST.includes(relPath);

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    if (/^\s*(\/\/|\*)/.test(line)) {
      continue;
    }

    if (trimmed.includes('__dirname') && !isDirnameAllowlisted) {
      violations.push({
        file: relPath,
        line: lineNum,
        content: trimmed,
        severity: 'error',
        message: '禁止使用 __dirname，编译 exe 后指向临时目录，改用 resolveProjectRoot()',
      });
    }

    if (/process\.cwd\(\)/.test(trimmed)) {
      const isPathJoin = /join\s*\(\s*process\.cwd\(\)/.test(trimmed);
      const isPathResolve = /resolve\s*\(\s*process\.cwd\(\)/.test(trimmed);
      const isPathConcat = /\+\s*process\.cwd\(\)/.test(trimmed) || /process\.cwd\(\)\s*\+/.test(trimmed);

      if ((isPathJoin || isPathResolve || isPathConcat) && !isCwdAllowlisted) {
        violations.push({
          file: relPath,
          line: lineNum,
          content: trimmed,
          severity: 'warn',
          message: 'process.cwd() 用于路径拼接，可能是数据持久化操作，请改用 config/paths.ts 的函数',
        });
      }
    }
  }

  return violations;
}

/**
 * 检查白名单文件是否仍带有已知风险标注
 */
function validateAllowlist(): void {
  for (const relPath of DIRNAME_ALLOWLIST) {
    const filePath = path.join(SRC_DIR, relPath);
    if (!fs.existsSync(filePath)) {
      console.error(`  ⚠️  白名单文件不存在: ${relPath}`);
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.includes('已知风险')) {
      console.warn(`  ⚠️  白名单文件 ${relPath} 缺少"已知风险"标注，请确认是否仍需要使用 __dirname`);
    }
  }
}

/**
 * 统计 process.cwd() 总体使用情况（按类别分组）
 */
function countProcessCwd(files: string[]): {
  total: number;
  allowlisted: number;
  unlisted: number;
} {
  let total = 0;
  let allowlisted = 0;
  let unlisted = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relPath = path.relative(SRC_DIR, filePath).replace(/\\/g, '/');
    const lines = content.split('\n');

    let fileCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/process\.cwd\(\)/.test(lines[i]) && !/^\s*(\/\/|\*)/.test(lines[i])) {
        fileCount++;
      }
    }

    total += fileCount;
    if (CWD_ALLOWLIST.includes(relPath)) {
      allowlisted += fileCount;
    } else {
      unlisted += fileCount;
    }
  }

  return { total, allowlisted, unlisted };
}

function main(): void {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`❌ 源码目录不存在: ${SRC_DIR}`);
    process.exit(1);
  }

  const files = walkDir(SRC_DIR);
  let allViolations: Violation[] = [];

  validateAllowlist();

  for (const filePath of files) {
    const relPath = path.relative(SRC_DIR, filePath).replace(/\\/g, '/');
    const violations = checkFile(filePath, relPath);
    allViolations = allViolations.concat(violations);
  }

  const cwdStats = countProcessCwd(files);

  const errors = allViolations.filter((v) => v.severity === 'error');
  const warnings = allViolations.filter((v) => v.severity === 'warn');

  console.log('');
  console.log('🔍 路径使用安全检查');

  if (errors.length > 0) {
    console.log('');
    console.log(`❌ [错误] 发现 ${errors.length} 个违规使用 __dirname：`);
    console.log('');
    for (const v of errors) {
      console.log(`  ${v.file}:${v.line}`);
      console.log(`    ${v.content}`);
      console.log(`    → ${v.message}`);
      console.log('');
    }
  }

  if (warnings.length > 0) {
    console.log(`⚠️  [警告] 发现 ${warnings.length} 个 process.cwd() 路径拼接：`);
    console.log('');
    for (const v of warnings) {
      console.log(`  ${v.file}:${v.line}`);
      console.log(`    ${v.content}`);
      console.log(`    → ${v.message}`);
      console.log('');
    }
  }

  console.log('📊 统计');
  console.log('');
  console.log(`    扫描文件数:           ${files.length}`);
  console.log(`    process.cwd() 总计:   ${cwdStats.total} 处使用`);
  if (cwdStats.allowlisted > 0) {
    console.log(`      白名单内:          ${cwdStats.allowlisted} 处（引导层/测试文件）`);
  }
  if (cwdStats.unlisted > 0) {
    console.log(`      未分类（安全使用）:  ${cwdStats.unlisted} 处`);
  }
  if (errors.length > 0) {
    console.log(`    __dirname 违规:       ${errors.length} 个 ❌`);
  } else {
    console.log(`    __dirname 违规:       0 个 ✅`);
  }
  if (warnings.length > 0) {
    console.log(`    路径拼接风险:         ${warnings.length} 个 ⚠️`);
  } else {
    console.log(`    路径拼接风险:         0 个 ✅`);
  }

  if (errors.length > 0) {
    console.log('');
    console.log('❌ 路径安全检查未通过：存在违规使用 __dirname，请修复后重试。');
    process.exit(1);
  }

  console.log('');
  console.log('✅ 路径安全检查通过。');
  process.exit(0);
}

main();
