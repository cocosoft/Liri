// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 族工具「出参结构」回归（2026-11-20，U-03 补齐）
 *
 * 真机背景：6 个族工具（cron / worktree / task_list / sleep / skill / vfs）在 2026-10-30
 * 合并后**都没有 `outputJsonSchema`** ⇒ 注册表回退历史占位 `{content:string}`
 * （`ToolRegistry` 的占位分支）⇒ 模型看不到这些工具的真实出参结构。
 *
 * 本用例锁住：
 * ① 每个族都能产出 `outputJsonSchema`（不缺成员声明）；
 * ② 合并形态正确：全 object ⇒ properties 并集 + required 交集；全 string ⇒ 标量；混合 ⇒ 联合 type。
 */

import { describe, expect, it } from 'bun:test';
import { createCronFamilyTool } from '@openliri/tool-task';
import { createWorktreeFamilyTool } from '@openliri/tool-workspace';
import { createTaskListFamilyTool } from '@openliri/tool-task';
import { createSleepFamilyTool } from '@openliri/tool-task';
import { createSkillFamilyTool } from '@openliri/tool-agent';
import { createVfsFamilyTool } from '@openliri/tool-workspace';
import { mergeFamilyOutput } from '@openliri/tool-task';
import type { FamilyMember } from '@openliri/tool-task';

type Schema = Record<string, unknown>;
const props = (s: Schema | undefined): Record<string, unknown> =>
  ((s?.properties ?? {}) as Record<string, unknown>) ?? {};
const required = (s: Schema | undefined): unknown[] =>
  Array.isArray(s?.required) ? (s!.required as unknown[]) : [];

describe('族工具出参结构（U-03 补齐，2026-11-20）', () => {
  it('6 族全部产出 outputJsonSchema（此前为 undefined ⇒ 回退占位）', () => {
    const families = {
      cron: createCronFamilyTool(),
      worktree: createWorktreeFamilyTool(),
      task_list: createTaskListFamilyTool(),
      sleep: createSleepFamilyTool(),
      skill: createSkillFamilyTool(),
      vfs: createVfsFamilyTool(),
    };
    for (const [name, tool] of Object.entries(families)) {
      expect(`${name}:${typeof tool.outputJsonSchema}`).toBe(`${name}:object`);
    }
  });

  it('cron：4 个 op 的字段并集（create/list/stop/delete）', () => {
    const schema = createCronFamilyTool().outputJsonSchema;
    expect(schema?.type).toBe('object');
    const keys = Object.keys(props(schema));
    // list 分支的 jobs、delete/stop 的 id、create 的 id/name 等都应在并集里
    expect(keys).toContain('jobs');
    expect(keys).toContain('id');
    expect(keys).toContain('name');
  });

  it('worktree：enter/exit 并集，required 取交集（success/message）', () => {
    const schema = createWorktreeFamilyTool().outputJsonSchema;
    const keys = Object.keys(props(schema));
    expect(keys).toContain('worktree_path');
    expect(keys).toContain('previous_branch');
    // 两个成员共有 ⇒ 交集保留；各自独有的可选字段不会进 required
    expect(required(schema)).toEqual(['success', 'message']);
  });

  it('task_list：3 个 op 的字段并集非空', () => {
    const schema = createTaskListFamilyTool().outputJsonSchema;
    expect(schema?.type).toBe('object');
    expect(Object.keys(props(schema)).length).toBeGreaterThan(0);
  });

  it('sleep：duration 与 wake/until 字段并集（durationMs/wakeId）', () => {
    const schema = createSleepFamilyTool().outputJsonSchema;
    const keys = Object.keys(props(schema));
    expect(keys).toContain('durationMs');
    expect(keys).toContain('wakeId');
  });

  it('skill：混合形态（run 文本 + view/list 对象）⇒ 联合 type', () => {
    const schema = createSkillFamilyTool().outputJsonSchema;
    expect(schema?.type).toEqual(['object', 'string']);
    // object 成员的字段仍应并入
    expect(Object.keys(props(schema))).toContain('skills');
  });

  it('vfs：四个成员 data 均为 JSON 文本 ⇒ 标量声明', () => {
    const schema = createVfsFamilyTool().outputJsonSchema;
    expect(schema?.type).toBe('string');
    expect(String(schema?.description)).toContain('written');
  });
});

describe('mergeFamilyOutput 纯函数边界', () => {
  const member = (key: string, outputJsonSchema?: Schema): FamilyMember => ({
    key,
    legacyName: key,
    readOnly: true,
    ...(outputJsonSchema ? { outputJsonSchema } : {}),
    create: () => {
      throw new Error('本用例不实例化成员');
    },
  });

  it('任一成员缺声明 ⇒ undefined（不臆造）', () => {
    const members = new Map([
      ['a', member('a', { type: 'object', properties: { x: {} } })],
      ['b', member('b')],
    ]);
    expect(mergeFamilyOutput(members, 'op', 'f')).toBeUndefined();
  });

  it('required 取交集：两成员共有字段才保留', () => {
    const members = new Map([
      [
        'a',
        member('a', {
          type: 'object',
          properties: { x: {}, y: {} },
          required: ['x', 'y'],
        }),
      ],
      [
        'b',
        member('b', {
          type: 'object',
          properties: { y: {}, z: {} },
          required: ['y', 'z'],
        }),
      ],
    ]);
    const merged = mergeFamilyOutput(members, 'op', 'f');
    expect(Object.keys(props(merged)).sort()).toEqual(['x', 'y', 'z']);
    expect(required(merged)).toEqual(['y']);
  });
});
