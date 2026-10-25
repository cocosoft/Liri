// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P0（2026-10-25 用户裁定「默认拒绝 + 白名单」）：第三方插件准入闸。
//
// 口径：文件/安装型插件在主进程内 `import` 执行 ⇒ 默认不可信；放行两途：
//   ① `LIRI_PLUGIN_TRUSTED_IDS=<id>[,<id>]`；② 逃生 `FEATURE_PLUGIN_THIRD_PARTY_INPROCESS=true`。
import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '@openliri/kernel';
import {
  decidePluginTrust,
  isThirdPartyPluginTrusted,
  parseTrustedPluginIds,
} from '../../src/plugins/utils/pluginTrust';

const ENV_IDS = 'LIRI_PLUGIN_TRUSTED_IDS';
const ENV_FLAG = 'FEATURE_PLUGIN_THIRD_PARTY_INPROCESS';

const saved: Record<string, string | undefined> = {};
function stash(key: string): void {
  saved[key] = process.env[key];
}
function restore(key: string): void {
  if (saved[key] === undefined) delete process.env[key];
  else process.env[key] = saved[key];
}

describe('T25-08：白名单解析', () => {
  it('逗号 / 分号分隔、去空格、剔除空项', () => {
    expect(Array.from(parseTrustedPluginIds('a,b; c ,,'))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(parseTrustedPluginIds(undefined).size).toBe(0);
    expect(parseTrustedPluginIds('   ').size).toBe(0);
  });
});

describe('T25-08：信任判定（纯函数）', () => {
  it('默认（不开逃生、不在白名单）⇒ 拒绝', () => {
    expect(
      decidePluginTrust({
        pluginId: 'evil-plugin',
        trustedIds: new Set(),
        allowInProcess: false,
      })
    ).toEqual({ trusted: false, reason: 'untrusted' });
  });

  it('白名单命中 ⇒ 放行（reason=allowlisted）', () => {
    expect(
      decidePluginTrust({
        pluginId: 'my-plugin',
        trustedIds: new Set(['my-plugin']),
        allowInProcess: false,
      })
    ).toEqual({ trusted: true, reason: 'allowlisted' });
  });

  it('逃生开关开 ⇒ 整体放行（reason=in-process-optin，且优先于白名单）', () => {
    expect(
      decidePluginTrust({
        pluginId: 'anything',
        trustedIds: new Set(),
        allowInProcess: true,
      })
    ).toEqual({ trusted: true, reason: 'in-process-optin' });
  });
});

describe('T25-08：env + 开关的实际入口', () => {
  afterEach(() => {
    restore(ENV_IDS);
    restore(ENV_FLAG);
  });

  it('未配置 ⇒ 拒绝', () => {
    stash(ENV_IDS);
    stash(ENV_FLAG);
    delete process.env[ENV_IDS];
    delete process.env[ENV_FLAG];
    expect(isThirdPartyPluginTrusted('any').trusted).toBe(false);
  });

  it('LIRI_PLUGIN_TRUSTED_IDS 命中 ⇒ 放行；未命中仍拒绝', () => {
    stash(ENV_IDS);
    stash(ENV_FLAG);
    process.env[ENV_IDS] = 'foo, bar';
    delete process.env[ENV_FLAG];
    expect(isThirdPartyPluginTrusted('bar')).toEqual({
      trusted: true,
      reason: 'allowlisted',
    });
    expect(isThirdPartyPluginTrusted('baz').trusted).toBe(false);
  });

  it('FEATURE_PLUGIN_THIRD_PARTY_INPROCESS=true ⇒ 整体放行（逃生）', () => {
    stash(ENV_IDS);
    stash(ENV_FLAG);
    delete process.env[ENV_IDS];
    process.env[ENV_FLAG] = 'true';
    expect(isThirdPartyPluginTrusted('baz')).toEqual({
      trusted: true,
      reason: 'in-process-optin',
    });
  });
});

describe('T25-08：开关默认值与加载器闸位', () => {
  it('PLUGIN_THIRD_PARTY_INPROCESS 默认关（默认拒绝）', () => {
    expect(FEATURE_FLAGS.PLUGIN_THIRD_PARTY_INPROCESS).toBe(false);
  });

  it('加载器在 `import(entryPath)` 之前调用准入闸（源码级防回流）', () => {
    const src = readFileSync(
      new URL('../../src/plugins/core/PluginLoader.ts', import.meta.url),
      'utf8'
    );
    const gate = src.indexOf('isThirdPartyPluginTrusted(');
    const importCall = src.indexOf('await import(entryPath)');
    expect(gate).toBeGreaterThan(-1);
    expect(importCall).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(importCall);
  });
});
