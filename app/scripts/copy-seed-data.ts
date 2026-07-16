/**
 * copy-seed-data.ts — 复制第一层只读种子数据到分发包
 *
 * 复制 .env.example、docs/、config/、SOUL.md、USER.md、knowledge/、
 * memory-index.json、credentials/.key 等首次分发资源。
 *
 * 排除技能外部目录、运行时产物（db、lock、logs、cache 等）和测试文件。
 *
 * 用法:
 *   bun run scripts/copy-seed-data.ts [--target=../dist/pkg]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 递归复制目录或文件 */
function copyRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    console.warn(`[跳过] 源路径不存在: ${src}`);
    return;
  }

  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

/**
 * 递归复制目录，支持排除模式
 * @param src 源目录
 * @param dest 目标目录
 * @param excludePatterns glob 风格排除列表（匹配文件名或路径片段）
 */
function copyRecursiveWithExclude(
  src: string,
  dest: string,
  excludePatterns: RegExp[]
): void {
  if (!fs.existsSync(src)) {
    console.warn(`[跳过] 源路径不存在: ${src}`);
    return;
  }

  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    // 检查目录名是否命中排除
    const dirName = path.basename(src);
    if (excludePatterns.some((p) => p.test(dirName) || p.test(src))) {
      console.log(`[排除] ${src}`);
      return;
    }

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    for (const entry of fs.readdirSync(src)) {
      copyRecursiveWithExclude(
        path.join(src, entry),
        path.join(dest, entry),
        excludePatterns
      );
    }
  } else {
    // 检查文件名是否命中排除
    const fileName = path.basename(src);
    if (excludePatterns.some((p) => p.test(fileName) || p.test(src))) {
      return;
    }

    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  let targetDir = path.resolve(__dirname, '..', '..', 'dist', 'pkg');

  for (const arg of args) {
    if (arg.startsWith('--target=')) {
      targetDir = path.resolve(arg.split('=')[1]);
    }
  }

  const appRoot = path.resolve(__dirname, '..');
  const dataRoot = path.join(appRoot, 'data', 'pyapp');

  console.log('\n=== 复制种子数据到分发包 ===');
  console.log(`源目录: ${appRoot}`);
  console.log(`目标目录: ${targetDir}`);

  // 确保目标 app/ 目录存在
  const targetAppDir = path.join(targetDir, 'app');
  if (!fs.existsSync(targetAppDir)) {
    fs.mkdirSync(targetAppDir, { recursive: true });
  }

  // ── §4.3 第一层只读资源 ──

  // .env.example
  const envExampleSrc = path.join(appRoot, '.env.example');
  const envExampleDest = path.join(targetAppDir, '.env.example');
  if (fs.existsSync(envExampleSrc)) {
    fs.copyFileSync(envExampleSrc, envExampleDest);
    console.log(`[复制] .env.example`);
  } else {
    console.warn(`[跳过] .env.example 不存在: ${envExampleSrc}`);
  }

  // docs/
  const docsSrc = path.join(appRoot, 'docs');
  const docsDest = path.join(targetAppDir, 'docs');
  if (fs.existsSync(docsSrc)) {
    copyRecursive(docsSrc, docsDest);
    console.log(`[复制] docs/`);
  } else {
    console.warn(`[跳过] docs/ 不存在: ${docsSrc}`);
  }

  // config/startup.yaml 和 permissions.yaml
  const configSrc = path.join(appRoot, 'config');
  const configDest = path.join(targetAppDir, 'config');
  if (fs.existsSync(configSrc)) {
    for (const file of ['startup.yaml', 'permissions.yaml']) {
      const src = path.join(configSrc, file);
      const dest = path.join(configDest, file);
      if (fs.existsSync(src)) {
        if (!fs.existsSync(configDest)) {
          fs.mkdirSync(configDest, { recursive: true });
        }
        fs.copyFileSync(src, dest);
        console.log(`[复制] config/${file}`);
      }
    }
  }

  // ── §4.4 种子数据 ──

  const targetDataDir = path.join(targetAppDir, 'data', 'pyapp');
  if (!fs.existsSync(targetDataDir)) {
    fs.mkdirSync(targetDataDir, { recursive: true });
  }

  // SOUL.md 和 USER.md
  for (const file of ['SOUL.md', 'USER.md']) {
    const src = path.join(dataRoot, file);
    const dest = path.join(targetDataDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`[复制] data/pyapp/${file}`);
    } else {
      console.warn(`[跳过] data/pyapp/${file} 不存在`);
    }
  }

  // 排除规则（运行时产物 + 测试文件 + 外置 skill）
  const seedExcludes: RegExp[] = [
    /\.db$/,
    /\.db-journal$/,
    /\.db-wal$/,
    /\.db-shm$/,
    /\.liri\.lock$/,
    /\.onboarded$/,
    /^logs$/,
    /^cache$/,
    /^sessions$/,
    /^temp$/,
    /^processed$/,
    /^skills-external$/,
    /bench_large_.*\.bin/,
  ];

  // knowledge/
  const knowledgeSrc = path.join(dataRoot, 'knowledge');
  const knowledgeDest = path.join(targetDataDir, 'knowledge');
  if (fs.existsSync(knowledgeSrc)) {
    copyRecursiveWithExclude(knowledgeSrc, knowledgeDest, seedExcludes);
    console.log(`[复制] data/pyapp/knowledge/`);
  } else {
    console.warn(`[跳过] data/pyapp/knowledge/ 不存在`);
  }

  // skills/（排除 skills-external/）
  const skillsSrc = path.join(dataRoot, 'skills');
  const skillsDest = path.join(targetDataDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    copyRecursiveWithExclude(skillsSrc, skillsDest, seedExcludes);
    console.log(`[复制] data/pyapp/skills/`);
  } else {
    console.warn(`[跳过] data/pyapp/skills/ 不存在`);
  }

  // data/memory/memory-index.json
  const memoryIndexSrc = path.join(dataRoot, 'data', 'memory', 'memory-index.json');
  const memoryIndexDest = path.join(targetDataDir, 'data', 'memory', 'memory-index.json');
  if (fs.existsSync(memoryIndexSrc)) {
    if (!fs.existsSync(path.dirname(memoryIndexDest))) {
      fs.mkdirSync(path.dirname(memoryIndexDest), { recursive: true });
    }
    fs.copyFileSync(memoryIndexSrc, memoryIndexDest);
    console.log(`[复制] data/pyapp/data/memory/memory-index.json`);
  } else {
    console.warn(`[跳过] memory-index.json 不存在`);
  }

  // credentials/.key
  const keySrc = path.join(dataRoot, 'credentials', '.key');
  const keyDest = path.join(targetDataDir, 'credentials', '.key');
  if (fs.existsSync(keySrc)) {
    if (!fs.existsSync(path.dirname(keyDest))) {
      fs.mkdirSync(path.dirname(keyDest), { recursive: true });
    }
    fs.copyFileSync(keySrc, keyDest);
    console.log(`[复制] data/pyapp/credentials/.key`);
  } else {
    console.warn(`[跳过] credentials/.key 不存在`);
  }

  console.log('\n[完成] 种子数据复制完成');
}

main();