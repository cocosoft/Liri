/**
 * N-72（2026-09-25）：任务分工**保存时可用性校验**的回归锁。
 *
 * 实测背景：`agent` / `local` 曾指向 `enabled=0` 的模型（其 provider `llamacpp` 的
 * `is_active=0`）却被成功存下，直到子代理执行才报"未解析到可用供应商"。
 *
 * 采集方式：**注入依赖桩**（`validateTaskRoutingTargets(body, deps)`）——
 * 不读真实 DB、**不使用 `mock.module`**（进程级替换会跨测试文件泄漏）。
 */
import { describe, test, expect } from 'bun:test';
import {
  validateTaskRoutingTargets,
  type TaskRoutingValidationDeps,
} from '../../src/ai/api/ModelRuntimeAPI';

type ModelStub = { displayName: string; providerId: string; enabled: boolean };
type ProviderStub = { providerType: string; name: string; isActive: boolean };

function makeDeps(
  models: Record<string, ModelStub>,
  providers: ProviderStub[]
): TaskRoutingValidationDeps {
  return {
    getPricingById: async (id) => models[id],
    getPricing: async (modelId) => models[modelId],
    listProviders: async () => providers,
  };
}

const DEEPSEEK: ModelStub = {
  displayName: 'DeepSeek V4 Flash',
  providerId: 'deepseek',
  enabled: true,
};
const LLAMA: ModelStub = {
  displayName: 'Llama 3.1 8B (llama.cpp)',
  providerId: 'llamacpp',
  enabled: false,
};
const ACTIVE_DS: ProviderStub = {
  providerType: 'deepseek',
  name: 'DeepSeek',
  isActive: true,
};
const INACTIVE_LLAMA: ProviderStub = {
  providerType: 'llamacpp',
  name: 'Llama.cpp',
  isActive: false,
};

describe('N-72 任务分工保存时可用性校验', () => {
  test('空 body / 空值 ⇒ 通过（清空路由是合法操作）', async () => {
    const deps = makeDeps({}, []);
    expect(await validateTaskRoutingTargets({}, deps)).toEqual([]);
    expect(
      await validateTaskRoutingTargets(
        { agent: '', local: '   ', chat: null },
        deps
      )
    ).toEqual([]);
  });

  test('模型不存在（已删除）⇒ 报「不存在」', async () => {
    const problems = await validateTaskRoutingTargets(
      { agent: 'ghost-uuid' },
      makeDeps({}, [ACTIVE_DS])
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('不存在');
    expect(problems[0]).toContain('agent');
  });

  test('模型已禁用（enabled=0）⇒ 报「已禁用」（实测触发路径）', async () => {
    const problems = await validateTaskRoutingTargets(
      { agent: 'llama-id' },
      makeDeps({ 'llama-id': LLAMA }, [ACTIVE_DS, INACTIVE_LLAMA])
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('已禁用');
    expect(problems[0]).toContain('Llama 3.1 8B (llama.cpp)');
  });

  test('供应商未注册 ⇒ 报「未注册」', async () => {
    const problems = await validateTaskRoutingTargets(
      { agent: 'orphan-id' },
      makeDeps(
        {
          'orphan-id': {
            displayName: 'Orphan',
            providerId: 'unknown_provider',
            enabled: true,
          },
        },
        [ACTIVE_DS]
      )
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('未注册');
    expect(problems[0]).toContain('unknown_provider');
  });

  test('供应商未激活（is_active=0）⇒ 报「未激活」', async () => {
    const problems = await validateTaskRoutingTargets(
      { local: 'llama-on-id' },
      makeDeps(
        {
          'llama-on-id': {
            displayName: 'Llama 3.1 8B (llama.cpp)',
            providerId: 'llamacpp',
            enabled: true,
          },
        },
        [ACTIVE_DS, INACTIVE_LLAMA]
      )
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('未激活');
    expect(problems[0]).toContain('Llama.cpp');
  });

  test('模型可用（enabled + provider active）⇒ 通过', async () => {
    expect(
      await validateTaskRoutingTargets(
        { agent: 'ds-id', local: 'ds-id', chat: 'ds-id' },
        makeDeps({ 'ds-id': DEEPSEEK }, [ACTIVE_DS])
      )
    ).toEqual([]);
  });

  test('多键混合 ⇒ 逐键列出全部问题（不早退）', async () => {
    const problems = await validateTaskRoutingTargets(
      { agent: 'llama-id', local: 'ghost-uuid', chat: 'ds-id' },
      makeDeps({ 'llama-id': LLAMA, 'ds-id': DEEPSEEK }, [
        ACTIVE_DS,
        INACTIVE_LLAMA,
      ])
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('agent');
    expect(problems[1]).toContain('local');
  });

  test('按 modelId 也可解析（uuid 优先、兼容 modelId）', async () => {
    expect(
      await validateTaskRoutingTargets(
        { agent: 'deepseek-v4-flash' },
        makeDeps({ 'deepseek-v4-flash': DEEPSEEK }, [ACTIVE_DS])
      )
    ).toEqual([]);
  });

  test('**只读校验**：不修改传入的 body', async () => {
    const body: Record<string, unknown> = { agent: 'llama-id', chat: '' };
    await validateTaskRoutingTargets(
      body,
      makeDeps({ 'llama-id': LLAMA }, [ACTIVE_DS, INACTIVE_LLAMA])
    );
    expect(body).toEqual({ agent: 'llama-id', chat: '' });
  });
});
