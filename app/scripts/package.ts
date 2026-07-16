/**
 * package.ts — 完整打包流程
 *
 * 将 dist/pkg/ 目录打包为：
 *  - 完整包：liri-vX.Y.Z-win-x64-full.zip（含 Bun 运行时、种子数据、原生依赖）
 *  - 增量包：liri-vX.Y.Z-update.zip（仅 liri.js + 变更的 deps）
 *
 * 用法:
 *   bun run scripts/package.ts --platform=win-x64
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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

  // 确保 run.bat 存在（生成启动脚本）
  const runBatPath = path.join(pkgDir, 'run.bat');
  if (!fs.existsSync(runBatPath)) {
    const runBatContent = '@echo off\r\nruntime\\bun.exe run liri.js %*';
    fs.writeFileSync(runBatPath, runBatContent, 'utf-8');
    console.log(`[生成] run.bat`);
  }

  // 完整包
  const fullZipName = `liri-v${version}-${platform}-full.zip`;
  const fullZipPath = path.join(distDir, fullZipName);
  createZip(pkgDir, fullZipPath);

  const fullZipSize = fs.existsSync(fullZipPath)
    ? `${(fs.statSync(fullZipPath).size / 1024 / 1024).toFixed(1)} MB`
    : '未知';

  console.log(`\n[完成] 完整包: ${fullZipName} (${fullZipSize})`);
  console.log(`       路径: ${fullZipPath}`);

  // 增量包（仅 liri.js + deps 中的变更文件）
  const updateDir = path.join(distDir, 'update-tmp');
  if (fs.existsSync(updateDir)) {
    fs.rmSync(updateDir, { recursive: true, force: true });
  }
  fs.mkdirSync(updateDir, { recursive: true });

  // 复制 liri.js
  const liriSrc = path.join(pkgDir, 'liri.js');
  if (fs.existsSync(liriSrc)) {
    fs.copyFileSync(liriSrc, path.join(updateDir, 'liri.js'));
  }

  // 复制 deps/（如果存在）
  const depsSrc = path.join(pkgDir, 'node_modules');
  const depsDest = path.join(updateDir, 'deps', 'node_modules');
  if (fs.existsSync(depsSrc)) {
    const copyRecursive = (src: string, dest: string) => {
      if (!fs.existsSync(src)) return;
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
          copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
      } else {
        const destDir2 = path.dirname(dest);
        if (!fs.existsSync(destDir2)) fs.mkdirSync(destDir2, { recursive: true });
        fs.copyFileSync(src, dest);
      }
    };
    // 只复制 sharp 和 pdfjs-dist（与 build:deps 保持一致）
    for (const dep of ['sharp', 'pdfjs-dist']) {
      const depSrc = path.join(depsSrc, dep);
      const depDst = path.join(depsDest, dep);
      if (fs.existsSync(depSrc)) {
        copyRecursive(depSrc, depDst);
      }
      // 同时复制 @img/* 原生依赖
      const atImgSrc = path.join(depsSrc, '@img');
      const atImgDest = path.join(depsDest, '@img');
      if (fs.existsSync(atImgSrc)) {
        copyRecursive(atImgSrc, atImgDest);
      }
    }
  }

  const updateZipName = `liri-v${version}-update.zip`;
  const updateZipPath = path.join(distDir, updateZipName);
  createZip(updateDir, updateZipPath);

  const updateZipSize = fs.existsSync(updateZipPath)
    ? `${(fs.statSync(updateZipPath).size / 1024 / 1024).toFixed(1)} MB`
    : '未知';

  console.log(`\n[完成] 增量包: ${updateZipName} (${updateZipSize})`);
  console.log(`       路径: ${updateZipPath}`);

  // 清理临时目录
  if (fs.existsSync(updateDir)) {
    fs.rmSync(updateDir, { recursive: true, force: true });
  }

  console.log('\n=== 打包完成 ===');
}

main();