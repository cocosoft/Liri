// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P2 · 能力授权的持久化与合并（2026-10-25，市场页勾选授权）
//
// 锁五件事：
//  ① 文件不存在 / 损坏 ⇒ 空表（不抛、不覆盖用户数据）；
//  ② 写入只覆盖目标插件条目，其它插件保留；空数组 = 删除条目；
//  ③ env 与文件**取并集**（任一入口放行即放行），任一侧非空即启用门控；
//  ④ 文件授权同样参与 fail-closed：声明了但文件里没有 ⇒ 拒绝并指出缺哪项；
//  ⑤ 展示视角 `readMergedCapabilityGrants` 与门控结论 `decision.granted` 区分开。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PLUGIN_CAPABILITY_GRANTS_FILE,
  readCapabilityGrants,
  resolveCapabilityGrantsPath,
  writeCapabilityGrants,
} from '../../src/plugins/utils/pluginCapabilityGrantsStore';
import {
  PLUGIN_CAPABILITY_GRANTS_ENV,
  isCapabilityEnforcementEnabled,
  mergeCapabilityGrants,
  readMergedCapabilityGrants,
  resolvePluginCapabilities,
} from '../../src/plugins/utils/pluginCapabilities';

const ENV_GRANTS = PLUGIN_CAPABILITY_GRANTS_ENV;
const saved: Record<string, string | undefined> = {};
const temps: string[] = [];

function isolateHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-grants-'));
  temps.push(dir);
  process.env.LIRI_HOME = dir;
  return dir;
}

beforeEach(() => {
  for (const key of ['LIRI_HOME', ENV_GRANTS]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  isolateHome();
});

afterEach(() => {
  for (const key of ['LIRI_HOME', ENV_GRANTS]) {
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

describe('授权文件读写', () => {
  it('文件不存在 ⇒ 空表；路径落在 <plugins>/capability-grants.json', () => {
    const path = resolveCapabilityGrantsPath();
    expect(path.endsWith(PLUGIN_CAPABILITY_GRANTS_FILE)).toBe(true);
    expect(readCapabilityGrants(path).size).toBe(0);
  });

  it('写入保留其它插件条目；空数组 ⇒ 删除该条目', () => {
    writeCapabilityGrants('a', ['tools', 'config']);
    writeCapabilityGrants('b', ['tools']);
    let grants = readCapabilityGrants();
    expect(grants.get('a')).toEqual(new Set(['tools', 'config']));
    expect(grants.get('b')).toEqual(new Set(['tools']));

    writeCapabilityGrants('a', []);
    grants = readCapabilityGrants();
    expect(grants.has('a')).toBe(false);
    expect(grants.get('b')).toEqual(new Set(['tools']));

    // 落盘形状可读（version + grants）
    const raw = JSON.parse(
      readFileSync(resolveCapabilityGrantsPath(), 'utf-8')
    );
    expect(raw.version).toBe(1);
    expect(raw.grants).toEqual({ b: ['tools'] });
  });

  it('文件损坏 ⇒ 空表，且不覆盖原文件', () => {
    const path = resolveCapabilityGrantsPath();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{broken', 'utf-8');

    expect(readCapabilityGrants(path).size).toBe(0);
    expect(readFileSync(path, 'utf-8')).toBe('{broken');
  });
});

describe('合并与门控', () => {
  it('mergeCapabilityGrants 取并集（同 id 能力合并）', () => {
    const merged = mergeCapabilityGrants(
      new Map([['a', new Set(['tools'])]]),
      new Map([
        ['a', new Set(['config'])],
        ['b', new Set(['tools'])],
      ])
    );
    expect(merged.get('a')).toEqual(new Set(['tools', 'config']));
    expect(merged.get('b')).toEqual(new Set(['tools']));
  });

  it('仅文件有授权 ⇒ 也算启用门控（未授权的声明被拒）', () => {
    writeCapabilityGrants('p', ['tools']);
    expect(isCapabilityEnforcementEnabled()).toBe(true);

    const allowed = resolvePluginCapabilities('p', ['tools']);
    expect(allowed.allowed).toBe(true);

    const denied = resolvePluginCapabilities('p', ['tools', 'config']);
    expect(denied.allowed).toBe(false);
    expect(denied.missing).toEqual(['config']);
    expect(denied.enforced).toBe(true);
  });

  it('env 与文件并集：env 放行的能力不会再被判缺失', () => {
    writeCapabilityGrants('p', ['tools']);
    process.env[ENV_GRANTS] = 'p:config';

    const decision = resolvePluginCapabilities('p', ['tools', 'config']);
    expect(decision.allowed).toBe(true);
    expect(decision.granted).toEqual(['tools', 'config']);
  });

  it('展示视角：清单因未实现能力被整体拒绝时，仍能看到已勾选项', () => {
    writeCapabilityGrants('p', ['tools']);
    const decision = resolvePluginCapabilities('p', ['tools', 'events']);
    expect(decision.allowed).toBe(false);
    expect(decision.granted).toEqual([]); // 门控结论
    expect(readMergedCapabilityGrants('p').has('tools')).toBe(true); // 展示视角
  });
});
