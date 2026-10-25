/**
 * plugin-sign — 插件清单签名工具链（T25-08 P2，2026-10-25）
 *
 * 为什么需要它：签名闸（`LIRI_PLUGIN_REQUIRE_SIGNATURE`）要求 `plugin.sig` 是对
 * `plugin.json` **原始字节**的 Ed25519 签名（base64），但此前没有任何生成手段 ——
 * 只能手搓 openssl 且极易把"规范化后的 JSON"签进去（验签会失败，且原因难查）。
 *
 * 三个子命令（全部只碰本地文件，不联网）：
 *   keygen --out <dir> [--force]                     生成 Ed25519 密钥对（私钥 PKCS8 / 公钥 SPKI）
 *   sign   --plugin <dir> [--key <pem>]              对 `<dir>/plugin.json` 原始字节签名 ⇒ `<dir>/plugin.sig`
 *   verify --plugin <dir> --keys <dir>               用受信任公钥目录验签（与运行时同一个入口）
 *
 * 用法：`bun run plugin:sign <子命令> …`（在 `app/` 下）。
 *
 * 安全口径（如实）：
 * - 私钥**只落在本地**（默认 `plugin-signing.key`，权限尽量收窄）；本工具不做密钥托管；
 * - 信任锚仍是「目录里放 `*.pem` 公钥」：私钥对应的公钥要**手工**放进
 *   `LIRI_PLUGIN_TRUSTED_KEYS_DIR`，工具不会替你改运行时的信任配置。
 */
import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLUGIN_MANIFEST_FILE,
  PLUGIN_SIGNATURE_FILE,
  PLUGIN_SIGNATURE_ENFORCE_ENV,
  PLUGIN_TRUSTED_KEYS_DIR_ENV,
  checkPluginSignature,
} from '../src/plugins/utils/pluginSignature';

const DEFAULT_KEY_FILE = 'plugin-signing.key';
const DEFAULT_PUBLIC_FILE = 'plugin-signing.pub.pem';

const USAGE = `插件清单签名工具（T25-08 P2）

用法：bun run plugin:sign <子命令> [参数]

  keygen --out <dir> [--force]
      生成 Ed25519 密钥对：<dir>/${DEFAULT_KEY_FILE}（私钥，务必保密）+ <dir>/${DEFAULT_PUBLIC_FILE}

  sign --plugin <dir> [--key <pem>]
      对 <dir>/${PLUGIN_MANIFEST_FILE} 的**原始字节**签名，写出 <dir>/${PLUGIN_SIGNATURE_FILE}（base64）

  verify --plugin <dir> --keys <dir>
      用受信任公钥目录（*.pem）验签；与运行时门禁共用 checkPluginSignature

启用（运行时）：把公钥放进**默认信任锚**即生效
  ${PLUGIN_TRUSTED_KEYS_DIR_ENV}=<自定义目录>   # 可选；不设则用下面的默认位置
  默认位置：<plugins 根>/trusted-keys（放 *.pem）
  ${PLUGIN_SIGNATURE_ENFORCE_ENV}=false   # 可选：临时关闭校验
`;

function fail(message: string): never {
  process.stderr.write(`[plugin-sign] ❌ ${message}\n`);
  process.exit(1);
}

function argValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

/** 公钥指纹（SPKI DER 的 SHA-256 前 16 hex）：用于在文档/日志里点名一把钥匙 */
function fingerprintOf(publicPem: string): string {
  const der = Buffer.from(
    publicPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
    'base64'
  );
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

function keygen(args: readonly string[]): void {
  const outDir = argValue(args, '--out');
  if (!outDir) fail(`keygen 需要 --out <dir>\n\n${USAGE}`);
  const force = args.includes('--force');
  const keyPath = join(outDir, DEFAULT_KEY_FILE);
  const pubPath = join(outDir, DEFAULT_PUBLIC_FILE);
  if (!force && (existsSync(keyPath) || existsSync(pubPath))) {
    fail(`目标目录已有密钥文件（用 --force 覆盖）：${outDir}`);
  }
  mkdirSync(outDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  writeFileSync(
    keyPath,
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    { encoding: 'utf-8', mode: 0o600 }
  );
  writeFileSync(pubPath, publicPem, 'utf-8');
  process.stdout.write(
    `[plugin-sign] ✅ 已生成密钥对\n` +
      `  私钥：${keyPath}（保密；不要放进插件目录）\n` +
      `  公钥：${pubPath}（复制到默认信任锚 <plugins 根>/trusted-keys/，或 ${PLUGIN_TRUSTED_KEYS_DIR_ENV} 指向的目录）\n` +
      `  指纹：${fingerprintOf(publicPem)}\n`
  );
}

function sign(args: readonly string[]): void {
  const pluginDir = argValue(args, '--plugin');
  if (!pluginDir) fail(`sign 需要 --plugin <dir>\n\n${USAGE}`);
  const keyPath = argValue(args, '--key') ?? DEFAULT_KEY_FILE;
  const manifestPath = join(pluginDir, PLUGIN_MANIFEST_FILE);
  if (!existsSync(manifestPath)) fail(`找不到清单：${manifestPath}`);
  if (!existsSync(keyPath)) fail(`找不到私钥：${keyPath}（先用 keygen 生成）`);

  const manifestBytes = readFileSync(manifestPath);
  const signature = cryptoSign(null, manifestBytes, readFileSync(keyPath));
  const signaturePath = join(pluginDir, PLUGIN_SIGNATURE_FILE);
  writeFileSync(signaturePath, signature.toString('base64'), 'utf-8');
  process.stdout.write(
    `[plugin-sign] ✅ 已签名 ${manifestPath}（${manifestBytes.length} 字节，原始字节）\n` +
      `  签名：${signaturePath}\n`
  );
}

function verify(args: readonly string[]): void {
  const pluginDir = argValue(args, '--plugin');
  const keysDir = argValue(args, '--keys');
  if (!pluginDir || !keysDir)
    fail(`verify 需要 --plugin <dir> --keys <dir>\n\n${USAGE}`);

  const decision = checkPluginSignature({
    pluginDir,
    // 与运行时同一入口：本命令等价于"开启强制签名 + 指定信任锚"时的判定
    env: {
      [PLUGIN_SIGNATURE_ENFORCE_ENV]: 'true',
      [PLUGIN_TRUSTED_KEYS_DIR_ENV]: keysDir,
    },
  });
  if (!decision.allowed) {
    process.stderr.write(
      `[plugin-sign] ❌ 验签未通过：${decision.reason ?? '未知原因'}\n`
    );
    process.exit(1);
  }
  process.stdout.write(
    `[plugin-sign] ✅ 验签通过${decision.signerKeyFile ? `（公钥 ${decision.signerKeyFile}）` : ''}\n`
  );
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'keygen':
      keygen(args);
      return;
    case 'sign':
      sign(args);
      return;
    case 'verify':
      verify(args);
      return;
    case '--help':
    case '-h':
    case undefined:
      process.stdout.write(USAGE);
      return;
    default:
      process.stderr.write(
        `[plugin-sign] ❌ 未知子命令：${command}\n\n${USAGE}`
      );
      process.exit(2);
  }
}

main();
