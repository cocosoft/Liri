// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * M1：任务分解结果 Schema 校验
 * spec：.trae/specs/task-decomposition-schema-validation.md（裁定 D1=zod / D2=抛错降级）
 */
import { describe, expect, it } from 'bun:test';
import { validateDecompositionShape } from '../../src/ai/router/decompositionSchema.js';
import { TaskDecomposer } from '../../src/ai/router/TaskDecomposer.js';
import type { AIProvider } from '../../src/ai/providers/AIProvider.js';

/** 最小假 Provider（只实现 llmDecompose 触达的方法） */
function fakeProvider(content: string): AIProvider {
  return {
    id: 'test-provider',
    displayName: 'Test Provider',
    chat: async () => ({ content, model: 'test-model' }),
    chatStream: async function* () {
      /* 未使用 */
    },
    listModels: async () => [],
    validateConfig: () => ({ valid: true, errors: [] }),
  } as unknown as AIProvider;
}

describe('M1 validateDecompositionShape — 纯校验', () => {
  it('合法输入 ⇒ ok:true（字段原样透传）', () => {
    const shape = validateDecompositionShape(
      {
        mainTier: 'complex',
        reasoning: '拆分理由',
        subTasks: [
          { id: 'step-1', description: 'A', tier: 'simple', dependsOn: [] },
          { id: 'step-2', name: 'B', dependsOn: ['step-1'] },
        ],
      },
      5
    );
    expect(shape.ok).toBe(true);
    if (!shape.ok) return;
    expect(shape.data.mainTier).toBe('complex');
    expect(shape.data.subTasks).toHaveLength(2);
    expect(shape.data.subTasks[1]!.name).toBe('B');
  });

  it('subTasks 非数组 ⇒ ok:false', () => {
    const shape = validateDecompositionShape({ subTasks: {} }, 5);
    expect(shape.ok).toBe(false);
    if (shape.ok) return;
    expect(shape.issues[0]!.kind).toBe('schema');
  });

  it('subTasks 为空数组 ⇒ ok:false（空分解对下游无意义，spec §4-D3=(a)）', () => {
    const shape = validateDecompositionShape({ subTasks: [] }, 5);
    expect(shape.ok).toBe(false);
  });

  it('元素为 null / 非对象 ⇒ ok:false', () => {
    expect(validateDecompositionShape({ subTasks: [null] }, 5).ok).toBe(false);
    expect(validateDecompositionShape({ subTasks: ['x'] }, 5).ok).toBe(false);
  });

  it('dependsOn 含非字符串 ⇒ ok:false', () => {
    const shape = validateDecompositionShape(
      { subTasks: [{ id: 'a', dependsOn: ['ok', 1] }] },
      5
    );
    expect(shape.ok).toBe(false);
  });

  it('mainTier 非字符串 ⇒ ok:false', () => {
    expect(
      validateDecompositionShape({ subTasks: [{ id: 'a' }], mainTier: 3 }, 5).ok
    ).toBe(false);
  });

  it('显式 id 重复 ⇒ duplicate_id', () => {
    const shape = validateDecompositionShape(
      { subTasks: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] },
      5
    );
    expect(shape.ok).toBe(false);
    if (shape.ok) return;
    expect(shape.issues.some((i) => i.kind === 'duplicate_id')).toBe(true);
  });

  it('截断后不再重复 ⇒ 不报（先截断后判定，spec §3 规则 5）', () => {
    // maxSubTasks=2 ⇒ 只校验前 2 项；第 3 项与第 1 项重复但已被截掉
    const shape = validateDecompositionShape(
      { subTasks: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] },
      2
    );
    expect(shape.ok).toBe(true);
  });

  it('缺 id ⇒ 不算重复（自动编号交调用方）', () => {
    const shape = validateDecompositionShape(
      { subTasks: [{ description: 'A' }, { description: 'B' }] },
      5
    );
    expect(shape.ok).toBe(true);
  });
});

describe('M1 TaskDecomposer 接线 — 畸形 ⇒ 降级单步', () => {
  it('合法 JSON ⇒ 正常分解（零行为回归）', async () => {
    const decomposer = new TaskDecomposer(
      null,
      fakeProvider(
        JSON.stringify({
          mainTier: 'complex',
          reasoning: 'r',
          subTasks: [{ id: 'step-1', description: 'A' }],
        })
      )
    );
    const result = await decomposer.decompose('do something');
    expect(result.mainTier).toBe('complex');
    expect(result.subTasks).toHaveLength(1);
    expect(result.subTasks[0]!.description).toBe('A');
  });

  it('结构畸形（subTasks 非数组）⇒ 降级 simpleDecompose（单步，不抛到调用方）', async () => {
    const decomposer = new TaskDecomposer(
      null,
      fakeProvider('{"subTasks": {}}')
    );
    const result = await decomposer.decompose('do something');
    // 降级产物：单步 + 原消息作为 description
    expect(result.subTasks).toHaveLength(1);
    expect(result.subTasks[0]!.description).toBe('do something');
    expect(result.reasoning).toContain('简单模式');
  });

  it('subTasks 空数组 ⇒ 降级 single-step', async () => {
    const decomposer = new TaskDecomposer(
      null,
      fakeProvider('{"subTasks": []}')
    );
    const result = await decomposer.decompose('do something');
    expect(result.subTasks).toHaveLength(1);
    expect(result.reasoning).toContain('简单模式');
  });
});

// 13-P1-1 Step 2（2026-10-06，`任务计划-20261004.md` §20.6）：逃生门生产可用 ——
// 分解 prompt/schema 产出 `dependsOnMode`，使模型能**按步**选择 soft（opt-out）。
describe('13-P1-1 Step 2: dependsOnMode 结构校验与接线', () => {
  it('合法值 hard / soft ⇒ ok:true（原样透传）', () => {
    const shape = validateDecompositionShape(
      {
        subTasks: [
          { id: 'a', description: 'A', dependsOnMode: 'hard' },
          {
            id: 'b',
            description: 'B',
            dependsOn: ['a'],
            dependsOnMode: 'soft',
          },
        ],
      },
      5
    );
    expect(shape.ok).toBe(true);
    if (!shape.ok) return;
    expect(shape.data.subTasks[0]!.dependsOnMode).toBe('hard');
    expect(shape.data.subTasks[1]!.dependsOnMode).toBe('soft');
  });

  it('未识别取值 ⇒ 仍 ok:true（**宽进**，与 tier 同策略：不因取值噪声判整次分解失败）', () => {
    const shape = validateDecompositionShape(
      { subTasks: [{ id: 'a', description: 'A', dependsOnMode: 'degrade' }] },
      5
    );
    expect(shape.ok).toBe(true);
  });

  it('TaskDecomposer 归一：soft 保留（含大小写/空白）、噪声值 ⇒ undefined（走全局默认）', async () => {
    const decomposer = new TaskDecomposer(
      null,
      fakeProvider(
        JSON.stringify({
          mainTier: 'complex',
          reasoning: 'r',
          subTasks: [
            { id: 'step-1', description: 'A', dependsOnMode: ' SOFT ' },
            {
              id: 'step-2',
              description: 'B',
              dependsOn: ['step-1'],
              dependsOnMode: 'degrade',
            },
            { id: 'step-3', description: 'C' },
          ],
        })
      )
    );
    const result = await decomposer.decompose('do something');
    expect(result.subTasks[0]!.dependsOnMode).toBe('soft');
    expect(result.subTasks[1]!.dependsOnMode).toBeUndefined();
    expect(result.subTasks[2]!.dependsOnMode).toBeUndefined();
  });
});
