/**
 * copy-bun-runtime.ts — 复制便携 Bun 运行时到分发包
 *
 * 用于方案 C（便携 Bun + bundle）打包，将 bun.exe 从系统安装位置
 * 复制到 dist/pkg/runtime/ 目录，实现 Bun 运行时与业务代码分离。
 *
 * 用法:
 *   bun run scripts/copy-bun-runtime.ts [--target=../dist/pkg]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 查找 bun.exe 的多个可能位置 */
function findBunExe(): string | null {
  const candidates: string[] = [];

  // 1. PATH 环境变量（通过 where 命令）
  try {
    const result = execSync('where bun', { encoding: 'utf-8', timeout: 5000 });
    const lines = result.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.endsWith('.exe') && fs.existsSync(trimmed)) {
        candidates.push(trimmed);
      }
    }
  } catch {
    // PATH 中找不到，继续尝试其他位置
  }

  // 2. 常见安装位置
  const homeDir = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Administrator';
  candidates.push(
    path.join(homeDir, '.bun', 'bin', 'bun.exe'),
    path.join(homeDir, 'AppData', 'Local', 'bun', 'bun.exe'),
    'C:\\Program Files\\bun\\bun.exe',
    'C:\\bun\\bun.exe',
  );

  // 3. 从 node_modules 中查找
  const appNodeModules = path.resolve(__dirname, '..', 'node_modules', 'bun', 'bin', 'bun.exe');
  candidates.push(appNodeModules);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function main(): void {
  const args = process.argv.slice(2);
  let targetDir = path.resolve(__dirname, '..', '..', 'dist', 'pkg');

  for (const arg of args) {
    if (arg.startsWith('--target=')) {
      targetDir = path.resolve(arg.split('=')[1]);
    }
  }

  console.log('\n=== 复制便携 Bun 运行时 ===');
  console.log(`目标目录: ${targetDir}`);

  const bunExePath = findBunExe();
  if (!bunExePath) {
    console.error('[错误] 未找到 bun.exe');
    console.error('请确保 Bun 已安装（https://bun.sh）');
    process.exit(1);
  }

  console.log(`找到 Bun: ${bunExePath}`);
  console.log(`版本: ${execSync(`"${bunExePath}" --version`, { encoding: 'utf-8' }).trim()}`);

  // 创建 runtime 目录
  const runtimeDir = path.join(targetDir, 'runtime');
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true });
  }

  const destPath = path.join(runtimeDir, 'bun.exe');
  fs.copyFileSync(bunExePath, destPath);

  const stat = fs.statSync(destPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
  console.log(`[完成] 已复制 bun.exe (${sizeMB} MB) 到 ${destPath}`);
}

main();