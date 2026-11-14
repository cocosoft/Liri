#!/usr/bin/env bun
// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * gen-package-manifests.ts —— G2 剩余：npm / Scoop / Homebrew 分发清单生成（2026-11-14）
 *
 * 规格：`.trae/specs/cli-package-channels.md`。
 *
 * 为什么是"生成"而不是"手写"：三份清单里都有**版本号 + sha256**（随产物变化），
 * 手写必然漂移；本脚本把它们收敛到一处（纯函数渲染 + 一次 CLI 入口）。
 *
 * 用法：
 *   bun run scripts/gen-package-manifests.ts --version 0.5.28 --artifact dist/liri-cli.tgz
 *   bun run scripts/gen-package-manifests.ts --version 0.5.28 --artifact <path> --check
 *   bun run scripts/gen-package-manifests.ts --version 0.5.28 --placeholder
 *   bun run scripts/gen-package-manifests.ts --standalone --version 0.5.28 --assets app/dist/cli-bin
 *   bun run scripts/gen-package-manifests.ts --standalone-npm --version 0.5.28 --assets app/dist/cli-bin
 *
 * `--check`：只校验**已提交**的清单与产物哈希是否一致（不一致 ⇒ 退出 1，不写盘）。
 * `--placeholder`：不读产物，哈希写 64 个 0（**仅用于提交仓库内的清单占位**；发版作业会用真实哈希覆写）。
 * `--standalone`：读**真实单文件二进制**目录，渲染**去 bun 前置**的 Scoop / Homebrew 清单 + 合并
 * `SHA256SUMS`（输出到 `packaging/standalone/**`，不入库）；缺平台即退出 1（不产出坏链接）。
 * `--standalone-npm`：生成**按平台分包**的 npm 包树（主包启动器 + `@openliri/cli-*` 平台包，
 * 二进制复制进各自包；输出到 `packaging/standalone-npm/**`，不入库）；缺平台即退出 1。
 *
 * **如实边界**：清单能保证"字段与哈希正确"，**不能**保证各渠道商店端到端可用
 * （Homebrew tap / Scoop bucket 需人工提 PR；npm 发布需 `NPM_TOKEN`）。见 spec §3。
 */

