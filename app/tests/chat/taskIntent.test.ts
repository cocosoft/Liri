// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * hasResearchIntent 判定单测（P0-3，2026-09-06，Teamwork P1 批次）
 * 验证研究型意图词表命中/不命中边界：多方案权衡/系统性研究类命中；
 * 普通问答/单方案执行类不命中（避免研究模式成本翻倍误伤日常问答）。
 */
import { describe, expect, it } from 'bun:test';
import { hasResearchIntent } from '../../src/chat/taskIntent';

describe('hasResearchIntent — 研究型意图判定（P0-3 触发信号）', () => {
  it('多方案/权衡/选型/可行性类任务命中', () => {
    expect(hasResearchIntent('帮我研究两种方案怎么选，给出选型建议')).toBe(true);
    expect(
      hasResearchIntent('做一份竞品分析报告，评估三家产品的方案对比')
    ).toBe(true);
    expect(
      hasResearchIntent('对比评估 A/B 两条技术路线的可行性并权衡取舍')
    ).toBe(true);
    expect(hasResearchIntent('系统性地评估三种数据库的选型')).toBe(true);
  });

  it('普通问答/单方案执行类不命中（防误伤）', () => {
    expect(hasResearchIntent('什么是依赖注入？')).toBe(false);
    expect(hasResearchIntent('帮我实现一个分页组件')).toBe(false);
    expect(hasResearchIntent('帮我修复这个报错')).toBe(false);
    expect(hasResearchIntent('解释一下这段代码')).toBe(false);
    expect(hasResearchIntent('')).toBe(false);
  });
});
