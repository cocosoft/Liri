// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 收尾（2026-10-25）：Python 插件**旧配置迁移** —— 收敛 config 双轨。
//
// 锁三件事：
//  ① 只补「共用存储里还没有的键」⇒ 不覆盖 UI/Node 侧写入的新值；
//  ② 任一键被 schema 拒绝 ⇒ 旧文件**保留**（下次再试，不静默丢数据）；
//  ③ 成功并入 ⇒ 旧文件改名 `.migrated` 留档（不删除），且不会二次迁移。
import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PluginConfigPort } from '../../src/plugins/host/pluginConfigPort';
import { migrateLegacyPythonConfig } from '../../src/plugins/core/pythonPluginConfigMigration';

const PLUGIN_ID = 'py-probe';
const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  }
});

/** 假端口：内存 Map，`rejectKeys` 模拟 schema 校验失败 */
function fakePort(
  initial: Record<string, unknown> = {},
  rejectKeys: string[] = []
): PluginConfigPort & { store: Map<string, Record<string, unknown>> } {
  const store = new Map<string, Record<string, unknown>>([
    [PLUGIN_ID, { ...initial }],
  ]);
  return {
    store,
    read(pluginId) {
      return { ...(store.get(pluginId) ?? {}) };
    },
    write(pluginId, key, value) {
      if (rejectKeys.includes(key)) {
        return { ok: false, errors: [`${key}: invalid value`] };
      }
      const current = store.get(pluginId) ?? {};
      store.set(pluginId, { ...current, [key]: value });
      return { ok: true, errors: [] };
    },
  };
}

/** 写一个旧版 Python 配置（`<dir>/plugin-config/<id>.json`） */
function writeLegacy(dir: string, value: unknown): string {
  const legacyDir = join(dir, 'plugin-config');
  mkdirSync(legacyDir, { recursive: true });
  const path = join(legacyDir, `${PLUGIN_ID}.json`);
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
  return path;
}

describe('旧版 Python 配置 → 共用存储（一次性迁移）', () => {
  it('旧文件不存在 ⇒ absent，且不创建任何文件', () => {
    const dir = tempDir('liri-mig-absent-');
    const legacyPath = join(dir, 'plugin-config', `${PLUGIN_ID}.json`);
    const port = fakePort();

    const result = migrateLegacyPythonConfig({
      pluginId: PLUGIN_ID,
      port,
      legacyPath,
    });
    expect(result).toEqual({ status: 'absent', importedKeys: [] });
    expect(existsSync(legacyPath)).toBe(false);
  });

  it('坏 JSON / 非对象 ⇒ invalid，旧文件原样保留', () => {
    const dir = tempDir('liri-mig-bad-');
    const legacyDir = join(dir, 'plugin-config');
    mkdirSync(legacyDir, { recursive: true });
    const broken = join(legacyDir, `${PLUGIN_ID}.json`);
    writeFileSync(broken, '{not json', 'utf8');

    const r1 = migrateLegacyPythonConfig({
      pluginId: PLUGIN_ID,
      port: fakePort(),
      legacyPath: broken,
    });
    expect(r1.status).toBe('invalid');
    expect(existsSync(broken)).toBe(true);

    const arrayPath = writeLegacy(dir, ['a', 'b']);
    const r2 = migrateLegacyPythonConfig({
      pluginId: PLUGIN_ID,
      port: fakePort(),
      legacyPath: arrayPath,
    });
    expect(r2.status).toBe('invalid');
    expect(existsSync(arrayPath)).toBe(true);
  });

  it('某键被 schema 拒绝 ⇒ blocked，旧文件保留，已导入的键仍写入', () => {
    const dir = tempDir('liri-mig-blocked-');
    const legacyPath = writeLegacy(dir, { theme: 'dark', lang: 'zh' });
    const port = fakePort({}, ['lang']);

    const result = migrateLegacyPythonConfig({
      pluginId: PLUGIN_ID,
      port,
      legacyPath,
    });
    expect(result.status).toBe('blocked');
    expect(result.blockedKey).toBe('lang');
    expect(port.store.get(PLUGIN_ID)).toEqual({ theme: 'dark' });
    expect(existsSync(legacyPath)).toBe(true);
    expect(existsSync(`${legacyPath}.migrated`)).toBe(false);
  });

  it('成功并入：不覆盖已有键、旧文件改名 .migrated、二次调用不再迁移', () => {
    const dir = tempDir('liri-mig-ok-');
    const legacyPath = writeLegacy(dir, { theme: 'dark', lang: 'zh' });
    const port = fakePort({ theme: 'light' });

    const result = migrateLegacyPythonConfig({
      pluginId: PLUGIN_ID,
      port,
      legacyPath,
    });
    expect(result).toEqual({ status: 'migrated', importedKeys: ['lang'] });
    // 已有键不被旧值覆盖
    expect(port.store.get(PLUGIN_ID)).toEqual({ theme: 'light', lang: 'zh' });
    expect(existsSync(legacyPath)).toBe(false);
    expect(readFileSync(`${legacyPath}.migrated`, 'utf8')).toContain('dark');

    const again = migrateLegacyPythonConfig({
      pluginId: PLUGIN_ID,
      port,
      legacyPath,
    });
    expect(again.status).toBe('absent');
  });
});

describe('防双轨回流（源码级）', () => {
  it('PythonPluginAdapter 走共用端口，不再自带 configStore / persistConfig', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'plugins',
        'core',
        'PythonPluginAdapter.ts'
      ),
      'utf8'
    );
    expect(src).toContain('resolvePluginConfigPort');
    expect(src).toContain('migrateLegacyPythonConfig');
    // `persistConfigs`（manager 的方法名）会出现在注释里 ⇒ 只断言"自带存储"的成员引用消失
    expect(src).not.toContain('this.configStore');
    expect(src).not.toContain('this.persistConfig(');
  });
});
