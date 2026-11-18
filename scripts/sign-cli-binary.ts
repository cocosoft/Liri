#!/usr/bin/env bun
// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * sign-cli-binary.ts —— G2 剩余三期：**单文件二进制签名**（2026-11-14）
 *
 * 为什么需要：`build-cli-binary.ts` 只产出产物 + `SHA256SUMS`；校验和只证完整性，**不等于签名**。
 * 本脚本把「平台签名」接成**可离线验证的纯函数 + 显式跳过**：
 * - 证书/凭据来自环境变量（发版侧 secrets），仓库内**不含**任何证书；
 * - 未配置凭据 ⇒ 打印**跳过原因**并继续（不伪造"已签名"，退出码仍为 0）；
 * - 已配置 ⇒ 逐条执行签名与校验命令，任一失败即退出 1（不静默降级）；
 * - 签名会改变产物字节 ⇒ **签名后重新生成 `SHA256SUMS`**（与 `build-cli-binary` 同口径）。
 *
 * 支持的平台：
 * - `win32`：`signtool sign` + `signtool verify`（时间戳默认 DigiCert）；
 * - `darwin`：`codesign`（Developer ID；如同时提供 `.p12` 则先建临时 keychain 导入）；
 * - `linux`：**跳过**（无通用二进制代码签名标准；本批不引入 GPG 分发）。
 *
 * 环境变量（全部可选）：
 * | 变量 | 用途 |
 * |---|---|
 * | `LIRI_SIGN_WIN_CERT_PFX_BASE64` | Windows `.pfx`（base64；运行期落临时文件） |
 * | `LIRI_SIGN_WIN_CERT_PASSWORD` | 上面 `.pfx` 的口令 |
 * | `LIRI_SIGN_WIN_TIMESTAMP_URL` | 时间戳服务（默认 `https://timestamp.digicert.com`） |
 * | `LIRI_SIGN_MAC_IDENTITY` | macOS 签名身份（如 `Developer ID Application: X (TEAMID)`） |
 * | `LIRI_SIGN_MAC_CERT_P12_BASE64` | macOS `.p12`（可选；提供则建临时 keychain 导入） |
 * | `LIRI_SIGN_MAC_CERT_PASSWORD` | `.p12` 口令 |
 * | `LIRI_SIGN_MAC_KEYCHAIN_PASSWORD` | 临时 keychain 口令（缺省沿用 `.p12` 口令） |
 *
 * 用法：`bun run scripts/sign-cli-binary.ts [--file <产物>] [--platform win32|darwin|linux]`
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import {
  defaultOutfile,
  parseSha256Sums,
  renderSha256Sums,
  sha256Of,
} from './build-cli-binary';

const REPO_ROOT = join(import.meta.dir, '..');

/** 默认时间戳服务（Windows Authenticode） */
export const DEFAULT_TIMESTAMP_URL = 'https://timestamp.digicert.com';

export type SignPlatform = 'win32' | 'darwin' | 'linux';

export interface SignCommand {
  cmd: string;
  args: string[];
}

export interface SigningPlan {
  status: 'sign' | 'skip';
  /** 人读原因（跳过时**必须**说明缺什么；签名时说明用什么身份） */
  reason: string;
  commands: SignCommand[];
}

export interface SigningOptions {
  /** Windows：已落盘的 `.pfx` 路径 */
  winCertPath?: string;
  winCertPassword?: string;
  winTimestampUrl?: string;
  /** macOS：签名身份 */
  macIdentity?: string;
  /** macOS：已落盘的 `.p12` 路径（可选） */
  macCertPath?: string;
  macCertPassword?: string;
  macKeychainPassword?: string;
  macKeychainPath?: string;
}

/** 归一化平台名（非法值 ⇒ null，不静默落到当前平台） */
export function normalizePlatform(value: string): SignPlatform | null {
  return value === 'win32' || value === 'darwin' || value === 'linux'
    ? value
    : null;
}

function skip(reason: string): SigningPlan {
  return { status: 'skip', reason, commands: [] };
}