import { createHash } from 'node:crypto';
import { existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
// 复用校验和渲染（唯一实现，避免两套 `<hash>  <name>` 格式）
import { renderSha256Sums } from './build-cli-binary';

/** 仓库根（脚本位于 `scripts/`） */
const REPO_ROOT = resolve(import.meta.dir, '..');

/** 发布产物下载地址前缀（发版时由 CI 传入真实 Release 资产 URL） */
export const DEFAULT_DOWNLOAD_BASE =
  'https://github.com/openliri/Liri/releases/download';

/** 清单输出路径（相对仓库根） */
export const MANIFEST_PATHS = {
  scoop: 'packaging/scoop/liri.json',
  homebrew: 'packaging/homebrew/liri.rb',
  npm: 'packaging/npm/package.json',
} as const;

/** 计算文件 sha256（小写十六进制） */
export function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export interface ManifestInput {
  version: string;
  /** 发布产物文件名（Release 资产名，如 `liri-cli-0.5.28.tgz`） */
  artifactName: string;
  sha256: string;
  /** 下载地址前缀（缺省 {@link DEFAULT_DOWNLOAD_BASE}） */
  downloadBase?: string;
}

function downloadUrl(input: ManifestInput): string {
  const base = input.downloadBase ?? DEFAULT_DOWNLOAD_BASE;
  return `${base}/v${input.version}/${input.artifactName}`;
}

/**
 * Scoop 清单（Windows；`bun` 为运行前置）。
 *
 * 产物内含 `Liri.cmd` 启动脚本（由发版作业打包时生成），Scoop 只负责落盘与暴露 `liri`。
 */
export function renderScoopManifest(input: ManifestInput): string {
  return `${JSON.stringify(
    {
      $schema:
        'https://raw.githubusercontent.com/ScoopInstaller/Scoop/master/schema.json',
      version: input.version,
      description: 'Liri — AI 私人助手（CLI）',
      homepage: 'https://openliri.com',
      license: 'MIT',
      depends: ['bun'],
      architecture: {
        '64bit': {
          url: downloadUrl(input),
          hash: input.sha256,
          extract_dir: `liri-cli-${input.version}`,
        },
      },
      bin: [['Liri.cmd', 'liri']],
      checkver: { github: 'https://github.com/openliri/Liri' },
      autoupdate: {
        architecture: {
          '64bit': {
            url: `${DEFAULT_DOWNLOAD_BASE}/v$version/liri-cli-$version.tgz`,
          },
        },
      },
      '//': '由 scripts/gen-package-manifests.ts 生成，勿手改；提交目标是 openliri/scoop bucket。',
    },
    null,
    2
  )}\n`;
}

/** Homebrew formula（macOS/Linux；`bun` 为运行前置，安装为 libexec 脚本 + shim） */
export function renderHomebrewFormula(input: ManifestInput): string {
  return `# 由 scripts/gen-package-manifests.ts 生成，勿手改；提交目标是 openliri/homebrew-tap。
class Liri < Formula
  desc "Liri — AI 私人助手（CLI）"
  homepage "https://openliri.com"
  url "${downloadUrl(input)}"
  sha256 "${input.sha256}"
  license "MIT"
  version "${input.version}"

  depends_on "bun"

  def install
    libexec.install "main.js"
    (bin/"liri").write <<~SH
      #!/bin/sh
      exec "#{Formula["bun"].opt_bin}/bun" "#{libexec}/main.js" "$@"
    SH
    chmod 0755, bin/"liri"
  end

  test do
    assert_match "Liri", shell_output("#{bin}/liri --version 2>&1", 0)
  end
end
`;
}

/** npm 发布包清单（**独立目录**：只含构建产物，不沿用 app/package.json 的 workspace 依赖） */
export function renderNpmPackageJson(input: ManifestInput): string {
  return `${JSON.stringify(
    {
      name: 'openliri',
      version: input.version,
      description: 'Liri — AI 私人助手（CLI；需 Bun 运行时）',
      homepage: 'https://openliri.com',
      license: 'MIT',
      bin: { Liri: 'dist/main.js' },
      files: ['dist/main.js'],
      engines: { bun: '>=1.4.2' },
      '//': '由 scripts/gen-package-manifests.ts 生成，勿手改；发版作业把 dist/main.js 复制到本目录后 npm publish。',
    },
    null,
    2
  )}\n`;
}

/** 渲染全部清单（纯函数） */
export function renderAllManifests(input: ManifestInput): Record<string, string> {
  return {
    [MANIFEST_PATHS.scoop]: renderScoopManifest(input),
    [MANIFEST_PATHS.homebrew]: renderHomebrewFormula(input),
    [MANIFEST_PATHS.npm]: renderNpmPackageJson(input),
  };
}

/* ===================================================================
 *  G2 剩余四期（2026-11-14）：**standalone 变体**（单文件二进制 ⇒ 去掉 bun 前置）
 *  ---------------------------------------------------------------
 *  只在“已经有真实二进制产物”时生成：`collectStandaloneAssets` 对缺失平台**如实报错**，
 *  不产出占位清单（缺平台的 manifest 发出去就是坏链接）。
 *  产物命名与 `build-cli-binary.ts` 的 `defaultOutfile()` 同源：`liri-<platform>-<arch>[.exe]`。
 *  npm 变体**不做**：npm 需按平台分包（optionalDependencies）才能去运行时前置，见 spec §8。
 * =================================================================== */

/** standalone 清单输出路径（相对仓库根；不提交仓库，发版作业随 Release 上传） */
export const STANDALONE_MANIFEST_PATHS = {
  scoop: 'packaging/standalone/scoop/liri.json',
  homebrew: 'packaging/standalone/homebrew/liri.rb',
  sums: 'packaging/standalone/SHA256SUMS',
} as const;

export type StandalonePlatform = 'win32' | 'darwin' | 'linux';
export type StandaloneArch = 'x64' | 'arm64';

export interface StandaloneAsset {
  name: string;
  platform: StandalonePlatform;
  arch: StandaloneArch;
  sha256: string;
}

/** 单文件二进制必须覆盖的平台/架构（缺一不发 standalone 清单） */
export const REQUIRED_STANDALONE_TARGETS: ReadonlyArray<
  readonly [StandalonePlatform, StandaloneArch]
> = [
  ['win32', 'x64'],
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'x64'],
];

