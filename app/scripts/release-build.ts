/**
 * release-build.ts — 统一打包入口（本地 = CI 同一套，契约驱动）
 *
 * 形态: compile（默认，产出 exe + node_modules 发布单元）| bundle（便携包 pkg/）
 * 数据源: package-manifest.ts（externals / 默认变体）
 *
 * 用法:
 *   bun run scripts/release-build.ts --platform=win-x64            # compile 主链路
 *   bun run scripts/release-build.ts --platform=win-x64 --mode=bundle
 *   bun run scripts/release-build.ts --platform=macos-arm64 --skip-smoke
 *   bun run scripts/release-build.ts --platform=win-x64 --zip
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { DEFAULT_VARIANT, RUNTIME_DEPS, EXTERNAL_BUILD_ARGS } from './package-manifest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(__dirname, '..', '..', 'dist'); // 仓库根 dist（compile 独占）

interface PlatformCfg {
  bunTarget: string;
  exeName: string;
  os: string; // 主机 OS 匹配（仅同平台执行启动冒烟）
}
const PLATFORMS: Record<string, PlatformCfg> = {
  'win-x64': { bunTarget: 'bun-windows-x64-modern', exeName: 'liri_terminal.exe', os: 'win32' },
  'macos-arm64': { bunTarget: 'bun-darwin-arm64-modern', exeName: 'liri_terminal', os: 'darwin' },
  'linux-x64': { bunTarget: 'bun-linux-x64-modern', exeName: 'liri_terminal', os: 'linux' },
};

interface CliOpts {
  platform: string;
  variant: string;
  mode: 'compile' | 'bundle';
  skipSmoke: boolean;
  zip: boolean;
}

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  const opts: CliOpts = {
    platform: process.platform === 'win32' ? 'win-x64' : 'linux-x64',
    variant: DEFAULT_VARIANT,
    mode: 'compile',
    skipSmoke: false,
    zip: false,
  };
  for (const arg of args) {
    if (arg.startsWith('--platform=')) opts.platform = arg.split('=')[1];
    else if (arg.startsWith('--variant=')) opts.variant = arg.split('=')[1];
    else if (arg === '--mode=bundle') opts.mode = 'bundle';
    else if (arg === '--skip-smoke') opts.skipSmoke = true;
    else if (arg === '--zip') opts.zip = true;
  }
  if (!PLATFORMS[opts.platform]) {
    console.error(`无效平台: ${opts.platform}，可选: ${Object.keys(PLATFORMS).join(', ')}`);
    process.exit(1);
  }
  return opts;
}

function runIn(dir: string, cmd: string, args: string[]): void {
  console.log(`\n$ ${cmd} ${args.join(' ')}  (cwd: ${dir})`);
  const r = spawnSync(cmd, args, { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`[release-build FAIL] ${cmd} exited ${r.status ?? r.error?.message ?? 'unknown'}`);
    process.exit(r.status ?? 1);
  }
}

function rmrf(p: string): void {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function createZip(sourceDir: string, outputFile: string): void {
  if (process.platform === 'win32') {
    runIn('.', 'powershell', ['-NoProfile', '-Command', `Compress-Archive -Path "${sourceDir}\\*" -DestinationPath "${outputFile}" -Force`]);
  } else {
    const r = spawnSync('zip', ['-r', outputFile, '.'], { cwd: sourceDir, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`[release-build FAIL] zip exited ${r.status ?? 'unknown'}`);
      process.exit(r.status ?? 1);
    }
  }
}

function buildCompile(opts: CliOpts, cfg: PlatformCfg): void {
  const outDir = DIST_DIR;
  // 产物区重建前清空 node_modules（compile 独占，杜绝异平台残留）
  rmrf(path.join(outDir, 'node_modules'));
  rmrf(path.join(outDir, '.update-extract'));

  runIn(APP_DIR, 'bun', ['run', 'scripts/build-variant.ts', `--variant=${opts.variant}`]);
  runIn(APP_DIR, 'bun', [
    'build', '--compile',
    `--target=${cfg.bunTarget}`,
    ...EXTERNAL_BUILD_ARGS,
    '--compile-autoload-package-json',
    `--outfile=${path.join(outDir, cfg.exeName)}`,
    'src/pyapp.ts',
  ]);
  runIn(APP_DIR, 'bun', ['run', 'scripts/copy-external-deps.ts']); // 默认输出到根 dist（契约产物）
  runIn(APP_DIR, 'bun', ['run', 'scripts/verify-package.ts', `--pkg=${outDir}`]);

  if (opts.zip) {
    const ver = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf-8')).version;
    const zipName = `liri-terminal-v${ver}-${opts.platform}.zip`;
    createZip(outDir, path.join(path.resolve(APP_DIR, '..', 'release'), zipName));
    console.log(`[release-build] zip: ${zipName}`);
  }
}

function buildBundle(opts: CliOpts): void {
  // 便携包 pkg/（复用既有原子步骤，仅编排不变更实现；依赖/变体来自契约）
  runIn(APP_DIR, 'bun', ['run', 'scripts/build-variant.ts', `--variant=${opts.variant}`]);
  runIn(APP_DIR, 'bun', ['run', 'build:bundle']);
  runIn(APP_DIR, 'bun', ['run', 'build:runtime']);
  runIn(APP_DIR, 'bun', ['run', 'build:deps']);
  runIn(APP_DIR, 'bun', ['run', 'build:seed']);
  const pkgDir = path.join(DIST_DIR, 'pkg');
  runIn(APP_DIR, 'bun', ['run', 'scripts/verify-package.ts', `--pkg=${pkgDir}`, '--dir=runtime']);
}

function runSmoke(cfg: PlatformCfg): void {
  if (process.platform !== cfg.os) {
    console.log('[release-build] 当前主机与目标平台不一致，跳过启动冒烟（CI 应在对应 runner 上执行）');
    return;
  }
  const exe = path.join(DIST_DIR, cfg.exeName);
  console.log(`[smoke] 运行 ${exe} --smoke ...`);
  const r = spawnSync(exe, ['--smoke'], {
    cwd: DIST_DIR,
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, LIRI_SMOKE: '1' },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0 || !out.includes('SMOKE_OK')) {
    console.error('[smoke FAIL] 启动自检未通过');
    console.error(out.slice(0, 4000));
    process.exit(r.status ?? 1);
  }
  console.log('[smoke OK] externals 可加载');
}

function main(): void {
  const opts = parseArgs();
  const cfg = PLATFORMS[opts.platform];

  console.log(`\n=== release-build ===`);
  console.log(`platform=${opts.platform} variant=${opts.variant} mode=${opts.mode}`);
  console.log(`externals: ${RUNTIME_DEPS.join(', ')}`);

  if (opts.mode === 'bundle') {
    buildBundle(opts);
  } else {
    buildCompile(opts, cfg);
    if (!opts.skipSmoke) runSmoke(cfg);
  }

  console.log('\n=== release-build 完成 ===');
}

main();
