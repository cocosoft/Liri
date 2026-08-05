/**
 * M0 配置迁移 v3 + env 注入收敛单测
 *
 * 覆盖（对应方案 §六b 验收）：
 * - M0 兼容迁移：历史 flat key（permission.workspaces / permission.rules）
 *   迁移后合并进 permission 整块且不丢失数据
 * - M0 env 注入：面板仅配 customRules（无信任工作区）时，env 注入
 *   仅合并 trustedWorkspaces，customRules 保留
 */

import { describe, expect, it, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigMigration } from '../ConfigMigration';
import { injectTrustedWorkspaceFromEnv } from '../envInject';
import { ConfigManager } from '../ConfigManager';

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

describe('ConfigMigration v3（flat key → permission 整块）', () => {
  it('合并 permission.workspaces / permission.rules 且不丢失数据', () => {
    const raw = {
      migrationVersion: 2,
      'permission.workspaces': {
        mode: 'strict',
        trustedWorkspaces: [
          { path: '/ws/a', trustLevel: 'work', enabled: true },
        ],
      },
      'permission.rules': {
        customRules: {
          commandRules: {
            mode: 'blacklist',
            blacklist: [{ pattern: 'rm -rf' }],
          },
        },
      },
    };

    const migrated = ConfigMigration.migrate(raw) as Record<string, unknown>;
    const permission = migrated['permission'] as Record<string, unknown>;

    // flat key 已清除
    expect(migrated['permission.workspaces']).toBeUndefined();
    expect(migrated['permission.rules']).toBeUndefined();
    // 数据合并且保留
    expect(permission['mode']).toBe('strict');
    expect(permission['trustedWorkspaces']).toEqual([
      { path: '/ws/a', trustLevel: 'work', enabled: true },
    ]);
    expect(
      (permission['customRules'] as { commandRules: { blacklist: unknown[] } })
        .commandRules.blacklist
    ).toEqual([{ pattern: 'rm -rf' }]);
    // 迁移版本已更新
    expect(migrated['migrationVersion']).toBe(3);
  });

  it('无 flat key 时迁移不改写 permission', () => {
    const raw = {
      migrationVersion: 2,
      permission: { mode: 'default', customRules: {} },
    };
    const migrated = ConfigMigration.migrate(raw) as Record<string, unknown>;
    expect(migrated['permission']).toEqual({
      mode: 'default',
      customRules: {},
    });
  });

  it('needsMigration 仅对低版本返回 true', () => {
    expect(ConfigMigration.needsMigration({ migrationVersion: 2 })).toBe(true);
    expect(ConfigMigration.needsMigration({ migrationVersion: 3 })).toBe(false);
    expect(ConfigMigration.needsMigration({})).toBe(true);
  });
});

describe('injectTrustedWorkspaceFromEnv（仅合并 trustedWorkspaces）', () => {
  it('customRules 保留，trustedWorkspaces 注入', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cfg-test-'));
    tmpDirs.push(tmpDir);
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        migrationVersion: 3,
        permission: {
          mode: 'default',
          customRules: { commandRules: { mode: 'blacklist', blacklist: [] } },
        },
      })
    );

    const cm = new ConfigManager(configPath);
    cm.enableConfigs();

    const prev = process.env.LIRI_TRUSTED_WORKSPACE;
    process.env.LIRI_TRUSTED_WORKSPACE = 'C:\\ws|work';
    try {
      injectTrustedWorkspaceFromEnv(cm);
      const permission =
        cm.getConfigValue<Record<string, unknown>>('permission')!;
      // customRules 未被覆盖
      expect(permission['customRules']).toBeDefined();
      // trustedWorkspaces 已注入
      expect(permission['trustedWorkspaces']).toEqual([
        { path: 'C:\\ws', trustLevel: 'work', enabled: true },
      ]);
    } finally {
      if (prev === undefined) delete process.env.LIRI_TRUSTED_WORKSPACE;
      else process.env.LIRI_TRUSTED_WORKSPACE = prev;
    }
  });

  it('已有 trustedWorkspaces 时不重复注入', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cfg-test-'));
    tmpDirs.push(tmpDir);
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        migrationVersion: 3,
        permission: {
          mode: 'default',
          trustedWorkspaces: [
            { path: '/existing', trustLevel: 'chat', enabled: true },
          ],
        },
      })
    );

    const cm = new ConfigManager(configPath);
    cm.enableConfigs();

    const prev = process.env.LIRI_TRUSTED_WORKSPACE;
    process.env.LIRI_TRUSTED_WORKSPACE = 'C:\\new';
    try {
      injectTrustedWorkspaceFromEnv(cm);
      const permission =
        cm.getConfigValue<Record<string, unknown>>('permission')!;
      const ws = permission['trustedWorkspaces'] as Array<{
        path: string;
      }>;
      expect(ws).toHaveLength(1);
      expect(ws[0].path).toBe('/existing');
    } finally {
      if (prev === undefined) delete process.env.LIRI_TRUSTED_WORKSPACE;
      else process.env.LIRI_TRUSTED_WORKSPACE = prev;
    }
  });
});

describe('ConfigManager 点号路径读写一致（M0 语义统一，§六b）', () => {
  it('setValue 点号写入 → getConfigValue 点号回退读取一致', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cfg-test-'));
    tmpDirs.push(tmpDir);
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ migrationVersion: 3 }));

    const cm = new ConfigManager(configPath);
    cm.enableConfigs();

    cm.setValue('permission.trustedWorkspaces', [
      { path: '/ws', trustLevel: 'work', enabled: true },
    ]);
    // 整块读取（getConfigValue 顶层）
    const permission =
      cm.getConfigValue<Record<string, unknown>>('permission')!;
    expect(permission['trustedWorkspaces']).toEqual([
      { path: '/ws', trustLevel: 'work', enabled: true },
    ]);
    // 点号路径直接回退读取
    expect(cm.getConfigValue('permission.trustedWorkspaces')).toEqual([
      { path: '/ws', trustLevel: 'work', enabled: true },
    ]);
  });

  it('setConfigValue flat 写入 → getConfigValue flat 读取对称', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cfg-test-'));
    tmpDirs.push(tmpDir);
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ migrationVersion: 3 }));

    const cm = new ConfigManager(configPath);
    cm.enableConfigs();

    cm.setConfigValue('permission', {
      mode: 'strict',
      customRules: { directoryRules: { blacklist: [] } },
    });
    expect(cm.getConfigValue('permission')).toEqual({
      mode: 'strict',
      customRules: { directoryRules: { blacklist: [] } },
    });
    // 点号路径也能读取嵌套字段
    expect(cm.getConfigValue<{ mode: string }>('permission')!.mode).toBe(
      'strict'
    );
  });

  it('历史 flat key 写入（不推荐）点号回退仍可读，迁移后清除', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'cfg-test-'));
    tmpDirs.push(tmpDir);
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        migrationVersion: 2,
        'permission.workspaces': {
          mode: 'default',
          trustedWorkspaces: [],
        },
      })
    );

    const cm = new ConfigManager(configPath);
    cm.enableConfigs();

    // 迁移后 flat key 已合并进 permission 整块
    expect(cm.getConfigValue('permission.workspaces')).toBeUndefined();
    const permission =
      cm.getConfigValue<Record<string, unknown>>('permission')!;
    expect(permission['mode']).toBe('default');
    expect(permission['trustedWorkspaces']).toEqual([]);
  });
});
