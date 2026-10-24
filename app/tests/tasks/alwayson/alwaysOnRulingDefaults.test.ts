/**
 * AlwaysOn 两项裁定的**默认值回归锁**（2026-10-21 用户裁定「维持不启用」）
 *
 * 背景（`dev_docs/20261019/待处理问题-20261019.md` 2026-10-21 裁定）：
 * ① snapshot-copy 回退 —— 脏仓/非 git 项目继续「跳过本轮并如实报告」，**不**退回直连项目目录；
 * ② 目标达成自评 —— 报告固定 `Goal Achievement: unverified`，**不**额外调模型判定。
 * 两项均为显式「不做」决定（前置条件分别是「保留目录清理策略」与「自评误判成本评估」）。
 *
 * 事故背景：该裁定当时记为「零代码变更」，但 `FEATURE_FLAGS` 里两键仍是 `true`
 * （2026-10-20 的启用提交未回退）⇒ **文档与运行行为相反**。本用例锁住"默认关"，
 * 并保留 `FEATURE_<NAME>=true` 的显式开启口（将来满足前置条件时无需改码）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { FEATURE_FLAGS, feature } from '@openliri/kernel';

const KEYS = ['ALWAYSON_GOAL_EVAL', 'ALWAYSON_SNAPSHOT_FALLBACK'] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[`FEATURE_${key}`];
});

describe('AlwaysOn 裁定默认关（2026-10-21）', () => {
  it('两项代码默认值与运行时读值都是 false', () => {
    for (const key of KEYS) {
      expect(FEATURE_FLAGS[key]).toBe(false);
      delete process.env[`FEATURE_${key}`];
      expect(feature(key)).toBe(false);
    }
  });

  it('显式 `FEATURE_<NAME>=true` 仍可开启（灰度/逃生口未被裁掉）', () => {
    for (const key of KEYS) {
      process.env[`FEATURE_${key}`] = 'true';
      expect(feature(key)).toBe(true);
      delete process.env[`FEATURE_${key}`];
    }
  });
});
