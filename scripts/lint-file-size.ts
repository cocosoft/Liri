/**
 * 巨型文件检查器 (File Size Linter)
 *
 * 在 CI 中运行：bun run scripts/lint-file-size.ts
 * 检查项目中的巨型文件（>500 行警告，>1000 行错误）。
 *
 * 对应 .trae/rules/project_rules.md §6 优化项 E：巨型文件拆分。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EOL } from 'node:os';

// ============ 配置 ============

/** 超过此行数为警告 */
const WARN_LINES = 500;
/** 超过此行数为错误（与 R04-001 MUST 800 行对齐） */
const ERROR_LINES = 800;
/** 排除目录 */
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'target', '.trae']);
/** 检查的文件扩展名 */
const CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.rs']);

// ============ 类型定义 ============

interface FileSizeResult {
    file: string;
    lines: number;
    sizeKB: number;
    severity: 'error' | 'warning' | 'ok';
}

/**
 * 加载文件大小例外（R04-001）
 * 来源：scripts/layer-exceptions.json 的 fileSizeExceptions（与 lint-architecture.ts 同源）。
 * 历史巨型文件登记为例外后不再阻塞 CI，仅拦截新增超限文件。
 */
function loadFileSizeExceptions(): Set<string> {
    const exPath = join(import.meta.dir, 'layer-exceptions.json');
    const exceptions = new Set<string>();
    if (!existsSync(exPath)) return exceptions;

    try {
        const data = JSON.parse(readFileSync(exPath, 'utf-8'));
        for (const ex of data.fileSizeExceptions || []) {
            // 已过期的例外失效（强制重新评估）
            if (ex.expiresAt && new Date(ex.expiresAt) < new Date()) continue;
            exceptions.add(ex.file.replace(/\\/g, '/').toLowerCase());
        }
    } catch {
        /* 例外文件解析失败时不豁免任何文件（保持严格检查） */
    }
    return exceptions;
}

// ============ 工具函数 ============

function readdirSyncFull(dir: string): Array<{ name: string; isDirectory: () => boolean }> {
    const fs = require('node:fs');
    return fs.readdirSync(dir, { withFileTypes: true });
}

/** 递归收集目录下所有匹配文件（排除指定目录） */
function collectFiles(dir: string): string[] {
    const results: string[] = [];
    try {
        const entries = readdirSyncFull(dir);
        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (EXCLUDE_DIRS.has(entry.name)) continue;
                results.push(...collectFiles(fullPath));
            } else {
                const ext = entry.name.slice(entry.name.lastIndexOf('.'));
                if (CHECK_EXTENSIONS.has(ext)) {
                    results.push(fullPath);
                }
            }
        }
    } catch {
        /* 目录不存在时忽略 */
    }
    return results;
}

/** 统计文件行数 */
function countLines(filePath: string): number {
    const content = readFileSync(filePath, 'utf-8');
    return content.split(/\r?\n/).length;
}

// ============ 主流程 ============

async function main(): Promise<void> {
    const rootDir = process.cwd();
    const fileSizeExceptions = loadFileSizeExceptions();
    const srcDirs = [
        join(rootDir, 'app', 'src'),
        join(rootDir, 'client', 'src'),
        join(rootDir, 'app', 'native'),
    ];

    console.log('=== 巨型文件检查器 ===');
    console.log(`规则: >${WARN_LINES} 行 = 警告, >${ERROR_LINES} 行 = 错误`);
    console.log();

    const allResults: FileSizeResult[] = [];

    for (const srcDir of srcDirs) {
        if (!existsSync(srcDir)) {
            console.log(`跳过不存在的目录: ${relative(rootDir, srcDir)}`);
            continue;
        }

        const files = collectFiles(srcDir);
        console.log(`检查目录: ${relative(rootDir, srcDir)} (${files.length} 个文件)`);

        for (const file of files) {
            const lines = countLines(file);
            const stat = require('node:fs').statSync(file);
            const sizeKB = Math.round(stat.size / 1024);

            if (lines > WARN_LINES) {
                const relPath = relative(rootDir, file);
                const severity = lines > ERROR_LINES ? 'error' : 'warning';
                // 已登记例外的历史巨型文件（R04-001）豁免，不再阻塞 CI
                const exempt =
                    severity === 'error' &&
                    fileSizeExceptions.has(relPath.replace(/\\/g, '/').toLowerCase());

                allResults.push({
                    file: exempt ? `${relPath}（例外豁免）` : relPath,
                    lines,
                    sizeKB,
                    severity: exempt ? 'ok' : severity,
                });
            }
        }
    }

    // 按行数降序排列
    allResults.sort((a, b) => b.lines - a.lines);

    // 输出结果
    if (allResults.length === 0) {
        console.log();
        console.log('未发现巨型文件。');
        process.exit(0);
    }

    let errorCount = 0;
    let warningCount = 0;
    let exemptCount = 0;

    console.log();
    console.log(`发现 ${allResults.length} 个超标文件（R04-001 例外豁免 ${fileSizeExceptions.size} 项已加载）:`);
    console.log('-'.repeat(80));

    for (const result of allResults) {
        const tag =
            result.severity === 'error'
                ? '[ERROR]'
                : result.severity === 'warning'
                  ? '[WARN ]'
                  : '[EXEMPT]';
        const prefix =
            result.severity === 'error'
                ? '\x1b[31m'
                : result.severity === 'warning'
                  ? '\x1b[33m'
                  : '\x1b[36m';
        const suffix = '\x1b[0m';

        console.log(`${prefix}${tag}${suffix} ${result.lines} 行 (${result.sizeKB} KB) - ${result.file}`);

        if (result.severity === 'error') errorCount++;
        else if (result.severity === 'warning') warningCount++;
        else exemptCount++;
    }

    console.log('-'.repeat(80));
    console.log(`总计: ${errorCount} 个错误, ${warningCount} 个警告, ${exemptCount} 个例外豁免`);
    console.log();

    // 退出码：有错误则失败（例外豁免不计入）
    if (errorCount > 0) {
        console.log('存在 >800 行且未登记例外的文件需要拆分（阻塞合并）。');
        console.log('历史巨型文件请登记到 scripts/layer-exceptions.json 的 fileSizeExceptions（R04-001）。');
        process.exit(1);
    } else {
        console.log('警告级文件建议拆分，但不阻塞合并。');
        process.exit(0);
    }
}

main().catch((err) => {
    console.error('检查器内部错误:', err);
    process.exit(2);
});