/** 从文件名解析 `<platform>-<arch>`（非本命名 ⇒ null，不猜） */
export function parseStandaloneName(
  fileName: string
): { platform: StandalonePlatform; arch: StandaloneArch } | null {
  const match = /^liri-(win32|darwin|linux)-(x64|arm64)(?:\.exe)?$/.exec(
    fileName
  );
  if (!match) return null;
  return {
    platform: match[1] as StandalonePlatform,
    arch: match[2] as StandaloneArch,
  };
}

/**
 * 归一化为资产表（纯函数）：按必需清单核对，**缺哪个平台就报哪个**。
 * @returns `assets`（按 platform → arch 升序）+ `missing`（空 = 齐全）
 */
export function resolveStandaloneAssets(
  entries: ReadonlyArray<{ name: string; sha256: string }>
): { assets: StandaloneAsset[]; missing: string[] } {
  const assets: StandaloneAsset[] = [];
  for (const entry of entries) {
    const parsed = parseStandaloneName(entry.name);
    if (parsed) assets.push({ name: entry.name, sha256: entry.sha256, ...parsed });
  }
  const missing = REQUIRED_STANDALONE_TARGETS.filter(
    ([platform, arch]) =>
      !assets.some((a) => a.platform === platform && a.arch === arch)
  ).map(([platform, arch]) => `liri-${platform}-${arch}`);
  assets.sort(
    (a, b) =>
      a.platform.localeCompare(b.platform) || a.arch.localeCompare(b.arch)
  );
  return { assets, missing };
}

export interface StandaloneInput {
  version: string;
  assets: ReadonlyArray<StandaloneAsset>;
  downloadBase?: string;
}

function assetUrl(input: StandaloneInput, asset: StandaloneAsset): string {
  const base = input.downloadBase ?? DEFAULT_DOWNLOAD_BASE;
  return `${base}/v${input.version}/${asset.name}`;
}

function assetOf(
  input: StandaloneInput,
  platform: StandalonePlatform,
  arch: StandaloneArch
): StandaloneAsset {
  const found = input.assets.find(
    (a) => a.platform === platform && a.arch === arch
  );
  if (!found) {
    // 调用方（resolveStandaloneAssets）已拦截缺失；这里再 fail-fast 一次，不产出坏清单
    throw new Error(`standalone 资产缺失：liri-${platform}-${arch}`);
  }
  return found;
}

/** Scoop（standalone）：**无 `depends`**，直接落盘 exe 并暴露 `liri` */
export function renderScoopStandaloneManifest(input: StandaloneInput): string {
  const win = assetOf(input, 'win32', 'x64');
  return `${JSON.stringify(
    {
      $schema:
        'https://raw.githubusercontent.com/ScoopInstaller/Scoop/master/schema.json',
      version: input.version,
      description: 'Liri — AI 私人助手（CLI，单文件二进制）',
      homepage: 'https://openliri.com',
      license: 'MIT',
      architecture: {
        '64bit': { url: assetUrl(input, win), hash: win.sha256 },
      },
      bin: [[win.name, 'liri']],
      checkver: { github: 'https://github.com/openliri/Liri' },
      '//': '由 scripts/gen-package-manifests.ts --standalone 生成；不含 bun 前置。',
    },
    null,
    2
  )}\n`;
}

