/**
 * ReActLoop 终稿校验钩子（`onFinalOutputValidation`）契约测试 —— P1-1②（2026-09-28）
 *
 * 锁定 4 条不变量：
 *  1. **未覆写 ⇒ 零行为变化**（`TAORLoop` 等子类不受影响：默认返回 false，不重试）；
 *  2. **返回 true ⇒ 骨架 `continue` 再给一轮**（真·本轮内自纠，而非收尾后跨轮 steering）；
 *  3. **顺序**：`onIncompleteTurn`（完整性）优先于本钩子（合法性）——同一轮内前者
 *     返回 true 时后者**不被调用**；
 *  4. **只在终稿时刻调用**：本轮有 tool_calls（`shouldContinue=true`）时不触发。
 */
import { describe, test, expect } from 'bun:test';
import { ReActLoop } from '../../src/query/ReActLoop';
import type {
  ActResult,
  ReasonResult,
  ReActEvent,
  ReActState,
} from '../../src/query/ReActLoop';

interface TestResult {
  reasonCount: number;
  /** 钩子调用轨迹（按发生顺序；重复的 subject 表示同一轮内被多次调用） */
  order: string[];
  /** 每次钩子调用的所属轮次（用于断言"只在终稿轮触发"） */
  hookRounds: Array<{ hook: string; round: number }>;
}

/**
 * 可配置子类：`incompleteBudget` / `validationBudget` 为各自钩子"还能返回几次 true"。
 * 用预算而非固定返回值，避免测试自身死循环（骨架另有 maxIterations 兜底）。
 */
class BudgetedLoop extends ReActLoop<{ prompt: string }, undefined, TestResult> {
  reasonCount = 0;
  order: string[] = [];
  hookRounds: Array<{ hook: string; round: number }> = [];
  private incompleteBudget: number;
  private validationBudget: number;

  /** 为 true 时首轮产出 tool_calls（用于验证"有工具调用时不触发校验"） */
  private readonly toolCallOnFirstRound: boolean;

  constructor(opts: {
    incompleteBudget?: number;
    validationBudget?: number;
    toolCallOnFirstRound?: boolean;
  }) {
    super({ maxIterations: 8, maxConsecutiveInvalidTurns: 3 });
    this.incompleteBudget = opts.incompleteBudget ?? 0;
    this.validationBudget = opts.validationBudget ?? 0;
    this.toolCallOnFirstRound = opts.toolCallOnFirstRound ?? false;
  }

  protected async *reason(): AsyncGenerator<
    ReActEvent,
    ReasonResult<undefined>
  > {
    this.reasonCount++;
    yield { type: 'reasoning_start' };
    const withToolCall = this.toolCallOnFirstRound && this.reasonCount === 1;
    return withToolCall
      ? {
          text: '',
          toolCalls: [{ id: 'call_1', name: 'noop', input: {} }],
          finishReason: 'tool_calls',
        }
      : { text: 'final answer', toolCalls: [], finishReason: 'stop' };
  }

  protected async *act(): AsyncGenerator<ReActEvent, ActResult> {
    return {
      results: [
        {
          toolCallId: 'call_1',
          name: 'noop',
          status: 'success' as const,
          output: 'ok',
        },
      ],
      allSucceeded: true,
      anyAborted: false,
    };
  }

  /** 仅首轮（带工具调用）继续，其余轮次进入终稿判定 */
  protected shouldContinue(): boolean {
    return this.toolCallOnFirstRound && this.reasonCount === 1;
  }

  protected override async onIncompleteTurn(): Promise<boolean> {
    this.order.push('incomplete');
    this.hookRounds.push({ hook: 'incomplete', round: this.reasonCount });
    if (this.incompleteBudget > 0) {
      this.incompleteBudget--;
      return true;
    }
    return false;
  }

  protected override async onFinalOutputValidation(): Promise<boolean> {
    this.order.push('validation');
    this.hookRounds.push({ hook: 'validation', round: this.reasonCount });
    if (this.validationBudget > 0) {
      this.validationBudget--;
      return true;
    }
    return false;
  }

  protected finalize(_state: ReActState): TestResult {
    return {
      reasonCount: this.reasonCount,
      order: this.order,
      hookRounds: this.hookRounds,
    };
  }
}

/** **不覆写任何钩子**的子类：验证骨架默认实现（等价 `TAORLoop` 的处境） */
class PlainLoop extends ReActLoop<{ prompt: string }, undefined, TestResult> {
  reasonCount = 0;

  constructor() {
    super({ maxIterations: 8, maxConsecutiveInvalidTurns: 3 });
  }

  protected async *reason(): AsyncGenerator<
    ReActEvent,
    ReasonResult<undefined>
  > {
    this.reasonCount++;
    yield { type: 'reasoning_start' };
    return { text: 'final answer', toolCalls: [], finishReason: 'stop' };
  }

  protected async *act(): AsyncGenerator<ReActEvent, ActResult> {
    return { results: [], allSucceeded: true, anyAborted: false };
  }

  protected shouldContinue(): boolean {
    return false;
  }

  protected finalize(_state: ReActState): TestResult {
    return { reasonCount: this.reasonCount, order: [], hookRounds: [] };
  }
}

/** 手动消费 generator 以取 return 值（for-await 拿不到） */
async function drain<T extends ReActLoop<{ prompt: string }, undefined, TestResult>>(
  loop: T
): Promise<TestResult> {
  const iter = loop.run({ prompt: 'x' })[Symbol.asyncIterator]();
  let next = await iter.next();
  while (!next.done) next = await iter.next();
  return next.value;
}

describe('ReActLoop 终稿校验钩子（P1-1②）', () => {
  test('未覆写钩子 ⇒ 零行为变化（不重试，仅一轮 reason）', async () => {
    const loop = new PlainLoop();
    const result = await drain(loop);
    expect(result.reasonCount).toBe(1);
  });

  test('校验返回 true ⇒ 骨架 continue，再给一轮（真本轮内重试）', async () => {
    const loop = new BudgetedLoop({ validationBudget: 1 });
    const result = await drain(loop);

    expect(result.reasonCount).toBe(2);
    // 第二轮预算耗尽 ⇒ 如实放行收尾（不无限重试）
    expect(result.order).toEqual([
      'incomplete',
      'validation',
      'incomplete',
      'validation',
    ]);
  });

  test('顺序：完整性（incomplete）优先于合法性（validation）', async () => {
    const loop = new BudgetedLoop({
      incompleteBudget: 1,
      validationBudget: 1,
    });
    const result = await drain(loop);

    // 第 1 轮 incomplete=true ⇒ continue，该轮 validation 未被调用
    // ⇒ 首次出现 'validation' 必须晚于两次 'incomplete'
    expect(result.order[0]).toBe('incomplete');
    expect(result.order[1]).toBe('incomplete');
    expect(result.order.indexOf('validation')).toBe(2);
    expect(result.reasonCount).toBe(3);
  });

  test('本轮有 tool_calls（shouldContinue=true）⇒ 不触发校验', async () => {
    const loop = new BudgetedLoop({ toolCallOnFirstRound: true });
    const result = await drain(loop);

    // 首轮进入 ACT（带工具调用），第 2 轮才是终稿判定
    expect(result.reasonCount).toBe(2);
    expect(result.hookRounds.length).toBeGreaterThan(0);
    expect(result.hookRounds.every((c) => c.round === 2)).toBe(true);
  });
});
