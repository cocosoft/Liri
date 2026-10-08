// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * Steering 事件化契约测试（2026-10-08，架构治理 P1 · §1.6 红线审计修复）
 *
 * 缺口背景：`[STEERING]` 正文被 push 为 `role:'user'` 消息进入模型对话上下文 ⇒ **模型可见输入**，
 * 但修复前**只落 logger、无任何会话事件** ⇒ 会话结束后无法从事件日志重建"模型当时看到了哪段
 * steering"（与 `goal/injected` 的 X2 缺口同族）。修复 = 新增 `context/steering` 事件，
 * 并在 `onSteering` **先落盘、再注入**。
 *
 * 锁定 4 条不变量：
 *  1. 事件类型 `context/steering` 已登记进已知事件清单；
 *  2. **来源随正文流动**：`queueSteering(text, source)` / `injectSteering(text, source)`
 *     的 source 必须抵达 `onSteering`（否则事件无法标注来源）；
 *  3. 骨架一次消费**整批**（多条一次交给 `onSteering`）；
 *  4. `TAORLoop.onSteering` **确实落事件**（每条一条），且观测面缺失时**如实不落**（不伪造）。
 */
import { describe, expect, it } from 'bun:test';
import { ReActLoop } from '../../src/query/ReActLoop';
import type {
  ActResult,
  ReasonResult,
  ReActEvent,
  ReActState,
  SteeringEntry,
} from '../../src/query/ReActLoop';
import { TAORLoop } from '../../src/query/TAORLoop';
import type { QueryEngine } from '../../src/query/QueryEngine';
import { KNOWN_SESSION_EVENT_TYPES } from '../../src/session/types/knownEventTypes';

// ─── 1. 登记 ────────────────────────────────────────────────────────────────

describe('§1.6 steering 事件化：事件登记', () => {
  it('context/steering 在已知事件清单内（写入端 assertEventWritable 才不会拒绝）', () => {
    expect(KNOWN_SESSION_EVENT_TYPES.has('context/steering')).toBe(true);
  });
});

// ─── 2/3. 来源随队列流动（骨架层）────────────────────────────────────────────

class SteeringSpyLoop extends ReActLoop<
  { prompt: string },
  undefined,
  SteeringEntry[]
> {
  captured: SteeringEntry[] = [];

  constructor(steeringMessages?: string[]) {
    super({
      maxIterations: 4,
      maxConsecutiveInvalidTurns: 3,
      steeringMessages,
    });
  }

  protected async *reason(): AsyncGenerator<
    ReActEvent,
    ReasonResult<undefined>
  > {
    yield { type: 'reasoning_start' };
    return { text: 'final answer', toolCalls: [], finishReason: 'stop' };
  }

  protected async *act(): AsyncGenerator<ReActEvent, ActResult> {
    return { results: [], allSucceeded: true, anyAborted: false };
  }

  protected shouldContinue(): boolean {
    return false;
  }

  protected override async onSteering(entries: SteeringEntry[]): Promise<void> {
    this.captured.push(...entries);
  }

  protected finalize(_state: ReActState): SteeringEntry[] {
    return this.captured;
  }
}

/** 手动消费 generator 以取 return 值（for-await 拿不到） */
async function drain(
  loop: ReActLoop<{ prompt: string }, undefined, SteeringEntry[]>
): Promise<SteeringEntry[]> {
  const iter = loop.run({ prompt: 'x' })[Symbol.asyncIterator]();
  let next = await iter.next();
  while (!next.done) next = await iter.next();
  return next.value;
}

describe('§1.6 steering 事件化：来源随队列流动', () => {
  it('queueSteering(text, source) 的 source 抵达 onSteering（默认 other）', async () => {
    const loop = new SteeringSpyLoop();
    loop.queueSteering('来自用户的指令', 'user');
    loop.queueSteering('未标注来源', undefined as never); // 显式 undefined ⇒ 走默认值

    const captured = await drain(loop);

    expect(captured).toEqual([
      { text: '来自用户的指令', source: 'user' },
      { text: '未标注来源', source: 'other' },
    ]);
  });

  it('骨架一次消费整批（多条一次性交给 onSteering）', async () => {
    const loop = new SteeringSpyLoop();
    loop.queueSteering('A', 'orchestrator');
    loop.queueSteering('B', 'budget');
    loop.queueSteering('C', 'loop-guard');

    const captured = await drain(loop);

    expect(captured.map((e) => e.source)).toEqual([
      'orchestrator',
      'budget',
      'loop-guard',
    ]);
  });

  it('构造期 steeringMessages 也带来源（other），不产生无 source 的条目', async () => {
    const loop = new SteeringSpyLoop(['初始注入']);

    const captured = await drain(loop);

    expect(captured).toEqual([{ text: '初始注入', source: 'other' }]);
  });
});

// ─── 4. TAORLoop 确实落事件 ─────────────────────────────────────────────────

interface TestableTaorLoop {
  taorConfig: { sessionId?: string };
  deps: {
    appendStreamEvent?: (
      sid: string,
      ev: unknown
    ) => Promise<{ ok: boolean; tailSeq: number }>;
  };
  onSteering(entries: SteeringEntry[]): Promise<void>;
}

function makeTaorLoop(): TestableTaorLoop {
  return new TAORLoop(
    {} as unknown as QueryEngine
  ) as unknown as TestableTaorLoop;
}

describe('§1.6 steering 事件化：TAORLoop 先落盘再注入', () => {
  it('每条 entry 落一条 context/steering，text/source 原样入载荷', async () => {
    const loop = makeTaorLoop();
    loop.taorConfig.sessionId = 'sess-steer-1';
    const emitted: Array<{ type: string; data: unknown; seq: number }> = [];
    loop.deps.appendStreamEvent = async (_sid, ev) => {
      emitted.push(ev as never);
      return { ok: true, tailSeq: emitted.length };
    };

    await loop.onSteering([
      { text: 'A', source: 'user' },
      { text: 'B', source: 'orchestrator' },
    ]);

    expect(emitted.map((e) => e.type)).toEqual([
      'context/steering',
      'context/steering',
    ]);
    expect(emitted.map((e) => e.data)).toEqual([
      { text: 'A', source: 'user' },
      { text: 'B', source: 'orchestrator' },
    ]);
    // `seq: 0` ⇒ 交 append 在 mutex 内原子分配（与 `_emitValidationInjected` 同款约定）
    expect(emitted.every((e) => e.seq === 0)).toBe(true);
  });

  it('观测面未装配（无 appendStreamEvent）⇒ 如实不落且不抛（仍完成注入）', async () => {
    const loop = makeTaorLoop();
    loop.taorConfig.sessionId = 'sess-steer-2';
    loop.deps.appendStreamEvent = undefined;

    await expect(
      loop.onSteering([{ text: 'A', source: 'other' }])
    ).resolves.toBeUndefined();
  });

  it('落盘失败不阻断注入（观测面失败 ≠ 功能失败，CS03）', async () => {
    const loop = makeTaorLoop();
    loop.taorConfig.sessionId = 'sess-steer-3';
    loop.deps.appendStreamEvent = async () => {
      throw new Error('disk full');
    };

    await expect(
      loop.onSteering([{ text: 'A', source: 'other' }])
    ).resolves.toBeUndefined();
  });
});
