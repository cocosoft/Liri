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
 *
 * `--check`：只校验**已提交**的清单与产物哈希是否一致（不一致 ⇒ 退出 1，不写盘）。
 * `--placeholder`：不读产物，哈希写 64 个 0（**仅用于提交仓库内的清单占位**；发版作业会用真实哈希覆写）。
 *
 * **如实边界**：清单能保证"字段与哈希正确"，**不能**保证各渠道商店端到端可用
 * （Homebrew tap / Scoop bucket 需人工提 PR；npm 发布需 `NPM_TOKEN`）。见 spec §3。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

function main(argv: string[]): number {
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
