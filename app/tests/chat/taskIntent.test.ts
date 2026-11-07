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
import {
  hasRefineIntent,
  hasResearchIntent,
  hasVerifyIntent,
  isCapabilityDirectIntent,
} from '../../src/chat/taskIntent';

// 2026-11-07（真机）：单次能力请求否决编排 —— 识图 / 读文件 / 查版本不该走 PDCA
describe('isCapabilityDirectIntent — 单次能力直通判定（2026-11-07）', () => {
  it('单次识图 / 读文件 / 查版本类命中', () => {
    expect(isCapabilityDirectIntent('识别这张图里有什么')).toBe(true);
    expect(isCapabilityDirectIntent('帮我看看这张图')).toBe(true);
    expect(isCapabilityDirectIntent('帮我看下这个图片是什么')).toBe(true);
    expect(isCapabilityDirectIntent('读一下这个文件')).toBe(true);
    expect(isCapabilityDirectIntent('查一下 node 版本')).toBe(true);
    expect(isCapabilityDirectIntent('帮我检查这段代码有没有问题')).toBe(true);
  });

  // 真机复验（2026-11-07）：裸 `写` 曾把「文件里写了什么」误判成写操作 ⇒ 未直通、拉起 PDCA
  it('「写了什么」等只读问句不被当作写操作', () => {
    expect(
      isCapabilityDirectIntent('帮我检查 C:\\tmp\\note.txt 这个文件里写了什么')
    ).toBe(true);
    expect(isCapabilityDirectIntent('看看日志里写了什么')).toBe(true);
  });

  it('多步 / 产出 / 写操作类不命中（交回既有升级判定）', () => {
    expect(isCapabilityDirectIntent('帮我实现一个分页组件')).toBe(false);
    expect(isCapabilityDirectIntent('帮我做个记账软件，分步做完')).toBe(false);
    expect(isCapabilityDirectIntent('识别图片里的文字并整理成表格')).toBe(
      false
    );
    expect(isCapabilityDirectIntent('写一个脚本识别图片')).toBe(false);
    expect(isCapabilityDirectIntent('帮我检查项目里有没有未使用依赖')).toBe(
      false
    );
    expect(isCapabilityDirectIntent('今天天气怎么样')).toBe(false);
    expect(isCapabilityDirectIntent('')).toBe(false);
  });
});

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

// 2026-11-03（§13）：多轮精修意图 —— 验证线路 deep 档位的触发信号
describe('hasRefineIntent — 多轮精修意图判定（deep 档位信号，2026-11-03）', () => {
  it('要求多轮打磨/反复迭代类命中', () => {
    expect(hasRefineIntent('请多轮打磨这份方案')).toBe(true);
    expect(hasRefineIntent('反复修改到满意为止')).toBe(true);
    expect(hasRefineIntent('迭代优化三轮再给我')).toBe(true);
    expect(hasRefineIntent('先出草稿，再精修两版')).toBe(true);
  });

  it('单轮执行/普通校验类不命中（防误伤）', () => {
    expect(hasRefineIntent('帮我实现一个分页组件')).toBe(false);
    expect(hasRefineIntent('产出后请做质量把关')).toBe(false);
    expect(hasRefineIntent('什么是依赖注入？')).toBe(false);
    expect(hasRefineIntent('')).toBe(false);
  });

  // 2026-11-03（缺口 #6）：`多轮` 必须后接动作词，避免「多轮对话」误判为多轮打磨
  it('「多轮对话」不命中；「多轮打磨」命中', () => {
    expect(hasRefineIntent('我们继续保持多轮对话')).toBe(false);
    expect(hasRefineIntent('请多轮打磨这份方案')).toBe(true);
  });
});
