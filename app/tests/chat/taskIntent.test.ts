// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * hasResearchIntent 判定单测（P0-3，2026-09-06，Teamwork P1 批次）
 * 验证研究型意图词表命中/不命中边界：多方案权衡/系统性研究类命中；
 * 普通问答/单方案执行类不命中（避免研究模式成本翻倍误伤日常问答）。
 *
 * 2026-10-07（`.trae/specs/pattern-wiring-closure.md` §4「P1」）：新增 `hasVerifyIntent`
 * （`self_verify` 模式的触发信号）同文件覆盖 —— 命中/不命中边界与"防误伤"口径同上。
 */
import { describe, expect, it } from 'bun:test';
import { hasResearchIntent, hasVerifyIntent } from '../../src/chat/taskIntent';

describe('hasResearchIntent — 研究型意图判定（P0-3 触发信号）', () => {
  it('多方案/权衡/选型/可行性类任务命中', () => {
    expect(hasResearchIntent('帮我研究两种方案怎么选，给出选型建议')).toBe(
      true
    );
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

describe('hasVerifyIntent — 自校验意图判定（P1 触发信号，2026-10-07）', () => {
  it('要求内置校验/质量把关类命中', () => {
    expect(hasVerifyIntent('产出后请做质量把关')).toBe(true);
    expect(hasVerifyIntent('请逐项核对，确保无误后再交付')).toBe(true);
    expect(hasVerifyIntent('执行完先自检一次')).toBe(true);
    expect(hasVerifyIntent('结果校验通过才输出')).toBe(true);
  });

  it('普通问答/普通执行类不命中（防误伤）', () => {
    expect(hasVerifyIntent('什么是依赖注入？')).toBe(false);
    expect(hasVerifyIntent('帮我实现一个分页组件')).toBe(false);
    expect(hasVerifyIntent('帮我修复这个报错')).toBe(false);
    expect(hasVerifyIntent('')).toBe(false);
  });

  it('与 hasResearchIntent 不互相误伤（两个信号独立）', () => {
    // 研究型表述不含自校验词 ⇒ verify 信号为假（避免两条规则互抢）
    expect(hasVerifyIntent('帮我研究两种方案怎么选，给出选型建议')).toBe(false);
    // 自校验表述不含研究词 ⇒ research 信号为假
    expect(hasResearchIntent('产出后请做质量把关')).toBe(false);
  });
});
