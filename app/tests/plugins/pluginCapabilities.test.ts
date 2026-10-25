// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P2（2026-10-25）：插件**能力授权**——纯判定 + 加载器闸位。
//
// 口径（spec §4 P2 / §6）：能力是闭合集合；授权表 `LIRI_PLUGIN_CAPABILITY_GRANTS`
// 未配置 ⇒ 零行为变更；配置后 fail-closed（声明未授权 ⇒ 拒绝加载）。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  LEGACY_DEFAULT_CAPABILITIES,
  PLUGIN_CAPABILITY_GRANTS_ENV,
  decidePluginCapabilities,
  describeCapabilityDenial,
  isCapabilityEnforcementEnabled,
  parseCapabilityGrants,
  parseDeclaredCapabilities,
  resolvePluginCapabilities,
} from '../../src/plugins/utils/pluginCapabilities';
import { PluginLoader } from '../../src/plugins/core/PluginLoader';
import { PluginState } from '../../src/plugins/types/PluginTypes';

const ENV_GRANTS = PLUGIN_CAPABILITY_GRANTS_ENV;
const ENV_TRUSTED = 'LIRI_PLUGIN_TRUSTED_IDS';
const saved: Record<string, string | undefined> = {};
const temps: string[] = [];

beforeEach(() => {
  for (const key of [ENV_GRANTS, ENV_TRUSTED]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of [ENV_GRANTS, ENV_TRUSTED]) {
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

describe('T25-08 P2 · 声明解析（闭合集合）', () => {
  it('缺省 ⇒ 旧清单保守默认 tools', () => {
    expect(parseDeclaredCapabilities(undefined)).toEqual({
      declared: [...LEGACY_DEFAULT_CAPABILITIES],
      unknown: [],
      malformed: false,
    });
    expect([...LEGACY_DEFAULT_CAPABILITIES]).toEqual(['tools']);
  });

  it('合法声明保序去重；集合外名字单独回传', () => {
    expect(parseDeclaredCapabilities(['config', 'tools', 'config'])).toEqual({
      declared: ['config', 'tools'],
      unknown: [],
      malformed: false,
    });
    expect(parseDeclaredCapabilities(['tools', 'network'])).toEqual({
      declared: ['tools'],
      unknown: ['network'],
      malformed: false,
    });
  });

  it('非数组 / 非字符串元素 ⇒ malformed（不猜）', () => {
    expect(parseDeclaredCapabilities('tools').malformed).toBe(true);
    expect(parseDeclaredCapabilities(['tools', 1]).malformed).toBe(true);
  });
});

describe('T25-08 P2 · 授权表解析', () => {
  it('多插件 / 多能力；非法片段跳过', () => {
    const grants = parseCapabilityGrants(
      'a:tools,config; b:events ;bad;:tools;c:'
    );
    expect(grants.get('a')).toEqual(new Set(['tools', 'config']));
    expect(grants.get('b')).toEqual(new Set(['events']));
    expect(grants.get('c')).toEqual(new Set());
    expect(grants.has('bad')).toBe(false);
    expect(parseCapabilityGrants(undefined).size).toBe(0);
  });
});

describe('T25-08 P2 · 判定矩阵', () => {
  const base = { pluginId: 'p', manifestCapabilities: ['tools', 'config'] };

  it('未启用门控 ⇒ 全放行（零行为变更）', () => {
    const d = decidePluginCapabilities(base);
    expect(d).toMatchObject({
      allowed: true,
      granted: ['tools', 'config'],
      missing: [],
      enforced: false,
    });
  });

  it('启用门控 + 缺一项 ⇒ 拒绝并指出缺哪项', () => {
    const d = decidePluginCapabilities({
      ...base,
      grants: new Map([['p', new Set(['tools'])]]),
      enforce: true,
    });
    expect(d.allowed).toBe(false);
    expect(d.missing).toEqual(['config']);
    expect(describeCapabilityDenial(d)).toContain('config');
    expect(describeCapabilityDenial(d)).toContain(ENV_GRANTS);
  });

  it('启用门控 + 全部授权 ⇒ 放行', () => {
    const d = decidePluginCapabilities({
      ...base,
      grants: new Map([['p', new Set(['tools', 'config'])]]),
      enforce: true,
    });
    expect(d).toMatchObject({ allowed: true, missing: [], enforced: true });
  });

  it('未知能力 ⇒ 无论是否启用门控一律拒绝（清单非法）', () => {
    for (const enforce of [false, true]) {
      const d = decidePluginCapabilities({
        pluginId: 'p',
        manifestCapabilities: ['tools', 'network'],
        grants: new Map([['p', new Set(['tools', 'network'])]]),
        enforce,
      });
      expect(d.allowed).toBe(false);
      expect(d.unknown).toEqual(['network']);
      expect(describeCapabilityDenial(d)).toContain('未知能力');
    }
  });
});

describe('T25-08 P2 · env 入口', () => {
  it('授权表为空 ⇒ 不启用门控；非空 ⇒ 启用', () => {
    expect(isCapabilityEnforcementEnabled()).toBe(false);
    expect(resolvePluginCapabilities('p', ['tools', 'config']).allowed).toBe(
      true
    );

    process.env[ENV_GRANTS] = 'p:tools';
    expect(isCapabilityEnforcementEnabled()).toBe(true);
    const d = resolvePluginCapabilities('p', ['tools', 'config']);
    expect(d.allowed).toBe(false);
    expect(d.missing).toEqual(['config']);
  });
});

describe('T25-08 P2 · 加载器闸位（拒绝未授权能力）', () => {
  function makePluginManifest(capabilities: unknown): {
    dir: string;
    id: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), 'liri-cap-loader-'));
    temps.push(dir);
    const id = 'cap-probe';
    // 插件目录 = `<pluginDirectories>/<id>/`（发现逻辑只扫子目录）
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(
      join(dir, id, 'plugin.json'),
      JSON.stringify({
        id,
        name: 'cap-probe',
        version: '1.0.0',
        description: 'probe',
        entryPoint: 'index.js',
        ...(capabilities === undefined ? {} : { capabilities }),
      }),
      'utf8'
    );
    return { dir, id };
  }

  it('已信任但能力未授权 ⇒ 不加载（且不执行入口）', async () => {
    const { dir, id } = makePluginManifest(['tools', 'config']);
    process.env[ENV_TRUSTED] = id;
    process.env[ENV_GRANTS] = `${id}:tools`;

    const loader = new PluginLoader({
      pluginDirectories: [dir],
      autoLoad: false,
    });
    await loader.initialize();
    const result = await loader.loadPlugin(id);

    expect(result.success).toBe(false);
    expect(result.error).toContain('能力校验未通过');
    expect(result.error).toContain('config');
    expect(loader.getPlugin(id)?.state).toBe(PluginState.UNLOADED);
  });

  it('闸门读**磁盘上最新清单**：发现后把能力改大 ⇒ 仍按新清单拒绝（不吃发现期缓存）', async () => {
    const { dir, id } = makePluginManifest(['tools']);
    process.env[ENV_TRUSTED] = id;
    process.env[ENV_GRANTS] = `${id}:tools`;

    const loader = new PluginLoader({
      pluginDirectories: [dir],
      autoLoad: false,
    });
    await loader.initialize(); // 发现期清单：capabilities = ['tools']

    // 发现之后、加载之前，磁盘上的清单被改成要求 config
    writeFileSync(
      join(dir, id, 'plugin.json'),
      JSON.stringify({
        id,
        name: 'cap-probe',
        version: '1.0.0',
        description: 'probe',
        entryPoint: 'index.js',
        capabilities: ['tools', 'config'],
      }),
      'utf8'
    );

    const result = await loader.loadPlugin(id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('能力校验未通过');
    expect(result.error).toContain('config');
  });

  it('源码级防回流：能力闸在 import(entryPath) 之前', () => {
    const src = readFileSync(
      new URL('../../src/plugins/core/PluginLoader.ts', import.meta.url),
      'utf8'
    );
    const gate = src.indexOf('resolvePluginCapabilities(');
    const importCall = src.indexOf('await import(entryPath)');
    expect(gate).toBeGreaterThan(-1);
    expect(importCall).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(importCall);
  });
});
