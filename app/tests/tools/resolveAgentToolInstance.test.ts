/**
 * R6（2026-09-22）：AgentTool 真身解析（穿透 `ToolLazyWrapper`）
 *
 * 病根：`getToolManager().getTool('Agent')` 返回 `ToolLazyWrapper`
 * （`implements Tool`，**非 extends**）⇒ 三处入口的 `tool instanceof AgentTool` **恒为 false**
 * ⇒ `GET /v1/agents/control`、`POST /v1/agents/:id/stop|pause` 全量 503，
 * `AgentTool.stopAgent`（含批次级取消 R1）的修复代码一行都不会被执行。
 *
 * 本文件锁定四件事：
 *  ① **病根可复现**：包装器既非 `AgentTool` 实例，也不代理契约方法；
 *  ② `unwrap()` 能拿到真身（未加载时**同步加载**；异步工厂/加载中 ⇒ `null` 而非假真身）；
 *  ③ `LazyModuleLoader.loadSync()` 不并发造实例（工具工厂多为"每次 new"）；
 *  ④ `resolveAgentToolInstance()` 用**能力判定**认领，且解析失败 fail-closed 为 `null`。
 */
import { describe, test, expect } from 'bun:test';
import { LazyModuleLoader } from '../../src/core/utils/LazyModuleLoader';
import { ToolLazyWrapper } from '../../src/tools/utils/ToolLazyWrapper';
import { AgentTool } from '../../src/tools/AgentTool/AgentTool';
import { resolveAgentToolInstance } from '../../src/tools/utils/resolveAgentToolInstance';
import type { Tool, ToolInfo } from '../../src/tools/types/Tool';

/** 最小 ToolInfo（仅本测试用到的字段） */
function metadata(name: string): ToolInfo {
  return {
    name,
    description: `${name} tool`,
    params: [],
  } as unknown as ToolInfo;
}

/** 具备控制面契约的假工具（鸭子类型判据：stopAgent + getActiveAgents） */
function agentToolLike(label: string): Record<string, unknown> {
  return {
    name: 'Agent',
    label,
    stopAgent: () => true,
    getActiveAgents: () => [],
  };
}

describe('R6：病根复现（包装器既非实例、也不代理契约方法）', () => {
  test('ToolLazyWrapper 不是 AgentTool 实例，且不代理 stopAgent/getActiveAgents', () => {
    const real = agentToolLike('real');
    const wrapper = new ToolLazyWrapper(
      metadata('Agent'),
      new LazyModuleLoader<Tool>(() => real as unknown as Tool)
    );

    // ① 原判据（继承判定）恒 false
    expect(wrapper instanceof AgentTool).toBe(false);
    // ② 直接鸭子类型也失败（包装器不透传任意方法）⇒ 必须先解包
    const asRecord = wrapper as unknown as Record<string, unknown>;
    expect(typeof asRecord.stopAgent).toBe('undefined');
    expect(typeof asRecord.getActiveAgents).toBe('undefined');
    // ③ 解包后能力判定成立
    expect(typeof (wrapper.unwrap() as unknown as Record<string, unknown>).stopAgent).toBe(
      'function'
    );
  });
});

describe('R6：ToolLazyWrapper.unwrap / LazyModuleLoader.loadSync', () => {
  test('未加载 + 同步工厂 ⇒ 同步加载并返回真身；后续 get() 复用同一实例', async () => {
    let created = 0;
    const real = agentToolLike('sync');
    const loader = new LazyModuleLoader<Tool>(() => {
      created++;
      return real as unknown as Tool;
    });
    const wrapper = new ToolLazyWrapper(metadata('Agent'), loader);

    expect(loader.isLoaded()).toBe(false);
    expect(wrapper.unwrap()).toBe(real as unknown as Tool);
    expect(loader.isLoaded()).toBe(true);
    // 关键：不再二次造实例（工具工厂多为"每次 new 新对象"）
    expect(await loader.get()).toBe(real as unknown as Tool);
    expect(created).toBe(1);
  });

  test('已加载 ⇒ unwrap 与 getSync 返回同一对象', async () => {
    const real = agentToolLike('loaded');
    const loader = new LazyModuleLoader<Tool>(() => real as unknown as Tool);
    await loader.get();
    const wrapper = new ToolLazyWrapper(metadata('Agent'), loader);

    expect(wrapper.unwrap()).toBe(loader.getSync());
  });

  test('异步工厂 ⇒ unwrap 返回 null（明确信号，不返回假真身）', async () => {
    const loader = new LazyModuleLoader<Tool>(
      async () => agentToolLike('async') as unknown as Tool
    );
    const wrapper = new ToolLazyWrapper(metadata('Agent'), loader);

    expect(wrapper.unwrap()).toBeNull();
  });

  test('异步加载进行中 ⇒ loadSync 抛错、unwrap 返回 null（防并发造两实例）', async () => {
    const loader = new LazyModuleLoader<Tool>(
      () => new Promise<Tool>(() => {}) // 永不 resolve：稳定停在"加载中"
    );
    const wrapper = new ToolLazyWrapper(metadata('Agent'), loader);

    void loader.get(); // 启动异步加载（同步段已置 loading=true）
    expect(() => loader.loadSync()).toThrow(/异步加载进行中/);
    expect(wrapper.unwrap()).toBeNull();
  });

  test('loadSync 幂等：重复调用不再执行工厂', () => {
    let created = 0;
    const loader = new LazyModuleLoader<Tool>(() => {
      created++;
      return agentToolLike('idem') as unknown as Tool;
    });
    const first = loader.loadSync();
    const second = loader.loadSync();
    expect(second).toBe(first);
    expect(created).toBe(1);
  });
});

describe('R6：resolveAgentToolInstance（能力判定 + fail-closed）', () => {
  test('解析结果具备契约 ⇒ 认领', () => {
    const tool = agentToolLike('ok');
    expect(resolveAgentToolInstance(() => tool)).toBe(tool as unknown as AgentTool);
  });

  test('解析结果仍是包装器（无契约方法）⇒ null（不误认领）', () => {
    const wrapper = new ToolLazyWrapper(
      metadata('Agent'),
      new LazyModuleLoader<Tool>(() => agentToolLike('wrapped') as unknown as Tool)
    );
    expect(resolveAgentToolInstance(() => wrapper)).toBeNull();
  });

  test('未注册（undefined/null）⇒ null', () => {
    expect(resolveAgentToolInstance(() => undefined)).toBeNull();
    expect(resolveAgentToolInstance(() => null)).toBeNull();
  });

  test('解析入口抛错 ⇒ 不被向上抛（降级为 null）', () => {
    expect(
      resolveAgentToolInstance(() => {
        throw new Error('tool manager not ready');
      })
    ).toBeNull();
  });
});
