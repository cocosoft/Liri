/**
 * D5（2026-11-18）：A2A 不确定性**产出方**单测
 *
 * 覆盖：纯映射边界（无信号 / 越界 / 缺 confidence）、taskId→sessionId 登记、
 * provider 取值、开关默认关、委派后端登记行为（含缺省 ctx 不登记）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  A2A_UNCERTAINTY_VERIFIER_ENV,
  createVerifierUncertaintyProvider,
  isA2AUncertaintyVerifierEnabled,
  registerA2ATaskSession,
  resetA2ATaskSessions,
  resolveA2ASessionForTask,
  toUncertaintySignal,
} from '../../src/infrastructure/http/handlers/routes/a2a-uncertainty';
import { createCoreApiDelegator } from '../../src/infrastructure/http/handlers/routes/a2a-delegator';
import {
  recordVerifierResult,
  resetVerifierMetrics,
} from '@modules/query/taor/verifierMetrics';

const ENV_BEFORE = process.env[A2A_UNCERTAINTY_VERIFIER_ENV];

beforeEach(() => {
  resetA2ATaskSessions();
  resetVerifierMetrics();
});

afterEach(() => {
  if (ENV_BEFORE === undefined)
    delete process.env[A2A_UNCERTAINTY_VERIFIER_ENV];
  else process.env[A2A_UNCERTAINTY_VERIFIER_ENV] = ENV_BEFORE;
});

describe('toUncertaintySignal（纯映射）', () => {
  it('无结果 ⇒ null（不发字段）', () => {
    expect(toUncertaintySignal(null)).toBeNull();
  });

  it('confidence 0.2 ⇒ score 0.8 / method=verifier / rationale 带结构化结论', () => {
    const signal = toUncertaintySignal({
      verdict: 'APPROVE',
      confidence: 0.2,
      checkPassRate: 0.5,
      turn: 1,
      at: 1,
    });
    expect(signal?.uncertainty).toEqual({
      score: 0.8,
      method: 'verifier',
      rationale: 'verdict=APPROVE; checkPassRate=0.5',
    });
  });

  it('缺 confidence ⇒ null（不造 0）', () => {
    expect(
      toUncertaintySignal({ verdict: 'APPROVE', turn: 1, at: 1 })
    ).toBeNull();
  });

  it('confidence 越界 / 非有限 ⇒ null（不夹取）', () => {
    for (const confidence of [
      Number.NaN,
      -0.1,
      1.5,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(
        toUncertaintySignal({ verdict: 'REJECT', confidence, turn: 1, at: 1 })
      ).toBeNull();
    }
  });
});

describe('taskId → sessionId 索引 + provider', () => {
  it('未登记 task ⇒ provider 返回 null', () => {
    const provider = createVerifierUncertaintyProvider();
    expect(provider('task-none')).toBeNull();
  });

  it('已登记但会话无验证器记录 ⇒ null（不猜测）', () => {
    registerA2ATaskSession('task-1', 'sess-1');
    expect(resolveA2ASessionForTask('task-1')).toBe('sess-1');
    expect(createVerifierUncertaintyProvider()('task-1')).toBeNull();
  });

  it('已登记 + 有验证器记录 ⇒ 返回真实信号', async () => {
    registerA2ATaskSession('task-2', 'sess-2');
    recordVerifierResult({
      sessionId: 'sess-2',
      turn: 1,
      verdict: 'ESCALATE',
      durationMs: 3,
      confidence: 0.6,
    });
    const signal = await createVerifierUncertaintyProvider()('task-2');
    expect(signal?.uncertainty).toMatchObject({
      score: 0.4,
      method: 'verifier',
    });
  });
});

describe('开关默认关', () => {
  it('缺省 ⇒ 关；显式 true（大小写/空白不敏感）⇒ 开', () => {
    delete process.env[A2A_UNCERTAINTY_VERIFIER_ENV];
    expect(isA2AUncertaintyVerifierEnabled()).toBe(false);
    process.env[A2A_UNCERTAINTY_VERIFIER_ENV] = ' TRUE ';
    expect(isA2AUncertaintyVerifierEnabled()).toBe(true);
  });
});

describe('委派后端登记 taskId → sessionId', () => {
  const fakeCore = {
    createSession: async () => ({ id: 'sess-from-core' }),
    chat: async () => ({ content: 'ok' }),
  };

  it('带 ctx.taskId ⇒ 登记；不带 ctx ⇒ 不登记（行为不变）', async () => {
    const delegator = createCoreApiDelegator(fakeCore);
    await delegator('hi', undefined, { taskId: 'task-a' });
    expect(resolveA2ASessionForTask('task-a')).toBe('sess-from-core');

    resetA2ATaskSessions();
    await delegator('hi');
    expect(resolveA2ASessionForTask('task-a')).toBeNull();
  });
});