/** Homebrew（standalone）：按平台分支给 url/sha256，**无 `depends_on "bun"`** */
export function renderHomebrewStandaloneFormula(
  input: StandaloneInput
): string {
  const macArm = assetOf(input, 'darwin', 'arm64');
  const macX64 = assetOf(input, 'darwin', 'x64');
  const linux = assetOf(input, 'linux', 'x64');
  return `# 由 scripts/gen-package-manifests.ts --standalone 生成；不含 bun 前置。
class Liri < Formula
  desc "Liri — AI 私人助手（CLI，单文件二进制）"
  homepage "https://openliri.com"
  version "${input.version}"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "${assetUrl(input, macArm)}"
      sha256 "${macArm.sha256}"
    else
      url "${assetUrl(input, macX64)}"
      sha256 "${macX64.sha256}"
    end
  end

  on_linux do
    url "${assetUrl(input, linux)}"
    sha256 "${linux.sha256}"
  end

  def install
    # 下载物即单文件可执行（文件名带平台后缀）⇒ 统一装成 liri
    bin.install Dir["*"].first => "liri"
  end

  test do
    assert_match "Liri", shell_output("#{bin}/liri --version 2>&1", 0)
  end
end
`;
}

/** 渲染 standalone 清单 + 合并校验和（纯函数） */
export function renderStandaloneManifests(
  input: StandaloneInput
): Record<string, string> {
  return {
    [STANDALONE_MANIFEST_PATHS.scoop]: renderScoopStandaloneManifest(input),
    [STANDALONE_MANIFEST_PATHS.homebrew]:
      renderHomebrewStandaloneFormula(input),
    [STANDALONE_MANIFEST_PATHS.sums]: renderSha256Sums(
      input.assets.map((a) => ({ name: a.name, sha256: a.sha256 }))
    ),
  };
}

/* ===================================================================
 *  G2 剩余五期（2026-11-14）：**npm standalone 变体**（按平台分包，去 bun 前置）
 *  ---------------------------------------------------------------
 *  做法（与 esbuild / swc 同类）：
 *   主包 `openliri`（`bin/liri.js` 启动器，零运行时依赖）
 *     + 平台包 `@openliri/cli-<platform>-<arch>`（`os` / `cpu` 限定，只装匹配平台）
 *   主包用 `optionalDependencies` 串联 ⇒ npm 自动跳过不匹配的平台包。
 *  启动器**平台表与 `REQUIRED_STANDALONE_TARGETS` 同源**（单一事实源，避免漂移）。
 * =================================================================== */

/** npm standalone 产物根（相对仓库根；发版期生成，不入库） */
export const NPM_STANDALONE_ROOT = 'packaging/standalone-npm';

export interface NpmPlatformTarget {
  platform: StandalonePlatform;
  arch: StandaloneArch;
  /** 平台包名（`@openliri/cli-<platform>-<arch>`） */
  packageName: string;
  /** 包内二进制文件名（Windows 带 `.exe`） */
  binaryName: string;
}

/** 平台包清单（单一事实源 = {@link REQUIRED_STANDALONE_TARGETS}） */
export function npmPlatformTargets(): NpmPlatformTarget[] {
  return REQUIRED_STANDALONE_TARGETS.map(([platform, arch]) => ({
    platform,
    arch,
    packageName: `@openliri/cli-${platform}-${arch}`,
    binaryName: platform === 'win32' ? 'liri.exe' : 'liri',
  })).sort((a, b) => a.packageName.localeCompare(b.packageName));
}

/** 启动器（Node CJS）：按 `process.platform-arch` 找平台包并透传 argv/退出码 */
export function renderNpmStandaloneLauncher(): string {
  const table = npmPlatformTargets()
    .map(
      (t) =>
        `  "${t.platform}-${t.arch}": { pkg: "${t.packageName}", bin: "${t.binaryName}" },`
    )
    .join('\n');
  return `#!/usr/bin/env node
// 由 scripts/gen-package-manifests.ts --standalone-npm 生成，勿手改。
// 平台表与构建矩阵同源（scripts/gen-package-manifests.ts 的 REQUIRED_STANDALONE_TARGETS）。
"use strict";

const { spawnSync } = require("node:child_process");

const TARGETS = {
${table}
};

const key = process.platform + "-" + process.arch;
const target = TARGETS[key];
if (!target) {
  console.error(
    "Liri CLI 不支持当前平台：" + key + "（支持：" + Object.keys(TARGETS).join(", ") + "）"
  );
  process.exit(1);
}

let binaryPath;
try {
  binaryPath = require.resolve(target.pkg + "/" + target.bin);
} catch (err) {
  console.error(
    "Liri CLI 缺少平台包 " + target.pkg +
      "（可选依赖未安装；常见原因：npm install --no-optional 或平台不匹配）"
  );
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);
`;
}

