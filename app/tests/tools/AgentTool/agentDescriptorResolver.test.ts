/**
 * Agent 描述符解析链测试（多 agent 协作方案 O11 + T7）
 *
 * 锁定四级回退与 fail-closed 语义：
 * ① DB 角色（三态：命中 / 被禁用 / 不存在）→ ② 运行时注册表 → ③ 内置类型 → ④ **显式拒绝**
 * 以及 O11-1 的两段校验（先存在性、再启用位）。
 *
 * T7：启用判定的**实现在存储层** ⇒ 本测试的 `getRole` 桩直接给三态（`ok`/`disabled`/`missing`）。
 */
import { describe, test, expect } from 'bun:test';
import {
  resolveAgentDescriptor,
  type AgentDescriptorDeps,
} from '../../../src/tools/AgentTool/AgentDescriptorResolver';

const BUILTINS = ['general', 'explore', 'plan', 'verification'];

function makeDeps(
  over: Partial<AgentDescriptorDeps> = {}
): AgentDescriptorDeps {
  return {
    getRole: async () => ({ state: 'missing' }),
    getRegistered: () => null,
    builtinTypeNames: BUILTINS,
    ...over,
  };
}

describe('resolveAgentDescriptor：四级回退（O11）', () => {
  test('未指定 subagent_type ⇒ 沿用基准提示词（source=default）', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: undefined,
      baseSystemPrompt: 'BASE',
      deps: makeDeps(),
    });

    expect(result).toEqual({
      ok: true,
      source: 'default',
      systemPrompt: 'BASE',
    });
  });

  test('① DB 角色命中（enabled）⇒ 用其 systemPrompt 与 model', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'architect',
      baseSystemPrompt: 'BASE',
      deps: makeDeps({
        getRole: async () => ({
          state: 'ok',
          role: { agentId: 'architect', systemPrompt: 'ARCH', model: 'm-1' },
        }),
      }),
    });

    expect(result).toEqual({
      ok: true,
      source: 'role-store',
      systemPrompt: 'ARCH',
      model: 'm-1',
      // T9：未授权的角色恒为 false（该用例角色未设 canDelegate）
      canDelegate: false,
    });
  });

  test('① DB 角色存在但 systemPrompt 为空 ⇒ 回退基准提示词（来源仍为 role-store）', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'architect',
      baseSystemPrompt: 'BASE',
      deps: makeDeps({
        getRole: async () => ({
          state: 'ok',
          role: { agentId: 'architect', systemPrompt: '' },
        }),
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.source).toBe('role-store');
    expect(result.ok && result.systemPrompt).toBe('BASE');
  });

  test('② DB 无、注册表命中 ⇒ source=registry', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'plugin-agent',
      baseSystemPrompt: 'BASE',
      deps: makeDeps({
        getRegistered: (key, raw) =>
          key === 'plugin-agent' || raw === 'plugin-agent'
            ? { name: 'plugin-agent', systemPrompt: 'PLUGIN' }
            : null,
      }),
    });

    expect(result.ok && result.source).toBe('registry');
    expect(result.ok && result.systemPrompt).toBe('PLUGIN');
  });

  test('③ DB/注册表均无、名称为内置类型 ⇒ source=builtin（用基准提示词）', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'explore',
      baseSystemPrompt: 'BUILTIN_EXPLORE',
      deps: makeDeps(),
    });

    expect(result.ok && result.source).toBe('builtin');
    expect(result.ok && result.systemPrompt).toBe('BUILTIN_EXPLORE');
  });

  test('大小写与首尾空白归一（"  Architect " ⇒ architect）', async () => {
    let seenKey = '';
    await resolveAgentDescriptor({
      subagentType: '  Architect ',
      baseSystemPrompt: 'BASE',
      deps: makeDeps({
        getRole: async (key) => {
          seenKey = key;
          return { state: 'missing' };
        },
      }),
    });

    expect(seenKey).toBe('architect');
  });
});

describe('resolveAgentDescriptor：fail-closed（O11-1）', () => {
  test('DB 角色被禁用 ⇒ **显式拒绝**（不回退默认提示词）', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'architect',
      baseSystemPrompt: 'BASE',
      deps: makeDeps({
        getRole: async () => ({ state: 'disabled' }),
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('已被禁用');
  });

  test('未知名称 ⇒ 显式拒绝，且错误里给出可用名单（不再静默降级）', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'no-such-agent',
      baseSystemPrompt: 'BASE',
      deps: makeDeps(),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(
      '未知的 subagent_type'
    );
    expect(result.ok === false && result.error).toContain('verification');
  });

  test('层级短路：①命中后不再查②③（getRegistered 不被调用）', async () => {
    let registeredCalled = false;
    const result = await resolveAgentDescriptor({
      subagentType: 'architect',
      baseSystemPrompt: 'BASE',
      deps: makeDeps({
        getRole: async () => ({
          state: 'ok',
          role: { agentId: 'architect', systemPrompt: 'ARCH' },
        }),
        getRegistered: () => {
          registeredCalled = true;
          return null;
        },
      }),
    });

    expect(result.ok && result.source).toBe('role-store');
    expect(registeredCalled).toBe(false);
  });
});

describe('resolveAgentDescriptor：委派授权位（T9）', () => {
  test('DB 角色授权的 ⇒ 解析结果携带 canDelegate=true', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'architect',
      baseSystemPrompt: 'BASE',
      deps: makeDeps({
        getRole: async () => ({
          state: 'ok',
          role: {
            agentId: 'architect',
            systemPrompt: 'ARCH',
            canDelegate: true,
          },
        }),
      }),
    });

    expect(result.ok && result.canDelegate).toBe(true);
  });

  test('角色未授权（字段缺省）⇒ canDelegate=false（fail-closed）', async () => {
    const result = await resolveAgentDescriptor({
      subagentType: 'architect',
      baseSystemPrompt: 'BASE',
      deps: makeDeps({
        getRole: async () => ({
          state: 'ok',
          role: { agentId: 'architect', systemPrompt: 'ARCH' },
        }),
      }),
    });

    expect(result.ok && result.canDelegate).toBe(false);
  });

  test('② 运行时注册 / ③ 内置类型 ⇒ 不携带授权（模型无法自行声明）', async () => {
    const viaBuiltin = await resolveAgentDescriptor({
      subagentType: 'explore',
      baseSystemPrompt: 'BUILTIN_EXPLORE',
      deps: makeDeps(),
    });
    expect(viaBuiltin.ok && viaBuiltin.canDelegate).toBeUndefined();

    const viaRegistry = await resolveAgentDescriptor({
      subagentType: 'plugin-agent',
      baseSystemPrompt: 'BASE',
      deps: makeDeps({
        getRegistered: () => ({ name: 'plugin-agent', systemPrompt: 'P' }),
      }),
    });
    expect(viaRegistry.ok && viaRegistry.canDelegate).toBeUndefined();
  });
});
