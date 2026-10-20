/**
 * U-02（2026-10-20）：AlwaysOn 最小可用自主执行 —— 纯函数 / 桥接器 / 启动接线回归。
 *
 * 覆盖：
 * ① `parseAlwaysOnPlan()` 的 fail-closed 口径（高风险、坏 JSON、坏动作类型一律拒绝）；
 * ② `createAlwaysOnBridge()` 的四阶段（discovery → workspace → execution → report）；
 * ③ `bootstrapAlwaysOn()` 的开关语义（关 ⇒ 零注册；开 ⇒ 注册 + 启动；路径缺失跳过）。
 */
import { describe, expect, it } from 'bun:test';

import {
  extractJsonObject,
  parseAlwaysOnPlan,
} from '../../../src/tasks/alwayson/planParser';
import {
  buildDiscoveryPrompt,
  buildExecutionPrompt,
  createAlwaysOnBridge,
} from '../../../src/tasks/alwayson/AlwaysOnBridge';
import { bootstrapAlwaysOn } from '../../../src/tasks/alwayson/AlwaysOnBootstrap';
import type { AlwaysOnManager } from '../../../src/tasks/alwayson/AlwaysOnManager';
import type { DiscoveryPlan } from '../../../src/tasks/alwayson/types';

const PLAN_JSON = JSON.stringify({
  summary: '补一个缺失的单测',
  actions: [{ type: 'inspect', description: '查看 xxx 模块' }],
  riskLevel: 'low',
});

