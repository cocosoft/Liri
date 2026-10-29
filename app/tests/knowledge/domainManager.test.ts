// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `DomainManager` 单测（S2，2026-10-29，issue #10）
 *
 * 背景：`DomainManager` 是 Phase A 的基础设施，但此前 **0 覆盖**（`app/tests` 内 0 引用）。
 * 本文件只补测试、**不改生产代码**，锁住 5 个方法的现有行为：
 *   `getDomainsRoot` / `ensureRoot` / `list` / `create` / `getConfig`
 *
 * 隔离方式：`DomainManager` 内部经由 `resolveDomainDir()` → `resolvePyappHome(process.env)`
 * 解析路径（`app/src/environment/paths.ts:111` 优先 `LIRI_HOME`），所以把 `LIRI_HOME`
 * 指向 `mkdtemp` 出来的临时目录即可全量隔离，不碰真实 `~/.pyapp`。
 * `beforeEach` 里带**安全护栏**：若环境覆盖未生效（例如 `userDataDirOverride` 被设置），
 * 直接抛错，绝不在真实目录上跑。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveDomainsRoot } from '../../src/environment/paths';
import { DomainManager } from '../../src/knowledge/domain';

const HOME_KEY = 'LIRI_HOME';

let originalHome: string | undefined;
let tmpHome = '';
let domainsRoot = '';
let manager: DomainManager;

beforeEach(() => {
  originalHome = process.env[HOME_KEY];
  tmpHome = mkdtempSync(join(tmpdir(), 'liri-domain-'));
  process.env[HOME_KEY] = tmpHome;
  domainsRoot = resolveDomainsRoot();

  // 安全护栏：覆盖没生效就不跑（否则会写真实 ~/.pyapp/knowledge/domains）
  if (!domainsRoot.startsWith(tmpHome)) {
    throw new Error(
      `LIRI_HOME 覆盖未生效，拒绝在真实目录上运行：${domainsRoot}`
    );
  }

  manager = new DomainManager();
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env[HOME_KEY];
  } else {
    process.env[HOME_KEY] = originalHome;
  }
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

describe('DomainManager（S2 单测）', () => {
  test('getDomainsRoot：返回 <LIRI_HOME>/knowledge/domains', () => {
    expect(manager.getDomainsRoot()).toBe(
      join(tmpHome, 'knowledge', 'domains')
    );
  });

  test('ensureRoot：目录不存在则创建，重复调用幂等', async () => {
    expect(existsSync(domainsRoot)).toBe(false);

    await manager.ensureRoot();
    expect(existsSync(domainsRoot)).toBe(true);

    await manager.ensureRoot(); // 已存在不应抛错
    expect(existsSync(domainsRoot)).toBe(true);
  });

  test('list：根目录为空时返回空数组（并顺带建出根目录）', async () => {
    const list = await manager.list();

    expect(list).toEqual([]);
    expect(existsSync(domainsRoot)).toBe(true);
  });

  test('create：生成 wiki/ 与 .schema/ 目录并写 .domain.yaml，返回完整配置', async () => {
    const config = await manager.create('botany', {
      label: '植物学',
      description: '植物分类与光合作用',
      queryHints: { keywords: ['植物', '光合作用'] },
      allowedCrossDomainRefs: ['default'],
    });

    const domainDir = join(domainsRoot, 'botany');
    expect(existsSync(join(domainDir, 'wiki'))).toBe(true);
    expect(existsSync(join(domainDir, '.schema'))).toBe(true);
    expect(existsSync(join(domainDir, '.domain.yaml'))).toBe(true);

    expect(config.name).toBe('botany');
    expect(config.label).toBe('植物学');
    expect(config.description).toBe('植物分类与光合作用');
    expect(config.queryHints.keywords).toEqual(['植物', '光合作用']);
    expect(config.allowedCrossDomainRefs).toEqual(['default']);
    expect(config.createdAt).toBeGreaterThan(0);
  });

  test('create：未给 overrides 时 label 回退为域名、其余走默认值', async () => {
    const config = await manager.create('bare');

    expect(config.label).toBe('bare');
    expect(config.description).toBe('');
    expect(config.queryHints).toEqual({ keywords: [] });
    expect(config.allowedCrossDomainRefs).toEqual([]);
  });

  test('create：同名域已存在 ⇒ 抛错（不静默覆盖）', async () => {
    await manager.create('botany');

    await expect(manager.create('botany')).rejects.toThrow(/已存在/);
  });

  test('list：只返回含 .domain.yaml 的域；跳过 . 前缀目录与配置缺失目录', async () => {
    await manager.create('botany', { label: '植物学' });
    await manager.create('dist', { label: '分布式' });

    // 无 .domain.yaml 的普通目录 ⇒ 不计入
    mkdirSync(join(domainsRoot, 'no-config'), { recursive: true });
    // 隐藏目录 ⇒ 不计入
    mkdirSync(join(domainsRoot, '.hidden'), { recursive: true });
    // 给 botany 塞 2 个 wiki 页面用于计数
    writeFileSync(join(domainsRoot, 'botany', 'wiki', 'a.md'), '# a');
    writeFileSync(join(domainsRoot, 'botany', 'wiki', 'b.md'), '# b');

    const list = await manager.list();
    const names = list.map((d) => d.name).sort();

    expect(names).toEqual(['botany', 'dist']);
    expect(list.find((d) => d.name === 'botany')?.wikiPageCount).toBe(2);
    expect(list.find((d) => d.name === 'dist')?.wikiPageCount).toBe(0);
    expect(list.find((d) => d.name === 'botany')?.label).toBe('植物学');
  });

  test('getConfig：存在 ⇒ 解析字段；不存在且非 default ⇒ null', async () => {
    await manager.create('botany', {
      label: '植物学',
      queryHints: { keywords: ['植物'], languages: ['zh'] },
    });

    const config = await manager.getConfig('botany');
    expect(config?.name).toBe('botany');
    expect(config?.label).toBe('植物学');
    expect(config?.queryHints.keywords).toEqual(['植物']);
    expect(config?.queryHints.languages).toEqual(['zh']);

    expect(await manager.getConfig('missing')).toBeNull();
  });

  test('getConfig：default 域缺配置 ⇒ 返回内置默认配置（不是 null）', async () => {
    const config = await manager.getConfig('default');

    expect(config).not.toBeNull();
    expect(config?.name).toBe('default');
    expect(config?.label).toBe('默认域');
  });

  test('getConfig：.domain.yaml 字段缺失 ⇒ 不崩，按空值/零值兜底', async () => {
    const domainDir = join(domainsRoot, 'sparse');
    mkdirSync(domainDir, { recursive: true });
    writeFileSync(join(domainDir, '.domain.yaml'), 'name: sparse\n');

    const config = await manager.getConfig('sparse');

    expect(config?.name).toBe('sparse');
    expect(config?.label).toBe('');
    expect(config?.description).toBe('');
    expect(config?.queryHints.keywords).toEqual([]);
    expect(config?.queryHints.languages).toBeUndefined();
    expect(config?.allowedCrossDomainRefs).toEqual([]);
    expect(config?.createdAt).toBe(0);
  });
});
