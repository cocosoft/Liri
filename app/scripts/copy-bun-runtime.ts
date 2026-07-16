/**
 * copy-bun-runtime.ts — 复制便携 Bun 运行时到分发包
 *
 * 用于方案 C（便携 Bun + bundle）打包，将 bun 二进制从系统安装位置
 * 复制到 dist/pkg/runtime/ 目录，实现 Bun 运行时与业务代码分离。
 *
 * 跨平台支持 Windows / macOS / Linux。
 *
 * 用法:
 *   bun run scripts/copy-bun-runtime.ts [--target=../dist/pkg]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_WINDOWS = process.platform === 'win32';
/** 目标运行时文件名（Windows: bun.exe, Unix: bun） */
const RUNTIME_NAME = IS_WINDOWS ? 'bun.exe' : 'bun';

/**
 * 在 PATH 中查找 bun 二进制
 * Windows 用 where，Unix 用 which
 */
function findBunInPath(): string | null {
  try {
    const cmd = IS_WINDOWS ? 'where bun' : 'which bun';
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });
    const lines = result.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const trimmed = line.trim();
      if (fs.existsSync(trimmed)) {
        return trimmed;
      }
    }
  } catch {
    // PATH 中找不到
  }
  return null;
}

/**
 * 按平台获取候选安装路径
 */
function getPlatformCandidates(): string[] {
  const home = os.homedir();

  if (IS_WINDOWS) {
    return [
      path.join(home, '.bun', 'bin', 'bun.exe'),
      path.join(home, 'AppData', 'Local', 'bun', 'bun.exe'),
      'C:\\Program Files\\bun\\bun.exe',
      'C:\\bun\\bun.exe',
      // CI: setup-bun action 安装位置
      path.join(home, '.bun', 'bin', 'bun'),
    ];
  }

  // Unix (Linux / macOS)
  return [
    path.join(home, '.bun', 'bin', 'bun'),
    '/usr/local/bin/bun',
    '/usr/bin/bun',
    '/opt/bun/bin/bun',
    // macOS Homebrew
    '/opt/homebrew/bin/bun',
    '/usr/local/opt/bun/bin/bun',
    // CI: setup-bun action 安装位置
    path.join(home, '.bun', 'bin', 'bun'),
  ];
}

/**
 * 查找 bun 二进制的路径
 */
function findBunExe(): string | null {
  const candidates: string[] = [];

  // 1. 环境变量 BUN_PATH（CI 可通过此变量覆盖）
  const envBunPath = process.env.BUN_PATH;
  if (envBunPath && fs.existsSync(envBunPath)) {
    candidates.push(envBunPath);
  }

  // 2. PATH 环境变量
  const fromPath = findBunInPath();
  if (fromPath) candidates.push(fromPath);

  // 3. 平台常见安装位置
  candidates.push(...getPlatformCandidates());

  // 4. node_modules 中的 bun
  const nodeModulesBun = path.resolve(
    __dirname, '..', 'node_modules', 'bun', 'bin', 'bun'
  );
  candidates.push(nodeModulesBun);
  // Windows 备选
  if (IS_WINDOWS) {
    candidates.push(nodeModulesBun + '.exe');
  }

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
  console.log(`平台: ${process.platform}`);
  console.log(`运行时文件名: ${RUNTIME_NAME}`);
  console.log(`目标目录: ${targetDir}`);

  const bunExePath = findBunExe();
  if (!bunExePath) {
    console.error('[错误] 未找到 bun 运行时');
    console.error('请确保 Bun 已安装（https://bun.sh）');
    console.error('或设置环境变量 BUN_PATH 指向 bun 二进制路径');
    process.exit(1);
  }

  console.log(`找到 Bun: ${bunExePath}`);
  console.log(`版本: ${execSync(`"${bunExePath}" --version`, { encoding: 'utf-8' }).trim()}`);

  // 创建 runtime 目录
  const runtimeDir = path.join(targetDir, 'runtime');
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true });
  }

  const destPath = path.join(runtimeDir, RUNTIME_NAME);
  fs.copyFileSync(bunExePath, destPath);

  const stat = fs.statSync(destPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
  console.log(`[完成] 已复制 ${RUNTIME_NAME} (${sizeMB} MB) 到 ${destPath}`);
}

main();
