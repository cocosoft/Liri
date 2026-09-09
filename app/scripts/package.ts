/**
 * package.ts — 完整打包流程
 *
 * 将 dist/pkg/ 目录打包为：
 *  - 完整包：liri-vX.Y.Z-{platform}-full.zip（含 Bun 运行时、种子数据、原生依赖）
 *
 * 2026-09-09 决策：退役独立 update.zip（增量包），update 通道复用 full zip。
 *
 * 用法:
 *   bun run scripts/package.ts --platform=win-x64
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { RUNTIME_DEPS } from './package-manifest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 获取版本号 */
function getVersion(): string {
  const pkgJsonPath = path.resolve(__dirname, '..', 'package.json');
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  return pkgJson.version || '0.0.0';
}

/** 使用 PowerShell Compress-Archive 打包目录为 zip */
function createZip(sourceDir: string, outputFile: string): void {
  // 使用 PowerShell 压缩，比 Node 自带的 zlib 更可靠处理大文件和符号链接
  const psCmd = `Compress-Archive -Path "${sourceDir}\\*" -DestinationPath "${outputFile}" -Force`;
  console.log(`[打包] ${outputFile}`);
  try {
    execSync(`powershell -NoProfile -Command "${psCmd}"`, {
      stdio: 'inherit',
      timeout: 120000,
    });
  } catch {
    // PowerShell 可能不可用，回退使用 bun 自带的方法
    console.log('[回退] PowerShell 不可用，使用 bun 打包...');
    // 简单 zip 实现：使用 PowerShell tar（Windows 11+）
    try {
      const tarCmd = `tar.exe -a -c -f "${outputFile}" -C "${sourceDir}" .`;
      execSync(tarCmd, { stdio: 'inherit', timeout: 120000 });
    } catch {
      console.error('[失败] 无法创建 zip 文件，请确保安装了 PowerShell 或 tar');
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  let platform = 'win-x64';

  for (const arg of args) {
    if (arg.startsWith('--platform=')) {
      platform = arg.split('=')[1];
    }
  }

  const version = getVersion();
  const pkgDir = path.resolve(__dirname, '..', '..', 'dist', 'pkg');
  const distDir = path.resolve(__dirname, '..', '..', 'dist');

  console.log(`\n=== Liri 打包 ===`);
  console.log(`版本: v${version}`);
  console.log(`平台: ${platform}`);
  console.log(`源目录: ${pkgDir}`);

  if (!fs.existsSync(pkgDir)) {
    console.error(`[错误] 分发包目录不存在: ${pkgDir}`);
    console.error('请先执行 build:bundle、build:runtime、build:deps、build:seed');
    process.exit(1);
  }

  // 生成启动脚本（每次打包时重新生成，确保内容与方案一致）
  const runBatPath = path.join(pkgDir, 'run.bat');
  const runBatContent = '@echo off\r\nsetlocal\r\nset "LIRI_PROJECT_DIR=%~dp0"\r\n"%~dp0runtime\\bun.exe" run "%~dp0liri.js" %*';
  fs.writeFileSync(runBatPath, runBatContent, 'utf-8');
  console.log(`[生成] run.bat`);

  // 完整包
  const fullZipName = `liri-v${version}-${platform}-full.zip`;
  const fullZipPath = path.join(distDir, fullZipName);
  createZip(pkgDir, fullZipPath);

  const fullZipSize = fs.existsSync(fullZipPath)
    ? `${(fs.statSync(fullZipPath).size / 1024 / 1024).toFixed(1)} MB`
    : '未知';

  console.log(`\n[完成] 完整包: ${fullZipName} (${fullZipSize})`);
  console.log(`       路径: ${fullZipPath}`);

  // 增量包（update.zip）已退役（2026-09-09 决策）：update 通道复用 full zip，本地不再产独立 update 包

  console.log('\n=== 打包完成 ===');
}

main();