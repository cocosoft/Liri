// MIT License
// Copyright (c) 2026 190615273@qq.com
// 配置层叠集成测试：内置 YAML 文件 ↔ ProfileManager/BundleManager 端到端

import { describe, expect, it } from 'bun:test';
import { loadProfile, selectProfile } from '../../src/config/layers/ProfileManager';
import { loadBundles } from '../../src/config/layers/BundleManager';

/** 断言辅助：patches 为 Record<string, unknown>，按内置 YAML 预期形状精化类型 */
function patches(p: Record<string, unknown>) {
  return p as {
    logging: { level: string };
    sandbox: { mode: string; enabled: boolean };
    test: { deterministicSeed: boolean };
  };
}

describe('配置层叠集成（内置 YAML 文件）', () => {
  it('selectProfile 优先级：CLI > env > 默认 development', () => {
    expect(selectProfile({ cli: 'production' }).name).toBe('production');
    expect(selectProfile({ cli: 'production', env: 'staging' }).name).toBe('production');
    expect(selectProfile({ env: 'staging' }).name).toBe('staging');
    expect(selectProfile().name).toBe('development');
    expect(selectProfile().source).toBe('default');
  });

  it('development 为空 Profile（11.9.2）', () => {
    const p = loadProfile('development');
    expect(p.bundles).toEqual([]);
    expect(p.patches).toEqual({});
    expect(p.source).toBe('builtin');
  });

  it('production 加载内置 YAML（受控保护）', () => {
    const p = loadProfile('production');
    expect(p.source).toBe('builtin');
    expect(p.protected).toBe(true);
    expect(p.bundles).toEqual(['core', 'chat', 'ai', 'channels', 'enterprise']);
    expect(patches(p.patches).logging.level).toBe('warn');
    expect(patches(p.patches).sandbox.mode).toBe('strict');
  });

  it('受控保护：production 禁止用户覆盖（无 allowOverride）', () => {
    // 无论用户目录是否存在同名文件，production 都取内置（受控）
    const p = loadProfile('production');
    expect(p.source).toBe('builtin');
  });

  it('staging 加载内置 YAML', () => {
    const p = loadProfile('staging');
    expect(patches(p.patches).logging.level).toBe('info');
    expect(patches(p.patches).sandbox.mode).toBe('standard');
  });

  it('test 加载内置 YAML', () => {
    const p = loadProfile('test');
    expect(patches(p.patches).test.deterministicSeed).toBe(true);
    expect(patches(p.patches).sandbox.enabled).toBe(false);
  });

  it('BundleManager：core 变体加载 core（variants 缺省 core-only），过滤 ai', () => {
    const { bundles, notLoaded } = loadBundles(
      ['core', 'ai', 'channels'],
      { variant: 'core' }
    );
    expect(bundles.map((b) => b.name)).toEqual(['core']);
    expect(notLoaded.map((n) => n.name).sort()).toEqual(['ai', 'channels']);
    expect(notLoaded.every((n) => n.reason === 'variants-mismatch')).toBe(true);
    // config: 包装层剥离（11.12 P0）：core bundle 的 config.server.host 直接可用
    expect((bundles[0].config as { server: { host: string } }).server.host).toBe('localhost');
  });

  it('BundleManager：coding 变体加载 core/ai/channels，过滤 enterprise', () => {
    const { bundles, notLoaded } = loadBundles(
      ['core', 'ai', 'channels', 'enterprise'],
      { variant: 'coding' }
    );
    expect(bundles.map((b) => b.name).sort()).toEqual(['ai', 'channels', 'core']);
    expect(notLoaded.map((n) => n.name)).toEqual(['enterprise']);
  });

  it('BundleManager：缺失 bundle → missing（fail-fast 判定依据）', () => {
    const { notLoaded } = loadBundles(['ghost-bundle'], { variant: 'coding' });
    expect(notLoaded).toEqual([{ name: 'ghost-bundle', reason: 'missing' }]);
  });
});
