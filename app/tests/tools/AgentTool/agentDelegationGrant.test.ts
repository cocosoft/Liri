/**
 * 子代理"能否再委派"的双判据（T9）
 *
 * 判据 = **角色策略**（DB `agent_roles.can_delegate`，由用户在「Agent 角色」页设置）
 * × **父侧深度上限**（`MAX_SUBAGENT_DEPTH`）。锁定四件事：
 * ① 角色被授权 ⇒ 委派入口（`Agent`）出现在子代理的**工具定义**中；
 * ② 角色未授权（字段缺省）⇒ 不出现（fail-closed）；
 * ③ `sessions_yield` **始终**不可继承（与授权无关，属语义防护）；
 * ④ 深度达上限 ⇒ 即使授权也不放行（`resolveDelegationGrant` 的双判据合取）。
 *
 * 说明：与其它 AgentTool 测试同法注入 fake 引擎（`Reflect.set`）与 fake 工具池
 * （`setAgentToolManager`，生产由 ToolManager 注入）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  AgentTool,
  setAgentToolManager,
} from '../../../src/tools/AgentTool/AgentTool';
import { ToolExecutionStatus } from '../../../src/tools/types/ToolResult';
import type { Tool } from '../../../src/tools/types/Tool';
import { getTaskConcurrencyLimits } from '../../../src/tasks/limits';

const MAX_DEPTH = getTaskConcurrencyLimits().subagentDepth;

function fakeTool(name: string): Tool {
  return {
    name,
    getInfo: () => ({ name, description: `${name} tool`, params: [] }),
  } as unknown as Tool;
}

interface EngineStubParams {
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ function?: { name?: string } }>;
}

/** 注入 fake 引擎，返回"本子代理实际拿到哪些工具名"的捕获对象 */
function installEngine(tool: AgentTool): { toolNames: string[] } {
  const capture = { toolNames: [] as string[] };
  Reflect.set(tool, 'engine', {
    execute: async (params: EngineStubParams) => {
      capture.toolNames = (params.tools ?? []).map(
        (t) => t.function?.name ?? ''
      );
      return { output: 'ok', completed: true, timedOut: false };
    },
    abort: () => true,
    ownerSessionId: () => undefined,
  });
  return capture;
}

/** 让解析链对任意 `subagent_type` 都返回"DB 角色（可按需授权委派）" */
function installResolver(tool: AgentTool, canDelegate: boolean): void {
  Reflect.set(tool, 'resolveAgentDescriptor', async () => ({
    ok: true,
    source: 'role-store',
    systemPrompt: 'ROLE',
    canDelegate,
  }));
}

async function runChild(tool: AgentTool): Promise<void> {
  const result = await tool.execute({
    description: '子代理',
    prompt: '做点事',
    // 带 `subagent_type` ⇒ 走 runWithEngine（非 directCall），引擎入参可被捕获
    subagent_type: 'architect',
  });
  expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
}

describe('T9：子代理委派授权（角色策略 × 深度）', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      ['grep', 'Agent', 'Task', 'sessions_yield'].map(fakeTool)
    );
  });

  afterEach(() => {
    setAgentToolManager(() => []);
  });

  test('角色被授权 ⇒ 委派入口对子代理可见；`sessions_yield` 仍被阻断', async () => {
    const tool = new AgentTool();
    const capture = installEngine(tool);
    installResolver(tool, true);

    await runChild(tool);

    expect(capture.toolNames).toContain('Agent');
    // 语义防护与授权无关：yield 恒不可继承
    expect(capture.toolNames).not.toContain('sessions_yield');
  });

  test('角色未授权（缺省）⇒ 委派入口不可见（fail-closed）', async () => {
    const tool = new AgentTool();
    const capture = installEngine(tool);
    installResolver(tool, false);

    await runChild(tool);

    expect(capture.toolNames).not.toContain('Agent');
    expect(capture.toolNames).not.toContain('Task');
    expect(capture.toolNames).not.toContain('sessions_yield');
    // 普通工具不受影响
    expect(capture.toolNames).toContain('grep');
  });

  test('深度达上限 ⇒ 即使授权也不放行（双判据合取）', () => {
    const tool = new AgentTool();
    const resolveGrant = Reflect.get(tool, 'resolveDelegationGrant') as (
      canDelegate: boolean | undefined,
      context?: { subagentDepth?: number }
    ) => boolean;

    // 授权 + 深度未达上限 ⇒ 放行
    expect(resolveGrant.call(tool, true, { subagentDepth: 0 })).toBe(true);
    expect(
      resolveGrant.call(tool, true, { subagentDepth: MAX_DEPTH - 1 })
    ).toBe(true);
    // 授权但深度达上限 ⇒ 拒绝（与 executeGuard 同源判据，避免"可见但必被拒"）
    expect(resolveGrant.call(tool, true, { subagentDepth: MAX_DEPTH })).toBe(
      false
    );
    // 未授权（含缺省）⇒ 恒拒绝
    expect(resolveGrant.call(tool, false, { subagentDepth: 0 })).toBe(false);
    expect(resolveGrant.call(tool, undefined, { subagentDepth: 0 })).toBe(false);
  });
});
