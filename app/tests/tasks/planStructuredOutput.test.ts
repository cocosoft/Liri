// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * C9（2026-11-05）：Planner 的结构化输出（`submit_plan` 工具调用）。
 *
 * 背景：原先 Planner 只能"输出一段 JSON 文本"，真机多次出现
 * 「Planner 输出不是可解析的 JSON / Unterminated string」⇒ 修复重问仍失败 ⇒ 任务直接失败。
 * 现改为**工具调用**提交计划（JSON schema 约束），文本 JSON 仅作兼容回退；
 * 两者共用同一套字段校验（`parsePlanDraft`），不产生第二份契约。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  draftFromSubmitPlanToolCalls,
  SUBMIT_PLAN_TOOL_NAME,
} from '../../src/tasks/planOutputParser.js';

const validPlan = {
  steps: ['读取配置', '写入产物'],
  acceptanceCriteria: ['内容等于 A', '内容等于 B'],
  dependsOn: [[], [0]],
};

describe('draftFromSubmitPlanToolCalls — 结构化计划（工具调用）', () => {
  it('submit_plan 的参数对象 ⇒ 直接得到计划', () => {
    const got = draftFromSubmitPlanToolCalls([
      { name: SUBMIT_PLAN_TOOL_NAME, arguments: validPlan },
    ]);
    expect(got?.draft).toEqual(validPlan);
  });

  it('参数是 JSON 字符串（部分 provider 形态）⇒ 同样可解析', () => {
    const got = draftFromSubmitPlanToolCalls([
      { name: SUBMIT_PLAN_TOOL_NAME, arguments: JSON.stringify(validPlan) },
    ]);
    expect(got?.draft.steps).toEqual(validPlan.steps);
  });

  it('忽略其它工具调用，只认 submit_plan', () => {
    const got = draftFromSubmitPlanToolCalls([
      { name: 'file_read', arguments: { path: 'a.txt' } },
      { name: SUBMIT_PLAN_TOOL_NAME, arguments: validPlan },
    ]);
    expect(got?.draft.steps.length).toBe(2);
    expect(
      draftFromSubmitPlanToolCalls([{ name: 'file_read', arguments: {} }])
    ).toBeNull();
  });

  it('参数不合法 ⇒ null（交给文本回退/修复重问，不吞错）', () => {
    expect(
      draftFromSubmitPlanToolCalls([
        { name: SUBMIT_PLAN_TOOL_NAME, arguments: { steps: [] } },
      ])
    ).toBeNull();
    expect(
      draftFromSubmitPlanToolCalls([
        { name: SUBMIT_PLAN_TOOL_NAME, arguments: { steps: [1, 2] } },
      ])
    ).toBeNull();
    expect(
      draftFromSubmitPlanToolCalls([
        { name: SUBMIT_PLAN_TOOL_NAME, arguments: null },
      ])
    ).toBeNull();
  });

  it('空调用列表 ⇒ null', () => {
    expect(draftFromSubmitPlanToolCalls([])).toBeNull();
  });
});

describe('planPhase — 接线（结构化优先，文本兜底）', () => {
  const src = readFileSync(
    join(__dirname, '..', '..', 'src', 'tasks', 'lro', 'planPhase.ts'),
    'utf-8'
  );

  it('向执行器追加合成工具 submit_plan', () => {
    expect(src).toContain('extraTools: [SUBMIT_PLAN_TOOL]');
  });

  it('先读工具调用、再回退文本解析、最后才修复重问', () => {
    const toolCallAt = src.indexOf(
      'draftFromSubmitPlanToolCalls(result.toolCalls)'
    );
    const textAt = src.indexOf('parsePlanDraft(planText)');
    const repairAt = src.indexOf('repairPlanJson(');
    expect(toolCallAt).toBeGreaterThan(-1);
    expect(textAt).toBeGreaterThan(toolCallAt);
    expect(repairAt).toBeGreaterThan(textAt);
  });
});
