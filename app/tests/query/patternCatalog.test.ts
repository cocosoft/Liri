// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * PC-6（2026-10-07）：编排模式**只读目录**守卫（`listPatternCatalog`）
 *
 * 锁四件事：
 *   ① 覆盖注册表**全部** pattern（数量与声明序一致，不多不少）；
 *   ② 每条都带展示所需字段（显示名 / 适用场景 / 角色 / 绑定 / assembler）；
 *   ③ **装配状态自洽**：`ready` ⇒ 有 `route` 且无 `reason`；`unavailable` ⇒ 有非空 `reason`；
 *   ④ 冻结**当前实况**（哪些已接线、哪些未接线）—— 接线状态变化必须显式改本用例。
 */
import { describe, it, expect } from 'bun:test';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  listPatternCatalog,
  patternCatalogSnapshotPath,
  writePatternCatalogSnapshot,
} from '../../src/query/patternAssembler.js';
import { listPatterns } from '../../src/core/patterns/index.js';

describe('listPatternCatalog（PC-6 编排模式目录）', () => {
  it('① 覆盖注册表全部 pattern，且顺序 = 声明序', () => {
    const catalog = listPatternCatalog();
    expect(catalog.map((c) => c.name)).toEqual(
      listPatterns().map((p) => p.name)
    );
  });

  it('② 展示字段齐备（显示名 / 适用场景 / 角色 / 绑定 / assembler）', () => {
    for (const c of listPatternCatalog()) {
      expect(c.displayName.length).toBeGreaterThan(0);
      expect(c.when.length).toBeGreaterThan(0);
      expect(c.roles.length).toBeGreaterThan(0);
      expect(c.bindings.length).toBeGreaterThan(0);
      expect(c.assembler.length).toBeGreaterThan(0);
      // 绑定角色与 roles 一一对应（注册表不变量在目录层同样成立）
      expect(c.bindings.map((b) => b.role).sort()).toEqual([...c.roles].sort());
      for (const b of c.bindings) expect(b.providers.length).toBeGreaterThan(0);
    }
  });

  it('③ 装配状态自洽：ready ⇒ route 无 reason；unavailable ⇒ 非空 reason', () => {
    for (const c of listPatternCatalog()) {
      if (c.status === 'ready') {
        expect(typeof c.route).toBe('string');
        expect(c.reason).toBeUndefined();
      } else {
        expect(c.route).toBeUndefined();
        expect((c.reason ?? '').length).toBeGreaterThan(0);
      }
    }
  });

  it('④ 冻结当前实况（接线状态变化须显式改本用例）', () => {
    const byName = Object.fromEntries(
      listPatternCatalog().map((c) => [c.name, c])
    );
    // 已接线（有可执行路由）
    expect(byName.competitive_strategy.status).toBe('ready');
    expect(byName.competitive_strategy.route).toBe('research');
    expect(byName.self_verify.status).toBe('ready');
    expect(byName.self_verify.route).toBe('verify');
    // 未接线（如实登记，含原因）
    expect(byName.long_task_pdl.status).toBe('unavailable');
    expect(byName.iterative_refine.status).toBe('unavailable');
    expect(byName.parallel_distributed.status).toBe('unavailable');
  });

  it('目录是副本：改动返回值不影响注册表', () => {
    const catalog = listPatternCatalog();
    catalog[0].roles.push('__mutated__');
    catalog[0].bindings[0].providers.push('__mutated__');
    expect(listPatternCatalog()[0].roles).not.toContain('__mutated__');
    expect(listPatternCatalog()[0].bindings[0].providers).not.toContain(
      '__mutated__'
    );
  });
});

/**
 * 可达性维度（2026-10-07，`.trae/specs/pattern-catalog-reachability-and-persistence.md`）
 *
 * 修复背景：原目录只有二元 `status` ⇒ `self_verify`（装配 `ready` 但选择层**永不产出**）
 * 被展示为「已接线」（谎报可用）。本组锁「触发可达性」与「装配状态」**正交**且如实。
 */
describe('listPatternCatalog 可达性（2026-10-07 收口）', () => {
  it('⑤ 可达性自洽：可达 ⇒ 无原因；不可达 ⇒ 非空原因', () => {
    for (const c of listPatternCatalog()) {
      if (c.reachable) {
        expect(c.unreachableReason).toBeUndefined();
      } else {
        expect((c.unreachableReason ?? '').length).toBeGreaterThan(0);
      }
    }
  });

  it('⑥ 冻结可达性实况 + 门控（触发面/开关变化须显式改本用例）', () => {
    const byName = Object.fromEntries(
      listPatternCatalog().map((c) => [c.name, c])
    );
    // 唯一有触发面的模式（complex + research），且声明了功能门控
    expect(byName.competitive_strategy.reachable).toBe(true);
    expect(byName.competitive_strategy.featureGate?.flag).toBe(
      'COMPETITIVE_STRATEGY'
    );
    expect(typeof byName.competitive_strategy.featureGate?.enabled).toBe(
      'boolean'
    );
    // `self_verify`：装配 `ready` 但**不可达** —— 正是修复前被谎报的那一条
    expect(byName.self_verify.status).toBe('ready');
    expect(byName.self_verify.reachable).toBe(false);
    // 其余三条同样无触发面（`long_task_pdl` 的运行时由快速路径独立驱动）
    for (const n of [
      'long_task_pdl',
      'iterative_refine',
      'parallel_distributed',
    ]) {
      expect(byName[n].reachable).toBe(false);
    }
    // 门控只出现在声明了门控的模式上
    for (const c of listPatternCatalog()) {
      if (c.name !== 'competitive_strategy') {
        expect(c.featureGate).toBeUndefined();
      }
    }
  });

  it('⑦ 静态快照落盘（可注入目录）：文件可读、内容 = 目录 + generatedAt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pattern-catalog-'));
    try {
      expect(patternCatalogSnapshotPath(dir)).toBe(
        join(dir, 'pattern_catalog.json')
      );
      const res = await writePatternCatalogSnapshot(dir);
      expect(res.path).toBe(join(dir, 'pattern_catalog.json'));
      expect(res.entryCount).toBe(listPatternCatalog().length);
      const parsed = JSON.parse(await readFile(res.path, 'utf8')) as {
        generatedAt: string;
        entries: unknown[];
      };
      expect(typeof parsed.generatedAt).toBe('string');
      expect(parsed.entries).toHaveLength(res.entryCount);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
