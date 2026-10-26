#!/usr/bin/env bun
/**
 * 构建 Windows 沙箱 helper（`win-sandbox-run.exe`）—— 方案 `.trae/specs/windows-sandbox.md` §3.2
 *
 * 为什么要脚本：源码是 C（不入库编译产物），本机与 CI 都需要一条确定性的构建命令。
 * 不依赖「开发者 PowerShell」：自己按 `vswhere` 找到 MSVC，拼出 INCLUDE/LIB/PATH 再调 `cl`。
 *
 * 用法：
 *   bun run build:win-sandbox                 # 输出 <PROJECT_DIR>/bin/win-sandbox-run.exe
 *   bun run build:win-sandbox -- --out <path> # 指定输出
 *   bun run build:win-sandbox -- --require    # 非 Windows / 缺工具链 ⇒ 失败（CI 用）
 *
 * 退出码：0 = 成功或（非 --require 时）跳过；1 = 失败。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const SOURCE = join(
  PROJECT_ROOT,
  'app/src/sandbox/win/native/win_sandbox_run.c'
);
const DEFAULT_OUT = join(PROJECT_ROOT, 'bin', 'win-sandbox-run.exe');

const argOutIndex = process.argv.indexOf('--out');
const OUT =
  argOutIndex >= 0 && process.argv[argOutIndex + 1]
    ? resolve(process.argv[argOutIndex + 1] as string)
    : DEFAULT_OUT;
const REQUIRE = process.argv.includes('--require');

function skipOrFail(message: string): never {
  if (REQUIRE) {
    console.error(`[win-sandbox] ❌ ${message}（--require）`);
    process.exit(1);
  }
  console.warn(`[win-sandbox] 跳过：${message}`);
  process.exit(0);
}

/** 用 vswhere 找 VS 安装路径（BuildTools / Community / Professional 均可） */
function findVsInstall(): string | null {
  const vswhere = join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe'
  );
  if (!existsSync(vswhere)) return null;
  try {
    const out = execFileSync(
      vswhere,
      ['-latest', '-products', '*', '-property', 'installationPath'],
      { encoding: 'utf8' }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** 在 VS 安装目录下找 x64 的 cl.exe（取最高版本） */
function findCl(vsInstall: string): string | null {
  const toolsRoot = join(vsInstall, 'VC', 'Tools', 'MSVC');
  if (!existsSync(toolsRoot)) return null;
  const versions = readdirSync(toolsRoot).sort().reverse();
  for (const version of versions) {
    const cl = join(toolsRoot, version, 'bin', 'Hostx64', 'x64', 'cl.exe');
    if (existsSync(cl)) return cl;
  }
  return null;
}

/** Windows SDK 的 Include/Lib 根（取最高版本） */
function findSdk(): { include: string; lib: string; bin: string } | null {
  const sdkRoot =
    process.env['WindowsSdkDir'] ??
    join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Windows Kits',
      '10'
    );
  const includeRoot = join(sdkRoot, 'Include');
  if (!existsSync(includeRoot)) return null;
  const version = readdirSync(includeRoot).sort().reverse()[0];
  if (!version) return null;
  return {
    include: join(includeRoot, version),
    lib: join(sdkRoot, 'Lib', version),
    bin: join(sdkRoot, 'bin', version, 'x64'),
  };
}

function main(): void {
  if (process.platform !== 'win32') {
    skipOrFail(`仅 Windows 需要（当前 ${process.platform}）`);
    return;
  }
  if (!existsSync(SOURCE)) {
    console.error(`[win-sandbox] ❌ 源码缺失：${SOURCE}`);
    process.exit(1);
  }

  const vsInstall = findVsInstall();
  if (!vsInstall) skipOrFail('未找到 Visual Studio（vswhere 无结果）');
  const cl = findCl(vsInstall as string);
  if (!cl) skipOrFail('未找到 MSVC cl.exe（需要 C++ 生成工具）');
  const sdk = findSdk();
  if (!sdk) skipOrFail('未找到 Windows SDK');

  const msvcRoot = dirname(dirname(dirname(dirname(cl as string))));
  mkdirSync(dirname(OUT), { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    INCLUDE: [
      join(msvcRoot, 'include'),
      join(sdk!.include, 'ucrt'),
      join(sdk!.include, 'shared'),
      join(sdk!.include, 'um'),
    ].join(';'),
    LIB: [
      join(msvcRoot, 'lib', 'x64'),
      join(sdk!.lib, 'ucrt', 'x64'),
      join(sdk!.lib, 'um', 'x64'),
    ].join(';'),
    Path: [dirname(cl as string), sdk!.bin, process.env.Path ?? ''].join(';'),
  };

  try {
    execFileSync(
      cl as string,
      [
        '/nologo',
        // 源码含中文注释与宽字符串字面量 ⇒ 必须显式按 UTF-8 解析（否则 CP936 下 C2001）
        '/utf-8',
        '/O2',
        '/W3',
        '/D_CRT_SECURE_NO_WARNINGS',
        // 中间产物放系统临时目录：否则 `.obj` 会落在 cwd（app/）污染工作区
        `/Fo:${join(tmpdir(), 'win-sandbox-run.obj')}`,
        `/Fe:${OUT}`,
        SOURCE,
        'advapi32.lib',
      ],
      { stdio: 'inherit', env }
    );
  } catch {
    console.error('[win-sandbox] ❌ 编译失败');
    process.exit(1);
  }

  const size = statSync(OUT).size;
  console.log(`[win-sandbox] ✅ ${OUT}（${size} B）`);
  process.exit(0);
}

main();
