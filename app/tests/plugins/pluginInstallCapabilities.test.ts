// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P2（2026-10-25）：**安装链路**的能力授权闸（spec §6「未授权能力 ⇒ 拒绝安装」）。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PluginInstallManager,
  PluginInstallPaths,
} from '../../src/plugins/install/PluginInstallManager';
import type { PluginRegistry } from '../../src/plugins/core/PluginRegistry';
import type { NpmDistributor } from '../../src/plugins/distribution/NpmDistributor';
import { PLUGIN_CAPABILITY_GRANTS_ENV } from '../../src/plugins/utils/pluginCapabilities';

const ENV_GRANTS = PLUGIN_CAPABILITY_GRANTS_ENV;
const saved: Record<string, string | undefined> = {};
const temps: string[] = [];

beforeEach(() => {
  saved[ENV_GRANTS] = process.env[ENV_GRANTS];
  delete process.env[ENV_GRANTS];
});

afterEach(() => {
  if (saved[ENV_GRANTS] === undefined) delete process.env[ENV_GRANTS];
  else process.env[ENV_GRANTS] = saved[ENV_GRANTS];
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** 造一个「本地插件源目录」（含 plugin.json 与入口文件） */
function makeSourcePlugin(id: string, capabilities: unknown): string {
  const src = tempDir(`liri-cap-src-${id}-`);
  writeFileSync(
    join(src, 'plugin.json'),
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      description: 'probe',
      entryPoint: 'index.js',
      ...(capabilities === undefined ? {} : { capabilities }),
    }),
    'utf8'
  );
  writeFileSync(join(src, 'index.js'), 'export default {};', 'utf8');
  return src;
}

/** 安装器（local 源不用 registry / npm 分发器） */
function makeManager(installedRoot: string): PluginInstallManager {
  mkdirSync(installedRoot, { recursive: true });
  return new PluginInstallManager(
    {} as PluginRegistry,
    {} as NpmDistributor,
    new PluginInstallPaths(installedRoot)
  );
}

describe('T25-08 P2 · 安装链路能力闸', () => {
  it('声明了未授权能力 ⇒ 拒绝安装，并清掉刚落盘的目录', async () => {
    const root = tempDir('liri-cap-installed-');
    const src = makeSourcePlugin('cap-probe', ['tools', 'config']);
    const dest = join(root, 'cap-probe');
    process.env[ENV_GRANTS] = 'cap-probe:tools';

    const manager = makeManager(root);
    const result = await manager.install({
      source: 'local',
      sourcePath: src,
      installPath: dest,
      skipSecurityScan: true,
    });

    expect(result.success).toBe(false);
    expect(result.installPath).toBe('');
    expect(String(result.error)).toContain('能力校验未通过');
    expect(String(result.error)).toContain('config');
    expect(existsSync(dest)).toBe(false);
    expect(manager.isInstalled(src)).toBe(false);
  });

  it('全部能力已授权 ⇒ 安装成功', async () => {
    const root = tempDir('liri-cap-installed-');
    const src = makeSourcePlugin('cap-probe', ['tools', 'config']);
    const dest = join(root, 'cap-probe');
    process.env[ENV_GRANTS] = 'cap-probe:tools,config';

    const manager = makeManager(root);
    const result = await manager.install({
      source: 'local',
      sourcePath: src,
      installPath: dest,
      skipSecurityScan: true,
    });

    expect(result.success).toBe(true);
    expect(existsSync(join(dest, 'plugin.json'))).toBe(true);
    expect(manager.isInstalled(src)).toBe(true);
  });

  it('声明了集合外的能力 ⇒ 拒绝安装（清单非法，不猜"未知=允许"）', async () => {
    const root = tempDir('liri-cap-installed-');
    const src = makeSourcePlugin('cap-probe', ['tools', 'network']);
    const dest = join(root, 'cap-probe');
    // 即便授权表"允许"了 network，也不该放行（能力是闭合集合）
    process.env[ENV_GRANTS] = 'cap-probe:tools,network';

    const manager = makeManager(root);
    const result = await manager.install({
      source: 'local',
      sourcePath: src,
      installPath: dest,
      skipSecurityScan: true,
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('未知能力');
    expect(existsSync(dest)).toBe(false);
  });

  it('授权表未配置 ⇒ 零行为变更（旧清单照常安装）', async () => {
    const root = tempDir('liri-cap-installed-');
    const src = makeSourcePlugin('cap-probe', undefined);
    const dest = join(root, 'cap-probe');

    const manager = makeManager(root);
    const result = await manager.install({
      source: 'local',
      sourcePath: src,
      installPath: dest,
      skipSecurityScan: true,
    });

    expect(result.success).toBe(true);
    expect(existsSync(join(dest, 'plugin.json'))).toBe(true);
  });

  it('目标目录在安装前已存在 ⇒ 拒绝安装但**不删除**已有内容（只回滚自己创建的）', async () => {
    const root = tempDir('liri-cap-installed-');
    const src = makeSourcePlugin('cap-probe', ['tools', 'config']);
    const dest = join(root, 'cap-probe');
    // 用户既有目录：先放一个 marker
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'USER_DATA.txt'), 'keep me', 'utf8');
    process.env[ENV_GRANTS] = 'cap-probe:tools';

    const manager = makeManager(root);
    const result = await manager.install({
      source: 'local',
      sourcePath: src,
      installPath: dest,
      skipSecurityScan: true,
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('安装目录未删除');
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(join(dest, 'USER_DATA.txt'))).toBe(true);
  });

  it('installPath 指到受管根目录之外 ⇒ 拒绝安装但**不删除**该目录（交给调用方）', async () => {
    const root = tempDir('liri-cap-installed-');
    const outside = tempDir('liri-cap-outside-');
    const src = makeSourcePlugin('cap-probe', ['tools', 'config']);
    const dest = join(outside, 'cap-probe');
    process.env[ENV_GRANTS] = 'cap-probe:tools';

    const manager = makeManager(root);
    const result = await manager.install({
      source: 'local',
      sourcePath: src,
      installPath: dest,
      skipSecurityScan: true,
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('安装目录未删除');
    expect(existsSync(dest)).toBe(true);
  });
});
