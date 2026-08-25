// MIT License
// Copyright (c) 2026 190615273@qq.com
// ReferenceValidator 归属校验单测（验收标准 10）

import { describe, expect, it } from 'bun:test';
import { validateReferences } from '../../src/config/layers/ReferenceValidator';

const okCheckers = {
  providerExists: async (id: string) => ['p1', 'p2'].includes(id),
  modelExists: async (m: string) => ['deepseek-chat', 'gpt-4'].includes(m),
};

describe('ReferenceValidator 归属校验（数出同源）', () => {
  it('引用存在的 providerId/modelId → 通过', async () => {
    const config = {
      ai: { providerId: 'p1', defaultModel: 'deepseek-chat' },
    };
    const result = await validateReferences(config, okCheckers);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('引用不存在的 providerId → fail（violation 含路径与值）', async () => {
    const config = { ai: { providerId: 'ghost' } };
    const result = await validateReferences(config, okCheckers);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { path: 'ai.providerId', field: 'providerId', value: 'ghost' },
    ]);
  });

  it('引用不存在的 modelId → fail', async () => {
    const config = { ai: { modelId: 'not-a-model' } };
    const result = await validateReferences(config, okCheckers);
    expect(result.ok).toBe(false);
    expect(result.violations[0].field).toBe('modelId');
    expect(result.violations[0].value).toBe('not-a-model');
  });

  it('provider 别名（旧字段名）同样校验', async () => {
    const config = { routing: { provider: 'p1' } };
    const result = await validateReferences(config, okCheckers);
    expect(result.ok).toBe(true);
  });

  it('嵌套深层引用', async () => {
    const config = { a: { b: { c: { providerId: 'ghost', ok: 'p1' } } } };
    const result = await validateReferences(config, okCheckers);
    expect(result.ok).toBe(false);
    expect(result.violations[0].path).toBe('a.b.c.providerId');
  });

  it('多个违规全部收集', async () => {
    const config = { ai: { providerId: 'g1', modelId: 'g2' } };
    const result = await validateReferences(config, okCheckers);
    expect(result.violations.length).toBe(2);
  });

  it('空配置 → 通过', async () => {
    const result = await validateReferences({}, okCheckers);
    expect(result.ok).toBe(true);
  });

  it('非字符串值（数字/布尔）不校验', async () => {
    const config = { ai: { providerId: 123, model: true } };
    const result = await validateReferences(config, okCheckers);
    expect(result.ok).toBe(true);
  });
});
