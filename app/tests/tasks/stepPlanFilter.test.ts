// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-10）：demand 规划期的纯校验步骤过滤 —— 只删"无产出动作 + 校验语义"的步骤，
 * 且绝不把计划清空；删除后验收标准与依赖序号必须同步对齐。
 */

import { describe, expect, it } from 'bun:test';
import {
  dropVerificationOnlySteps,
  isVerificationOnlyStep,
} from '../../src/tasks/lro/stepPlanFilter';

describe('P1：纯校验步骤判定', () => {
  it('校验类开头 ⇒ 纯校验', () => {
    expect(isVerificationOnlyStep('校验 prd.md 七章标题完整')).toBe(true);
    expect(isVerificationOnlyStep('验证输出与需求一致')).toBe(true);
  });

  it('"读取 X 并校验 Y" 也算（题干出现校验语义且无产出动作）', () => {
    expect(isVerificationOnlyStep('读取 prd.md，校验正文与七章结构完整')).toBe(
      true
    );
  });

  it('带产出动作 ⇒ 不是纯校验（不得误删）', () => {
    expect(isVerificationOnlyStep('创建工作区根目录的 prd.md 并校验章节')).toBe(
      false
    );
    expect(isVerificationOnlyStep('实现登录接口')).toBe(false);
  });
});

describe('P1：过滤与索引对齐', () => {
  it('剔除校验步骤，验收标准与依赖随之重映射', () => {
    const result = dropVerificationOnlySteps({
      steps: ['创建 prd.md', '校验 prd.md 七章', '创建 design.md'],
      acceptance: ['prd 已写入', '七章完整', 'design 已写入'],
      // 原始：第 2 步依赖第 1 步，第 3 步依赖第 2 步（被删）⇒ 重映射后第 2 步无前置
      dependsOn: [[], [0], [1]],
    });
    expect(result.droppedIndexes).toEqual([1]);
    expect(result.steps).toEqual(['创建 prd.md', '创建 design.md']);
    expect(result.acceptance).toEqual(['prd 已写入', 'design 已写入']);
    expect(result.dependsOn).toEqual([[], []]);
  });

  it('全部都是校验步骤 ⇒ 放弃过滤（绝不产出空计划）', () => {
    const result = dropVerificationOnlySteps({
      steps: ['校验 prd.md', '检查 design.md'],
      acceptance: ['a', 'b'],
    });
    expect(result.droppedIndexes).toEqual([]);
    expect(result.steps).toEqual(['校验 prd.md', '检查 design.md']);
  });

  it('无可删步骤 ⇒ 原样返回（含未定义字段）', () => {
    const result = dropVerificationOnlySteps({ steps: ['创建 a.md'] });
    expect(result.steps).toEqual(['创建 a.md']);
    expect(result.acceptance).toBeUndefined();
    expect(result.dependsOn).toBeUndefined();
    expect(result.droppedIndexes).toEqual([]);
  });
});
