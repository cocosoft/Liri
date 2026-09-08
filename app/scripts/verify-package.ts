/**
 * verify-package.ts — 契约驱动的打包产物校验（缺项即红，杜绝假绿）
 *
 * 检查项全部来自 package-manifest.ts（RUNTIME_DEPS），不再手写硬编码清单。
 *
 * 用法:
 *   bun run scripts/verify-package.ts --pkg=<产物目录> [--file=<相对路径>]... [--dir=<相对路径>]...
 *
 * 示例:
 *   bun run scripts/verify-package.ts --pkg=../dist \
 *     --dir=runtime --dir=app/config --file=app/data/pyapp/SOUL.md
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RUNTIME_DEPS } from './package-manifest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface VerifyOptions {
  pkgDir: string;
  files: string[];
  dirs: string[];
}

function parseArgs(): VerifyOptions {
  const args = process.argv.slice(2);
  const opts: VerifyOptions = { pkgDir: '', files: [], dirs: [] };
  for (const arg of args) {
    if (arg.startsWith('--pkg=')) opts.pkgDir = arg.split('=')[1];
    else if (arg.startsWith('--file=')) opts.files.push(arg.split('=')[1]);
    else if (arg.startsWith('--dir=')) opts.dirs.push(arg.split('=')[1]);
  }
  if (!opts.pkgDir) {
    opts.pkgDir = path.resolve(__dirname, '..', '..', 'dist');
  }
  return opts;
}

function main(): void {
  const opts = parseArgs();
  const pkg = path.resolve(opts.pkgDir);

  if (!fs.existsSync(pkg)) {
    console.error(`[verify FAIL] 产物目录不存在: ${pkg}`);
    process.exit(1);
  }

  let failed = false;
  const checkFile = (rel: string, extra = '') => {
    const p = path.join(pkg, rel);
    if (fs.existsSync(p)) {
      console.log(`  ✅ ${rel}`);
    } else {
      console.log(`  ❌ ${rel} MISSING${extra}`);
      failed = true;
    }
  };
  const checkDir = (rel: string, extra = '') => {
    const p = path.join(pkg, rel);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      console.log(`  ✅ ${rel}/`);
    } else {
      console.log(`  ❌ ${rel}/ MISSING${extra}`);
      failed = true;
    }
  };

  console.log(`=== 契约校验: ${pkg} ===`);

  // 1. 运行期外部依赖（唯一来源：package-manifest.ts 契约）
  for (const dep of RUNTIME_DEPS) {
    checkFile(path.join('node_modules', dep, 'package.json'));
  }
  // sharp 的原生平台包（@img/*）必须随包分发
  if (RUNTIME_DEPS.includes('sharp')) {
    checkDir('node_modules/@img', '（sharp 原生二进制缺失，运行时无法加载）');
  }

  // 2. 调用方补充的结构/文件断言
  for (const rel of opts.dirs) checkDir(rel);
  for (const rel of opts.files) checkFile(rel);

  if (failed) {
    console.error('=== Verification FAILED ===');
    process.exit(1);
  }
  console.log('=== Verification passed ===');
}

main();
