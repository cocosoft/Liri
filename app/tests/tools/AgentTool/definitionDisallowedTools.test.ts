/**
 * 定义侧 `disallowedTools` 生效守卫（只收窄，不扩权）—— 台账 **D-39 → D-46**
 *
 * 背景：内置 `VERIFICATION_AGENT_DEFINITION.disallowedTools` 与用户 `.md` 代理 / DB 角色的
 * 同名声明，此前**被解析但从未被消费**（D-39）。D-46 完成接线：
 * `resolveAgentDescriptor` 下发该字段 ⇒ `execute` → `runBackgroundPath`/`runForegroundPath`
 * → `runWithEngine` ⇒ `resolveDeniedTools(input.deniedTools, definitionDisallowedTools)`
 * ⇒ `filterToolPool`（**定义侧与执行侧同源**）⇒ 定义侧禁用项**真正生效**。
 *
 * 本文件锁三层，从内到外：
 *  · ① 解析链**下发**该字段（`AgentDescriptorResolver`）
 *  · ② 合取语义 `resolveDeniedTools`（并集，不覆盖、不扩权）
 *  · ③ **端到端**：描述符带的禁用项经 `execute` 后**真的**从子代理工具定义里消失
 *    （复用 `agentDelegationGrant.test.ts` 的 fake 引擎 harness：捕获实际下发的工具名）
 *
 * 端到端用例是**接线本身的守卫** —— 把 `runWithEngine` 里的合取去掉即变红。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  AgentTool,
  setAgentToolManager,
  filterToolPool,
  resolveDeniedTools,
} from '../../../src/tools/AgentTool/AgentTool';
import {
  resolveAgentDescriptor,
  type AgentDescriptorDeps,
} from '../../../src/tools/AgentTool/AgentDescriptorResolver';
import { VERIFICATION_AGENT_DEFINITION } from '../../../src/tools/AgentTool/strategies/VerificationStrategy';
import { ToolExecutionStatus } from '../../../src/tools/types/ToolResult';
import type { Tool } from '../../../src/tools/types/Tool';
// 漂移守卫判据：生成物（与 tests/tools/toolNameLists.test.ts 同一事实源）
import { TOOL_NAMES } from '../../../src/tools/toolNames.generated';

/** 最小可测工具（`buildToolDefinitions` 会读 `getInfo()`，故必须提供） */
function fakeTool(name: string): Tool {
  return {
    name,
    getInfo: () => ({ name, description: `${name} tool`, params: [] }),
  } as unknown as Tool;
}

/** 覆盖"读 + 三种直接写文件 + 定义侧已禁的两项"的池，用于断言各自的去留 */
const POOL_TOOL_NAMES = [
  'file_write',
  'file_edit',
  'write_project_file',
  'file_read',
  'agent',
  'notebook',
  'grep',
];
const POOL = POOL_TOOL_NAMES.map(fakeTool);

/**
 * 注入 fake 引擎，捕获"本子代理实际拿到哪些工具名"（与 agentDelegationGrant.test.ts 同法）。
 *
 * 同时捕获**执行侧**实例键（`toolInstances`）—— O7 要求"定义侧与执行侧同源"，
 * 只断言定义侧会漏掉"实例侧漏裁"的回归（D-48 swarm 用例需要两侧一起锁）。
 */
function installEngine(tool: AgentTool): {
  toolNames: string[];
  toolInstances: string[];
} {
  const capture = { toolNames: [] as string[], toolInstances: [] as string[] };
  Reflect.set(tool, 'engine', {
    execute: async (params: {
      tools?: Array<{ function?: { name?: string } }>;
      toolInstances?: Map<string, unknown>;
    }) => {
      capture.toolNames = (params.tools ?? []).map(
        (t) => t.function?.name ?? ''
      );
      capture.toolInstances = [...(params.toolInstances ?? new Map()).keys()];
      return { output: 'ok', completed: true, timedOut: false };
    },
    abort: () => true,
    ownerSessionId: () => undefined,
  });
  return capture;
}

