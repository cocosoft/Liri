// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P2 · 插件清单签名（2026-10-25）：默认关；开启后 fail-closed。
//
// 锁五件事：
//  ① 开关只认 1/true/yes/on，缺省关（未启用 ⇒ 不读任何文件）；
//  ② 信任锚**无默认目录**：开启但未配置 ⇒ 拒绝（否则"校验"可被空目录绕过）；
//  ③ 签名对象是清单**原始字节**（换行/空格变化即失败），签名 base64 允许折行；
//  ④ 非 Ed25519 公钥/坏 PEM 只记问题，不参与信任；
//  ⑤ 加载器层：开启后未签名/被篡改 ⇒ 拒绝加载，且不执行入口。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PLUGIN_SIGNATURE_ENFORCE_ENV,
  PLUGIN_TRUSTED_KEYS_DIR_ENV,
  checkPluginSignature,
  isSignatureEnforcementEnabled,
  loadTrustedPublicKeys,
  normalizeSignature,
  resolveTrustedKeysDir,
  verifyDetachedSignature,
} from '../../src/plugins/utils/pluginSignature';
import { PluginLoader } from '../../src/plugins/core/PluginLoader';
import { PluginState } from '../../src/plugins/types/PluginTypes';

const ENV_SIGN = PLUGIN_SIGNATURE_ENFORCE_ENV;
const ENV_KEYS = PLUGIN_TRUSTED_KEYS_DIR_ENV;
const ENV_TRUSTED = 'LIRI_PLUGIN_TRUSTED_IDS';

const saved: Record<string, string | undefined> = {};
const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function ed25519Pair(): {
  publicPem: string;
  privateKey: Parameters<typeof sign>[2];
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey,
  };
}

/** 造一个已签名（或故意不签）的插件目录 */
function makePluginDir(options: {
  signWith?: Parameters<typeof sign>[2];
  omitSignature?: boolean;
  tamperAfterSign?: boolean;
}): { dir: string; manifestBytes: Buffer } {
  const dir = tempDir('liri-sig-');
  const manifestPath = join(dir, 'plugin.json');
  const body = {
    id: 'sig-probe',
    name: 'sig-probe',
    version: '1.0.0',
    description: 'probe',
    entryPoint: 'index.js',
    capabilities: ['tools'],
  };
  writeFileSync(manifestPath, JSON.stringify(body), 'utf8');
  const manifestBytes = Buffer.from(JSON.stringify(body), 'utf8');

  if (options.signWith && !options.omitSignature) {
    const signature = sign(null, manifestBytes, options.signWith).toString(
      'base64'
    );
    writeFileSync(join(dir, 'plugin.sig'), signature, 'utf8');
  }
  if (options.tamperAfterSign) {
    writeFileSync(
      manifestPath,
      JSON.stringify({ ...body, name: 'tampered' }),
      'utf8'
    );
  }
  return { dir, manifestBytes };
}

beforeEach(() => {
  for (const key of [ENV_SIGN, ENV_KEYS, ENV_TRUSTED, 'LIRI_HOME']) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  // 隔离默认信任锚（`<LIRI_HOME>/plugins/trusted-keys`）：不读开发机真实公钥目录
  process.env.LIRI_HOME = tempDir('liri-sig-home-');
});

afterEach(() => {
  for (const key of [ENV_SIGN, ENV_KEYS, ENV_TRUSTED, 'LIRI_HOME']) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  }
});

