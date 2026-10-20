// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D5（2026-10-11 用户裁定「采纳 · 渐进棘轮」）—— 工具能力/风险派生测试。
 *
 * 覆盖：
 * ① 纯函数 `deriveFromLegacyEffects()` 的派生口径（复用既有元数据，零新字段强制）；
 * ② `BaseTool.getCapability()` / `getInfo().capability` 集成；
 * ③ `lint:tool-schema` 判据 `findToolsMissingCapability()` 的**负向夹具自证**（门禁非恒真）。
 */
import { describe, expect, it } from 'bun:test';

import { deriveFromLegacyEffects } from '../../src/tools/toolCapability';
import { BaseTool } from '../../src/tools/BaseTool';
import { WebFetchTool } from '../../src/tools/WebFetchTool/WebFetchTool';
import { findToolsMissingCapability } from '../../scripts/lint-tool-schema';

const NONE = { idempotent: true, sideEffect: 'none' } as const;
const LOCAL = { idempotent: false, sideEffect: 'local' } as const;
const EXTERNAL = { idempotent: false, sideEffect: 'external' } as const;

describe('D5 deriveFromLegacyEffects（纯函数）', () => {
  it('sideEffect=none（只读）⇒ read / low / readonly', () => {
    expect(deriveFromLegacyEffects({ effect: NONE, isReadOnly: true })).toEqual(
      {
        capability: 'read',
        risk: 'low',
        sandbox: 'readonly',
      }
    );
  });

  it('sideEffect=local ⇒ write-local / medium / none', () => {
    expect(
      deriveFromLegacyEffects({ effect: LOCAL, isReadOnly: false })
    ).toEqual({ capability: 'write-local', risk: 'medium', sandbox: 'none' });
  });

  it('sideEffect=external ⇒ write-external / high / none', () => {
    expect(
      deriveFromLegacyEffects({ effect: EXTERNAL, isReadOnly: false })
    ).toEqual({ capability: 'write-external', risk: 'high', sandbox: 'none' });
  });

  it('isDestructive ⇒ 风险至少 high（即便 effect=local）', () => {
    expect(
      deriveFromLegacyEffects({
        effect: LOCAL,
        isReadOnly: false,
        isDestructive: true,
      }).risk
    ).toBe('high');
  });

  it('未声明（MCP/插件）：只读 ⇒ read；非只读 ⇒ write-external/high（保守）', () => {
    expect(deriveFromLegacyEffects({ isReadOnly: true }).capability).toBe(
      'read'
    );
    expect(deriveFromLegacyEffects({ isReadOnly: false })).toEqual({
      capability: 'write-external',
      risk: 'high',
      sandbox: 'none',
    });
  });

  it('executesCode=true ⇒ execute / high / execution（覆盖 effect 推断）', () => {
    expect(
      deriveFromLegacyEffects({
        effect: NONE,
        isReadOnly: false,
        executesCode: true,
      })
    ).toEqual({ capability: 'execute', risk: 'high', sandbox: 'execution' });
  });

  it('显式 sandboxLevel 优先于派生值', () => {
    expect(
      deriveFromLegacyEffects({
        effect: NONE,
        isReadOnly: true,
        sandboxLevel: 'file-io',
      }).sandbox
    ).toBe('file-io');
  });

  it('tags 含 write ⇒ 风险至少 medium', () => {
    expect(
      deriveFromLegacyEffects({
        effect: undefined,
        isReadOnly: true, // 只读 ⇒ 本来 low
        tags: ['write'] as never,
      }).risk
    ).toBe('medium');
  });
});

describe('D5 BaseTool 集成', () => {
  it('getInfo().capability == getCapability()（可观测）', () => {
    const tool = new WebFetchTool();
    expect(tool.getInfo().capability).toEqual(tool.getCapability());
  });

  it('只读网络工具（web_fetch, sideEffect=none）⇒ read / low', () => {
    const cap = new WebFetchTool().getCapability();
    expect(cap.capability).toBe('read');
    expect(cap.risk).toBe('low');
  });

  it('sandboxLevel=execution ⇒ capability=execute / risk=high / sandbox=execution', () => {
    class FakeExecTool extends BaseTool<unknown, unknown> {
      name = 'bash';
      description = 'fixture';
      params: [] = [];
      override sandboxLevel: 'execution' = 'execution';
      async execute(): Promise<never> {
        throw new Error('not used');
      }
    }
    expect(new FakeExecTool().getCapability()).toEqual({
      capability: 'execute',
      risk: 'high',
      sandbox: 'execution',
    });
  });
});

