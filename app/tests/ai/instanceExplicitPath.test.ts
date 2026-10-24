// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 门禁：显式 `dbPath` 的实例必须**按路径分桶**，不得被默认单例吞掉。
 *
 * 背景（2026-10-24，CI ubuntu 红暴露）：`ProviderManager` / `BalanceStore` / `TaskStore` /
 * `ModelPricingService` 原实现都是「`!isLocalPrincipal && dbPath === undefined` 才走租户实例，
 * 随后 `if (!instance) new(dbPath)`」
 * ⇒ 显式路径只在**首次**创建时被采纳；一旦默认单例（或租户实例）已存在，
 * `getInstance(':memory:')` 会静默返回**指向真实 `app.db`** 的实例。
 * 后果：测试读到上一份残留行（实测断言误红），更危险的是**测试写入真实库**。
 *
 * 本门禁以源码结构锁死三件事：
 *   ① 显式路径分支存在，且在「默认单例创建」**之前**返回；
 *   ② 该分支写入独立的 `explicitInstances` 分桶（不是 `instance`）；
 *   ③ 旧写法 `&& dbPath === undefined` 不得回流（它正是缺陷本体）。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const TARGETS = [
  { name: 'ProviderManager', path: 'src/ai/providers/ProviderManager.ts' },
  { name: 'BalanceStore', path: 'src/ai/providers/BalanceStore.ts' },
  { name: 'TaskStore', path: 'src/workspace/TaskStore.ts' },
  { name: 'ModelPricingService', path: 'src/ai/models/ModelPricingService.ts' },
] as const;

describe('显式 dbPath 分桶（四处同构单例）', () => {
  for (const target of TARGETS) {
    it(`${target.name}：显式路径分支先于默认单例返回，并写入 explicitInstances`, () => {
      const src = readFileSync(
        new URL(`../../${target.path}`, import.meta.url),
        'utf8'
      );

      const explicitAt = src.indexOf('if (dbPath !== undefined) {');
      const defaultAt = src.indexOf(`if (!${target.name}.instance) {`);

      expect(explicitAt).toBeGreaterThan(-1);
      expect(defaultAt).toBeGreaterThan(explicitAt);
      expect(src).toContain(
        `${target.name}.explicitInstances.set(dbPath, created)`
      );
      // 旧写法回流即失败（它让显式路径在默认单例已存在时失效）
      expect(src).not.toContain('&& dbPath === undefined');
    });
  }
});
