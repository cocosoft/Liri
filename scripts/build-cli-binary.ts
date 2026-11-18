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
  return `app/dist/cli-bin/liri-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`;
}

/**
 * G2 七期（2026-11-14）：解析 `bun build --compile --target` 值。
 *
 * 为什么需要：CI 的 macOS runner 是 **arm64**，原生只能产出 `darwin-arm64`；
 * Homebrew / npm 分包还需要 `darwin-x64` ⇒ 用 Bun 的交叉编译补这一份。
 */
export function parseBunTarget(
  target: string
): { os: 'win32' | 'darwin' | 'linux'; arch: 'x64' | 'arm64' } | null {
  const match =
    /^bun-(win32|windows|darwin|linux)-(x64|arm64)(?:-(?:baseline|modern|musl))?$/.exec(
      target.trim()
    );
  if (!match) return null;
  return {
    os:
      match[1] === 'windows'
        ? 'win32'
        : (match[1] as 'win32' | 'darwin' | 'linux'),
    arch: match[2] as 'x64' | 'arm64',
  };
}

/** 由交叉编译目标推导产物名（非法目标 ⇒ `null`，不猜） */
export function outfileForTarget(target: string): string | null {
  const parsed = parseBunTarget(target);
  if (!parsed) return null;
  return `app/dist/cli-bin/liri-${parsed.os}-${parsed.arch}${parsed.os === 'win32' ? '.exe' : ''}`;
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
  /** Bun 交叉编译目标（如 `bun-darwin-x64`）；缺省 = 当前平台原生构建 */
  target?: string;
}

/** 读取参数：同时支持 `--name value` 与 `--name=value` */
function readFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** 解析 CLI 参数（缺省组合；`--outfile` 缺省按 `--target` 或当前平台推导） */
export function parseBuildArgs(argv: string[]): BuildArgs | null {
  const entry = readFlag(argv, 'entry') ?? DEFAULT_ENTRY;
  const target = readFlag(argv, 'target');
  const outfile =
    readFlag(argv, 'outfile') ??
    (target ? outfileForTarget(target) : defaultOutfile());
  if (!entry.trim() || !outfile || !outfile.trim()) return null;
  if (target !== undefined && !parseBunTarget(target)) return null;
  return { entry, outfile, ...(target ? { target } : {}) };
}

/** 解析已有 `SHA256SUMS`（用于多次构建后**合并**而不是互相覆盖） */
export function parseSha256Sums(
  text: string
): Array<{ name: string; sha256: string }> {
  return text
    .split(/\r?\n/)
    .map((line) => /^([0-9a-f]{64})\s{2}(.+)$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ sha256: m[1], name: m[2] }));
}

async function main(argv: string[]): Promise<number> {
  const args = parseBuildArgs(argv);
  if (!args) {
    console.error(
      '用法：bun run scripts/build-cli-binary.ts [--entry app/src/main.ts] [--outfile app/dist/cli-bin/liri] [--target=bun-darwin-x64]'
    );
    return 1;
  }
  const entryPath = join(REPO_ROOT, args.entry);
  if (!existsSync(entryPath)) {
    console.error(`❌ 入口不存在：${args.entry}`);
    return 1;
  }

  console.log(
    `▶ bun build --compile ${args.entry} → ${args.outfile}${args.target ? `（target=${args.target}）` : ''}`
  );
  // 用 `node:child_process`（而非 Bun.spawn）⇒ 根脚本 tsconfig 无需 bun 类型
  const result = spawnSync(
    'bun',
    [
      'build',
      '--compile',
      args.entry,
      '--outfile',
      args.outfile,
      ...(args.target ? [`--target=${args.target}`] : []),
    ],
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
  const sumsPath = join(binaryAbs, '..', 'SHA256SUMS');
  // 同一目录多次构建（如 macOS 上先后产出 arm64 + x64）⇒ 合并，不丢前一份
  const previous = existsSync(sumsPath)
    ? parseSha256Sums(readFileSync(sumsPath, 'utf-8'))
    : [];
  const merged = [
    ...previous.filter((entry) => entry.name !== basename(args.outfile)),
    { name: basename(args.outfile), sha256: sha256Of(binaryAbs) },
  ];
  const sums = renderSha256Sums(merged);
  writeFileSync(sumsPath, sums, 'utf-8');
  console.log(`✅ 已更新校验和：${sumsPath}`);
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
