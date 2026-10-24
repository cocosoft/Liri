/**
 * 用量历史归一化（2026-10-22）：wire 别名 → 规范 modelId
 *
 * 回归的是"用量库按供应商 wire 名另立一档"：供应商实际接收的是
 * `model_registry.provider_mappings` 里的 wire 名（如 `deepseek-flash`），
 * 若落盘前不反查回规范 modelId，汇总里就会同时出现 `deepseek-flash` 与
 * `deepseek-v4-flash` 两档（历史 3183 行即此成因）。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildModelAliasIndex } from '../../src/ai/models/ModelRegistry.js';

describe('buildModelAliasIndex：wire 名 → 规范 modelId', () => {
  it('把 provider_mappings 的值反查成别名（真实 DB 形状）', () => {
    const index = buildModelAliasIndex([
      {
        modelId: 'deepseek-v4-flash',
        providerMappings: {
          deepseek: 'deepseek-flash',
          firstParty: 'deepseek-v4-flash',
        },
      },
      {
        modelId: 'deepseek-v4-pro',
        providerMappings: {
          deepseek: 'deepseek-v4-pro',
          firstParty: 'deepseek-v4-pro',
        },
      },
    ]);

    // wire 名命中；firstParty（与规范名相同）不入索引
    expect(index.get('deepseek-flash')).toBe('deepseek-v4-flash');
    expect(index.has('deepseek-v4-flash')).toBe(false);
    expect(index.has('deepseek-v4-pro')).toBe(false);
    expect(index.size).toBe(1);
  });

  it('大小写不敏感（key 统一小写）', () => {
    const index = buildModelAliasIndex([
      { modelId: 'Qwen3-8B', providerMappings: { llamacpp: 'qwen3-8b-wire' } },
    ]);
    expect(index.get('qwen3-8b-wire')).toBe('Qwen3-8B');
  });

  it('同名前缀冲突：先入者胜，不覆盖', () => {
    const index = buildModelAliasIndex([
      { modelId: 'model-a', providerMappings: { p: 'shared-wire' } },
      { modelId: 'model-b', providerMappings: { p: 'shared-wire' } },
    ]);
    expect(index.get('shared-wire')).toBe('model-a');
  });

  it('空值 / 纯空白不入索引', () => {
    const index = buildModelAliasIndex([
      { modelId: 'm1', providerMappings: { a: '', b: '   ', c: 'm1' } },
      { modelId: 'm2', providerMappings: null },
      { modelId: 'm3' },
    ]);
    expect(index.size).toBe(0);
  });

  it('接线：注册表加载时用该函数重建索引，并提供 resolveModelAlias()', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'src', 'ai', 'models', 'ModelRegistry.ts'),
      'utf-8'
    );
    // 2026-10-24 A2：索引改为写入**当前身份分桶**（`cache().modelAliasIndex`），故断言不含前缀
    expect(source).toContain('modelAliasIndex = buildModelAliasIndex(all)');
    expect(source).toMatch(/resolveModelAlias\(modelName: string\): string/);
  });
});