describe('签名开关与信任锚（纯函数）', () => {
  it('显式值优先：1/true/yes/on ⇒ 开；0/false/no/off ⇒ 关；缺省看信任锚', () => {
    expect(isSignatureEnforcementEnabled({})).toBe(false);
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
      expect(isSignatureEnforcementEnabled({ [ENV_SIGN]: value })).toBe(true);
    }
    for (const value of ['0', 'false', 'NO', 'off']) {
      // 即使配了信任锚，显式关也必须生效（灰度回退的唯一退路）
      expect(
        isSignatureEnforcementEnabled({
          [ENV_SIGN]: value,
          [ENV_KEYS]: '/keys',
        })
      ).toBe(false);
    }
    // 空串 = 未设置（不是"关"）：仍按信任锚判定
    expect(
      isSignatureEnforcementEnabled({ [ENV_SIGN]: '', [ENV_KEYS]: '/keys' })
    ).toBe(true);
    // 未设置开关：配了信任锚即视为"要校验"（漏写开关不再等于无校验）
    expect(isSignatureEnforcementEnabled({ [ENV_KEYS]: '/keys' })).toBe(true);
  });

  it('信任锚：未配 env ⇒ 默认位置；默认目录没有 *.pem ⇒ null', () => {
    const home = process.env.LIRI_HOME!;
    expect(resolveTrustedKeysDir({ LIRI_HOME: home })).toBeNull();

    // 显式配置优先（空白 ⇒ 视同未配，回退默认位置）
    expect(
      resolveTrustedKeysDir({ [ENV_KEYS]: '   ', LIRI_HOME: home })
    ).toBeNull();
    expect(resolveTrustedKeysDir({ [ENV_KEYS]: ' /keys ' })).toBe('/keys');
  });

  it('默认信任锚 `<plugins>/trusted-keys`：放了一把 *.pem 就自动生效', () => {
    const home = process.env.LIRI_HOME!;
    const defaultDir = join(home, 'plugins', 'trusted-keys');
    mkdirSync(defaultDir, { recursive: true });
    const env = { LIRI_HOME: home };

    // 空目录不算"配了信任锚"（否则升级后所有已信任插件会突然被拒）
    expect(resolveTrustedKeysDir(env)).toBeNull();
    expect(isSignatureEnforcementEnabled(env)).toBe(false);

    writeFileSync(
      join(defaultDir, 'official.pem'),
      ed25519Pair().publicPem,
      'utf8'
    );
    expect(resolveTrustedKeysDir(env)).toBe(defaultDir);
    expect(isSignatureEnforcementEnabled(env)).toBe(true);
  });

  it('签名文本允许折行/空白；非 base64 / 空 ⇒ null', () => {
    expect(normalizeSignature(' AA\nBB \n')).toBe('AABB');
    expect(normalizeSignature('')).toBeNull();
    expect(normalizeSignature('not base64!')).toBeNull();
  });
});

describe('公钥目录与验签', () => {
  it('Ed25519 公钥可用；非 Ed25519 / 坏 PEM 只记问题', () => {
    const dir = tempDir('liri-keys-');
    const keyDir = join(dir, 'keys');
    mkdirSync(keyDir);
    const { publicPem } = ed25519Pair();
    writeFileSync(join(keyDir, 'a.pem'), publicPem, 'utf8');

    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(
      join(keyDir, 'b.pem'),
      rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      'utf8'
    );
    writeFileSync(join(keyDir, 'c.pem'), 'not a pem', 'utf8');

    const loaded = loadTrustedPublicKeys(keyDir);
    expect(loaded.keys.map((k) => k.file)).toEqual(['a.pem']);
    expect(loaded.problems.length).toBe(2);
  });

  it('目录不存在 / 无 *.pem ⇒ 有清楚的问题说明', () => {
    const dir = tempDir('liri-keys-missing-');
    expect(loadTrustedPublicKeys(join(dir, 'nope')).keys).toEqual([]);
    expect(loadTrustedPublicKeys(join(dir, 'nope')).problems.join()).toContain(
      '不存在'
    );

    const empty = join(dir, 'keys');
    mkdirSync(empty);
    expect(loadTrustedPublicKeys(empty).problems.join()).toContain('没有');
  });

  it('原始字节一致才通过；改一个字节 / 换公钥 ⇒ 不匹配', () => {
    const a = ed25519Pair();
    const b = ed25519Pair();
    const payload = Buffer.from('{"id":"x"}', 'utf8');
    const signature = sign(null, payload, a.privateKey).toString('base64');

    const keysA = [{ file: 'a.pem', key: createPublicKey(a.publicPem) }];
    const keysB = [{ file: 'b.pem', key: createPublicKey(b.publicPem) }];

    expect(verifyDetachedSignature(payload, signature, keysA)).toBe('a.pem');
    expect(verifyDetachedSignature(payload, signature, keysB)).toBeNull();
    expect(
      verifyDetachedSignature(
        Buffer.from('{"id":"y"}', 'utf8'),
        signature,
        keysA
      )
    ).toBeNull();
  });
});

