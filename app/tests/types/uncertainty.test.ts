/**
 * D5（2026-11-14）：A2A / ACP 不确定性与推理轨迹字段回归锁。
 *
 * Spec：`.trae/specs/a2a-acp-uncertainty-field.md`。
 * 锁五条：① 归一化边界（0..1 / 枚举 / 截断 / 无脱敏不传文本）；
 * ② metadata 合并不写空键；③ 协商默认 false；④ ACP `done._meta` 透传；
 * ⑤ A2A 委派：仅协商且产出方有信号时写 `liri.*`（无产出方 ⇒ 零字段，不造假）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  A2A_UNCERTAINTY_EXTENSION_URI,
  LIRI_REASONING_TRACE_KEY,
  LIRI_UNCERTAINTY_KEY,
  acceptsUncertainty,
  attachUncertaintyMetadata,
  lastUncertaintyFromMessages,
  normalizeTrace,
  normalizeUncertainty,
} from '@modules/types/uncertainty';
import { consumeTurnStream } from '@modules/acp/control-plane/manager.turn-stream';
import type { AcpRuntimeEvent } from '@modules/acp/runtime/types';
import {
  runDelegation,
  setA2ADelegator,
  setA2AUncertaintyProvider,
} from '@modules/infrastructure/http/handlers/routes/a2a-routes';
import type { A2APortSlice } from '@modules/infrastructure/http/handlers/routes/a2a-rpc';
import type { A2ATask } from '@modules/types/a2a';

const redact = (s: string): string => s.replace(/secret/gi, '***');

afterEach(() => {
  setA2ADelegator(null);
  setA2AUncertaintyProvider(null);
});

describe('D5：不确定性归一化', () => {
  it('0..1 → 两位小数；枚举 method 保留', () => {
    expect(normalizeUncertainty({ score: 0.126, method: 'verifier' })).toEqual({
      score: 0.13,
      method: 'verifier',
    });
  });

  it('越界 / 非数 / 非法 method ⇒ 整条丢弃（不夹取、不伪造）', () => {
    expect(normalizeUncertainty({ score: 1.2, method: 'verifier' })).toBeNull();
    expect(
      normalizeUncertainty({ score: -0.1, method: 'verifier' })
    ).toBeNull();
    expect(
      normalizeUncertainty({ score: Number.NaN, method: 'verifier' })
    ).toBeNull();
    expect(normalizeUncertainty({ score: 0.5, method: 'guess' })).toBeNull();
    expect(normalizeUncertainty('x')).toBeNull();
  });

  it('rationale：无脱敏函数 ⇒ 丢弃；有脱敏 ⇒ 脱敏并截断 ≤200 字', () => {
    expect(
      normalizeUncertainty({
        score: 0.5,
        method: 'self_report',
        rationale: 'a secret b',
      })
    ).toEqual({ score: 0.5, method: 'self_report' });

    const long = `secret ${'x'.repeat(300)}`;
    const result = normalizeUncertainty(
      { score: 0.5, method: 'hybrid', rationale: long },
      redact
    );
    expect(result?.rationale?.startsWith('***')).toBe(true);
    expect(result?.rationale?.length ?? 0).toBeLessThanOrEqual(201);
  });
});

describe('D5：推理轨迹归一化', () => {
  it('最多 20 条、step 重排为 1..n、非法 kind 丢弃', () => {
    const input = Array.from({ length: 25 }, (_, i) => ({
      step: 99,
      kind: i === 0 ? 'bogus' : 'tool',
      summary: `s${i}`,
    }));
    const trace = normalizeTrace(input, redact);
    expect(trace).toHaveLength(20);
    expect(trace[0]).toMatchObject({ step: 1, kind: 'tool', summary: 's1' });
    expect(trace[19]?.step).toBe(20);
  });

  it('无脱敏函数 ⇒ 只保留 step/kind（summary 不传）', () => {
    expect(normalizeTrace([{ kind: 'plan', summary: '细节' }])).toEqual([
      { step: 1, kind: 'plan' },
    ]);
  });
});

describe('D5：metadata 合并与协商', () => {
  it('两信号皆空 ⇒ 返回原对象（**不写键**，字节不变）', () => {
    const metadata = { keep: 1 };
    expect(
      attachUncertaintyMetadata(metadata, { uncertainty: null, trace: [] })
    ).toBe(metadata);
    expect(attachUncertaintyMetadata(undefined, {})).toBeUndefined();
  });

  it('有信号 ⇒ 只写对应键', () => {
    const merged = attachUncertaintyMetadata(
      { keep: 1 },
      { uncertainty: { score: 0.2, method: 'verifier' } }
    );
    expect(merged).toEqual({
      keep: 1,
      [LIRI_UNCERTAINTY_KEY]: { score: 0.2, method: 'verifier' },
    });
    expect(merged?.[LIRI_REASONING_TRACE_KEY]).toBeUndefined();
  });

  it('协商：请求头 accept / 扩展 URI 命中，缺省 false', () => {
    expect(acceptsUncertainty({})).toBe(false);
    expect(acceptsUncertainty({ header: 'ACCEPT' })).toBe(true);
    expect(acceptsUncertainty({ header: ['accept'] })).toBe(true);
    expect(
      acceptsUncertainty({ extensionUris: [A2A_UNCERTAINTY_EXTENSION_URI] })
    ).toBe(true);
    expect(acceptsUncertainty({ extensionUris: ['urn:other'] })).toBe(false);
  });

  it('任务级汇总 = 最后一条带该键的消息（不重算）', () => {
    expect(
      lastUncertaintyFromMessages([
        {
          metadata: {
            [LIRI_UNCERTAINTY_KEY]: { score: 0.9, method: 'verifier' },
          },
        },
        { metadata: {} },
        {
          metadata: {
            [LIRI_UNCERTAINTY_KEY]: { score: 0.3, method: 'hybrid' },
          },
        },
      ])
    ).toEqual({ score: 0.3, method: 'hybrid' });
    expect(lastUncertaintyFromMessages([{ metadata: {} }])).toBeNull();
  });
});

describe('D5：ACP done._meta 透传', () => {
  async function* stream(
    events: AcpRuntimeEvent[]
  ): AsyncIterable<AcpRuntimeEvent> {
    for (const event of events) yield event;
  }

  it('有 _meta ⇒ 结果带 uncertaintyMeta；无 ⇒ 不带该键', async () => {
    const meta = { [LIRI_UNCERTAINTY_KEY]: { score: 0.4, method: 'verifier' } };
    const withMeta = await consumeTurnStream(
      stream([
        { type: 'text_delta', text: 'hi' },
        { type: 'done', stopReason: 'end_turn', _meta: meta },
      ])
    );
    expect(withMeta.uncertaintyMeta).toEqual(meta);

    const without = await consumeTurnStream(
      stream([{ type: 'done', stopReason: 'end_turn' }])
    );
    expect('uncertaintyMeta' in without).toBe(false);
  });
});

describe('D5：A2A 委派注入（仅协商 + 有产出方）', () => {
  function fakePort(): { port: A2APortSlice; tasks: Map<string, A2ATask> } {
    const tasks = new Map<string, A2ATask>();
    let seq = 0;
    const state = (s: string) => ({
      state: s,
      timestamp: new Date(0).toISOString(),
    });
    const port = {
      createTask: () => {
        const task: A2ATask = {
          id: `t${++seq}`,
          contextId: 'ctx',
          status: state('TASK_STATE_SUBMITTED') as never,
        };
        tasks.set(task.id, task);
        return task;
      },
      completeTask: (
        id: string,
        s: string,
        artifacts: unknown[],
        message?: unknown
      ) => {
        const prev = tasks.get(id) as A2ATask;
        const next: A2ATask = {
          ...prev,
          status: state(s) as never,
          artifacts: artifacts as never,
          ...(message ? { history: [message as never] } : {}),
        };
        tasks.set(id, next);
        return next;
      },
      getTask: (id: string) => tasks.get(id) ?? null,
    };
    return { port: port as unknown as A2APortSlice, tasks };
  }

  it('协商 + 产出方有信号 ⇒ 写 liri.*（无脱敏 ⇒ 只保留 score/kind）', async () => {
    setA2ADelegator(async () => '委派结果');
    setA2AUncertaintyProvider(() => ({
      uncertainty: {
        score: 0.126,
        method: 'verifier',
        rationale: 'secret 原因',
      },
      trace: [{ kind: 'plan', summary: 'secret 细节' }],
    }));

    const { port } = fakePort();
    const { completed, task } = await runDelegation(
      port,
      'hi',
      undefined,
      2000,
      true
    );

    expect(completed).toBe(true);
    expect(task.metadata?.[LIRI_UNCERTAINTY_KEY]).toEqual({
      score: 0.13,
      method: 'verifier',
    });
    expect(task.metadata?.[LIRI_REASONING_TRACE_KEY]).toEqual([
      { step: 1, kind: 'plan' },
    ]);
  });

  it('未协商 / 无产出方 / 越界值 ⇒ 响应不含 liri.* 键', async () => {
    setA2ADelegator(async () => 'ok');
    const { port } = fakePort();

    setA2AUncertaintyProvider(() => ({
      uncertainty: { score: 0.2, method: 'verifier' },
    }));
    const notNegotiated = await runDelegation(
      port,
      'hi',
      undefined,
      2000,
      false
    );
    expect(notNegotiated.task.metadata?.[LIRI_UNCERTAINTY_KEY]).toBeUndefined();

    setA2AUncertaintyProvider(null);
    const noProvider = await runDelegation(port, 'hi', undefined, 2000, true);
    expect(noProvider.task.metadata?.[LIRI_UNCERTAINTY_KEY]).toBeUndefined();

    setA2AUncertaintyProvider(() => ({
      uncertainty: { score: 5, method: 'verifier' },
    }));
    const invalid = await runDelegation(port, 'hi', undefined, 2000, true);
    expect(invalid.task.metadata?.[LIRI_UNCERTAINTY_KEY]).toBeUndefined();
  });
});
