// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-01（2026-10-17）：Planner 输出解析守卫。
 *
 * 锁定三条不变量：
 * 1. 允许首尾 ```json 围栏与前后噪声；
 * 2. 结构非法（空 steps / 非字符串 / 非法 dependsOn）⇒ 明确失败；
 * 3. 失败**不得**降级为“按行切分”——解析层只返回 ok:false。
 */
import { describe, it, expect } from 'bun:test';
import {
  parsePlanDraft,
  stripOuterFence,
  extractFirstJsonObject,
} from '../../src/tasks/planOutputParser.js';

describe('stripOuterFence', () => {
  it('剥离首尾 ```json 围栏', () => {
    const text = '```json\n{"steps":["a"]}\n```';
    expect(stripOuterFence(text)).toBe('{"steps":["a"]}');
  });

  it('不剥离正文中的代码块', () => {
    const text = '说明\n```json\n{"steps":["a"]}\n```\n结尾';
    expect(stripOuterFence(text)).toBe(text);
  });

  it('围栏未闭合时保持原样', () => {
    const text = '```json\n{"steps":["a"]}';
    expect(stripOuterFence(text)).toBe(text);
  });
});

describe('extractFirstJsonObject', () => {
  it('提取前后带解释文本的 JSON 对象', () => {
    const text = '计划如下：{"steps":["a","b"]} 请执行';
    expect(extractFirstJsonObject(text)).toBe('{"steps":["a","b"]}');
  });

  it('忽略字符串内的括号与转义', () => {
    const text = '{"steps":["含 } 与 \\" 的步骤"]}';
    expect(extractFirstJsonObject(text)).toBe(text);
  });

  it('不闭合返回 null', () => {
    expect(extractFirstJsonObject('{"steps":["a"')).toBeNull();
  });
});

describe('parsePlanDraft', () => {
  it('纯 JSON 正常解析', () => {
    const result = parsePlanDraft(
      '{"steps":["a","b"],"acceptanceCriteria":["A","B"],"dependsOn":[[],[0]]}'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.steps).toEqual(['a', 'b']);
    expect(result.draft.acceptanceCriteria).toEqual(['A', 'B']);
    expect(result.draft.dependsOn).toEqual([[], [0]]);
  });

  it('围栏 + 前后噪声可解析', () => {
    const result = parsePlanDraft(
      '好的，计划：\n```json\n{"steps":["a"]}\n```\n请确认'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.steps).toEqual(['a']);
  });

  it('空 steps / 非字符串项 ⇒ 拒绝', () => {
    expect(parsePlanDraft('{"steps":[]}').ok).toBe(false);
    expect(parsePlanDraft('{"steps":["a",1]}').ok).toBe(false);
    expect(parsePlanDraft('{"steps":["  "]}').ok).toBe(false);
  });

  it('非法 dependsOn ⇒ 拒绝', () => {
    const result = parsePlanDraft('{"steps":["a"],"dependsOn":[[-1]]}');
    expect(result.ok).toBe(false);
  });

  it('纯文本（无 JSON 对象）⇒ 失败且不产生行切 steps', () => {
    const result = parsePlanDraft('第一步：分析\n第二步：实现\n第三步：验证');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no-json-object');
      expect('draft' in result).toBe(false);
    }
  });

  it('截断 JSON ⇒ 明确失败（由调用方重问）', () => {
    const result = parsePlanDraft('{"steps":["a","b"');
    expect(result.ok).toBe(false);
  });
});