describe('D5 lint:tool-schema 判据（负向夹具自证）', () => {
  it('缺显式声明的工具类被判出；已覆盖 getCapability() 者与"非工具类"不判出', () => {
    const fixture = [
      // 工具类，缺显式声明（且不在 TOOL_EFFECTS）⇒ 应判出
      {
        file: 'a.ts',
        text: `class A extends BaseTool { name = 'fixture_unregistered'; }`,
      },
      // 工具类，已覆盖 getCapability() ⇒ 不判出
      {
        file: 'b.ts',
        text: `class B extends BaseTool { name = TOOL_NAME_CONSTANTS.file_read; getCapability() { return {}; } }`,
      },
      // 非工具类（未继承 BaseTool）⇒ 不参与统计
      { file: 'c.ts', text: `class C { name = 'x'; }` },
    ];
    const { missing, total } = findToolsMissingCapability(fixture);
    expect(total).toBe(2);
    expect(missing.map((m) => m.name)).toEqual(['fixture_unregistered']);
  });

  it('常量为键名（TOOL_NAME_CONSTANTS.x）⇒ 解析为真实工具名', () => {
    // 注入空的效果表：确保这里测的是"名字解析"，而非 TOOL_EFFECTS 豁免
    const { missing } = findToolsMissingCapability(
      [
        {
          file: 'd.ts',
          text: `class D extends BaseTool { name = TOOL_NAME_CONSTANTS.web_search; }`,
        },
      ],
      new Set()
    );
    expect(missing.map((m) => m.name)).toEqual(['web_search']);
  });

  /**
   * U-03（2026-10-20 用户裁定）：`extends BaseTool` 的 `idempotent` / `sideEffect` 由
   * `TOOL_EFFECTS`（编译期穷举）唯一声明 ⇒ 有条目即视为已声明；`implements Tool` 无基类
   * 派生，不享受该豁免。
   */
  it('extends BaseTool 且有 TOOL_EFFECTS 条目 ⇒ 视为已声明；implements Tool 不豁免', () => {
    const { missing, total } = findToolsMissingCapability([
      {
        file: 'j.ts',
        text: `class J extends BaseTool { name = 'clipboard'; }`,
      },
      {
        file: 'k.ts',
        text: `class K implements Tool { name = 'clipboard'; }`,
      },
    ]);
    expect(total).toBe(2);
    expect(missing.map((m) => m.name)).toEqual(['clipboard']);
  });

  /**
   * U-03（2026-10-19）：`implements Tool` 类（knowledge/voice/memory/适配器）此前**完全不在**
   * 门禁视野内；现纳入统计，并识别 `name: string = '…'` 这种带类型标注的写法。
   */
  it('implements Tool 也纳入统计；显式 sideEffect 视为已声明', () => {
    const { missing, total } = findToolsMissingCapability([
      {
        file: 'e.ts',
        text: `class E implements Tool { public name: string = 'knowledge_search'; }`,
      },
      {
        file: 'f.ts',
        text: `class F implements Tool { name = 'knowledge_write'; getInfo() { return { sideEffect: 'local' }; } }`,
      },
      // 非工具类（无 extends/implements）⇒ 不参与统计
      { file: 'g.ts', text: `class G { name = 'not_a_tool'; }` },
    ]);
    expect(total).toBe(2);
    expect(missing.map((m) => m.name)).toEqual(['knowledge_search']);
  });

  /**
   * U-03（2026-10-20）：`extends BaseTool` 的显式声明是**字段初始化器**写法
   * （`override sandboxLevel = 'execution' as const`），原判据只认 `:` ⇒ `bash` /
   * `powershell` / `code_run` 被误判为缺声明。此处钉死 `=` 写法同样算显式声明。
   */
  it('字段初始化器（`sandboxLevel = …`）视为已声明', () => {
    const { missing, total } = findToolsMissingCapability([
      {
        file: 'h.ts',
        text: `class H extends BaseTool { name = 'fixture_exec'; override sandboxLevel = 'execution' as const; }`,
      },
      {
        file: 'i.ts',
        text: `class I extends BaseTool { name = 'fixture_shell'; override sandboxLevel: 'execution' = 'execution'; }`,
      },
    ]);
    expect(total).toBe(2);
    expect(missing).toEqual([]);
  });
});
