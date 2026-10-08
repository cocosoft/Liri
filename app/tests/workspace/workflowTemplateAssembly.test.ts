/**
 * 模板 → 可执行定义**装配层** 单测（P1-19 ②，2026-10-08）
 *
 * 规格：`.trae/specs/workflow-template-execution-binding.md`（推荐形态 ①+②）。
 * 锁三条：
 *  1. **不猜、不降级**（CS04）：任一步骤缺 `tool` ⇒ 整模板**不产出**定义（`null`）；
 *  2. **命名空间前缀** `template:`（防与 seam 既有工作流名撞名）；
 *  3. `dependsOn` **原样透传**（拓扑/校验交 seam，不重写，CS01）。
 */
import { describe, expect, it } from 'bun:test';
import {
  templateToDefinition,
  templateWorkflowName,
  TEMPLATE_WORKFLOW_PREFIX,
} from '../../src/workspace/workflowTemplateAssembly';
import type { WorkflowTemplate } from '../../src/workspace/types';

function makeTemplate(
  overrides: Partial<WorkflowTemplate> = {}
): WorkflowTemplate {
  return {
    id: 'user_1',
    name: '发版流程',
    description: '打包 → 校验 → 发布',
    category: 'release',
    steps: [
      {
        id: 'build',
        name: '打包',
        description: '构建产物',
        type: 'auto',
        tool: 'bash:run',
      },
      {
        id: 'publish',
        name: '发布',
        description: '推送制品',
        type: 'manual',
        tool: 'release:publish',
        dependsOn: ['build'],
      },
    ],
    author: 'user',
    isPublic: false,
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('templateToDefinition：装配', () => {
  it('每步都显式带 tool ⇒ 产出定义；名加 `template:` 前缀，dependsOn 原样透传', () => {
    const definition = templateToDefinition(makeTemplate());

    expect(definition).not.toBeNull();
    expect(definition!.name).toBe(templateWorkflowName('user_1'));
    expect(definition!.name.startsWith(TEMPLATE_WORKFLOW_PREFIX)).toBe(true);
    expect(definition!.description).toBe('打包 → 校验 → 发布');
    expect(definition!.steps).toEqual([
      { id: 'build', description: '构建产物', tool: 'bash:run' },
      {
        id: 'publish',
        description: '推送制品',
        tool: 'release:publish',
        dependsOn: ['build'],
      },
    ]);
  });

  it('步骤 description 缺省 ⇒ 回退 name（seam 的 description 必填）', () => {
    const definition = templateToDefinition(
      makeTemplate({
        steps: [
          {
            id: 'a',
            name: '步骤名',
            description: '',
            type: 'auto',
            tool: 'x:y',
          },
        ],
      })
    );
    expect(definition!.steps[0].description).toBe('步骤名');
  });

  it('模板 description 为空 ⇒ 回退 name', () => {
    const definition = templateToDefinition(makeTemplate({ description: '' }));
    expect(definition!.description).toBe('发版流程');
  });

  it('无 dependsOn 的步骤 ⇒ 不写空数组（保持 seam 缺省语义）', () => {
    const definition = templateToDefinition(
      makeTemplate({
        steps: [
          {
            id: 'a',
            name: 'A',
            description: 'A',
            type: 'auto',
            tool: 'x:y',
            dependsOn: [],
          },
        ],
      })
    );
    expect('dependsOn' in definition!.steps[0]).toBe(false);
  });

  it('**缺 tool 的步骤 ⇒ 整模板返回 null**（显式不可执行，不猜不降级）', () => {
    const definition = templateToDefinition(
      makeTemplate({
        steps: [
          {
            id: 'build',
            name: '打包',
            description: '构建',
            type: 'auto',
            tool: 'bash:run',
          },
          // 第二步缺 tool：`type`/`description` 无法派生工具名（spec §3）
          {
            id: 'publish',
            name: '发布',
            description: '推送制品',
            type: 'manual',
          },
        ],
      })
    );
    expect(definition).toBeNull();
  });

  it('tool 为空白字符串 ⇒ 等同缺省（不得当"有工具"）', () => {
    const definition = templateToDefinition(
      makeTemplate({
        steps: [
          { id: 'a', name: 'A', description: 'A', type: 'auto', tool: '   ' },
        ],
      })
    );
    expect(definition).toBeNull();
  });

  it('空 steps ⇒ null（不产出空定义）', () => {
    expect(templateToDefinition(makeTemplate({ steps: [] }))).toBeNull();
  });

  it('内建 4 模板形态（有 suggestedAgentRole、无 tool）⇒ null ⇒ 行为与现状一致', () => {
    const definition = templateToDefinition(
      makeTemplate({
        id: 'builtin:bug-fix',
        steps: [
          {
            id: 'locate',
            name: '定位根因',
            description: '分析代码定位根本原因',
            type: 'auto',
            dependsOn: ['reproduce'],
            suggestedAgentRole: 'researcher',
          },
        ],
      })
    );
    expect(definition).toBeNull();
  });
});
