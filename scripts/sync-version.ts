/**
 * 版本同步脚本 (Version Sync)
 *
 * 每次发布前运行: bun run scripts/sync-version.ts
 * 将 app/package.json 的 version 同步到所有相关文件。
 *
 * 对应 .trae/rules/versioning.md §三
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

interface SyncTarget {
  file: string;
  field?: string;
  transform?: (v: string) => (content: string) => string;
}

const PROJECT_ROOT = resolve(import.meta.dirname, '..');

// 主版本来源: app/package.json
const MAIN_SOURCE = join(PROJECT_ROOT, 'app', 'package.json');

// 需要同步的目标文件
const TARGETS: SyncTarget[] = [
  // 后端组件
  { file: 'app/native/package.json', field: 'version' },
  {
    file: 'app/native/Cargo.toml',
    transform: (v: string) => (content: string) =>
      content.replace(/^version = ".*"/m, `version = "${v}"`),
  },
  // 前端组件
  { file: 'client/package.json', field: 'version' },
  { file: 'client/src-tauri/tauri.conf.json', field: 'version' },
  {
    file: 'client/src-tauri/Cargo.toml',
    transform: (v: string) => (content: string) =>
      content.replace(/^version = ".*"/m, `version = "${v}"`),
  },
  // Rust 锁文件的**根包版本**（防漂移：原缺此两项，导致 lock 内根包版本长期落后，
  // 实测 app/native/Cargo.lock 曾停 0.4.39、client/src-tauri/Cargo.lock 曾停 0.4.49）。
  // 仅改根包条目（`[[package]]` + 紧随其后的 name/version），不触碰依赖行。
  {
    file: 'app/native/Cargo.lock',
    transform: (v: string) => (content: string) =>
      content.replace(
        /(\[\[package\]\]\r?\nname = "liri-native"\r?\nversion = ")[^"]*(")/,
        `$1${v}$2`
      ),
  },
  {
    file: 'client/src-tauri/Cargo.lock',
    transform: (v: string) => (content: string) =>
      content.replace(
        /(\[\[package\]\]\r?\nname = "liri_client"\r?\nversion = ")[^"]*(")/,
        `$1${v}$2`
      ),
  },
  // 项目主页 badge
  {
    file: 'README.md',
    transform: (v: string) => (content: string) =>
      content
        .replace(/version-\d+\.\d+\.\d+-blue/g, `version-${v}-blue`)
        .replace(
          /当前版本：\*\*v[\d.]+(?:-[a-z0-9.]+)?\*\*/g,
          `当前版本：**v${v}**`
        ),
  },
];

function main(): void {
  // 读取主版本号
  if (!existsSync(MAIN_SOURCE)) {
    console.error(`错误: 找不到主版本文件 ${MAIN_SOURCE}`);
    process.exit(1);
  }

  const mainPkg = JSON.parse(readFileSync(MAIN_SOURCE, 'utf-8'));
  const version: string = mainPkg.version;

  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`错误: app/package.json 中的 version 格式无效: "${version}"`);
    process.exit(1);
  }

  console.log(`正在同步版本 v${version} 到 ${TARGETS.length} 个文件...\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const target of TARGETS) {
    const filePath = join(PROJECT_ROOT, target.file);

    if (!existsSync(filePath)) {
      console.warn(`  ⚠ 跳过 (不存在): ${target.file}`);
      continue;
    }

    try {
      let content = readFileSync(filePath, 'utf-8');

      if (target.field) {
        // JSON 字段替换
        const pkg = JSON.parse(content);
        if (pkg[target.field] === version) {
          console.log(`  ✓ 已是最新: ${target.file} (v${version})`);
          successCount++;
          continue;
        }
        pkg[target.field] = version;
        content = JSON.stringify(pkg, null, 2) + '\n';
      } else if (target.transform) {
        // 自定义转换
        const newContent = target.transform(version)(content);
        if (newContent === content) {
          // 内容未变：若已含目标版本 ⇒ 该文件本就最新；否则才是"占位符未命中"。
          // （原实现一律 warn 且随后又打印"已更新" ⇒ 同一文件自相矛盾，已订正为如实报告）
          if (content.includes(version)) {
            console.log(`  ✓ 已是最新: ${target.file} (v${version})`);
          } else {
            console.warn(`  ⚠ 未找到版本占位符: ${target.file}`);
          }
          successCount++;
          continue;
        }
        content = newContent;
      }

      writeFileSync(filePath, content, 'utf-8');
      console.log(`  ✓ 已更新: ${target.file} → v${version}`);
      successCount++;
    } catch (err) {
      console.error(
        `  ✗ 失败: ${target.file} — ${err instanceof Error ? err.message : String(err)}`
      );
      errorCount++;
    }
  }

  console.log(`\n同步完成: ${successCount} 成功, ${errorCount} 失败`);
  process.exit(errorCount > 0 ? 1 : 0);
}

main();
