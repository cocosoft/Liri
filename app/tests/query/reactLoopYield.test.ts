/**
 * ReActLoop yield 短路测试（阶段 A / A1-d）
 *
 * 锁定语义：`act()` 返回 `yielded: true` 时，骨架**不再进入下一轮 reason**，
 * 直接以 `phase='yielded'` 收尾（会话对外状态由上层保持 running，
 * 子代理结算后由恢复通路开启新 turn —— 见 阶段A-恢复通路设计Spec.md §3.3）。
 */
import { describe, test, expect } from 'bun:test';
import { ReActLoop } from '../../src/query/ReActLoop';
import type {
  ActResult,
  ReasonResult,
  ReActEvent,
  ReActState,
  ToolCallEntry,
} from '../../src/query/ReActLoop';

interface TestResult {
  reasonCount: number;
  actCount: number;
  phase: string;
}

/** 最小测试子类：本轮是否 yield 由构造参数决定 */
class TestLoop extends ReActLoop<{ prompt: string }, undefined, TestResult> {
  reasonCount = 0;
  actCount = 0;

  constructor(private readonly yielded: boolean) {
    super({ maxIterations: 5, maxConsecutiveInvalidTurns: 3 });
  }

  protected async *reason(): AsyncGenerator<
    ReActEvent,
    ReasonResult<undefined>
  > {
    this.reasonCount++;
    yield { type: 'reasoning_start' };
    return {
      text: '',
      toolCalls: [{ id: 'call_yield', name: 'sessions_yield', input: {} }],
      finishReason: 'tool_calls',
    };
  }

  protected async *act(): AsyncGenerator<ReActEvent, ActResult> {
    this.actCount++;
    return {
      results: [
        {
          toolCallId: 'call_yield',
          name: 'sessions_yield',
          status: 'success' as const,
          output: '{"status":"yielded"}',
        },
      ],
      allSucceeded: true,
      anyAborted: false,
      yielded: this.yielded,
    };
  }

  protected shouldContinue(): boolean {
    // 非 yield 场景第二轮即停，避免跑满 maxIterations
    return this.reasonCount < 2;
  }

  protected finalize(state: ReActState): TestResult {
    return {
      reasonCount: this.reasonCount,
      actCount: this.actCount,
      phase: state.phase,
    };
  }
}

/** 手动消费 generator 以取 return 值（for-await 拿不到） */
async function drain(loop: TestLoop): Promise<{
  events: ReActEvent[];
  result: TestResult;
}> {
  const iter = loop.run({ prompt: 'x' })[Symbol.asyncIterator]();
  const events: ReActEvent[] = [];
  let next = await iter.next();
  while (!next.done) {
    events.push(next.value);
    next = await iter.next();
  }
  return { events, result: next.value };
}

describe('ReActLoop yield 短路（A1-d）', () => {
  test('yielded=true ⇒ 产出 yielded 事件、phase=yielded、不再进入下一轮', async () => {
    const loop = new TestLoop(true);
    const { events, result } = await drain(loop);

    expect(events.some((e: ReActEvent) => e.type === 'yielded')).toBe(true);
    expect(result.phase).toBe('yielded');
    // 关键断言：未进入第二轮 reason
    expect(result.reasonCount).toBe(1);
    expect(result.actCount).toBe(1);
  });

  test('yielded=false ⇒ 走原有循环（正常推进到下一轮）', async () => {
    const loop = new TestLoop(false);
    const { events, result } = await drain(loop);

    expect(events.some((e: ReActEvent) => e.type === 'yielded')).toBe(false);
    expect(result.reasonCount).toBe(2); // 正常推进（第二轮由 shouldContinue 拦停）
    expect(result.phase).not.toBe('yielded');
  });
});
