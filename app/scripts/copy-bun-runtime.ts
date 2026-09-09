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
 * 在 PATH 中查找 bun 候选（Windows 用 where 返回多个，Unix 用 which）
 * 注意：结果可能命中 npm/PATH shim 脚本（如 AppData\Roaming\npm\bun，仅数百字节），
 * 调用方必须经 isValidBunBinary() 校验后才可使用。
 */
function findBunInPath(): string[] {
  try {
    const cmd = IS_WINDOWS ? 'where bun' : 'which bun';
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });
    return result
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => fs.existsSync(l));
  } catch {
    return [];
  }
}

/**
 * 校验文件是真实的 bun 可执行二进制（根因防御：PATH 中可能存在 npm shim
 * `bun`/`bun.cmd`/`bun.ps1`——数百字节的脚本，复制为 bun.exe 后无法运行）。
 * - 大小：bun 真二进制约 90MB，shim 仅数百字节 → 阈值 10MB
 * - 魔数：Windows PE(MZ) / Unix ELF(\\x7fELF) / macOS Mach-O(fe ed / cf fa / ce fa)
 */
function isValidBunBinary(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (stat.size < 10 * 1024 * 1024) return false;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (IS_WINDOWS) return buf[0] === 0x4d && buf[1] === 0x5a; // MZ → PE
    const isElf = buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
    const isMacho =
      (buf[0] === 0xfe && buf[1] === 0xed) ||
      (buf[0] === 0xcf && buf[1] === 0xfa) ||
      (buf[0] === 0xce && buf[1] === 0xfa);
    return isElf || isMacho;
  } catch {
    return false;
  }
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

  // 1. 当前 bun 运行时自身（最可靠：本脚本由 bun 运行，process.execPath 即真二进制路径）
  if (process.execPath && fs.existsSync(process.execPath)) {
    candidates.push(process.execPath);
  }

  // 2. 环境变量 BUN_PATH（显式覆盖）
  if (process.env.BUN_PATH && fs.existsSync(process.env.BUN_PATH)) {
    candidates.push(process.env.BUN_PATH);
  }

  // 3. PATH 环境变量（含 npm shim 等候选，由魔数校验过滤）
  candidates.push(...findBunInPath());

  // 4. 平台常见安装位置
  candidates.push(...getPlatformCandidates());

  // 5. node_modules 中的 bun
  const nodeModulesBun = path.resolve(
    __dirname, '..', 'node_modules', 'bun', 'bin', 'bun'
  );
  candidates.push(nodeModulesBun);
  if (IS_WINDOWS) {
    candidates.push(nodeModulesBun + '.exe');
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && isValidBunBinary(candidate)) {
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

  // 复制后二次校验（根因防御：防止无效文件被打入分发包）
  if (!isValidBunBinary(destPath)) {
    console.error(`[错误] 复制后的 ${RUNTIME_NAME} 不是有效可执行二进制（来源: ${bunExePath}）`);
    console.error('请通过 bun 官方安装器安装运行时，或设置 BUN_PATH 指向真二进制');
    fs.rmSync(destPath, { force: true });
    process.exit(1);
  }

  const stat = fs.statSync(destPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
  console.log(`[完成] 已复制 ${RUNTIME_NAME} (${sizeMB} MB) 到 ${destPath}`);
}

main();
