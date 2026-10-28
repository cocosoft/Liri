/**
 * 插件清单**签名校验**（T25-08 P2，2026-10-25）。
 *
 * 方案：`.trae/specs/plugin-process-isolation.md` §4「P2：市场 / 安装链路改造」——
 * 「安装时校验签名（可选）」。
 *
 * 口径（**信任锚即意图**，2026-10-25）：
 * - `LIRI_PLUGIN_REQUIRE_SIGNATURE` **显式**为 `false/0/no/off` ⇒ 关；显式为真值 ⇒ 开；
 *   **未设置** ⇒ 配了信任锚就自动开，否则关（详见 `isSignatureEnforcementEnabled`）；
 * - 信任锚 = **三处并集**：随包官方钥 `<projectRoot>/app/trusted-keys` ∪ 用户默认位置
 *   `<plugins 根>/trusted-keys` ∪ `LIRI_PLUGIN_TRUSTED_KEYS_DIR`（显式配置时**即使目录不存在**
 *   也参与判定，让错误暴露成可读的"目录不存在"）。任一目录**真的含 `*.pem`** 即生效。
 *   并集语义：用户自建钥**不会**把随包官方钥挤掉；随包目录只放**公钥**，私钥永不入库/不随包；
 * - 签名对象 = **`plugin.json` 的原始字节**（`plugin.sig` 存 base64），**不做 JSON 再序列化**
 *   —— 任何"规范化后签名"都要自己维护一套规范化规则，规则一偏就是验签成功但内容不同；
 * - 失败一律 fail-closed：未配信任锚 / 目录不存在 / 无有效公钥 / 缺签名 / 验签不匹配 ⇒ 拒绝。
 *
 * 非目标（如实）：没有密钥轮换/吊销列表、没有时间戳/防重放；这些等市场链路落地再谈。
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveBundledTrustedKeysDir,
  resolvePluginsDir,
} from '@modules/environment';

/** 启用强制签名校验的 env（`1` / `true` / `yes`，大小写不敏感） */
export const PLUGIN_SIGNATURE_ENFORCE_ENV = 'LIRI_PLUGIN_REQUIRE_SIGNATURE';
/** 受信任公钥目录 env（**追加**在随包官方钥与默认信任锚之上，不替代它们；见 `resolveTrustedKeysDirs`） */
export const PLUGIN_TRUSTED_KEYS_DIR_ENV = 'LIRI_PLUGIN_TRUSTED_KEYS_DIR';
/** 默认信任锚目录名（位于 `<plugins 根>/` 下；用户自建钥放这里，与随包官方钥互不替代） */
export const PLUGIN_DEFAULT_TRUSTED_KEYS_DIR_NAME = 'trusted-keys';
/** 清单文件名（签名对象） */
export const PLUGIN_MANIFEST_FILE = 'plugin.json';
/** 分离签名文件名（base64，签的是清单原始字节） */
export const PLUGIN_SIGNATURE_FILE = 'plugin.sig';

/** 一条受信任公钥 */
export interface TrustedPublicKey {
  /** 文件名（仅用于日志/定位，**不参与信任判断**） */
  file: string;
  key: KeyObject;
}

/** 校验结论 */
export interface PluginSignatureDecision {
  allowed: boolean;
  /** 拒绝原因（`allowed=false` 时必有；直接用于安装/加载错误文案） */
  reason?: string;
  /** 命中的公钥文件名（放行时，便于审计） */
  signerKeyFile?: string;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

/**
 * 是否启用强制签名校验。
 *
 * 判定顺序（2026-10-25 起"信任锚即意图"）：
 * 1. 显式 `=false/0/no/off` ⇒ **关**（灰度回退，即使配了信任锚）；
 * 2. 显式 `=true/1/yes/on` ⇒ **开**；
 * 3. 未设置 ⇒ **存在信任锚就自动开**，否则关。
 *
 * 为什么第 3 条值得这个"自动"：信任锚是**显式的安全意图**（随包官方钥 / 用户目录 / env 任一），
 * 但此前必须再记得写第二个开关；漏写就变成"配了公钥却完全不校验"的假保护 —— 与
 * `INV-SEC-003` 那类"把存在当生效"的失真同型。关掉仍有一条明确退路（显式 `=false`）。
 */
export function isSignatureEnforcementEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env[PLUGIN_SIGNATURE_ENFORCE_ENV];
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (FALSY.has(value)) return false;
    if (TRUTHY.has(value)) return true;
  }
  return resolveTrustedKeysDirs(env).length > 0;
}

