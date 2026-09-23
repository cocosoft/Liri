/**
 * ReActLoop 无进展熔断 × 软纠偏让路（2026-09-22）
 *
 * 修复的缺陷（来源 `chat-export-1790038432335.md`，真机日志 2026-09-21T23:23:37Z）：
 * 模型连续 3 轮重复调用**同一工具同一参数**（file_read 同两个文件）时，
 * `ReActToolLoop._injectRepeatCallCorrection` 于 `.271` 注入软纠偏指令，
 * 108ms 后基类 `no_progress_loop` 于 `.379` 即硬熔断收尾 ⇒ 模型**从未有机会**
 * 看到纠偏，只给用户留下空正文 + "工具循环无实质进展，任务已结束。"（用户回问"你挂了？"）。
 *
 * 本组用例用最小测试子类驱动骨架（同 `reactLoopYield.test.ts` 手法），锁定：
 *  1. 无纠偏 ⇒ 第 3 轮照旧熔断（既有行为不变）；
 *  2. 已注入纠偏 ⇒ **让路一次**（模型拿到至少一轮响应纠偏的机会）；
 *  3. 让路只给 1 次 ⇒ 仍会熔断，不会无限循环；
 *  4. 熔断收尾文案说明**重复了什么 / 为什么停 / 下一步**，不再是不可操作的冷提示。
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
  phase: string;
  lastError: string;
}

const REPEATED_TOOL = 'file_read';

/** 每轮都返回**完全相同**工具+参数（稳定签名）⇒ 触发无进展判定 */
class RepeatingLoop extends ReActLoop<
  { prompt: string },
  undefined,
  TestResult
> {
  reasonCount = 0;

  constructor(private readonly injectCorrection: boolean) {
    super({ maxIterations: 20, maxRepeatedRounds: 3 });
  }

  protected async *reason(): AsyncGenerator<
    ReActEvent,
    ReasonResult<undefined>
  > {
    this.reasonCount++;
    return {
      text: '',
      toolCalls: [
        {
          id: 'call_same',
          name: REPEATED_TOOL,
          input: { file_path: 'E:/x.ts' },
        },
      ],
      finishReason: 'tool_calls',
    };
  }

  protected async *act(): AsyncGenerator<ReActEvent, ActResult> {
    // 模拟 `ReActToolLoop._injectRepeatCallCorrection` 在同轮置位
    if (this.injectCorrection) this.repeatCorrectionPending = true;
    return {
      results: [
        {
          toolCallId: 'call_same',
          name: REPEATED_TOOL,
          status: 'success' as const,
          output: 'same-content',
        },
      ],
      allSucceeded: true,
      anyAborted: false,
    };
  }

  protected shouldContinue(): boolean {
    return true; // 由熔断 / maxIterations 收口
  }

  protected finalize(state: ReActState): TestResult {
    return {
      reasonCount: this.reasonCount,
      phase: state.phase,
      lastError: state.lastError ?? '',
    };
  }
}

/** 手动消费 generator 以取 return 值 */
async function drain(loop: RepeatingLoop): Promise<TestResult> {
  const iter = loop.run({ prompt: 'x' })[Symbol.asyncIterator]();
  let next = await iter.next();
  while (!next.done) next = await iter.next();
  return next.value;
}

describe('无进展熔断 × 软纠偏让路', () => {
  test('未注入纠偏 ⇒ 第 3 轮照旧熔断（既有行为不变）', async () => {
    const result = await drain(new RepeatingLoop(false));

    expect(result.phase).toBe('error');
    expect(result.reasonCount).toBe(3);
  });

  test('已注入纠偏 ⇒ 让路一次，模型获得额外轮次（reasonCount 显著大于 3）', async () => {
    const result = await drain(new RepeatingLoop(true));

    // 让路后窗口被重置 ⇒ 需再累积 3 轮同签名才再次熔断
    expect(result.reasonCount).toBeGreaterThan(3);
    expect(result.phase).toBe('error');
  });

  test('让路只给 1 次 ⇒ 最终仍熔断，不构成无限循环', async () => {
    const result = await drain(new RepeatingLoop(true));

    expect(result.phase).toBe('error');
    expect(result.reasonCount).toBeLessThan(20); // 未跑满 maxIterations
  });

  test('熔断文案可操作：说明重复了什么 / 为什么停 / 下一步', async () => {
    const result = await drain(new RepeatingLoop(false));

    expect(result.lastError).toContain('连续 3 轮重复调用');
    expect(result.lastError).toContain(REPEATED_TOOL);
    expect(result.lastError).toContain('已停下');
    // 不再使用旧的不可操作冷提示
    expect(result.lastError).not.toContain('工具循环无实质进展，任务已结束');
  });
});