describe('U-02 parseAlwaysOnPlan（fail-closed）', () => {
  it('合法 JSON（含代码围栏/前后说明）⇒ 解析成功', () => {
    const plan = parseAlwaysOnPlan(
      `说明文字\n\`\`\`json\n${PLAN_JSON}\n\`\`\`\n结束`,
      'p1'
    );
    expect(plan).not.toBeNull();
    expect(plan!.id).toBe('p1');
    expect(plan!.actions).toHaveLength(1);
    expect(plan!.riskLevel).toBe('low');
  });

  it('riskLevel=high ⇒ 拒绝（不执行高风险计划）', () => {
    const text = JSON.stringify({
      summary: 's',
      actions: [{ type: 'fix', description: 'd' }],
      riskLevel: 'high',
    });
    expect(parseAlwaysOnPlan(text, 'p')).toBeNull();
  });

  it('非 JSON / 缺字段 / 空 actions / 未知动作类型 ⇒ 一律拒绝', () => {
    expect(parseAlwaysOnPlan('no json here', 'p')).toBeNull();
    expect(
      parseAlwaysOnPlan(JSON.stringify({ summary: '', actions: [] }), 'p')
    ).toBeNull();
    expect(
      parseAlwaysOnPlan(
        JSON.stringify({ summary: 's', actions: [], riskLevel: 'low' }),
        'p'
      )
    ).toBeNull();
    expect(
      parseAlwaysOnPlan(
        JSON.stringify({
          summary: 's',
          actions: [{ type: 'deploy', description: 'd' }],
          riskLevel: 'low',
        }),
        'p'
      )
    ).toBeNull();
  });

  it('extractJsonObject：无对象 ⇒ null；正常对象可解析', () => {
    expect(extractJsonObject('nothing')).toBeNull();
    expect(extractJsonObject('[1,2]')).toBeNull();
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('U-02 AlwaysOnBridge 四阶段', () => {
  const plan: DiscoveryPlan = {
    id: 'p1',
    summary: 's',
    actions: [{ type: 'inspect', description: 'd', params: {} }],
    riskLevel: 'low',
  };

  function makeBridge(options?: {
    prompt?: () => string;
    maxToolCalls?: number;
    timeoutMinutes?: number;
  }) {
    const sessions: string[] = [];
    const reports: Array<{ planId: string; markdown: string }> = [];
    let toolCallHook:
      | ((phase: 'start' | 'end', name: string) => void)
      | undefined;

    const bridge = createAlwaysOnBridge({
      projectId: 'proj-1',
      projectName: 'demo',
      projectPath: '/tmp/demo',
      limits: {
        maxToolCalls: options?.maxToolCalls ?? 5,
        timeoutMinutes: options?.timeoutMinutes ?? 1,
      },
      createSession: async () => {
        sessions.push('s1');
        return 's1';
      },
      sendPrompt: async (_sid, prompt, hooks) => {
        toolCallHook = hooks.onToolCall;
        // 模拟两次工具调用 + 一次用量
        hooks.onToolCall?.('start', 'grep');
        hooks.onToolCall?.('end', 'grep');
        hooks.onToolCall?.('start', 'file_edit');
        hooks.onUsage?.({ totalTokens: 42, estimatedCostUsd: 0.01 });
        return options?.prompt
          ? options.prompt()
          : prompt.includes('发现阶段')
            ? PLAN_JSON
            : 'done';
      },
      writeReport: async (planId, markdown) => {
        reports.push({ planId, markdown });
        return `/reports/${planId}.md`;
      },
    });
    return { bridge, sessions, reports, getHook: () => toolCallHook };
  }

  it('discovery：解析出计划；会话只建一次', async () => {
    const { bridge, sessions } = makeBridge();
    const discovered = await bridge.discovery();
    await bridge.report({
      success: true,
      output: 'x',
      errors: [],
      toolCalls: 0,
      durationMs: 1,
    });
    expect(discovered).not.toBeNull();
    expect(sessions).toHaveLength(1);
  });

  it('execution：统计工具调用次数 / token，并生成报告文本', async () => {
    const { bridge, reports } = makeBridge();
    await bridge.discovery();
    const workspace = await bridge.workspace(
      (await bridge.discovery()) ?? plan
    );
    const result = await bridge.execution(workspace);

    expect(workspace).toBe('/tmp/demo');
    expect(result.toolCalls).toBe(2);
    expect(result.success).toBe(true);

    const markdown = await bridge.report(result);
    expect(markdown).toContain('Tool Calls');
    expect(reports).toHaveLength(1);
    expect(reports[0]!.planId.startsWith('alwayson-proj-1-')).toBe(true);
  });

  it('execution：工具调用超预算 ⇒ 失败并记 `maxToolCalls exceeded`', async () => {
    const { bridge } = makeBridge({ maxToolCalls: 1 });
    await bridge.discovery();
    const result = await bridge.execution('/tmp/demo');
    expect(result.success).toBe(false);
    expect(result.errors.join()).toContain('maxToolCalls');
  });

  it('execution：无计划 ⇒ 直接失败（不臆造）', async () => {
    const { bridge } = makeBridge();
    const result = await bridge.execution('/tmp/demo');
    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['missing-plan']);
  });

  it('prompt 注入预算与项目路径', () => {
    expect(buildDiscoveryPrompt('demo', '/tmp/demo')).toContain('只读');
    expect(
      buildExecutionPrompt('/tmp/demo', plan, {
        maxToolCalls: 7,
        timeoutMinutes: 3,
      })
    ).toContain('7 次工具调用');
  });
});

describe('U-02 bootstrapAlwaysOn（开关语义）', () => {
  function makeManager() {
    const calls = { registered: [] as string[], started: 0, stopped: 0 };
    const manager = {
      registerProject: (id: string) => {
        calls.registered.push(id);
        return {
          gates: { setEnabled: () => {} },
          setDiscoveryFn: () => {},
          setWorkspaceFn: () => {},
          setExecutionFn: () => {},
          setReportFn: () => {},
        };
      },
      start: () => {
        calls.started += 1;
      },
      stop: () => {
        calls.stopped += 1;
      },
    } as unknown as AlwaysOnManager;
    return { manager, calls };
  }

  const bridge = {
    discovery: async () => null,
    workspace: async () => '',
    execution: async () => ({
      success: true,
      output: '',
      errors: [],
      toolCalls: 0,
      durationMs: 0,
    }),
    report: async () => '',
  };

  it('关闭 ⇒ 零注册、不启动', () => {
    const { manager, calls } = makeManager();
    const result = bootstrapAlwaysOn({
      enabled: false,
      projects: [{ id: 'p1', name: 'n', path: '/tmp/demo' }],
      manager,
      createBridge: () => bridge,
      pathExists: () => true,
    });
    expect(result.registered).toEqual([]);
    expect(result.started).toBe(false);
    expect(typeof result.teardown).toBe('function');
    expect(calls.registered).toEqual([]);
    expect(calls.started).toBe(0);
  });

  it('开启 + 路径存在 ⇒ 注册并启动；teardown 会 stop', () => {
    const { manager, calls } = makeManager();
    const result = bootstrapAlwaysOn({
      enabled: true,
      projects: [{ id: 'p1', name: 'n', path: '/tmp/demo' }],
      manager,
      createBridge: () => bridge,
      pathExists: () => true,
    });
    expect(result.registered).toEqual(['p1']);
    expect(result.started).toBe(true);
    expect(calls.started).toBe(1);

    result.teardown();
    expect(calls.stopped).toBe(1);
  });

  it('路径缺失 ⇒ 跳过该项目（无注册、不启动）', () => {
    const { manager, calls } = makeManager();
    const result = bootstrapAlwaysOn({
      enabled: true,
      projects: [
        { id: 'p1', name: 'n', path: '/missing' },
        { id: 'p2', name: 'm', path: '' },
      ],
      manager,
      createBridge: () => bridge,
      pathExists: () => false,
    });
    expect(result.registered).toEqual([]);
    expect(result.started).toBe(false);
    expect(calls.started).toBe(0);
  });
});
