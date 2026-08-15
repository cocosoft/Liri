/**
 * package-compile.ts — compile 模式发布包
 *
 * 将 dist/（liri_terminal.exe + node_modules + README-compiled.md）整体打包为 zip，
 * 作为**发布单元**。exe 与 node_modules 是强绑定的一对——exe 运行时通过
 * Module._resolveFilename hook 从 exe 同级 node_modules 加载 external 依赖
 * （sharp/pdfjs-dist），单独分发 exe 会导致 "Cannot find package" 类错误。
 *
 * 用法:
 *   bun run scripts/package-compile.ts [--platform=win-x64]
 *
 * 产物: <root>/release/liri-terminal-v<version>-<platform>.zip
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
  const psCmd = `Compress-Archive -Path "${sourceDir}\\*" -DestinationPath "${outputFile}" -Force`;
  console.log(`[打包] ${outputFile}`);
  try {
    execSync(`powershell -NoProfile -Command "${psCmd}"`, {
      stdio: 'inherit',
      timeout: 300000,
    });
  } catch {
    console.log('[回退] PowerShell 不可用，使用 tar 打包...');
    const tarCmd = `tar.exe -a -c -f "${outputFile}" -C "${sourceDir}" .`;
    execSync(tarCmd, { stdio: 'inherit', timeout: 300000 });
  }
}

/** 目录大小（MB） */
function getDirSizeMB(dirPath: string): string {
  let total = 0;
  const walk = (p: string): void => {
    if (!fs.existsSync(p)) return;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(p)) walk(path.join(p, entry));
    } else {
      total += stat.size;
    }
  };
  walk(dirPath);
  return (total / 1024 / 1024).toFixed(1);
}

function main(): void {
  const args = process.argv.slice(2);
  let platform = process.platform === 'win32' ? 'win-x64' : process.platform + '-x64';

  for (const arg of args) {
    if (arg.startsWith('--platform=')) {
      platform = arg.split('=')[1];
    }
  }

  const version = getVersion();
  const targetDir = path.resolve(__dirname, '..', '..', 'dist');
  const releaseDir = path.resolve(targetDir, '..', 'release');

  console.log('\n=== Liri compile 发布包 ===');
  console.log(`版本: v${version}`);
  console.log(`平台: ${platform}`);
  console.log(`源目录: ${targetDir}`);

  if (!fs.existsSync(targetDir)) {
    console.error(`[错误] dist 目录不存在: ${targetDir}`);
    console.error('请先执行 build:win:coding 或 build:mac / build:linux');
    process.exit(1);
  }

  // ── 产物完整性校验（与 copy-external-deps 校验对齐）──
  const exeName = process.platform === 'win32' ? 'liri_terminal.exe' : 'liri_terminal';
  const exePath = path.join(targetDir, exeName);
  if (!fs.existsSync(exePath)) {
    console.error(`[错误] 未找到可执行文件: ${exePath}`);
    console.error('请先执行 bun run build:win:coding');
    process.exit(1);
  }

  const nodeModulesDir = path.join(targetDir, 'node_modules');
  const missingDeps = ['sharp', 'pdfjs-dist'].filter(
    (dep) => !fs.existsSync(path.join(nodeModulesDir, dep, 'package.json'))
  );
  if (missingDeps.length > 0) {
    console.error(
      `[错误] dist/node_modules 缺少外部依赖: ${missingDeps.join(', ')}\n` +
        '  发布单元必须包含 exe + node_modules（强绑定），请重新执行 build:win:coding'
    );
    process.exit(1);
  }

  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  const zipName = `liri-terminal-v${version}-${platform}.zip`;
  const zipPath = path.join(releaseDir, zipName);
  createZip(targetDir, zipPath);

  const zipSize = fs.existsSync(zipPath)
    ? `${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`
    : '未知';
  console.log(
    `\n[完成] 发布包: ${zipName} (${zipSize})` +
      `\n       内容: ${exeName} + node_modules（${getDirSizeMB(nodeModulesDir)} MB）+ README-compiled.md` +
      `\n       路径: ${zipPath}` +
      '\n       安装: 解压整个 zip 到目标目录（Program Files 等），保持 exe 与 node_modules 同级'
  );
}

main();
