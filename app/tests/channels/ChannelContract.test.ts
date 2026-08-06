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
 * 渠道三源契约测试（P2-2 / 4.11）
 *
 * 断言 config-schema.ts ↔ Channel.getDefaultConfig() ↔ 前端 PLATFORM_FIELDS 一致：
 * 1. 元测试：ALL_CHANNEL_DEFS 每个已注册渠道必须存在 config-schema.ts 且导出 getDefault*Config
 * 2. 一致性：渠道插件 config.getDefaultConfig() 与 schema getDefault*Config 深比较
 * 3. 前端字段 ⊆ schema 字段（前端只暴露 schema 中的字段）
 */

import { describe, expect, it } from 'bun:test';
import { ALL_CHANNEL_DEFS } from '../../src/channels/setupChannels';
// 字段渲染元数据已收敛至后端（4.1），契约测试直接引用后端单一来源
import { PLATFORM_FIELDS } from '../../src/channels/config-metadata';

/** 渠道 type → 模块目录名（仅不一致项需映射） */
const TYPE_TO_DIR: Record<string, string> = {
  facebook: 'facebookmessenger',
  googlechat: 'googlechat',
};

function dirFor(type: string): string {
  return TYPE_TO_DIR[type] || type;
}

/** 从 schema 模块导出中定位 getDefault*Config 函数（避免硬编码命名映射） */
function findDefaultGetter(
  mod: Record<string, unknown>
): ((...args: unknown[]) => Record<string, unknown>) | undefined {
  const key = Object.keys(mod).find(
    (k) => k.startsWith('getDefault') && k.endsWith('Config')
  );
  if (!key) return undefined;
  const fn = mod[key] as unknown;
  return typeof fn === 'function'
    ? (fn as (...args: unknown[]) => Record<string, unknown>)
    : undefined;
}

/** 从渠道 index 导出中定位 IChannelPlugin 实例 */
interface PluginLike {
  config: { getDefaultConfig(): Record<string, unknown> };
}
function findPlugin(
  mod: Record<string, unknown>
): PluginLike | undefined {
  for (const value of Object.values(mod)) {
    if (value && typeof value === 'object') {
      const candidate = value as {
        config?: { getDefaultConfig?: () => unknown };
      };
      if (typeof candidate.config?.getDefaultConfig === 'function') {
        return candidate as unknown as PluginLike;
      }
    }
  }
  return undefined;
}

describe('渠道三源契约（4.11）', () => {
  for (const def of ALL_CHANNEL_DEFS) {
    const { type } = def;

    it(`[元测试] ${type} 必须存在 config-schema.ts 并导出 getDefault*Config`, async () => {
      const mod = (await import(
        `../../src/channels/${dirFor(type)}/config-schema`
      )) as Record<string, unknown>;
      const getter = findDefaultGetter(mod);
      expect(
        getter,
        `${type} 缺少 getDefault*Config 导出（config-schema.ts）`
      ).toBeDefined();
    });

    it(`[一致性] ${type} schema 默认值字段 ⊆ Channel.getDefaultConfig 且值一致`, async () => {
      const schemaMod = (await import(
        `../../src/channels/${dirFor(type)}/config-schema`
      )) as Record<string, unknown>;
      const getter = findDefaultGetter(schemaMod);
      expect(getter).toBeDefined();
      const schemaDefault = getter!();

      const indexMod = (await import(
        `../../src/channels/${dirFor(type)}/index`
      )) as Record<string, unknown>;
      const plugin = findPlugin(indexMod);
      expect(
        plugin,
        `${type} 未从 index 中找到含 config.getDefaultConfig 的插件实例`
      ).toBeDefined();
      const pluginDefault = plugin!.config.getDefaultConfig();
      for (const [key, value] of Object.entries(schemaDefault)) {
        expect(
          key in pluginDefault,
          `${type} Channel.getDefaultConfig 缺 config-schema 字段 "${key}"`
        ).toBe(true);
        expect(
          pluginDefault[key],
          `${type} 字段 "${key}" 默认值不一致`
        ).toEqual(value);
      }
    });

    it(`[前端] ${type} PLATFORM_FIELDS 字段 ⊆ schema 字段`, async () => {
      const frontFields = PLATFORM_FIELDS[type];
      if (!frontFields) {
        return; // 未显式映射的渠道走 GENERIC_FIELDS，跳过
      }
      const schemaMod = (await import(
        `../../src/channels/${dirFor(type)}/config-schema`
      )) as Record<string, unknown>;
      const getter = findDefaultGetter(schemaMod);
      expect(getter).toBeDefined();
      const schemaFields = Object.keys(getter!());
      for (const field of frontFields) {
        expect(
          schemaFields,
          `${type} 前端字段 "${field.key}" 不在 config-schema 中`
        ).toContain(field.key);
      }
    });
  }
});
