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
import {
  repairAcceptanceCriteria,
  workspacePathConstraint,
  type PlannerRepairDeps,
} from '../../src/tasks/lro/plannerSupport.js';

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

  // 2026-11-08（真机 pdca_mw6mktrf）：规划阶段必须约束路径，否则 planner 产出 /tmp/…
  it('规划 prompt 带工作区路径约束', () => {
    expect(src).toContain('workspacePathConstraint(deps.isolation.workspace)');
  });
});

describe('workspacePathConstraint — 规划阶段路径约束（2026-11-08）', () => {
  it('给出工作区根目录，并点名禁止 /tmp、C:\\、~ 等绝对路径', () => {
    const text = workspacePathConstraint('C:\\work\\pdca_demo');
    expect(text).toContain('C:\\work\\pdca_demo');
    expect(text).toContain('相对路径');
    expect(text).toContain('/tmp');
    expect(text).toContain('C:\\');
    expect(text).toContain('~');
  });
});

describe('repairAcceptanceCriteria — 输出解析健壮性（2026-11-09）', () => {
  const steps = ['生成页面', '写自测脚本'];

  /** 假执行器：只回放给定输出（isolation 仅透传，不参与解析） */
  function deps(content: string, finishReason?: string): PlannerRepairDeps {
    return {
      taskId: 'pdca_test',
      isolation: {
        workspace: 'C:\\work\\pdca_test',
      } as unknown as PlannerRepairDeps['isolation'],
      executor: async () =>
        finishReason === undefined ? content : { content, finishReason },
    };
  }

  it('```json 围栏包裹 ⇒ 仍可解析（原先裸 JSON.parse 会失败）', async () => {
    const got = await repairAcceptanceCriteria(
      deps(
        '```json\n{"acceptanceCriteria":["页面含 canvas","自测退出码 0"]}\n```'
      ),
      '做一个游戏',
      steps,
      ['输出非空']
    );
    expect(got).toEqual(['页面含 canvas', '自测退出码 0']);
  });

  it('前后带解释文字 ⇒ 提取首个平衡 JSON 对象', async () => {
    const got = await repairAcceptanceCriteria(
      deps('好的，修正如下：\n{"acceptanceCriteria":["A","B"]}\n以上。'),
      '做一个游戏',
      steps,
      ['输出非空']
    );
    expect(got).toEqual(['A', 'B']);
  });

  it('条数不齐 ⇒ undefined（保留原验收标准）', async () => {
    const got = await repairAcceptanceCriteria(
      deps('{"acceptanceCriteria":["只有一条"]}'),
      '做一个游戏',
      steps,
      ['输出非空']
    );
    expect(got).toBeUndefined();
  });

  it('被 max_tokens 截断 ⇒ undefined，不抛错', async () => {
    const got = await repairAcceptanceCriteria(
      deps('{"acceptanceCriteria":["A","B', 'max_tokens'),
      '做一个游戏',
      steps,
      ['输出非空']
    );
    expect(got).toBeUndefined();
  });

  // 2026-11-09（真机 `pdca_mw8uz6mf`）：纠正调用此前未传预算 ⇒ provider 默认 4096 被思考吃光
  it('纠正调用显式传入输出预算（与主规划同口径）', async () => {
    let received: number | undefined;
    const got = await repairAcceptanceCriteria(
      {
        taskId: 'pdca_test',
        isolation: {
          workspace: 'C:\\work\\pdca_test',
        } as unknown as PlannerRepairDeps['isolation'],
        executor: async (params) => {
          received = params.maxTokens;
          return { content: '{"acceptanceCriteria":["A","B"]}' };
        },
      },
      '做一个游戏',
      steps,
      ['输出非空']
    );
    expect(got).toEqual(['A', 'B']);
    expect(received).toBeGreaterThan(0);
  });
});