describe('定义侧 disallowedTools：解析链下发 + 合取语义', () => {
  test('① 解析链：内置 verification 下发 disallowedTools', async () => {
    const deps: AgentDescriptorDeps = {
      getRole: async () => ({ state: 'missing' }),
      getRegistered: () => null,
      builtinTypeNames: ['verification'],
      getBuiltinDisallowedTools: (typeName) =>
        typeName === 'verification'
          ? VERIFICATION_AGENT_DEFINITION.disallowedTools
          : undefined,
    };

    const result = await resolveAgentDescriptor({
      subagentType: 'verification',
      baseSystemPrompt: 'x',
      deps,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('应解析成功');
    expect(result.source).toBe('builtin');
    expect(result.disallowedTools).toContain('file_write');
  });

  test('② 合取语义：resolveDeniedTools 并入两路且不覆盖', () => {
    expect(resolveDeniedTools(undefined, ['agent'])).toEqual(['agent']);
    expect(resolveDeniedTools(['x'], ['agent'])).toEqual(['x', 'agent']);
    expect(resolveDeniedTools(['x'], undefined)).toEqual(['x']);
  });

  test('③ 纯函数层：定义侧禁用项真的从池里裁掉，未禁用的不动', () => {
    const denied = resolveDeniedTools(
      undefined,
      VERIFICATION_AGENT_DEFINITION.disallowedTools
    );
    const names = filterToolPool(undefined, denied, POOL).map((t) => t.name);

    for (const t of ['agent', 'notebook', 'file_write', 'file_edit']) {
      expect(names).not.toContain(t);
    }
    expect(names).toContain('file_read');
    expect(names).toContain('grep');
  });
});

describe('端到端：描述符 disallowedTools 真正进入子代理工具池（D-46 接线守卫）', () => {
  beforeEach(() => {
    setAgentToolManager(() => POOL);
  });

  afterEach(() => {
    setAgentToolManager(() => []);
  });

  test('描述符带禁用集 ⇒ 子代理工具定义里**不含**写文件类工具，且不误伤只读工具', async () => {
    const tool = new AgentTool();
    const capture = installEngine(tool);
    // 只 stub 解析链的**返回**（字段来源已由 ① 单独覆盖）⇒ 本用例锁"下发后是否真被裁剪"
    Reflect.set(tool, 'resolveAgentDescriptor', async () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'VERIFICATION',
      disallowedTools: VERIFICATION_AGENT_DEFINITION.disallowedTools,
    }));

    const result = await tool.execute({
      description: '验证',
      prompt: '跑一遍验证',
      // 带 subagent_type ⇒ 走 runWithEngine（引擎入参可被捕获）
      subagent_type: 'verification',
    });
    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);

    // 提示词承诺 "CANNOT edit, write, or create files" ⇒ 直接写文件的三件工具必须消失
    expect(capture.toolNames).not.toContain('file_write');
    expect(capture.toolNames).not.toContain('file_edit');
    expect(capture.toolNames).not.toContain('write_project_file');
    // 定义侧原有两项
    expect(capture.toolNames).not.toContain('agent');
    expect(capture.toolNames).not.toContain('notebook');
    // 只读工具不受影响（裁剪只作用于黑名单）
    expect(capture.toolNames).toContain('file_read');
    expect(capture.toolNames).toContain('grep');
  });

  test('描述符**不带**禁用集 ⇒ 写文件类工具照旧可见（证明上面不是"池本来就空"）', async () => {
    const tool = new AgentTool();
    const capture = installEngine(tool);
    Reflect.set(tool, 'resolveAgentDescriptor', async () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'PLAIN',
    }));

    const result = await tool.execute({
      description: '普通',
      prompt: '做点事',
      subagent_type: 'verification',
    });
    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);

    expect(capture.toolNames).toContain('file_write');
    expect(capture.toolNames).toContain('file_read');
  });
});

