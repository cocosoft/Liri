/**
 * 内核瘦身 P1b（方案 A）—— 模块分级守卫
 *
 * 钉三件事：
 *  ① 17 个"纯记账"模块确实为 `ON_DEMAND`，且**不在**批次名单里；
 *  ② `cli` **仍然**是 BATCH —— 它是 CRITICAL 模块 `commands` 的必需依赖，
 *     `ModuleRegistry.initialize()` 会递归初始化它 ⇒ 标成 ON_DEMAND 也无效果（有意的例外）；
 *  ③ **真正的回归保护**：名单内每个模块在 `MODULE_DEFINITIONS` 里**必须没有 `initialize()`**
 *     —— 谁给它加了初始化动作，本测试即红：说明它不再是"纯记账"，必须重新分级（并更新 P1a 报告）。
 */
import { describe, expect, it } from 'bun:test';

import {
  DynamicLoadMode,
  getDeferredModuleIds,
  getModuleLoadMode,
  getOnDemandModuleIds,
  PURE_ACCOUNTING_ON_DEMAND_MODULES,
} from '@modules/core/LazyModuleStrategy';
import {
  MODULE_DEFINITIONS,
  MODULE_INITIALIZATION_ORDER,
} from '../../src/modules/ModuleDefinitions';

describe('P1b 方案 A：纯记账模块降级为 ON_DEMAND', () => {
  it('名单内 17 个模块的生效加载模式都是 ON_DEMAND', () => {
    expect(PURE_ACCOUNTING_ON_DEMAND_MODULES.length).toBe(17);
    for (const id of PURE_ACCOUNTING_ON_DEMAND_MODULES) {
      expect({ id, mode: getModuleLoadMode(id) }).toEqual({
        id,
        mode: DynamicLoadMode.ON_DEMAND,
      });
    }
  });

  it('名单内模块不再出现在批次（BATCH）名单里', () => {
    const batch = new Set(
      getDeferredModuleIds([...MODULE_INITIALIZATION_ORDER])
    );
    for (const id of PURE_ACCOUNTING_ON_DEMAND_MODULES) {
      expect({ id, inBatch: batch.has(id) }).toEqual({ id, inBatch: false });
    }
  });

  it('cli 仍为 BATCH（commands 的必需依赖，降级无效果）', () => {
    expect(getModuleLoadMode('cli')).toBe(DynamicLoadMode.BATCH);
    expect(getDeferredModuleIds([...MODULE_INITIALIZATION_ORDER])).toContain(
      'cli'
    );
    expect(
      getOnDemandModuleIds([...MODULE_INITIALIZATION_ORDER])
    ).not.toContain('cli');
  });

  it('回归保护：名单内模块**没有** initialize()（否则必须重新分级）', () => {
    const withInitialize = PURE_ACCOUNTING_ON_DEMAND_MODULES.filter(
      (id) => MODULE_DEFINITIONS[id]?.initialize !== undefined
    );
    expect(withInitialize).toEqual([]);
  });
});
