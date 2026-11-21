/**
 * 插件工具契约：类别 / 风险 / 只读的**映射与安全默认**（C3，2026-11-21；方案 v3 §14.3 / D6）
 *
 * 断言：
 * - 未声明 ⇒ 类别 `plugin`（**可见**的安全默认）、风险未声明（`undeclared` ⇒ 每次审批）；
 * - 声明值经校验透传（非法类别 / 非法风险一律丢弃，不让声明笔误放宽权限）；
 * - `buildRegisteredTool` 把 `riskClass` / `isReadOnly` 透传给 `Tool`（风险引擎无需改动）。
 */
import { describe, expect, it } from 'bun:test';

import {
  buildRegisteredTool,
  toRuntimeToolMeta,
} from '../../src/plugins/utils/toolRegistration';
import type { PluginToolDeclaration } from '../../src/plugins/utils/toolRegistration';
import { deriveToolRiskClass } from '../../src/tools/toolRiskClass';

const decl = (
  extra: Partial<PluginToolDeclaration> = {}
): PluginToolDeclaration => ({
  name: 'demo_plugin_tool',
  description: 'demo',
  ...extra,
});

describe('插件工具声明 → 运行期元数据', () => {
  it('未声明 ⇒ category=plugin / pack=插件 id / 风险未声明 / 只读未声明', () => {
    const meta = toRuntimeToolMeta('my-plugin', decl());
    expect(meta).toEqual({ category: 'plugin', pack: 'my-plugin' });
  });

  it('合法类别 / 包 / 风险 / 只读原样透传', () => {
    const meta = toRuntimeToolMeta(
      'my-plugin',
      decl({ category: 'file', pack: 'p', riskClass: 'read', readOnly: true })
    );
    expect(meta).toEqual({
      category: 'file',
      pack: 'p',
      riskClass: 'read',
      readOnly: true,
    });
  });

  it('非法类别 / 非法风险 ⇒ 回安全默认（不因声明笔误放宽）', () => {
    const meta = toRuntimeToolMeta(
      'my-plugin',
      decl({ category: 'not-a-category', riskClass: 'yolo' as never })
    );
    expect(meta.category).toBe('plugin');
    expect(meta.riskClass).toBeUndefined();
  });
});

describe('buildRegisteredTool：风险 / 只读透传', () => {
  it('声明 riskClass ⇒ Tool.riskClass 生效（风险引擎首选项命中）', () => {
    const tool = buildRegisteredTool(
      decl({ riskClass: 'external' }),
      async () => 'ok'
    );
    expect(tool.riskClass).toBe('external');
    expect(deriveToolRiskClass(tool)).toBe('external');
  });

  it('未声明风险 ⇒ 判 undeclared（仍询问，不静默放行）', () => {
    const tool = buildRegisteredTool(decl(), async () => 'ok');
    expect(tool.riskClass).toBeUndefined();
    expect(deriveToolRiskClass(tool)).toBe('undeclared');
  });

  it('声明 readOnly ⇒ isReadOnly() 为 true', () => {
    const tool = buildRegisteredTool(
      decl({ readOnly: true }),
      async () => 'ok'
    );
    expect(tool.isReadOnly()).toBe(true);
    expect(deriveToolRiskClass(tool)).toBe('read');
  });

  it('执行结果包成 ToolResult（外部执行器契约不变）', async () => {
    const tool = buildRegisteredTool(decl(), async (input) => ({
      echo: input['v'],
    }));
    const result = await tool.execute(
      { v: 1 },
      {} as Parameters<typeof tool.execute>[1]
    );
    expect(JSON.stringify(result)).toContain('"echo"');
  });
});