describe('checkPluginSignature（安装/加载共用入口）', () => {
  it('未启用 ⇒ 放行且不读文件（目录不存在也不报错）', () => {
    const decision = checkPluginSignature({
      pluginDir: join(tmpdir(), 'definitely-not-here-liri'),
      // LIRI_HOME 指向空临时目录 ⇒ 默认信任锚不含公钥 ⇒ 判定为未启用
      env: { LIRI_HOME: process.env.LIRI_HOME! },
    });
    expect(decision).toEqual({ allowed: true });
  });

  it('启用但未配信任锚 ⇒ 拒绝（指向具体 env）', () => {
    const { dir } = makePluginDir({});
    const decision = checkPluginSignature({
      pluginDir: dir,
      env: { [ENV_SIGN]: '1' },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain(ENV_KEYS);
  });

  it('启用 + 有效签名 + 受信任公钥 ⇒ 放行并回签名者文件名', () => {
    const pair = ed25519Pair();
    const keysDir = tempDir('liri-keys-ok-');
    writeFileSync(join(keysDir, 'trusted.pem'), pair.publicPem, 'utf8');
    const { dir } = makePluginDir({ signWith: pair.privateKey });

    const decision = checkPluginSignature({
      pluginDir: dir,
      env: { [ENV_SIGN]: 'true', [ENV_KEYS]: keysDir },
    });
    expect(decision).toEqual({ allowed: true, signerKeyFile: 'trusted.pem' });
  });

  it('缺 plugin.sig / 签名非法 / 清单被改 ⇒ 拒绝且原因可读', () => {
    const pair = ed25519Pair();
    const keysDir = tempDir('liri-keys-bad-');
    writeFileSync(join(keysDir, 'trusted.pem'), pair.publicPem, 'utf8');
    const env = { [ENV_SIGN]: '1', [ENV_KEYS]: keysDir };

    const unsigned = makePluginDir({ omitSignature: true });
    expect(
      checkPluginSignature({ pluginDir: unsigned.dir, env }).reason
    ).toContain('plugin.sig');

    const tampered = makePluginDir({
      signWith: pair.privateKey,
      tamperAfterSign: true,
    });
    expect(
      checkPluginSignature({ pluginDir: tampered.dir, env }).reason
    ).toContain('签名不匹配');

    const garbage = makePluginDir({ signWith: pair.privateKey });
    writeFileSync(join(garbage.dir, 'plugin.sig'), '!!!not-base64!!!', 'utf8');
    expect(
      checkPluginSignature({ pluginDir: garbage.dir, env }).reason
    ).toContain('base64');
  });

  it('只配信任锚（不写开关）⇒ 也校验：未签名插件被拒（防"配了公钥却不校验"）', () => {
    const pair = ed25519Pair();
    const keysDir = tempDir('liri-keys-auto-');
    writeFileSync(join(keysDir, 'trusted.pem'), pair.publicPem, 'utf8');
    const { dir } = makePluginDir({ omitSignature: true });

    const decision = checkPluginSignature({
      pluginDir: dir,
      env: { [ENV_KEYS]: keysDir },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('plugin.sig');
  });

  it('默认信任锚生效：公钥放 <plugins>/trusted-keys ⇒ 未签名被拒、签名放行（无需任何 env）', () => {
    const home = process.env.LIRI_HOME!;
    const keysDir = join(home, 'plugins', 'trusted-keys');
    mkdirSync(keysDir, { recursive: true });
    const pair = ed25519Pair();
    writeFileSync(join(keysDir, 'official.pem'), pair.publicPem, 'utf8');
    const env = { LIRI_HOME: home };

    const unsigned = makePluginDir({ omitSignature: true });
    expect(checkPluginSignature({ pluginDir: unsigned.dir, env }).allowed).toBe(
      false
    );

    const signed = makePluginDir({ signWith: pair.privateKey });
    expect(checkPluginSignature({ pluginDir: signed.dir, env })).toEqual({
      allowed: true,
      signerKeyFile: 'official.pem',
    });
  });

  it('目录里没有 plugin.json ⇒ 放行（无清单不会被加载器发现）', () => {
    const dir = tempDir('liri-no-manifest-');
    const decision = checkPluginSignature({
      pluginDir: dir,
      env: { [ENV_SIGN]: '1' },
    });
    expect(decision.allowed).toBe(true);
  });
});

describe('加载器闸位（开启签名后）', () => {
  function setup(signWith?: Parameters<typeof sign>[2]): {
    pluginRoot: string;
    id: string;
    keysDir: string;
  } {
    const id = 'sig-probe';
    const pluginRoot = tempDir('liri-sig-root-');
    const pluginDir = join(pluginRoot, id);
    mkdirSync(pluginDir, { recursive: true });
    const body = {
      id,
      name: 'sig-probe',
      version: '1.0.0',
      description: 'probe',
      entryPoint: 'index.js',
      capabilities: ['tools'],
    };
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(body), 'utf8');
    // 一个可被成功 import 的入口：本组用例只关心签名闸，不制造"入口缺失"的噪声失败
    writeFileSync(
      join(pluginDir, 'index.js'),
      'export default { name: "sig-probe", version: "1.0.0" };\n',
      'utf8'
    );
    if (signWith) {
      const bytes = Buffer.from(JSON.stringify(body), 'utf8');
      writeFileSync(
        join(pluginDir, 'plugin.sig'),
        sign(null, bytes, signWith).toString('base64'),
        'utf8'
      );
    }
    const keysDir = tempDir('liri-sig-keys-');
    return { pluginRoot, id, keysDir };
  }

  it('未签名 ⇒ 拒绝加载（状态回 UNLOADED）', async () => {
    const { pluginRoot, id, keysDir } = setup();
    const pair = ed25519Pair();
    writeFileSync(join(keysDir, 'trusted.pem'), pair.publicPem, 'utf8');
    process.env[ENV_TRUSTED] = id;
    process.env[ENV_SIGN] = '1';
    process.env[ENV_KEYS] = keysDir;

    const loader = new PluginLoader({
      pluginDirectories: [pluginRoot],
      autoLoad: false,
    });
    // 加载失败的 ERROR 事件在 EventEmitter 上是 'error'（无监听器会抛）—— 本组只关心签名闸
    loader.on('error', () => {});
    await loader.initialize();
    const result = await loader.loadPlugin(id);

    expect(result.success).toBe(false);
    expect(result.error).toContain('签名校验未通过');
    expect(loader.getPlugin(id)?.state).toBe(PluginState.UNLOADED);
  });

  it('有效签名 ⇒ 通过签名闸（本用例只断言不因签名被拒）', async () => {
    const pair = ed25519Pair();
    const { pluginRoot, id, keysDir } = setup(pair.privateKey);
    writeFileSync(join(keysDir, 'trusted.pem'), pair.publicPem, 'utf8');
    process.env[ENV_TRUSTED] = id;
    process.env[ENV_SIGN] = '1';
    process.env[ENV_KEYS] = keysDir;

    const loader = new PluginLoader({
      pluginDirectories: [pluginRoot],
      autoLoad: false,
    });
    loader.on('error', () => {});
    await loader.initialize();
    const result = await loader.loadPlugin(id);

    // 只断言"不是被签名闸拒的"（其余环节成败与本用例无关）
    expect(result.error ?? '').not.toContain('签名校验未通过');
  });
});
