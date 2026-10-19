/**
 * 2026-10-19 真机回归：circuit_breaker 的用户可见错误必须带上**最近失败的工具与原因**。
 *
 * 背景：PowerShell allowlist 误拒 `& node …` 时，用户只看到
 * `circuit_breaker: consecutive invalid turns exceeded`，无法定位根因。
 */
import { describe, expect, test } from 'bun:test';
import { ReActLoop } from '../../src/query/ReActLoop';
import type {
  ActResult,
  ReasonResult,
  ReActEvent,
  ReActState,
} from '../../src/query/ReActLoop';

interface TestResult {
  phase: string;
}

class AllFailLoop extends ReActLoop<{ prompt: string }, undefined, TestResult> {
  reasonCount = 0;
  actCount = 0;

  constructor() {
    super({ maxIterations: 10, maxConsecutiveInvalidTurns: 3 });
  }

  protected async *reason(): AsyncGenerator<
    ReActEvent,
    ReasonResult<undefined>
  > {
    this.reasonCount++;
    return {
      text: '',
      // 每轮参数不同 ⇒ 不触发 no_progress 守卫（本用例只验证 circuit_breaker）
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
    this.actCount++;
    return {
      results: [
        {
          toolCallId: `call_${this.reasonCount}`,
          name: 'powershell',
          status: 'error' as const,
          error: '安全检查: PowerShell 命令 "& node" 不在允许列表中',
        },
      ],
      allSucceeded: false,
      anyAborted: false,
    };
  }

  protected shouldContinue(): boolean {
    return true;
  }

  protected finalize(state: ReActState): TestResult {
    return { phase: state.phase };
  }
}

async function drain(loop: AllFailLoop): Promise<{
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

describe('circuit_breaker：错误信息可定位', () => {
  test('连续 3 轮全失败 ⇒ 熔断，且 error 事件含最近失败工具与原因', async () => {
    const loop = new AllFailLoop();
    const { events, result } = await drain(loop);

    expect(loop.actCount).toBe(3);
    expect(result.phase).toBe('circuit_breaker');

    const error = events.find(
      (e): e is Extract<ReActEvent, { type: 'error' }> => e.type === 'error'
    );
    expect(error?.message).toContain(
      'circuit_breaker: consecutive invalid turns exceeded'
    );
    expect(error?.message).toContain('powershell');
    expect(error?.message).toContain('不在允许列表中');
  });
});