/**
 * 由平台 + 已落盘的凭据路径推导**签名计划**（纯函数：同一输入 ⇒ 同一输出）。
 *
 * 只回答"该执行哪些命令"；**不**读 env、**不**碰文件系统、**不**执行命令。
 */
export function resolveSigningPlan(
  platform: SignPlatform,
  file: string,
  options: SigningOptions
): SigningPlan {
  if (platform === 'linux') {
    return skip('Linux 无通用二进制代码签名标准（本批不引入 GPG 分发）');
  }

  if (platform === 'win32') {
    if (!options.winCertPath) {
      return skip(
        '未配置 Windows 代码签名证书（LIRI_SIGN_WIN_CERT_PFX_BASE64）'
      );
    }
    if (!options.winCertPassword) {
      return skip(
        '已提供 Windows 证书但缺少口令（LIRI_SIGN_WIN_CERT_PASSWORD）'
      );
    }
    const timestampUrl =
      options.winTimestampUrl?.trim() || DEFAULT_TIMESTAMP_URL;
    return {
      status: 'sign',
      reason: `signtool 签名并校验（时间戳 ${timestampUrl}）`,
      commands: [
        {
          cmd: 'signtool',
          args: [
            'sign',
            '/fd',
            'sha256',
            '/f',
            options.winCertPath,
            '/p',
            options.winCertPassword,
            '/tr',
            timestampUrl,
            '/td',
            'sha256',
            file,
          ],
        },
        { cmd: 'signtool', args: ['verify', '/pa', file] },
      ],
    };
  }

  if (!options.macIdentity) {
    return skip('未配置 macOS 签名身份（LIRI_SIGN_MAC_IDENTITY）');
  }
  const commands: SignCommand[] = [];
  if (options.macCertPath) {
    if (!options.macCertPassword) {
      return skip('已提供 macOS 证书但缺少口令（LIRI_SIGN_MAC_CERT_PASSWORD）');
    }
    const keychain = options.macKeychainPath ?? 'liri-signing.keychain-db';
    const keychainPassword =
      options.macKeychainPassword ?? options.macCertPassword;
    commands.push({
      cmd: 'security',
      args: ['create-keychain', '-p', keychainPassword, keychain],
    });
    commands.push({
      cmd: 'security',
      args: [
        'import',
        options.macCertPath,
        '-k',
        keychain,
        '-P',
        options.macCertPassword,
        '-T',
        '/usr/bin/codesign',
      ],
    });
    commands.push({
      cmd: 'security',
      args: [
        'set-key-partition-list',
        '-S',
        'apple-tool:,apple:',
        '-s',
        '-k',
        keychainPassword,
        keychain,
      ],
    });
    commands.push({
      cmd: 'codesign',
      args: [
        '--force',
        '--options',
        'runtime',
        '--timestamp',
        '--keychain',
        keychain,
        '--sign',
        options.macIdentity,
        file,
      ],
    });
  } else {
    commands.push({
      cmd: 'codesign',
      args: [
        '--force',
        '--options',
        'runtime',
        '--timestamp',
        '--sign',
        options.macIdentity,
        file,
      ],
    });
  }
  commands.push({
    cmd: 'codesign',
    args: ['--verify', '--strict', '--verbose=2', file],
  });
  return {
    status: 'sign',
    reason: `codesign 签名并校验（身份 ${options.macIdentity}）`,
    commands,
  };
}

/** 解析 CLI 参数（`--file` 缺省按当前平台推导；`--platform` 缺省 = 当前平台） */
export function parseSignArgs(
  argv: string[],
  platform: NodeJS.Platform = process.platform
): { file: string; platform: SignPlatform } | null {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = get('file') ?? defaultOutfile();
  const rawPlatform = get('platform') ?? platform;
  const parsed = normalizePlatform(rawPlatform);
  if (!file.trim() || !parsed) return null;
  return { file, platform: parsed };
}

