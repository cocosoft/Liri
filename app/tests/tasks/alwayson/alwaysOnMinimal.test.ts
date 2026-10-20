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
    savedSession?: string;
    hangOnExecution?: boolean;
    /** 模拟脏仓/非 git：prepareWorkspace 返回跳过原因 */
    skipWorkspace?: string;
    /** 模拟收尾结果（`patchPath: null` ⇒ 无改动） */
    patchPath?: string | null;
    /** 注入目标达成自评（缺省不注入 ⇒ 报告保持 `unverified（未做模型自评）`） */
    goal?: 'achieved' | 'not_achieved' | 'unknown' | 'throw';
    /** 隔离策略（缺省 git-worktree；snapshot-copy ⇒ 报告用 Diff / Snapshot Kept） */
    strategy?: 'git-worktree' | 'snapshot-copy';
  }) {
    const sessions: string[] = [];
    const reports: Array<{ planId: string; markdown: string }> = [];
    const notified: Array<{ planId: string; success: boolean; body?: string }> =
      [];
    const taskTypes: string[] = [];
    const cwdCalls: Array<{ sid: string; cwd: string }> = [];
    const goalEvalCalls: Array<{ sessionId: string; goalSummary: string }> = [];
    let savedSessionId: string | undefined;

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
      loadSession: async () => options?.savedSession,
      saveSession: async (_projectId, sessionId) => {
        savedSessionId = sessionId;
      },
      prepareWorkspace: async ({ runId }) =>
        options?.skipWorkspace
          ? { skippedReason: options.skipWorkspace }
          : {
              workspace: {
                cwd: '/tmp/wt',
                strategy: options?.strategy ?? 'git-worktree',
                ref: { runId },
              },
            },
      finishWorkspace: async () => ({
        patchPath:
          options?.patchPath === null
            ? undefined
            : (options?.patchPath ?? '/reports/p1.patch'),
        diffBytes: options?.patchPath === null ? 0 : 12,
        // snapshot-copy 无 git 语义、不自动回灌 ⇒ 隔离区一律保留
        kept: options?.strategy === 'snapshot-copy',
      }),
      setSessionWorkspace: async (sid, cwd) => {
        cwdCalls.push({ sid, cwd });
      },
      sendPrompt: async (_sid, prompt, hooks, opts) => {
        if (opts?.taskType) taskTypes.push(opts.taskType);
        // 超时用例：挂起直到被 abort（验证「真正中止」而非仅记失败）
        if (options?.hangOnExecution && opts?.taskType === 'coding') {
          return new Promise<string>((_resolve, reject) => {
            opts.abortSignal?.addEventListener('abort', () =>
              reject(new Error('aborted'))
            );
          });
        }
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
      notifyReport: async (input) => {
        notified.push({
          planId: input.planId,
          success: input.success,
          body: input.body,
        });
        return true;
      },
      ...(options?.goal
        ? {
            evaluateGoal: async (input: {
              sessionId: string;
              goalSummary: string;
            }) => {
              goalEvalCalls.push({
                sessionId: input.sessionId,
                goalSummary: input.goalSummary,
              });
              if (options.goal === 'throw')
                throw new Error('judge unavailable');
              if (options.goal === 'unknown') {
                return {
                  verdict: 'unverified' as const,
                  reason: '证据不足',
                  source: 'model',
                };
              }
              return {
                verdict:
                  options.goal === 'achieved'
                    ? ('achieved' as const)
                    : ('not_achieved' as const),
                reason: options.goal === 'achieved' ? '已修好' : '只做了一半',
                source: 'model',
              };
            },
          }
        : {}),
    });
    return {
      bridge,
      sessions,
      reports,
      notified,
      taskTypes,
      cwdCalls,
      goalEvalCalls,
      getSaved: () => savedSessionId,
    };
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
    const discovered = (await bridge.discovery()) ?? plan;
    const workspace = await bridge.workspace(discovered);
    const result = await bridge.execution(workspace);

    expect(workspace).toBe('/tmp/wt');
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
    const result = await bridge.execution(await bridge.workspace(plan));
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

  /** v1.1（方案 §9 偏差处理）：会话跨重启复用 */
  it('会话复用：loadSession 命中 ⇒ 不新建会话', async () => {
    const { bridge, sessions, getSaved } = makeBridge({
      savedSession: 'saved-session',
    });
    await bridge.discovery();
    expect(sessions).toEqual([]);
    expect(getSaved()).toBeUndefined(); // 命中复用不会回写
  });

  it('会话新建：无记录 ⇒ createSession 并回写映射', async () => {
    const { bridge, sessions, getSaved } = makeBridge();
    await bridge.discovery();
    expect(sessions).toEqual(['s1']);
    expect(getSaved()).toBe('s1');
  });

  /** v1.1：工具面收窄（discovery 只读面 / execution 可写面） */
  it('taskType：discovery=alwayson_discovery（只读面）、execution=coding（可写面）', async () => {
    const { bridge, taskTypes } = makeBridge();
    await bridge.discovery();
    await bridge.execution(await bridge.workspace(plan));
    expect(taskTypes).toEqual(['alwayson_discovery', 'coding']);
  });

  /** v1.1：超时真正中止（底层收到 abortSignal 并被 reject，而不是仅记失败） */
  it('execution：超时触发 abort ⇒ 失败且记 timeout', async () => {
    const { bridge } = makeBridge({
      timeoutMinutes: 0.001, // 60ms
      hangOnExecution: true,
    });
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    expect(result.success).toBe(false);
    expect(result.errors.join()).toContain('timeout');
  });

  /** v1.1：报告投递主动通知 */
  it('report：写盘后调用 notifyReport（携带成功标记）', async () => {
    const { bridge, notified } = makeBridge();
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    await bridge.report(result);
    expect(notified).toHaveLength(1);
    expect(notified[0]!.success).toBe(true);
  });

  /** v2（方案 §10.7 裁定 B）：脏仓 / 非 git ⇒ 跳过本轮，不做任何写操作 */
  it('workspace：无法隔离 ⇒ 返回空串、跳过执行（不调用模型）并如实报告', async () => {
    const { bridge, taskTypes, reports } = makeBridge({
      skipWorkspace: 'not_git_repo_or_dirty',
    });
    await bridge.discovery();
    const workspace = await bridge.workspace(plan);
    expect(workspace).toBe('');

    const result = await bridge.execution(workspace);
    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['workspace-skipped: not_git_repo_or_dirty']);
    // 只有 discovery 调过模型；execution 被跳过
    expect(taskTypes).toEqual(['alwayson_discovery']);

    const markdown = await bridge.report(result);
    expect(markdown).toContain('未隔离（not_git_repo_or_dirty）');
    expect(reports).toHaveLength(1);
  });

  /** v2 P1：执行前把会话 cwd 指向隔离区，discovery 阶段复位到项目根 */
  it('setSessionWorkspace：discovery→项目根；execution→隔离区；收尾复位项目根', async () => {
    const { bridge, cwdCalls } = makeBridge();
    await bridge.discovery();
    await bridge.execution(await bridge.workspace(plan));
    // 第三条为 2026-10-20 新增：隔离区已清理，会话 cwd 不能悬空指向已删目录
    expect(cwdCalls).toEqual([
      { sid: 's1', cwd: '/tmp/demo' },
      { sid: 's1', cwd: '/tmp/wt' },
      { sid: 's1', cwd: '/tmp/demo' },
    ]);
  });

  /** v2 P5：报告写明隔离策略与补丁路径（**未自动应用**） */
  it('report：写明隔离策略、补丁路径与「未自动应用」', async () => {
    const { bridge } = makeBridge();
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    const markdown = await bridge.report(result);
    expect(markdown).toContain('git-worktree');
    expect(markdown).toContain('/reports/p1.patch');
    expect(markdown).toContain('未自动应用');
  });

  it('report：无改动 ⇒ Patch 行写「无改动」', async () => {
    const { bridge } = makeBridge({ patchPath: null });
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    const markdown = await bridge.report(result);
    expect(markdown).toContain('- **Patch**: 无改动');
  });

  /** snapshot-copy 回退（2026-10-20）：报告口径必须区分 Diff / Snapshot Kept */
  it('report：snapshot-copy ⇒ 写 Diff 与 Snapshot Kept（不写 Patch / Worktree Kept）', async () => {
    const { bridge } = makeBridge({
      strategy: 'snapshot-copy',
      patchPath: '/reports/p1.diff',
    });
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    const markdown = await bridge.report(result);
    expect(markdown).toContain('- **Workspace**: snapshot-copy');
    expect(markdown).toContain('- **Diff**: /reports/p1.diff');
    expect(markdown).toContain('- **Snapshot Kept**: /tmp/wt');
    expect(markdown).not.toContain('Worktree Kept');
    expect(markdown).not.toContain('- **Patch**:');
  });

  it('report：snapshot-copy 无差异 ⇒ Diff 行写「无改动」', async () => {
    const { bridge } = makeBridge({
      strategy: 'snapshot-copy',
      patchPath: null,
    });
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    const markdown = await bridge.report(result);
    expect(markdown).toContain('- **Diff**: 无改动');
  });

  /** 未注入 evaluateGoal（或 flag 关）⇒ 报告仍必须显式标注 unverified，不把"没报错"当"已达成" */
  it('report：未注入自评 ⇒ 标注 unverified（不把"没报错"当成"已达成"）', async () => {
    const { bridge, goalEvalCalls } = makeBridge();
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    const markdown = await bridge.report(result);
    expect(markdown).toContain('Goal Achievement**: unverified');
    expect(goalEvalCalls).toHaveLength(0);
  });

  /** 目标达成自评（2026-10-20 产品裁定启用） */
  it('自评：achieved ⇒ 报告写 achieved + 理由，通知含达成结论', async () => {
    const { bridge, goalEvalCalls, notified } = makeBridge({
      goal: 'achieved',
    });
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    const markdown = await bridge.report(result);

    expect(goalEvalCalls).toHaveLength(1);
    expect(goalEvalCalls[0]!.sessionId).toBe('s1');
    expect(goalEvalCalls[0]!.goalSummary).toBe(plan.summary);
    expect(markdown).toContain('Goal Achievement**: achieved（已修好）');
    expect(notified[0]!.body).toContain('目标达成：achieved');
  });

  it('自评：not_achieved ⇒ 报告如实写未达成（不掩盖）', async () => {
    const { bridge } = makeBridge({ goal: 'not_achieved' });
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    const markdown = await bridge.report(result);
    expect(markdown).toContain(
      'Goal Achievement**: not_achieved（只做了一半）'
    );
  });

  it('自评：未知/解析失败 ⇒ unverified（绝不臆造成 achieved）', async () => {
    const { bridge } = makeBridge({ goal: 'unknown' });
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    const markdown = await bridge.report(result);
    expect(markdown).toContain('Goal Achievement**: unverified（证据不足）');
  });

  it('自评：抛出异常 ⇒ unverified + 来源标注，且不阻断报告', async () => {
    const { bridge, reports } = makeBridge({ goal: 'throw' });
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    const markdown = await bridge.report(result);
    expect(markdown).toContain('Goal Achievement**: unverified');
    expect(markdown).toContain('error:evaluate-failed');
    expect(reports).toHaveLength(1);
  });

  it('自评：未隔离跳过轮 ⇒ 不调用自评（无证据可评）', async () => {
    const { bridge, goalEvalCalls } = makeBridge({
      skipWorkspace: 'not_git_repo_or_dirty',
      goal: 'achieved',
    });
    await bridge.discovery();
    const result = await bridge.execution(await bridge.workspace(plan));
    expect(goalEvalCalls).toHaveLength(0);
    const markdown = await bridge.report(result);
    expect(markdown).toContain('skipped:workspace');
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