/** 用户默认信任锚目录（`<plugins 根>/trusted-keys`，用户自建钥） */
export function resolveDefaultTrustedKeysDir(
  env: NodeJS.ProcessEnv = process.env
): string {
  return join(resolvePluginsDir(env), PLUGIN_DEFAULT_TRUSTED_KEYS_DIR_NAME);
}

/** 目录里是否有至少一把 `*.pem` 公钥（无目录/空目录 ⇒ false） */
function hasAnyPublicKey(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => name.endsWith('.pem'));
  } catch {
    // @ignore-catch — 目录不存在/不可读 ⇒ 视为没有公钥（下面的调用方按 null 处理）
    return false;
  }
}

/**
 * 解析**全部**信任锚目录（并集，去重，保持顺序）。
 *
 * 顺序（返回顺序 = 验签尝试顺序，仅影响日志里先命中哪把钥，不影响信任集合）：
 * 1. `LIRI_PLUGIN_TRUSTED_KEYS_DIR` 显式配置 ⇒ **原样加入**（即使不存在，让错误暴露成
 *    可读的「信任锚目录不存在」，而不是悄悄退回默认目录）；
 * 2. 随包官方钥 `<projectRoot>/app/trusted-keys` —— **仅当真的含 `*.pem`** 才加入
 *    （开发检出里该目录只有说明文件，不改变默认行为）；
 * 3. 用户默认位置 `<plugins 根>/trusted-keys` —— 同样**仅当真的含 `*.pem`** 才加入
 *    （空目录不算"配了信任锚"，否则升级后所有已信任插件会突然被拒）。
 *
 * 并集而非覆盖：用户自建钥**不会**把随包官方钥挤掉，反之亦然。
 */
export function resolveTrustedKeysDirs(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const dirs: string[] = [];
  const raw = env[PLUGIN_TRUSTED_KEYS_DIR_ENV];
  if (typeof raw === 'string' && raw.trim().length > 0) dirs.push(raw.trim());

  for (const candidate of [
    resolveBundledTrustedKeysDir(env),
    resolveDefaultTrustedKeysDir(env),
  ]) {
    if (!dirs.includes(candidate) && hasAnyPublicKey(candidate)) {
      dirs.push(candidate);
    }
  }
  return dirs;
}

/**
 * 归一化签名文本：去掉换行/空白（base64 常被折行），并校验字符集。
 *
 * 非法（空 / 含非 base64 字符）⇒ `null`（**不猜**：不把坏签名当"没签名"放过）。
 */
export function normalizeSignature(text: string): string | null {
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  return compact;
}

/** 读取信任锚目录下的 Ed25519 公钥（非 Ed25519 / 解析失败 ⇒ 记问题并跳过） */
export function loadTrustedPublicKeys(dir: string): {
  keys: TrustedPublicKey[];
  problems: string[];
} {
  const keys: TrustedPublicKey[] = [];
  const problems: string[] = [];
  if (!existsSync(dir)) {
    problems.push(`信任锚目录不存在：${dir}`);
    return { keys, problems };
  }
  let entries: string[];
  try {
    entries = readdirSync(dir)
      .filter((name) => name.endsWith('.pem'))
      .sort();
  } catch (error) {
    problems.push(`信任锚目录不可读：${String(error)}`);
    return { keys, problems };
  }
  for (const file of entries) {
    try {
      const key = createPublicKey(readFileSync(join(dir, file)));
      if (key.asymmetricKeyType !== 'ed25519') {
        problems.push(
          `${file}：不是 Ed25519 公钥（${String(key.asymmetricKeyType)}）`
        );
        continue;
      }
      keys.push({ file, key });
    } catch (error) {
      problems.push(`${file}：公钥解析失败（${String(error)}）`);
    }
  }
  if (keys.length === 0 && problems.length === 0) {
    problems.push(`信任锚目录内没有 *.pem 公钥：${dir}`);
  }
  return { keys, problems };
}