describe('定义侧字段的契约（D-46）', () => {
  test('④ verification 的禁用集覆盖提示词承诺（write/edit/create）+ 全为真实注册名', () => {
    const disallowed = VERIFICATION_AGENT_DEFINITION.disallowedTools ?? [];
    // `VERIFICATION_CRITICAL_REMINDER` 明写 "CANNOT edit, write, or create files"
    expect(disallowed).toContain('agent');
    expect(disallowed).toContain('notebook');
    expect(disallowed).toContain('file_write');
    expect(disallowed).toContain('file_edit');
    expect(disallowed).toContain('write_project_file');
    // 漂移守卫（同 D-44 口径）：该字段**已生效** ⇒ 含非注册名等于写了也不命中
    const live = new Set<string>(TOOL_NAMES);
    expect(disallowed.filter((t) => !live.has(t))).toEqual([]);
  });
});

/**
 * D-48（2026-09-30）：**swarm 路径**接入定义侧 `disallowedTools`（只收窄）。
 *
 * 修复前 `SwarmTaskDescriptor` 不携带该字段 ⇒ 并行 worker **不受**自己角色声明的限制
 *（D-46 遗留的"swarm 未接"）。过滤点（`buildSwarmExecutor`）在 **per-task 闭包内**、
 * `resolved` 已按 taskKey 取到 ⇒ 按**每任务精确**裁剪（而非"全体并集"）。
 *
 * 本组走**真实 swarm 路径**：`execute({tasks:[...]})` → `AgentSwarm.run` → executor
 * → fake 引擎（捕获 worker 实际拿到的定义/实例）。断言该 task 的禁用项真的消失。
 */
describe('端到端：swarm 任务级 disallowedTools 真正生效（D-48 接线守卫）', () => {
  /** worker 类别池：`AgentSwarm` 硬编码注入 search + file_read ⇒ 命中 grep/glob/file_read */
  const SWARM_POOL = ['grep', 'glob', 'file_read', 'file_write'].map(fakeTool);

  beforeEach(() => {
    setAgentToolManager(() => SWARM_POOL);
  });

  afterEach(() => {
    setAgentToolManager(() => []);
  });

  test('worker 带定义侧禁用项 ⇒ 该项从**该 worker** 工具集消失，其余只读工具不受影响', async () => {
    const tool = new AgentTool();
    const capture = installEngine(tool);
    Reflect.set(tool, 'resolveAgentDescriptor', async () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'SWARM-ROLE',
      // 只禁 grep ⇒ 不应误伤同任务内的 glob / file_read
      disallowedTools: ['grep'],
    }));

    const result = await tool.execute({
      description: '并行',
      prompt: '总任务',
      tasks: [
        {
          description: '子任务 A',
          prompt: 'p1',
          subagent_type: 'verification',
        },
      ],
    });
    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);

    // 定义侧（注入模型的工具清单）与执行侧（实例）**同源**，都不得含被禁项
    expect(capture.toolNames).not.toContain('grep');
    expect(capture.toolInstances).not.toContain('grep');
    // 未被禁的只读工具照旧保留（证明裁剪只作用于黑名单，不是"池本来就空"）
    expect(capture.toolNames).toContain('glob');
    expect(capture.toolNames).toContain('file_read');
  });

  test('对照：worker **不带**禁用项 ⇒ grep 照旧可见', async () => {
    const tool = new AgentTool();
    const capture = installEngine(tool);
    Reflect.set(tool, 'resolveAgentDescriptor', async () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'SWARM-ROLE',
    }));

    const result = await tool.execute({
      description: '并行',
      prompt: '总任务',
      tasks: [
        {
          description: '子任务 A',
          prompt: 'p1',
          subagent_type: 'verification',
        },
      ],
    });
    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);

    expect(capture.toolNames).toContain('grep');
    expect(capture.toolInstances).toContain('grep');
  });
});
