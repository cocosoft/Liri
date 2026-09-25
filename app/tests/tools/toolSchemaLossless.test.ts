// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 工具 schema 的 D1 载荷合法性回归（2026-09-25，`.trae/specs/event-payload-undefined-rootfix.md`）
//
// 背景：`ToolRegistry.getToolSchemas()` 的产物即 `context/model-input` 事件的 `tools.schemas`。
// 修复前该函数对**无默认值的参数**无条件写 `default: undefined`（实测路径
// `schemas[0].input_schema.properties.cwd.default`）⇒ D1 无损 JSON 校验**整条拒绝**事件
// ⇒ 「模型可见 ⇔ 已落盘」实际不成立（见 `dev_docs/error_repairs/预存错误与待处理问题.md`
// 第二十六次修复「附带发现 2」）。
//
// 本用例锁的是**面**（**真实工具集全体**），不是单点：此后任何工具新增"无默认值参数 /
// 无 aliases"都会被当场抓住。

import { describe, it, expect } from 'bun:test';
import { ToolRegistry } from '../../src/tools/ToolRegistry.js';
import { getAllBaseTools } from '../../src/tools/ToolFactory.js';

/** 深扫首个 `undefined` 值，返回其路径（无则 null） */
function findUndefinedPath(value: unknown, path = ''): string | null {
  if (value === undefined) return path || '(root)';
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findUndefinedPath(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, val] of Object.entries(value)) {
    const hit = findUndefinedPath(val, path ? `${path}.${key}` : key);
    if (hit) return hit;
  }
  return null;
}

/** 用**真实工具池**构建 schema（经真实 `ToolRegistry`，不造假工具） */
function buildRealSchemas(): {
  tools: ReturnType<typeof getAllBaseTools>;
  schemas: ReturnType<ToolRegistry['getToolSchemas']>;
} {
  const tools = getAllBaseTools();
  const registry = new ToolRegistry();
  for (const tool of tools) registry.registerTool(tool);
  return { tools, schemas: registry.getToolSchemas() };
}

describe('工具 schema 无 undefined 值（D1 载荷合法性，2026-09-25）', () => {
  it('真实工具集：getToolSchemas() 深扫无 undefined（修复前必失败）', () => {
    const { tools, schemas } = buildRealSchemas();

    // 防空跑：真实工具池非空，否则本用例会"空即通过"
    expect(tools.length).toBeGreaterThan(10);
    expect(schemas).toHaveLength(tools.length);

    expect(findUndefinedPath(schemas)).toBeNull();
  });

  it('约定：声明缺省的可选字段不出现键（修复前键存在且值为 undefined）', () => {
    const { tools, schemas } = buildRealSchemas();
    const byName = new Map(schemas.map((s) => [s.name, s]));
    let checkedParams = 0;
    let checkedAliases = 0;

    for (const tool of tools) {
      const info = tool.getInfo();
      const schema = byName.get(info.name);
      if (!schema) continue;

      const props = schema.input_schema.properties as Record<
        string,
        Record<string, unknown>
      >;
      for (const param of info.params ?? []) {
        // 只有"未声明默认值"的参数才用于锁约定（有值字段由下一用例保护）
        if (param.default !== undefined) continue;
        const prop = props[param.name];
        if (!prop) continue;
        checkedParams++;
        expect(Object.prototype.hasOwnProperty.call(prop, 'default')).toBe(
          false
        );
      }

      if (info.aliases === undefined) {
        checkedAliases++;
        expect(Object.prototype.hasOwnProperty.call(schema, 'aliases')).toBe(
          false
        );
      }
    }

    // 防空跑：真实工具集里确实存在"无默认值参数 / 无 aliases"的工具
    expect(checkedParams).toBeGreaterThan(0);
    expect(checkedAliases).toBeGreaterThan(0);
  });

  it('有值字段不被误删：声明了默认值的参数仍带该值', () => {
    const { tools, schemas } = buildRealSchemas();
    const byName = new Map(schemas.map((s) => [s.name, s]));
    let checked = 0;

    for (const tool of tools) {
      const info = tool.getInfo();
      const schema = byName.get(info.name);
      if (!schema) continue;
      const props = schema.input_schema.properties as Record<
        string,
        Record<string, unknown>
      >;
      for (const param of info.params ?? []) {
        if (param.default === undefined) continue;
        const prop = props[param.name];
        if (!prop) continue;
        checked++;
        expect(Object.prototype.hasOwnProperty.call(prop, 'default')).toBe(
          true
        );
        // 仅对可比较的字面量做等值断言（对象/函数型默认值只断言"键在"）
        const t = typeof param.default;
        if (t === 'string' || t === 'number' || t === 'boolean') {
          expect(prop.default).toEqual(param.default);
        }
      }
    }

    // 防空跑：真实工具集里确实存在"有默认值参数"
    expect(checked).toBeGreaterThan(0);
  });
});
