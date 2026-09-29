// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具"按名定位"的真实名优先（2026-09-29）
 *
 * 背景（实测）：`TodoWriteTool` 曾把**另一个真实工具名** `create_task_list` 当别名 ⇒
 * `tool_search(select:create_task_list)` 经 `findToolByName`（按数组顺序 `find`）返回
 * `todo_write`，把模型引向错误的工具（实测：模型据此改用 `todo_write`）。
 *
 * 本文件守住两条不变式：
 *  1. `findToolByName` **真实名优先于别名**（与 `ToolRegistry.getTool()` 口径一致），
 *     且**与数组顺序无关**（原实现按顺序 `find`，冲突时结果取决于注册顺序 ⇒ 脆弱）；
 *  2. 回归守卫：三处曾冲突的别名不再占用**他人真实工具名**；
 *  3. `ToolRegistry.registerTool` 的**注册期别名守卫**（跳过冲突别名 + 摘除被真实名顶替的别名）。
 */
import { describe, it, expect } from 'bun:test';
import { findToolByName } from '../../src/tools/types/Tool';
import type { Tool } from '../../src/tools/types/Tool';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import { TodoWriteTool } from '../../src/tools/TodoWriteTool/TodoWriteTool';
import { VideoGenerateTool } from '../../src/tools/VideoGenerateTool/VideoGenerateTool';

/** 别名持有者（其别名与他人真实名相同 —— 即本次缺陷形态） */
const ALIAS_HOLDER = {
  name: 'alias_holder',
  aliases: ['shared_name'],
} as unknown as Tool;
/** 真实工具（真名 = `shared_name`） */
const REAL_TOOL = { name: 'shared_name' } as unknown as Tool;
const PLAIN_TOOL = { name: 'plain' } as unknown as Tool;

describe('findToolByName — 真实名优先于别名', () => {
  it('别名持有者在前 ⇒ 仍返回真实工具（原缺陷场景）', () => {
    expect(findToolByName([ALIAS_HOLDER, REAL_TOOL], 'shared_name')).toBe(
      REAL_TOOL
    );
  });

  it('真实工具在前 ⇒ 返回真实工具（顺序无关）', () => {
    expect(findToolByName([REAL_TOOL, ALIAS_HOLDER], 'shared_name')).toBe(
      REAL_TOOL
    );
  });

  it('无冲突时别名仍可命中（别名机制未被削弱）', () => {
    expect(findToolByName([ALIAS_HOLDER], 'shared_name')).toBe(ALIAS_HOLDER);
  });

  it('完全未命中 ⇒ undefined', () => {
    expect(findToolByName([PLAIN_TOOL], 'nope')).toBeUndefined();
  });
});

describe('回归守卫 — 别名不得占用他人真实工具名', () => {
  it('TodoWriteTool：不再把真实工具名 create_task_list 当别名', () => {
    expect(new TodoWriteTool().aliases ?? []).not.toContain('create_task_list');
  });

  it('VideoGenerateTool：不再把 video 当别名（video 是 VideoTool 的真名）', () => {
    expect(new VideoGenerateTool().aliases ?? []).not.toContain('video');
  });
});

describe('ToolRegistry — 注册期别名守卫（2026-09-29）', () => {
  const mkTool = (name: string, aliases?: string[]): Tool =>
    ({ name, aliases }) as unknown as Tool;

  it('别名撞**已注册工具的真实名** ⇒ 跳过登记（真实名优先；工具本身仍注册）', () => {
    const registry = new ToolRegistry();
    registry.registerTool(mkTool('real_tool'));
    registry.registerTool(mkTool('alias_holder', ['real_tool']));

    expect(registry.getTool('real_tool')?.name).toBe('real_tool');
    expect(registry.getTool('alias_holder')?.name).toBe('alias_holder');
    // 冲突别名**未**登记 ⇒ 按别名查不到任何工具（原实现会指向 alias_holder）
    expect(registry.getToolByAlias('real_tool')).toBeUndefined();
  });

  it('反向：真实名被先前工具的别名占用 ⇒ 注册时摘除该别名', () => {
    const registry = new ToolRegistry();
    registry.registerTool(mkTool('holder', ['late_real']));
    expect(registry.getToolByAlias('late_real')?.name).toBe('holder');

    registry.registerTool(mkTool('late_real'));
    expect(registry.getToolByAlias('late_real')).toBeUndefined();
    expect(registry.getTool('late_real')?.name).toBe('late_real');
  });

  it('无冲突的别名照常登记（守卫不误伤）', () => {
    const registry = new ToolRegistry();
    registry.registerTool(mkTool('holder2', ['h2_alias', 'h2_alias2']));
    expect(registry.getToolByAlias('h2_alias')?.name).toBe('holder2');
    expect(registry.getToolByAlias('h2_alias2')?.name).toBe('holder2');
  });
});
