/**
 * LRO-09 步骤 3（2026-10-26）：熔断分型 —— **双预算** + `environment_blocked` 终止
 *
 * 实测根因：`tool_rules.json` 同指纹 allow+deny 冲突 ⇒ `file_write` 连续 3 次被规则拒绝，
 * 4 秒内烧完 `consecutiveInvalidTurns` 预算并熔断。这类失败**重试不可能改变结果**，
 * 与"模型输出了非法 tool_call"必须分开计数、分开收口。
 *
 * 拍板结论（2026-10-26）：阻塞阈值 **2**；ruleId 只给用户与日志；**不自动**续跑。
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { ReActLoop, classifyTurn } from '../../src/query/ReActLoop';
import type {
  ActResult,
  ReasonResult,
  ReActEvent,
  ReActState,
} from '../../src/query/ReActLoop';
import { resolveTerminationOutput } from '../../src/chat/terminationOutput.js';
import { getLogger } from '@modules/monitoring/logs/Logger.js';

// ── 1. 纯判定 ──────────────────────────────────────────────

describe('classifyTurn：按结构化字段分型（不解析 error 文本）', () => {
  test('全成功 ⇒ progress', () => {
    expect(classifyTurn([{ status: 'success' }, { status: 'success' }])).toBe(
      'progress'
    );
  });

  test('全 permission_denied ⇒ environment_blocked', () => {
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'permission_denied' },
        { status: 'error', failureKind: 'permission_denied' },
      ])
    ).toBe('environment_blocked');
  });

  test('混合 permission_denied + safety_blocked ⇒ 仍 environment_blocked（全为环境阻塞类）', () => {
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'permission_denied' },
        { status: 'error', failureKind: 'safety_blocked' },
      ])
    ).toBe('environment_blocked');
  });

  test('阻塞 + 成功混合 ⇒ progress（有推进，不清算环境）', () => {
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'permission_denied' },
        { status: 'success' },
      ])
    ).toBe('progress');
  });

  test('tool_error / 未分类 error ⇒ invalid（既有语义）', () => {
    expect(classifyTurn([{ status: 'error', failureKind: 'tool_error' }])).toBe(
      'invalid'
    );
    expect(classifyTurn([{ status: 'error' }])).toBe('invalid');
    // 阻塞 + 未分类混合 ⇒ 不能算纯环境阻塞
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'permission_denied' },
        { status: 'error' },
      ])
    ).toBe('invalid');
  });

  test('workspace_escape（B1）⇒ invalid 而**非** environment_blocked（可恢复）', () => {
    // 越界可由「批准加根」修复（issue #35）⇒ 不得 2 轮即熔断整轮
    expect(
      classifyTurn([{ status: 'error', failureKind: 'workspace_escape' }])
    ).toBe('invalid');
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'workspace_escape' },
        { status: 'error', failureKind: 'workspace_escape' },
      ])
    ).toBe('invalid');
  });

  // ── 2026-10-31（台账 §16）：越界且**已提交审批** ⇒ 中性 ──
  test('全 workspace_escape_pending_approval ⇒ awaiting_approval（中性）', () => {
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'workspace_escape_pending_approval' },
      ])
    ).toBe('awaiting_approval');
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'workspace_escape_pending_approval' },
        { status: 'error', failureKind: 'workspace_escape_pending_approval' },
      ])
    ).toBe('awaiting_approval');
  });

  test('待审批 + 其它失败混合 ⇒ 仍按失败分型（不因混入待审批就中性）', () => {
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'workspace_escape_pending_approval' },
        { status: 'error', failureKind: 'tool_error' },
      ])
    ).toBe('invalid');
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'workspace_escape_pending_approval' },
        { status: 'error', failureKind: 'permission_denied' },
      ])
    ).toBe('invalid');
  });

  test('待审批 + 成功 ⇒ progress（本轮确有推进）', () => {
    expect(
      classifyTurn([
        { status: 'error', failureKind: 'workspace_escape_pending_approval' },
        { status: 'success' },
      ])
    ).toBe('progress');
  });

  test('空数组 ⇒ progress（无失败可判，不得凭空计 invalid）', () => {
    expect(classifyTurn([])).toBe('progress');
  });

  test('负向对照：成功条目即使被误填 failureKind 也不得算阻塞', () => {
    expect(
      classifyTurn([{ status: 'success', failureKind: 'permission_denied' }])
    ).toBe('progress');
  });

  // ── P2-2（2026-10-27）：外部/系统中止的中性归类 ──
  test('全 aborted / 全 timeout（或两者混合）⇒ aborted（中性，不算进展）', () => {
    expect(classifyTurn([{ status: 'aborted' }])).toBe('aborted');
    expect(classifyTurn([{ status: 'timeout' }, { status: 'aborted' }])).toBe(
      'aborted'
    );
  });

  test('中止 + 成功 ⇒ progress（本轮确有推进）', () => {
    expect(classifyTurn([{ status: 'aborted' }, { status: 'success' }])).toBe(
      'progress'
    );
  });

  test('中止 + 失败 ⇒ 仍按失败分型（不因混入中止就洗白）', () => {
    expect(
      classifyTurn([
        { status: 'aborted' },
        { status: 'error', failureKind: 'tool_error' },
      ])
    ).toBe('invalid');
    expect(
      classifyTurn([
        { status: 'timeout' },
        { status: 'error', failureKind: 'permission_denied' },
      ])
    ).toBe('environment_blocked');
  });
});

// ── 2. 双预算计数与终止 ────────────────────────────────────

type RoundKind = 'blocked' | 'invalid' | 'ok' | 'aborted' | 'pending';

interface TestResult {
  phase: string;
  reason: string;
}

class ScriptedLoop extends ReActLoop<
  { prompt: string },
  undefined,
  TestResult
> {
  private readonly script: RoundKind[];
  private reasonCount = 0;
  actCount = 0;

  constructor(script: RoundKind[], sessionId?: string) {
    super({
      maxIterations: 20,
      maxConsecutiveInvalidTurns: 3,
      maxConsecutiveBlockedTurns: 2,
      ...(sessionId ? { sessionId } : {}),
    });
    this.script = script;
  }

  protected async *reason(): AsyncGenerator<
    ReActEvent,
    ReasonResult<undefined>
  > {
    if (this.reasonCount >= this.script.length) {
      return { text: 'done', toolCalls: [], finishReason: 'stop' };
    }
    this.reasonCount++;
    return {
      text: '',
      // 每轮参数不同 ⇒ 不触发 no_progress（本用例只验证熔断分型）
      toolCalls: [
        {
          id: `call_${this.reasonCount}`,
          name: 'powershell',
          input: { n: this.reasonCount },
        },
      ],
      finishReason: 'tool_calls',
    };
  }

  protected async *act(): AsyncGenerator<ReActEvent, ActResult> {
    const kind = this.script[this.actCount] ?? 'ok';
    const id = `call_${this.actCount + 1}`;
    this.actCount++;
    if (kind === 'ok') {
      return {
        results: [
          { toolCallId: id, name: 'powershell', status: 'success' as const },
        ],
        allSucceeded: true,
        anyAborted: false,
      };
    }
    // P2-2：外部/系统中止（骨架不消费 anyAborted，本用例只验证计数口径）
    if (kind === 'aborted') {
      return {
        results: [
          {
            toolCallId: id,
            name: 'powershell',
            status: 'aborted' as const,
            error: 'Execution aborted before tool run',
          },
        ],
        allSucceeded: false,
        anyAborted: true,
      };
    }
    const result =
      kind === 'blocked'
        ? {
            toolCallId: id,
            name: 'powershell',
            status: 'error' as const,
            // ruleId 只给用户/日志：原因文本里的 `[rule=…]` 会被终止文案带出
            error: 'Denied by rule from tool_rules.json [rule=rule_1]',
            failureKind: 'permission_denied' as const,
          }
        : kind === 'pending'
          ? {
              // 2026-10-31（台账 §16）：越界 + **已提交审批** ⇒ 中性态
              toolCallId: id,
              name: 'powershell',
              status: 'error' as const,
              error: '路径越界……已提交审批申请，批准后本次调用会被自动重试',
              failureKind: 'workspace_escape_pending_approval' as const,
            }
          : {
              toolCallId: id,
              name: 'powershell',
              status: 'error' as const,
              error: '工具内部异常',
              failureKind: 'tool_error' as const,
            };
    return { results: [result], allSucceeded: false, anyAborted: false };
  }

  protected shouldContinue(
    _input: { prompt: string },
    result: ReasonResult<undefined>
  ): boolean {
    // 脚本跑完后 `reason()` 不再产出 toolCalls ⇒ 视为收尾（否则会一路跑到 maxIterations）
    return result.toolCalls.length > 0;
  }

  protected finalize(state: ReActState): TestResult {
    return { phase: state.phase, reason: this.getTerminationReason() };
  }
}

async function drain(loop: ScriptedLoop): Promise<{
  events: ReActEvent[];
  result: TestResult;
}> {
  const events: ReActEvent[] = [];
  const it = loop.run({ prompt: 'x' });
  let next = await it.next();
  while (!next.done) {
    events.push(next.value);
    next = await it.next();
  }
  return { events, result: next.value };
}

function errorMessage(events: ReActEvent[]): string | undefined {
  return events.find(
    (e): e is Extract<ReActEvent, { type: 'error' }> => e.type === 'error'
  )?.message;
}

describe('environment_blocked：环境阻塞独立预算与终止', () => {
  test('连续 2 轮被规则拒绝 ⇒ environment_blocked（不再等 3 轮）', async () => {
    const loop = new ScriptedLoop(['blocked', 'blocked']);
    const { events, result } = await drain(loop);

    expect(loop.actCount).toBe(2);
    expect(result.phase).toBe('environment_blocked');
    expect(result.reason).toBe('environment_blocked');
    // 终止原因如实落到 finishReason，且正文透传 lastError（含可定位的 ruleId）
    const msg = errorMessage(events);
    expect(msg).toContain('环境拦截');
    expect(msg).toContain('permission_denied');
    expect(msg).toContain('rule_1');
    expect(msg).not.toContain('circuit_breaker');
  });

  test('阻塞预算不消耗 invalid 预算：1 轮阻塞 + 3 轮工具自身失败 ⇒ 仍是 circuit_breaker', async () => {
    const loop = new ScriptedLoop(['blocked', 'invalid', 'invalid', 'invalid']);
    const { events, result } = await drain(loop);

    expect(result.phase).toBe('circuit_breaker');
    expect(result.reason).toBe('circuit_breaker');
    expect(errorMessage(events)).toContain(
      'consecutive invalid turns exceeded'
    );
  });

  test('成功一轮即清零阻塞预算（偶发拦截不终止）', async () => {
    const loop = new ScriptedLoop(['blocked', 'ok', 'blocked']);
    const { result } = await drain(loop);

    expect(loop.actCount).toBe(3);
    expect(result.phase).toBe('completed');
  });

  // ── P2-2（2026-10-27）：中止轮中性，不清零既有失败计数 ──
  test('中止轮不清零失败计数（原实现按 progress 清零 ⇒ 永远攒不满 3 轮）', async () => {
    const loop = new ScriptedLoop(['invalid', 'aborted', 'invalid', 'invalid']);
    const { result } = await drain(loop);

    // 1 + (aborted 中性) + 1 + 1 = 3 ⇒ 熔断；修复前在第 2 轮被清零 ⇒ 只到 2 ⇒ 不熔断
    expect(result.phase).toBe('circuit_breaker');
    expect(result.reason).toBe('circuit_breaker');
  });

  test('连续中止不触发熔断（外部因素，不算进展也不算失败）', async () => {
    const loop = new ScriptedLoop(['aborted', 'aborted', 'aborted']);
    const { result } = await drain(loop);

    expect(loop.actCount).toBe(3);
    expect(result.phase).toBe('completed');
  });

  // ── 2026-10-31（台账 §16）：待审批轮中性 ──
  test('连续待审批不触发熔断（渲染 4 轮仍 completed）', async () => {
    const loop = new ScriptedLoop(['pending', 'pending', 'pending', 'pending']);
    const { result } = await drain(loop);

    expect(loop.actCount).toBe(4);
    expect(result.phase).toBe('completed');
    expect(result.reason).not.toBe('circuit_breaker');
  });

  test('待审批轮不清零失败计数（1 + 中性 + 1 + 1 ⇒ 仍熔断）', async () => {
    const loop = new ScriptedLoop(['invalid', 'pending', 'invalid', 'invalid']);
    const { result } = await drain(loop);

    // 若待审批被当成 progress 清零 ⇒ 计数只到 2 ⇒ 不熔断（本用例即为该回归的守卫）
    expect(result.phase).toBe('circuit_breaker');
    expect(result.reason).toBe('circuit_breaker');
  });

  test('终止输出：environment_blocked 属 error 族透传 lastError，且 finishReason 如实', () => {
    const out = resolveTerminationOutput({
      reason: 'environment_blocked',
      iteration: 1,
      maxIterations: 20,
      isLongTaskSignal: false,
      lastError: '本轮无法继续：1 个工具调用被环境拦截（连续 2 轮）',
      droppedToolCallsAtStop: 0,
      maxTotalDurationMs: 600000,
    });
    expect(out.finishReason).toBe('environment_blocked');
    expect(out.suffix).toContain('环境拦截');
  });
});

// ── 3. B0-1（2026-10-30）：熔断链日志必须能按会话归因 ──────────

describe('B0-1：熔断链日志带 sessionId', () => {
  const reactLogger = getLogger('query:reactLoop');

  function metaOf(
    calls: readonly unknown[][],
    key: string
  ): Record<string, unknown> | undefined {
    const hit = calls.find((c) => String(c[0]).includes(key));
    return hit?.[1] as Record<string, unknown> | undefined;
  }

  test('turn_blocked / environment_blocked triggered 均带 sessionId', async () => {
    const spy = spyOn(reactLogger, 'warn');
    try {
      await drain(new ScriptedLoop(['blocked', 'blocked'], 'session_b0'));
      expect(metaOf(spy.mock.calls, 'turn_blocked')?.sessionId).toBe(
        'session_b0'
      );
      expect(
        metaOf(spy.mock.calls, 'environment_blocked triggered')?.sessionId
      ).toBe('session_b0');
    } finally {
      spy.mockRestore();
    }
  });

  test('all-tools-failed / circuit_breaker triggered 均带 sessionId', async () => {
    const spy = spyOn(reactLogger, 'warn');
    try {
      await drain(
        new ScriptedLoop(
          ['invalid', 'invalid', 'invalid'],
          'session_b0_invalid'
        )
      );
      expect(metaOf(spy.mock.calls, 'all-tools-failed')?.sessionId).toBe(
        'session_b0_invalid'
      );
      expect(
        metaOf(spy.mock.calls, 'circuit_breaker triggered')?.sessionId
      ).toBe('session_b0_invalid');
    } finally {
      spy.mockRestore();
    }
  });
});
