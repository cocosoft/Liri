// MIT License
// Copyright (c) 2026 190615273@qq.com
// ConfigLayers 11 层合并单测（验收标准 7：优先级矩阵子集 + policy 保护 + locked）

import { describe, expect, it } from 'bun:test';
import { resolveConfigLayers, collectLeafPaths } from '../../src/config/layers/ConfigLayers';
import type { LayerProfile } from '../../src/config/layers/ProfileManager';
import type { LayerBundle } from '../../src/config/layers/BundleManager';

/** 断言辅助：resolveConfigLayers 返回 config: Record<string, unknown>，按测试预期形状精化类型 */
function cfg(config: Record<string, unknown>) {
  return config as {
    logging: { level: string };
    server: { port: number };
    ai: { defaultModel?: string; providerId?: string };
  };
}

const profile: LayerProfile = {
  name: 'production',
  bundles: ['core', 'ai'],
  patches: { logging: { level: 'warn' } },
  source: 'builtin',
  protected: true,
};

const bundles: LayerBundle[] = [
  { name: 'core', config: { server: { host: '0.0.0.0' }, ai: { defaultModel: 'a' } }, variants: ['core'], source: 'builtin' },
  { name: 'ai', config: { ai: { defaultModel: 'b', providerId: 'p1' } }, variants: ['coding', 'enterprise'], source: 'builtin' },
];

const baseInput = {
  profile,
  bundles,
  defaultConfig: { logging: { level: 'debug' }, server: { port: 8080 } },
};

describe('ConfigLayers 11 层合并', () => {
  it('层序：CLI patch > 用户设置 > Profile patch > Bundle > 默认值', () => {
    const result = resolveConfigLayers({
      ...baseInput,
      userSettings: { logging: { level: 'info' } },
      cliPatch: { logging: { level: 'error' } },
    });
    expect(cfg(result.config).logging.level).toBe('error'); // CLI patch 最高
    expect(cfg(result.config).server.port).toBe(8080); // 默认值保留
    // 层序检查
    const names = result.layers.map((l) => l.name);
    expect(names).toEqual(['default', 'bundle', 'profile-patch', 'user', 'cli-patch']);
  });

  it('Bundle 后声明胜（ai 覆盖 core 的 ai.defaultModel）', () => {
    const result = resolveConfigLayers(baseInput);
    expect(cfg(result.config).ai.defaultModel).toBe('b'); // ai bundle 后声明
    expect(cfg(result.config).ai.providerId).toBe('p1');
  });

  it('policy 保护：policy 声明 key 不被 Home/env/CLI 覆盖', () => {
    const result = resolveConfigLayers({
      ...baseInput,
      policySettings: { logging: { level: 'warn' } },
      homePatch: { logging: { level: 'debug' } },
      envLayer: { logging: { level: 'info' } },
      cliPatch: { logging: { level: 'error' } },
    });
    expect(cfg(result.config).logging.level).toBe('warn'); // policy 锁定
  });

  it('policy 保护：未声明 key 仍可被 CLI patch 覆盖', () => {
    const result = resolveConfigLayers({
      ...baseInput,
      policySettings: { logging: { level: 'warn' } },
      cliPatch: { server: { port: 9999 } },
    });
    expect(cfg(result.config).logging.level).toBe('warn'); // policy 锁定
    expect(cfg(result.config).server.port).toBe(9999); // 非 policy key 可覆盖
  });

  it('locked 模式：忽略 用户/项目/本地/Home/env/CLI patch', () => {
    const result = resolveConfigLayers({
      ...baseInput,
      locked: true,
      userSettings: { logging: { level: 'info' } },
      homePatch: { logging: { level: 'debug' } },
      envLayer: { logging: { level: 'info' } },
      cliPatch: { logging: { level: 'error' } },
    });
    expect(cfg(result.config).logging.level).toBe('warn'); // Profile patch 值，未被覆盖
    const names = result.layers.map((l) => l.name);
    expect(names).not.toContain('user');
    expect(names).not.toContain('home-patch');
    expect(names).not.toContain('env');
    expect(names).not.toContain('cli-patch');
  });

  it('墓碑删除：CLI patch 删除低层 bundle 值', () => {
    const result = resolveConfigLayers({
      ...baseInput,
      cliPatch: { ai: { defaultModel: null } },
    });
    expect(cfg(result.config).ai.defaultModel).toBeUndefined(); // 物理移除
    expect(cfg(result.config).ai.providerId).toBe('p1'); // 兄弟 key 保留
    expect(result.deletedKeys).toContain('cli-patch:ai.defaultModel');
  });

  it('variants 未加载 bundle 记录在 notLoadedBundles', () => {
    const result = resolveConfigLayers({
      ...baseInput,
      notLoadedBundles: [{ name: 'channels', reason: 'variants-mismatch' }],
    });
    expect(result.notLoadedBundles).toEqual([
      { name: 'channels', reason: 'variants-mismatch' },
    ]);
  });

  it('collectLeafPaths 收集嵌套叶子路径', () => {
    const paths = collectLeafPaths({ a: { b: 1 }, c: 2 });
    expect([...paths]).toEqual(['a.b', 'c']);
  });
});