/** 平台包 `package.json`（`os`/`cpu` 限定 ⇒ npm 只装匹配平台） */
export function renderNpmPlatformPackageJson(
  version: string,
  target: NpmPlatformTarget
): string {
  return `${JSON.stringify(
    {
      name: target.packageName,
      version,
      description: `Liri CLI 单文件二进制（${target.platform}-${target.arch}）`,
      homepage: 'https://openliri.com',
      license: 'MIT',
      os: [target.platform],
      cpu: [target.arch],
      files: [target.binaryName],
      '//':
        '由 scripts/gen-package-manifests.ts --standalone-npm 生成，勿手改；只承载本平台二进制。',
    },
    null,
    2
  )}\n`;
}

/** 主包 `package.json`（零运行时依赖 + optionalDependencies 串联平台包） */
export function renderNpmStandaloneRootPackageJson(version: string): string {
  const optionalDependencies = Object.fromEntries(
    npmPlatformTargets().map((t) => [t.packageName, version])
  );
  return `${JSON.stringify(
    {
      name: 'openliri',
      version,
      description: 'Liri — AI 私人助手（CLI，单文件二进制）',
      homepage: 'https://openliri.com',
      license: 'MIT',
      bin: { Liri: 'bin/liri.js' },
      files: ['bin/liri.js'],
      optionalDependencies,
      engines: { node: '>=18' },
      '//':
        '由 scripts/gen-package-manifests.ts --standalone-npm 生成，勿手改；平台二进制在 @openliri/cli-* 平台包内。',
    },
    null,
    2
  )}\n`;
}

/** 渲染 npm standalone 包树（纯函数：路径 → 内容；二进制由调用方复制） */
export function renderNpmStandaloneTree(
  version: string
): Record<string, string> {
  const tree: Record<string, string> = {
    [`${NPM_STANDALONE_ROOT}/package.json`]:
      renderNpmStandaloneRootPackageJson(version),
    [`${NPM_STANDALONE_ROOT}/bin/liri.js`]: renderNpmStandaloneLauncher(),
  };
  for (const target of npmPlatformTargets()) {
    tree[
      `${NPM_STANDALONE_ROOT}/packages/${target.packageName}/package.json`
    ] = renderNpmPlatformPackageJson(version, target);
  }
  return tree;
}



function parseArgs(argv: string[]): {
  version: string;
  artifact: string;
  check: boolean;
  placeholder: boolean;
  downloadBase?: string;
} | null {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const version = get('version');
  const placeholder = argv.includes('--placeholder');
  const artifact = get('artifact') ?? '';
  if (!version || (!artifact && !placeholder)) return null;
  return {
    version,
    artifact,
    check: argv.includes('--check'),
    placeholder,
    ...(get('download-base') ? { downloadBase: get('download-base') } : {}),
  };
}

/**
 * `--standalone` 分支：从**已有二进制产物目录**读取真实哈希，渲染去 bun 前置的清单。
 *
 * 与主流程的差别：**没有 `--placeholder`** —— 缺平台或目录为空即退出 1（不产出坏链接）。
 */