/** 从 env 取凭据（只读；空串视为未配置） */
export function readSigningEnv(
  env: Record<string, string | undefined>
): Record<string, string | undefined> {
  const pick = (key: string): string | undefined => {
    const value = env[key];
    return value && value.trim() ? value : undefined;
  };
  return {
    winCertPfxBase64: pick('LIRI_SIGN_WIN_CERT_PFX_BASE64'),
    winCertPassword: pick('LIRI_SIGN_WIN_CERT_PASSWORD'),
    winTimestampUrl: pick('LIRI_SIGN_WIN_TIMESTAMP_URL'),
    macIdentity: pick('LIRI_SIGN_MAC_IDENTITY'),
    macCertP12Base64: pick('LIRI_SIGN_MAC_CERT_P12_BASE64'),
    macCertPassword: pick('LIRI_SIGN_MAC_CERT_PASSWORD'),
    macKeychainPassword: pick('LIRI_SIGN_MAC_KEYCHAIN_PASSWORD'),
  };
}

/** base64 ⇒ 临时文件（运行期才落盘；仓库与工作区不留证书） */
function materializeCert(
  base64: string,
  fileName: string,
  dir: string
): string {
  const path = join(dir, fileName);
  writeFileSync(path, Buffer.from(base64, 'base64'));
  return path;
}

function runCommands(commands: SignCommand[]): boolean {
  for (const { cmd, args } of commands) {
    console.log(`▶ ${cmd} ${args.join(' ')}`);
    // 用 `node:child_process`（而非 Bun.spawn）⇒ 根脚本 tsconfig 无需 bun 类型
    const result = spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: 'inherit' });
    if (result.error) {
      console.error(`❌ 无法执行 ${cmd}：${result.error.message}`);
      return false;
    }
    if (result.status !== 0) {
      console.error(`❌ ${cmd} 失败（退出码 ${result.status ?? 'null'}）`);
      return false;
    }
  }
  return true;
}

async function main(argv: string[]): Promise<number> {
  const args = parseSignArgs(argv);
  if (!args) {
    console.error(
      '用法：bun run scripts/sign-cli-binary.ts [--file <产物>] [--platform win32|darwin|linux]'
    );
    return 1;
  }
  const filePath = isAbsolute(args.file)
    ? args.file
    : join(REPO_ROOT, args.file);
  if (!existsSync(filePath)) {
    console.error(`❌ 产物不存在：${args.file}`);
    return 1;
  }

  const env = readSigningEnv(process.env);
  const tempDir = mkdtempSync(join(tmpdir(), 'liri-sign-'));
  try {
    const winCertPath = env.winCertPfxBase64
      ? materializeCert(env.winCertPfxBase64, 'cert.pfx', tempDir)
      : undefined;
    const macCertPath = env.macCertP12Base64
      ? materializeCert(env.macCertP12Base64, 'cert.p12', tempDir)
      : undefined;

    const plan = resolveSigningPlan(args.platform, filePath, {
      winCertPath,
      winCertPassword: env.winCertPassword,
      winTimestampUrl: env.winTimestampUrl,
      macIdentity: env.macIdentity,
      macCertPath,
      macCertPassword: env.macCertPassword,
      macKeychainPassword: env.macKeychainPassword,
      macKeychainPath: macCertPath
        ? join(tempDir, 'liri-signing.keychain-db')
        : undefined,
    });

    if (plan.status === 'skip') {
      console.log(`⏭ 未签名：${plan.reason}`);
    } else {
      console.log(`▶ 签名：${plan.reason}`);
      if (!runCommands(plan.commands)) return 1;
      console.log('✅ 签名并校验通过');
    }

    // 签名会改变字节 ⇒ 校验和必须在签名**之后**重算；同目录可能有多个平台产物 ⇒ 合并而非覆盖
    const sumsPath = join(dirname(filePath), 'SHA256SUMS');
    const previous = existsSync(sumsPath)
      ? parseSha256Sums(readFileSync(sumsPath, 'utf-8'))
      : [];
    const merged = [
      ...previous.filter((entry) => entry.name !== basename(filePath)),
      { name: basename(filePath), sha256: sha256Of(filePath) },
    ];
    const sums = renderSha256Sums(merged);
    writeFileSync(sumsPath, sums, 'utf-8');
    console.log(`✅ 已重算校验和：${sumsPath}`);
    console.log(sums.trim());
    return 0;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
