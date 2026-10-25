// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 插件配置项视图 + 写入校验（2026-10-26）
//
// 复用的是「HTTP config 端点」与「CLI plugin-settings」**共用**的纯函数，
// 因此这里锁的是两边共同依赖的口径：默认值不冒充"已设置"、未声明的键直接拒、
// 合并后校验（避免分批写必填项被误拒）。
import { describe, expect, it } from 'bun:test';
import {
  buildPluginConfigView,
  extractPluginConfigSchema,
  validatePluginConfigPatch,
} from '../../src/plugins/utils/pluginConfigValues';
import type { PluginConfigSchema } from '../../src/plugins/utils/pluginConfigSchema';

const schema: PluginConfigSchema = {
  pluginId: 'demo',
  version: '1.0.0',
  items: [
    {
      key: 'theme',
      type: 'select',
      label: '主题',
      default: 'dark',
      options: [
        { label: '深色', value: 'dark' },
        { label: '浅色', value: 'light' },
      ],
    },
    { key: 'retries', type: 'number', label: '重试次数', required: true },
    { key: 'verbose', type: 'boolean', label: '详细日志', default: false },
  ],
};

describe('extractPluginConfigSchema', () => {
  it('清单里有合法 configSchema ⇒ 返回；缺失 / 形状不对 ⇒ undefined（不臆造）', () => {
    expect(extractPluginConfigSchema({ configSchema: schema })).toBe(schema);
    expect(extractPluginConfigSchema({})).toBeUndefined();
    expect(extractPluginConfigSchema(null)).toBeUndefined();
    expect(
      extractPluginConfigSchema({ configSchema: { items: 'not-array' } })
    ).toBeUndefined();
  });
});

describe('buildPluginConfigView', () => {
  it('已存储值优先；未存储的显示默认值且 isSet=false', () => {
    const view = buildPluginConfigView('demo', schema, { retries: 3 });

    const theme = view.items.find((i) => i.key === 'theme')!;
    expect(theme.value).toBe('dark');
    expect(theme.isSet).toBe(false);

    const retries = view.items.find((i) => i.key === 'retries')!;
    expect(retries.value).toBe(3);
    expect(retries.isSet).toBe(true);

    // 原始已存储值如实带出（含清单未声明的键也保留）
    expect(view.values).toEqual({ retries: 3 });
  });

  it('未声明 schema ⇒ items 为空，values 仍如实返回（不隐瞒已存储值）', () => {
    const view = buildPluginConfigView('demo', undefined, { foo: 1 });
    expect(view.items).toEqual([]);
    expect(view.values).toEqual({ foo: 1 });
  });

  it('返回的是副本：改视图不影响传入对象', () => {
    const stored = { retries: 3 };
    const view = buildPluginConfigView('demo', schema, stored);
    view.values['retries'] = 9;
    expect(stored.retries).toBe(3);
  });
});

describe('validatePluginConfigPatch', () => {
  it('未声明的键 ⇒ 拒绝并列出可用键（防拼写错误静默写入）', () => {
    const result = validatePluginConfigPatch(schema, {}, { them: 'light' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join()).toContain('配置项不存在：them');
      expect(result.errors.join()).toContain('theme');
    }
  });

  it('select 值不在选项内 ⇒ 拒绝', () => {
    const result = validatePluginConfigPatch(
      schema,
      { retries: 3 },
      {
        theme: 'purple',
      }
    );
    expect(result.ok).toBe(false);
  });

  it('类型不符 ⇒ 拒绝（retries 给字符串）', () => {
    const result = validatePluginConfigPatch(schema, {}, { retries: '3' });
    expect(result.ok).toBe(false);
  });

  it('合并后校验：必填项未设置时，只写别的键仍被拒（不落半截配置）', () => {
    const result = validatePluginConfigPatch(schema, {}, { theme: 'light' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain('retries');
  });

  it('合法 patch ⇒ 只回本次写入的键（不把默认值一起落盘）', () => {
    const result = validatePluginConfigPatch(
      schema,
      {},
      {
        retries: 3,
        theme: 'light',
      }
    );
    expect(result).toEqual({
      ok: true,
      values: { retries: 3, theme: 'light' },
    });
  });

  it('未声明 schema ⇒ 无约束放行（与 PluginConfigManager 同口径）', () => {
    expect(validatePluginConfigPatch(undefined, {}, { anything: 1 })).toEqual({
      ok: true,
      values: { anything: 1 },
    });
  });
});