function runStandalone(argv: string[]): number {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const version = get('version');
  const assetsDir = get('assets');
  if (!version || !assetsDir) {
    console.error(
      '用法：bun run scripts/gen-package-manifests.ts --standalone --version <v> --assets <dir> [--download-base <url>]'
    );
    return 1;
  }
  const dirAbs = isAbsolute(assetsDir) ? assetsDir : join(REPO_ROOT, assetsDir);
  if (!existsSync(dirAbs)) {
    console.error(`❌ 产物目录不存在：${assetsDir}`);
    return 1;
  }

  const entries = readdirSync(dirAbs)
    .filter((name) => parseStandaloneName(name) !== null)
    .map((name) => ({ name, sha256: sha256OfFile(join(dirAbs, name)) }));
  const { assets, missing } = resolveStandaloneAssets(entries);
  if (missing.length > 0) {
    console.error(
      `❌ standalone 资产缺失（不发不完整清单）：${missing.join(', ')}`
    );
    return 1;
  }

  const downloadBase = get('download-base');
  const rendered = renderStandaloneManifests({
    version,
    assets,
    ...(downloadBase ? { downloadBase } : {}),
  });
  for (const [rel, content] of Object.entries(rendered)) {
    const abs = join(REPO_ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
    console.log(`✅ 已生成 ${rel}`);
  }
  return 0;
}

/**
 * `--standalone-npm` 分支：把平台二进制复制进各自平台包，并渲染主包 + 启动器。
 *
 * 与 `--standalone` 同样**没有占位模式**：缺平台即退出 1。
 */
function runStandaloneNpm(argv: string[]): number {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const version = get('version');
  const assetsDir = get('assets');
  if (!version || !assetsDir) {
    console.error(
      '用法：bun run scripts/gen-package-manifests.ts --standalone-npm --version <v> --assets <dir>'
    );
    return 1;
  }
  const dirAbs = isAbsolute(assetsDir) ? assetsDir : join(REPO_ROOT, assetsDir);
  if (!existsSync(dirAbs)) {
    console.error(`❌ 产物目录不存在：${assetsDir}`);
    return 1;
  }

  const entries = readdirSync(dirAbs)
    .filter((name) => parseStandaloneName(name) !== null)
    .map((name) => ({ name, sha256: sha256OfFile(join(dirAbs, name)) }));
  const { assets, missing } = resolveStandaloneAssets(entries);
  if (missing.length > 0) {
    console.error(
      `❌ standalone 资产缺失（不发不完整包）：${missing.join(', ')}`
    );
    return 1;
  }

  for (const [rel, content] of Object.entries(
    renderNpmStandaloneTree(version)
  )) {
    const abs = join(REPO_ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
    console.log(`✅ 已生成 ${rel}`);
  }

  for (const target of npmPlatformTargets()) {
    const asset = assets.find(
      (a) => a.platform === target.platform && a.arch === target.arch
    );
    if (!asset) {
      console.error(`❌ 缺少 ${target.platform}-${target.arch} 产物`);
      return 1;
    }
    const dest = join(
      REPO_ROOT,
      NPM_STANDALONE_ROOT,
      'packages',
      target.packageName,
      target.binaryName
    );
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(dirAbs, asset.name), dest);
    console.log(`✅ 已就位 ${target.packageName}/${target.binaryName}`);
  }
  return 0;
}

function main(argv: string[]): number {
  if (argv.includes('--standalone-npm')) return runStandaloneNpm(argv);
  if (argv.includes('--standalone')) return runStandalone(argv);
  const args = parseArgs(argv);
  if (!args) {
    console.error(
      '用法：bun run scripts/gen-package-manifests.ts --version <v> --artifact <path> [--check] [--download-base <url>] | --version <v> --placeholder'
    );
    return 1;
  }
  if (!args.placeholder && !existsSync(args.artifact)) {
    console.error(`❌ 产物不存在：${args.artifact}`);
    return 1;
  }

  const input: ManifestInput = {
    version: args.version,
    artifactName: `liri-cli-${args.version}.tgz`,
    sha256: args.placeholder
      ? '0'.repeat(64)
      : sha256OfFile(args.artifact),
    ...(args.downloadBase ? { downloadBase: args.downloadBase } : {}),
  };
  const rendered = renderAllManifests(input);

  let drifted = 0;
  for (const [rel, content] of Object.entries(rendered)) {
    const abs = join(REPO_ROOT, rel);
    if (args.check) {
      const actual = existsSync(abs) ? readFileSync(abs, 'utf-8') : '';
      if (actual !== content) {
        console.error(`❌ 清单与产物不一致（需重新生成）：${rel}`);
        drifted += 1;
      }
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
    console.log(`✅ 已生成 ${rel}`);
  }

  if (args.check) {
    if (drifted > 0) return 1;
    console.log('✅ 清单与产物哈希一致');
  }
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