/**
 * 验签：清单**原始字节** + base64 签名 + 任一受信任公钥。
 *
 * @returns 命中的公钥文件名；全不匹配 ⇒ `null`
 */
export function verifyDetachedSignature(
  manifestBytes: Uint8Array,
  signatureBase64: string,
  keys: readonly TrustedPublicKey[]
): string | null {
  const signature = normalizeSignature(signatureBase64);
  if (!signature) return null;
  const raw = Buffer.from(signature, 'base64');
  for (const candidate of keys) {
    try {
      if (verify(null, manifestBytes, candidate.key, raw))
        return candidate.file;
    } catch {
      // @ignore-catch — 单个公钥验签抛错（算法不符等）⇒ 视为不匹配，继续试下一把
    }
  }
  return null;
}

/**
 * 安装 / 加载共用的**单一入口**（含 IO）。
 *
 * 顺序上先判开关：未启用时**不读任何文件** ⇒ 默认部署零行为变更、零额外 IO。
 */
export function checkPluginSignature(input: {
  pluginDir: string;
  env?: NodeJS.ProcessEnv;
}): PluginSignatureDecision {
  const env = input.env ?? process.env;
  if (!isSignatureEnforcementEnabled(env)) return { allowed: true };

  const manifestPath = join(input.pluginDir, PLUGIN_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    // 没有清单 ⇒ 不会被 `PluginLoader` 发现，也不构成运行时入口；与能力闸同口径放行
    return { allowed: true };
  }

  const keysDirs = resolveTrustedKeysDirs(env);
  if (keysDirs.length === 0) {
    return {
      allowed: false,
      reason:
        `已启用清单签名校验（${PLUGIN_SIGNATURE_ENFORCE_ENV}），但没有可用的信任锚：` +
        `把 Ed25519 公钥（*.pem）放进随包目录 ${resolveBundledTrustedKeysDir(env)}、` +
        `用户目录 ${resolveDefaultTrustedKeysDir(env)}，或设置 ` +
        `${PLUGIN_TRUSTED_KEYS_DIR_ENV}=<目录>。`,
    };
  }
  const keys: TrustedPublicKey[] = [];
  const problems: string[] = [];
  for (const dir of keysDirs) {
    const loaded = loadTrustedPublicKeys(dir);
    keys.push(...loaded.keys);
    problems.push(...loaded.problems);
  }
  if (keys.length === 0) {
    return {
      allowed: false,
      reason: `信任锚不可用（${keysDirs.join('、')}）：${problems.join('；') || '没有任何可用公钥'}。`,
    };
  }

  const signaturePath = join(input.pluginDir, PLUGIN_SIGNATURE_FILE);
  if (!existsSync(signaturePath)) {
    return {
      allowed: false,
      reason:
        `缺少 ${PLUGIN_SIGNATURE_FILE}：需要对 ${PLUGIN_MANIFEST_FILE} 的**原始字节**做 ` +
        `Ed25519 签名（base64）并放在插件目录内。`,
    };
  }

  let manifestBytes: Buffer;
  let signatureText: string;
  try {
    manifestBytes = readFileSync(manifestPath);
    signatureText = readFileSync(signaturePath, 'utf-8');
  } catch (error) {
    return {
      allowed: false,
      reason: `读取清单或签名失败：${String(error)}`,
    };
  }

  if (normalizeSignature(signatureText) === null) {
    return {
      allowed: false,
      reason: `${PLUGIN_SIGNATURE_FILE} 不是合法的 base64 签名。`,
    };
  }

  const matched = verifyDetachedSignature(manifestBytes, signatureText, keys);
  if (!matched) {
    return {
      allowed: false,
      reason:
        '签名不匹配：未命中任何受信任公钥（清单可能被改动，或签名并非对原始字节计算）。',
    };
  }
  return { allowed: true, signerKeyFile: matched };
}
