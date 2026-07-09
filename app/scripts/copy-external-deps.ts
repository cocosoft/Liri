/**
 * copy-external-deps.ts — 构建后复制外部依赖到输出目录
 *
 * 用于 bun build --compile 打包后，将 --external 标记的 npm 包
 * 复制到 exe 同目录，供运行时通过 createRequire 加载。
 *
 * 用法:
 *   bun run scripts/copy-external-deps.ts [--target=../dist]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 需要复制的外部依赖列表 */
const EXTERNAL_DEPS = ['pdfjs-dist', 'sharp'];

/**
 * 递归复制目录或文件
 */
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
 * 获取 npm 包的安装路径
 */
function resolvePackagePath(packageName: string): string | null {
  // 从当前脚本所在目录逐级向上查找 node_modules
  let current = path.resolve(__dirname, '..');
  while (true) {
    const candidate = path.join(current, 'node_modules', packageName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // 已到根目录
    current = parent;
  }
  return null;
}

function main(): void {
  const args = process.argv.slice(2);
  let targetDir = path.resolve(__dirname, '..', '..', 'dist');

  for (const arg of args) {
    if (arg.startsWith('--target=')) {
      targetDir = path.resolve(arg.split('=')[1]);
    }
  }

  console.log('\n=== 复制外部依赖到输出目录 ===');
  console.log(`目标目录: ${targetDir}`);

  if (!fs.existsSync(targetDir)) {
    console.error(`[错误] 输出目录不存在: ${targetDir}`);
    console.error('请先执行 bun build --compile');
    process.exit(1);
  }

  // 放入 node_modules 子目录，使 createRequire 能从 deps/ 正确解析
  const depsDir = path.join(targetDir, 'deps', 'node_modules');
  let copiedCount = 0;

  for (const dep of EXTERNAL_DEPS) {
    const srcPath = resolvePackagePath(dep);
    if (!srcPath) {
      console.warn(`[跳过] 未找到依赖: ${dep}`);
      continue;
    }

    const destPath = path.join(depsDir, dep);

    console.log(`[复制] ${dep}:`);
    console.log(`  源: ${srcPath}`);
    console.log(`  目标: ${destPath}`);

    copyRecursive(srcPath, destPath);
    copiedCount++;
  }

  console.log(`\n完成: 已复制 ${copiedCount}/${EXTERNAL_DEPS.length} 个外部依赖`);

  // 复制编译运行时 README
  const readmeSrc = path.resolve(__dirname, '..', 'docs', 'README-compiled.md');
  const readmeDest = path.join(targetDir, 'README-compiled.md');
  if (fs.existsSync(readmeSrc)) {
    fs.copyFileSync(readmeSrc, readmeDest);
    console.log(`[复制] README: ${readmeDest}`);
  } else {
    console.warn(`[跳过] README 文件不存在: ${readmeSrc}`);
  }
}

main();
