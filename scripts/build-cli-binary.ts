#!/usr/bin/env bun
// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * build-cli-binary.ts —— G2 剩余二期：**单文件二进制**构建 + 校验和（2026-11-14）
 *
 * 为什么需要：npm / Scoop / Homebrew 三渠道目前都以 `bun` 为运行前置（产物是 bun-target
 * 的 JS bundle）。`bun build --compile` 可产出**自带运行时的单文件可执行**
 * （Windows `.exe` / macOS / Linux），去掉该前置（体积换部署简单）。
 *
 * 本脚本只做两件事：
 * 1. 调用 `bun build --compile`（**不引入新依赖**，用本机 bun）；
 * 2. 为产物生成 `SHA256SUMS`（`<sha256>  <文件名>`，按文件名排序）—— 签名证书不在仓库，
 *    签名本身仍需发版侧配置（见 `.trae/specs/cli-package-channels.md` §7）。
 *
 * 用法：
 *   bun run scripts/build-cli-binary.ts [--entry app/src/main.ts] [--outfile app/dist/cli-bin/liri]
 *
 * 退出码：0 = 构建成功且校验和已写；1 = 参数/构建失败（如实报错，不静默降级）。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');

/** 默认入口（与 `app/package.json#bin` 同源） */
export const DEFAULT_ENTRY = 'app/src/main.ts';

/** 当前平台的默认产物名（`liri-<os>-<arch>[.exe]`） */
export function defaultOutfile(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string {
  const ext = platform === 'win32' ? '.exe' : '';
  return `app/dist/cli-bin/liri-${platform}-${arch}${ext}`;
}

/** 渲染 `SHA256SUMS`（纯函数：`<sha256>  <name>`，按 name 升序、行尾 `\n`） */
export function renderSha256Sums(
  entries: ReadonlyArray<{ name: string; sha256: string }>
): string {
  return [...entries]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `${e.sha256}  ${e.name}`)
    .join('\n')
    .concat('\n');
}

export interface BuildArgs {
  entry: string;
  outfile: string;
}

/** 解析 CLI 参数（缺省组合；`--outfile` 缺省按平台推导） */
export function parseBuildArgs(argv: string[]): BuildArgs | null {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const entry = get('entry') ?? DEFAULT_ENTRY;
  const outfile = get('outfile') ?? defaultOutfile();
  if (!entry.trim() || !outfile.trim()) return null;
  return { entry, outfile };
}

async function main(argv: string[]): Promise<number> {
  const args = parseBuildArgs(argv);
  if (!args) {
    console.error(
      '用法：bun run scripts/build-cli-binary.ts [--entry app/src/main.ts] [--outfile app/dist/cli-bin/liri]'
    );
    return 1;
  }
  const entryPath = join(REPO_ROOT, args.entry);
  if (!existsSync(entryPath)) {
    console.error(`❌ 入口不存在：${args.entry}`);
    return 1;
  }

  console.log(`▶ bun build --compile ${args.entry} → ${args.outfile}`);
  // 用 `node:child_process`（而非 Bun.spawn）⇒ 根脚本 tsconfig 无需 bun 类型
  const result = spawnSync(
    'bun',
    ['build', '--compile', args.entry, '--outfile', args.outfile],
    { cwd: REPO_ROOT, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(`❌ 编译失败（退出码 ${result.status ?? 'null'}）`);
    return 1;
  }

  // `--outfile` 相对仓库根解析 ⇒ 校验和输出到产物同目录
  const binaryAbs = join(REPO_ROOT, args.outfile);
  if (!existsSync(binaryAbs)) {
    console.error(`❌ 编译产物不存在：${args.outfile}`);
    return 1;
  }
  const sums = renderSha256Sums([
    { name: basename(args.outfile), sha256: sha256Of(binaryAbs) },
  ]);
  const sumsPath = join(binaryAbs, '..', 'SHA256SUMS');
  writeFileSync(sumsPath, sums, 'utf-8');
  console.log(`✅ 已生成校验和：${sumsPath}`);
  console.log(sums.trim());
  return 0;
}

/** 文件 sha256（与 `gen-package-manifests.ts` 同口径） */
export function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
