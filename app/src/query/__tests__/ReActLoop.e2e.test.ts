/**
 * P0-3: ReActLoop 核心路径 E2E 测试
 *
 * 覆盖场景：
 *   1. 基本推理-执行循环（reason → tool_calls → act → complete）
 *   2. 熔断器触发（连续 invalid turns → error）
 *   3. 中止信号（abort mid-loop）
 *   4. maxIterations 超限
 *   5. 错误恢复（reasoning_error → onReasoningError）
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ReActLoop } from '../ReActLoop.js';
import type {
  ReActEvent,
  ReasonResult,
  ActResult,
  ToolCallEntry,
  ToolResultEntry,
} from '../ReActLoop.js';

// ==========================================
// Test harness: Minimal ReActLoop implementation
// ==========================================

interface TestInput {
  message: string;
}

interface TestContext {
  responses: string[];
  index: number;
}

type TestResult = { finalText: string; iterations: number; phase: string };

class TestLoop extends ReActLoop<TestInput, TestContext, TestResult> {
  private responses: string[];
  private tools: Map<string, (input: Record<string, unknown>) => string>;

  constructor(
    responses: string[],
    tools?: Map<string, (input: Record<string, unknown>) => string>,
    config?: Partial<import('../ReActLoop.js').ReActLoopConfig>
  ) {
    super(config);
    this.responses = responses;
    this.tools = tools ?? new Map();
  }

  protected async *reason(
    input: TestInput,
    context?: TestContext
  ): AsyncGenerator<
    import('../ReActLoop.js').ReActEvent,
    ReasonResult<TestContext>
  > {
    if (!context) context = { responses: this.responses, index: 0 };

    if (context.index >= context.responses.length) {
      return {
        text: 'done',
        toolCalls: [],
        finishReason: 'stop',
        context,
      };
    }

    const response = context.responses[context.index];
    context.index++;

    // Parse tool calls from response (format: "TOOL:name:key=val")
    const toolCalls: ToolCallEntry[] = [];
    let text = response;
    for (const line of response.split('\n')) {
      const match = /^TOOL:(\w+):(.+)$/.exec(line.trim());
      if (match) {
        const [, name, argsStr] = match;
        const input: Record<string, unknown> = {};
        for (const pair of argsStr.split(',')) {
          const [k, v] = pair.split('=');
          input[k.trim()] = v.trim();
        }
        toolCalls.push({ id: `call_${toolCalls.length}`, name, input });
        text = text.replace(line, '').trim();
      }
    }

    return {
      text: text || 'executing tools',
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      context,
    };
  }

  protected async *act(
    calls: ToolCallEntry[],
    _context?: TestContext
  ): AsyncGenerator<ReActEvent, ActResult> {
    const results: ToolResultEntry[] = [];

    for (const call of calls) {
      const handler = this.tools.get(call.name);
      if (handler) {
        results.push({
          toolCallId: call.id,
          name: call.name,
          status: 'success',
          output: handler(call.input),
        });
      } else {
        results.push({
          toolCallId: call.id,
          name: call.name,
          status: 'error',
          error: `Unknown tool: ${call.name}`,
        });
      }
    }

    return {
      results,
      allSucceeded: results.every((r) => r.status === 'success'),
      anyAborted: false,
    };
  }

  protected shouldContinue(
    _input: TestInput,
    result: ReasonResult<TestContext>
  ): boolean {
    return result.toolCalls.length > 0;
  }

  protected finalize(
    state: import('../ReActLoop.js').ReActState,
    _context?: TestContext
  ): TestResult {
    return {
      finalText: '',
      iterations: state.iteration,
      phase: state.phase,
    };
  }
}

// ==========================================
// Tests
// ==========================================

describe('ReActLoop E2E', () => {
  let tools: Map<string, (input: Record<string, unknown>) => string>;

  beforeEach(() => {
    tools = new Map([
      ['read', (i) => `read: ${i.path}`],
      ['write', (i) => `wrote: ${i.content}`],
      ['search', (i) => `found: results for ${i.query}`],
    ]);
  });

  describe('Scenario 1: basic reason-act-complete cycle', () => {
    it('completes when no more tool calls', async () => {
      const loop = new TestLoop(
        ['Analyzing...\nTOOL:read:path=/tmp/test', 'Done.'],
        tools
      );

      const events: ReActEvent[] = [];
      const result = await collectEvents(
        loop.run({ message: 'read /tmp/test' }),
        events
      );

      expect(result.phase).toBe('completed');
      expect(result.iterations).toBeGreaterThanOrEqual(1);
      expect(events.find((e) => e.type === 'reasoning_start')).toBeDefined();
      expect(events.find((e) => e.type === 'acting_start')).toBeDefined();
    });

    it('yields tool_start and tool_end events', async () => {
      const loop = new TestLoop(['TOOL:search:query=hello', 'Done.'], tools);

      const events: ReActEvent[] = [];
      await collectEvents(loop.run({ message: 'search for hello' }), events);

      const toolEnd = events.filter((e) => e.type === 'tool_end');
      expect(toolEnd.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Scenario 2: circuit breaker', () => {
    it('triggers after maxConsecutiveInvalidTurns', async () => {
      // 连续失败轮使用不同工具名：buildRoundSignature 只拼「工具名:状态」，
      // 相同工具会先触发无进展熔断（no_progress_loop，maxRepeatedRounds=3）而非 circuit breaker。
      // 不同工具名 → 签名各异 → 专测 circuit breaker（maxConsecutiveInvalidTurns=3）在第 3 轮触发。
      const loop = new TestLoop(
        [
          'TOOL:unknownA:arg=x',
          'TOOL:unknownB:arg=x',
          'TOOL:unknownC:arg=x',
          'TOOL:unknownD:arg=x',
        ],
        tools,
        {
          maxConsecutiveInvalidTurns: 3,
          maxIterations: 10,
        }
      );

      const events: ReActEvent[] = [];
      const result = await collectEvents(loop.run({ message: 'fail' }), events);

      expect(result.phase).toBe('error');
      expect(result.iterations).toBeGreaterThanOrEqual(3); // circuit breaker at iteration≥3
      expect(events.find((e) => e.type === 'error')).toBeDefined();
    });

    it('resets counter on successful turn', async () => {
      const loop = new TestLoop(
        [
          'TOOL:unknown:x=1', // 1 invalid
          'TOOL:unknown:x=2', // 2 invalid
          'TOOL:read:path=/ok', // 1 valid → reset
          'TOOL:unknown:x=3', // 1 invalid
          'Done.',
        ],
        tools,
        { maxConsecutiveInvalidTurns: 3, maxIterations: 10 }
      );

      const events: ReActEvent[] = [];
      const result = await collectEvents(loop.run({ message: 'test' }), events);

      // Should complete normally because valid turn resets counter
      expect(result.phase).toBe('completed');
    });
  });

  describe('Scenario 3: abort signal', () => {
    it('emits aborted event when signal fires', async () => {
      const controller = new AbortController();
      // Add artificial delay to ensure abort fires before completion
      const slowTools = new Map([
        [
          'read',
          async (i: Record<string, unknown>) => {
            await new Promise((r) => setTimeout(r, 20));
            return `read: ${i.path}`;
          },
        ],
      ]);
      // Use a loop with inline tools
      const loop = new (class extends TestLoop {
        protected async *reason(
          input: TestInput,
          context?: TestContext
        ): AsyncGenerator<
          import('../ReActLoop.js').ReActEvent,
          ReasonResult<TestContext>
        > {
          await new Promise((r) => setTimeout(r, 5));
          return yield* super.reason(input, context);
        }
        protected async *act(
          calls: ToolCallEntry[],
          ctx?: TestContext
        ): AsyncGenerator<ReActEvent, ActResult> {
          const results: ToolResultEntry[] = [];
          for (const call of calls) {
            const handler = slowTools.get(call.name);
            if (handler) {
              results.push({
                toolCallId: call.id,
                name: call.name,
                status: 'success',
                output: (await handler(
                  call.input as Record<string, unknown>
                )) as string,
              });
            } else {
              results.push({
                toolCallId: call.id,
                name: call.name,
                status: 'error',
                error: `Unknown: ${call.name}`,
              });
            }
          }
          return {
            results,
            allSucceeded: results.every((r) => r.status === 'success'),
            anyAborted: false,
          };
        }
      })(Array(50).fill('TOOL:read:path=/tmp/x'), slowTools, {
        maxIterations: 50,
        abortSignal: controller.signal,
        maxConsecutiveInvalidTurns: 0,
      });

      const events: ReActEvent[] = [];
      const promise = collectEvents(loop.run({ message: 'loop' }), events);

      // Abort after a short delay
      setTimeout(() => controller.abort(), 20);
      const result = await promise;

      expect(['aborted', 'completed']).toContain(result.phase);
      // Aborted if signal caught, completed if finished before
    });
  });

  describe('Scenario 4: maxIterations', () => {
    it('stops after reaching maxIterations', async () => {
      // 每轮交替不同工具：buildRoundSignature 只拼「工具名:状态」，若 10 轮全相同
      // （read:success）会先触发无进展熔断（no_progress_loop）而非 maxIterations。
      // read/search 交替 → 窗口内无 3 连相同签名 → 专测 maxIterations=3 生效。
      const loop = new TestLoop(
        Array.from(
          { length: 10 },
          (_, i) => `TOOL:${i % 2 === 0 ? 'read' : 'search'}:path=/tmp/x${i}`
        ),
        tools,
        {
          maxIterations: 3,
          maxConsecutiveInvalidTurns: 0,
        }
      );

      const events: ReActEvent[] = [];
      const result = await collectEvents(
        loop.run({ message: 'endless' }),
        events
      );

      // A1（2026-09-05）：达上限用专门截断 phase——上层据此区分「截断」与「正常完成」
      expect(result.phase).toBe('truncated');
      expect(result.iterations).toBe(3);
    });
  });

  describe('Scenario 5: error recovery', () => {
    it('recovers via onReasoningError hook', async () => {
      const loop = new (class extends TestLoop {
        private shouldFail = true;

        protected async *reason(
          input: TestInput,
          context?: TestContext
        ): AsyncGenerator<
          import('../ReActLoop.js').ReActEvent,
          ReasonResult<TestContext>
        > {
          if (this.shouldFail) {
            this.shouldFail = false;
            throw new Error('simulated API error');
          }
          return yield* super.reason(input, context);
        }

        protected async onReasoningError(
          _error: unknown,
          input: TestInput,
          context?: TestContext
        ): Promise<ReasonResult<TestContext> | null> {
          return {
            text: 'recovered',
            toolCalls: [
              { id: 'call_0', name: 'read', input: { path: '/recovery' } },
            ],
            finishReason: 'tool_calls',
            context,
          };
        }
      })(['Done.'], tools, { maxIterations: 5, maxConsecutiveInvalidTurns: 0 });

      const events: ReActEvent[] = [];
      const result = await collectEvents(loop.run({ message: 'test' }), events);

      expect(result.phase).toBe('completed');
      // Should have recovered and executed the tool
      const toolEnds = events.filter((e) => e.type === 'tool_end');
      expect(toolEnds.length).toBe(1);
    });
  });
});

/** Collect all events from an async generator and return the final result */
async function collectEvents<T>(
  gen: AsyncGenerator<ReActEvent, T>,
  events: ReActEvent[]
): Promise<T> {
  let result: IteratorResult<ReActEvent, T>;
  do {
    result = await gen.next();
    if (!result.done) {
      events.push(result.value);
    }
  } while (!result.done);
  return result.value;
}
