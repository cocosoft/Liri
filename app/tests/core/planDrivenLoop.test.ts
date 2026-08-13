// MIT License
// Copyright (c) 2026 190615273@qq.com

// S0 行为冻结（2026-08-13）：复杂度判定结构化（CS02）+ 子任务上限唯一来源
import { describe, it, expect } from 'bun:test';
import {
  classifyTaskComplexity,
  SIMPLE_TASK_MAX_LENGTH,
} from '../../src/core/loop/PlanDrivenLoop';
import { MAX_SUBTASKS } from '../../src/ai/router/TaskDecomposer';

describe('classifyTaskComplexity — 结构化判定（无正则）', () => {
  it('空/空白消息判定为 complex（不误入快速路径）', () => {
    expect(classifyTaskComplexity('')).toBe('complex');
    expect(classifyTaskComplexity('   ')).toBe('complex');
  });

  it('短问候/致谢/短问题（≤60）判定为 simple', () => {
    expect(classifyTaskComplexity('你好')).toBe('simple');
    expect(classifyTaskComplexity('谢谢')).toBe('simple');
    expect(classifyTaskComplexity('什么是 React')).toBe('simple');
    expect(classifyTaskComplexity('翻译这段话：Hello world')).toBe('simple');
  });

  it('恰好等于阈值的消息判定为 simple', () => {
    const msg = '你'.repeat(SIMPLE_TASK_MAX_LENGTH);
    expect(msg.length).toBe(SIMPLE_TASK_MAX_LENGTH);
    expect(classifyTaskComplexity(msg)).toBe('simple');
  });

  it('超过阈值的长任务判定为 complex', () => {
    const msg = '请'.repeat(SIMPLE_TASK_MAX_LENGTH + 1);
    expect(classifyTaskComplexity(msg)).toBe('complex');
  });

  it('trim 后按有效长度判定（首尾空白不计入）', () => {
    const inner = '你'.repeat(SIMPLE_TASK_MAX_LENGTH);
    expect(classifyTaskComplexity(`  ${inner}  `)).toBe('simple');
  });
});

describe('子任务上限唯一来源（S0 冻结）', () => {
  it('MAX_SUBTASKS 为 5（TaskDecomposer 唯一事实来源）', () => {
    expect(MAX_SUBTASKS).toBe(5);
  });
});
