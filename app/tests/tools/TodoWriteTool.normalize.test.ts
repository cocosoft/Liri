// MIT License
// Copyright (c) 2026 190615273@qq.com

// TodoWriteTool.write 字段归一化（normalizeWriteTodos）单元测试。
// 2026-08-31：根治"任务分解全显示『任务 N』占位名"——模型常以字符串数组或
// title/task/desc 等字段传参，原实现仅读 content/name 导致全量兜底。
import { describe, it, expect } from 'bun:test';
import { normalizeWriteTodos } from '../../src/tools/TodoWriteTool/TodoWriteTool';

describe('normalizeWriteTodos — 字段归一化', () => {
  it('字符串数组元素直接作为 content', () => {
    const todos = normalizeWriteTodos(['分析会话系统', '做对标分析']);
    expect(todos.map((t) => t.content)).toEqual(['分析会话系统', '做对标分析']);
    expect(todos.every((t) => t.status === 'pending')).toBe(true);
  });

  it('对象元素优先 content 字段', () => {
    const todos = normalizeWriteTodos([
      { content: '第一步', name: '别名', title: '标题' },
    ]);
    expect(todos[0]!.content).toBe('第一步');
  });

  it('对象缺 content 时依次降级 name/title/task/subject/description/desc', () => {
    expect(normalizeWriteTodos([{ title: '标题内容' }])[0]!.content).toBe(
      '标题内容'
    );
    expect(normalizeWriteTodos([{ task: '任务内容' }])[0]!.content).toBe(
      '任务内容'
    );
    expect(normalizeWriteTodos([{ desc: '描述内容' }])[0]!.content).toBe(
      '描述内容'
    );
    expect(normalizeWriteTodos([{ description: '长描述' }])[0]!.content).toBe(
      '长描述'
    );
    expect(normalizeWriteTodos([{ name: '名字' }])[0]!.content).toBe('名字');
  });

  it('全字段缺失才兜底"任务 N"（序号从 1 起）', () => {
    const todos = normalizeWriteTodos([{}, null, '']);
    expect(todos.map((t) => t.content)).toEqual(['任务 1', '任务 2', '任务 3']);
  });

  it('状态白名单：in_progress/completed 保留，其余回退 pending', () => {
    const todos = normalizeWriteTodos([
      { content: 'a', status: 'in_progress' },
      { content: 'b', status: 'completed' },
      { content: 'c', status: 'weird' },
      { content: 'd' },
    ]);
    expect(todos.map((t) => t.status)).toEqual([
      'in_progress',
      'completed',
      'pending',
      'pending',
    ]);
  });

  it('保留模型传入的 id，缺失时生成新 id', () => {
    const todos = normalizeWriteTodos([
      { id: 'keep-me', content: 'a' },
      { content: 'b' },
    ]);
    expect(todos[0]!.id).toBe('keep-me');
    expect(todos[1]!.id).toMatch(/^todo_/);
  });
});
