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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  draftFromSubmitPlanToolCalls,
  SUBMIT_PLAN_TOOL_NAME,
} from '../../src/tasks/planOutputParser.js';
import {
  repairAcceptanceCriteria,
  workspaceFactsSnapshot,
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

  // B2（2026-11-09）：demand（许愿式）会话 —— 验收标准前置（fail-closed）
  it('demand 在创建 Plan 前校验验收标准，缺失即 PLAN_CRITERIA_MISSING', () => {
    const gateAt = src.indexOf('if (deps.demand)');
    const createAt = src.indexOf('// 创建 Plan');
    expect(gateAt).toBeGreaterThan(-1);
    expect(src).toContain('PLAN_CRITERIA_MISSING');
    expect(createAt).toBeGreaterThan(gateAt);
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

// B 项（2026-11-19）：Planner 是纯推理角色、不能自己核实文件是否存在 ⇒ 必须由提示词下发
// 工作区文件事实快照，并明令"快照里没有的具体文件名不得写进验收标准"。
describe('workspaceFactsSnapshot — 规划期工作区事实（B 项）', () => {
  function makeWorkspace(): string {
    const ws = mkdtempSync(join(tmpdir(), 'planner-snapshot-'));
    mkdirSync(join(ws, 'app', 'src'), { recursive: true });
    mkdirSync(join(ws, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(ws, '.git'));
    writeFileSync(join(ws, 'app', 'src', 'index.ts'), 'x', 'utf8');
    writeFileSync(join(ws, 'app', 'package.json'), '{}', 'utf8');
    writeFileSync(join(ws, 'README.md'), 'hi', 'utf8');
    writeFileSync(join(ws, 'node_modules', 'pkg', 'a.js'), 'x', 'utf8');
    return ws;
  }

  it('目录在前、文件在后；跳过 node_modules 与隐藏项；只列两层', () => {
    const ws = makeWorkspace();
    const text = workspaceFactsSnapshot(ws);
    const lines = text.split('\n');
    expect(lines).toContain('app/');
    expect(lines).toContain('app/src/');
    expect(lines).toContain('app/package.json');
    expect(lines).toContain('README.md');
    // 第 3 层条目（app/src/index.ts）不列出：快照只到两层，且规则禁止点名快照外文件
    expect(text).not.toContain('app/src/index.ts');
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('.git');
    // 目录条目先于同层文件
    expect(lines.indexOf('app/')).toBeLessThan(lines.indexOf('README.md'));
  });

  it('深度受限：第 3 层条目不列出（避免把仓库整棵树塞进提示词）', () => {
    const ws = makeWorkspace();
    mkdirSync(join(ws, 'app', 'src', 'deep'), { recursive: true });
    writeFileSync(join(ws, 'app', 'src', 'deep', 'x.ts'), 'x', 'utf8');
    expect(workspaceFactsSnapshot(ws)).not.toContain('app/src/deep');
  });

  it('同级过多 ⇒ 截断并标注省略数（不静默丢）', () => {
    const ws = mkdtempSync(join(tmpdir(), 'planner-snapshot-many-'));
    for (let i = 0; i < 30; i++) {
      writeFileSync(
        join(ws, `f${String(i).padStart(2, '0')}.txt`),
        'x',
        'utf8'
      );
    }
    const text = workspaceFactsSnapshot(ws);
    expect(text).toContain('另有');
    expect(text).toContain('未列出');
  });

  it('不存在的路径/空目录 ⇒ 空串（退化为无快照，不阻塞规划）', () => {
    expect(workspaceFactsSnapshot(join(tmpdir(), 'not-exist-xyz-123'))).toBe(
      ''
    );
    expect(
      workspaceFactsSnapshot(mkdtempSync(join(tmpdir(), 'empty-ws-')))
    ).toBe('');
  });

  it('workspacePathConstraint 带快照 + "不得点名快照外文件"硬规则', () => {
    const ws = makeWorkspace();
    const text = workspacePathConstraint(ws);
    expect(text).toContain('【工作区文件事实（快照，非全量）】');
    expect(text).toContain('app/src/');
    expect(text).toContain('不得写出未在快照中出现过的具体文件名');
    expect(text).toContain('先列出该目录内容');
  });

  it('空/不存在的工作区 ⇒ 不下发快照段（提示词保持旧样）', () => {
    const empty = mkdtempSync(join(tmpdir(), 'planner-snapshot-empty-'));
    const text = workspacePathConstraint(empty);
    expect(text).not.toContain('【工作区文件事实（快照，非全量）】');
    expect(text).toContain('**空目录**');
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

  // B2（2026-11-09）：demand 验收标准前置 —— 缺失时走同一纠正通道，提示词要明确"补全"
  it('mode=missing 的提示词点名缺失，并要求只补验收标准', async () => {
    let seenPrompt = '';
    const got = await repairAcceptanceCriteria(
      {
        taskId: 'pdca_test',
        isolation: {
          workspace: 'C:\\work\\pdca_test',
        } as unknown as PlannerRepairDeps['isolation'],
        executor: async (params) => {
          seenPrompt = params.userPrompt;
          return {
            content: '{"acceptanceCriteria":["页面含 canvas","自测退出码 0"]}',
          };
        },
      },
      '做一个游戏',
      steps,
      steps,
      'missing'
    );
    expect(seenPrompt).toContain('缺少验收标准');
    expect(got).toEqual(['页面含 canvas', '自测退出码 0']);
  });
});
