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
  findInvalidTaskAssignmentValues,
  pickChangedTaskAssignments,
  validateTaskRoutingTargets,
  type TaskRoutingValidationDeps,
} from '../../src/ai/api/ModelRuntimeAPI';

type ModelStub = { displayName: string; providerId: string; enabled: boolean };
type ProviderStub = {
  id?: string;
  providerType: string;
  name: string;
  isActive: boolean;
};

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

/**
 * 2026-11-04：`model_registry.provider_id` 的两种形态都要认。
 *
 * 缺陷现场：把 `local` 从 SiliconFlow 切到**已激活**的 Ollama（`qwen3.6-27b:latest`）时
 * 400「其供应商「645e47b5-…」未注册」—— 该记录存的是 `ai_providers.id`（UUID 强绑定，
 * 也是 N-59 级联停用的口径），而校验器只按 `provider_type` 匹配。
 */
describe('provider_id 两种形态（UUID 强绑定 / provider_type 松绑定）', () => {
  const OLLAMA_UUID = '645e47b5-8139-470b-b655-c1ba1f2e8368';
  const OLLAMA_MODEL: ModelStub = {
    displayName: 'qwen3.6-27b:latest',
    providerId: OLLAMA_UUID,
    enabled: true,
  };
  const ACTIVE_OLLAMA: ProviderStub = {
    id: OLLAMA_UUID,
    providerType: 'ollama',
    name: 'Ollama',
    isActive: true,
  };

  test('UUID 强绑定 + 供应商已注册 ⇒ 通过（本次实测缺陷）', async () => {
    expect(
      await validateTaskRoutingTargets(
        { local: 'ollama-model-id' },
        makeDeps({ 'ollama-model-id': OLLAMA_MODEL }, [ACTIVE_OLLAMA])
      )
    ).toEqual([]);
  });

  test('UUID 指向未注册供应商 ⇒ 仍报「未注册」（防线不松）', async () => {
    const problems = await validateTaskRoutingTargets(
      { local: 'ollama-model-id' },
      makeDeps({ 'ollama-model-id': OLLAMA_MODEL }, [ACTIVE_DS])
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('未注册');
  });

  test('UUID 强绑定但供应商未激活 ⇒ 仍报「未激活」', async () => {
    const problems = await validateTaskRoutingTargets(
      { local: 'ollama-model-id' },
      makeDeps({ 'ollama-model-id': OLLAMA_MODEL }, [
        { ...ACTIVE_OLLAMA, isActive: false },
      ])
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('未激活');
    expect(problems[0]).toContain('Ollama');
  });
});

/**
 * P2-6（2026-10-27）：全量 PUT 下只校验**改动的键**。
 *
 * 实测背景：`translation` / `quick` / `scheduled` / `embedding` 指向不可用供应商时，
 * 想改 `chat` 也会 400（校验把整张表都算进去）。
 */
describe('P2-6 任务分工：只校验本次改动的键', () => {
  const CURRENT = {
    chat: 'ds-id',
    agent: 'ds-id',
    translation: 'broken-id',
    embedding: 'broken-id',
  };

  test('未改动的遗留坏键被排除（核心回归）', () => {
    const changed = pickChangedTaskAssignments(
      { ...CURRENT, chat: 'new-id' },
      CURRENT
    );
    expect(changed).toEqual({ chat: 'new-id' });
  });

  test('新增键 / 清空键都算改动', () => {
    const changed = pickChangedTaskAssignments(
      { chat: 'ds-id', quick: 'new-id', translation: '' },
      CURRENT
    );
    expect(changed).toEqual({ quick: 'new-id', translation: '' });
  });

  test('改回原值（与现状相同）⇒ 不校验', () => {
    expect(pickChangedTaskAssignments({ chat: 'ds-id' }, CURRENT)).toEqual({});
  });

  test('null 视为改动（交由校验层按「非空才校验」处理）', () => {
    expect(pickChangedTaskAssignments({ chat: null }, CURRENT)).toEqual({
      chat: null,
    });
  });

  test('负向对照：真正改坏的键仍会被 N-72 拦住', async () => {
    const changed = pickChangedTaskAssignments(
      { ...CURRENT, chat: 'llama-id' },
      CURRENT
    );
    const problems = await validateTaskRoutingTargets(
      changed,
      makeDeps({ 'llama-id': LLAMA }, [ACTIVE_DS, INACTIVE_LLAMA])
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('chat');
    expect(problems[0]).toContain('已禁用');
  });
});

// I6（2026-11-08 真机）：把 `GET /v1/models/tasks` 的 `{tasks:{…}}` 原样 PUT 回来时，
// 对象进 SQLite 绑定参数 ⇒ 500 且把内部错误回给客户端。现改为入参形状先校验（400）。
describe('I6 任务分工入参形状校验', () => {
  test('包裹结构 {tasks:{…}} ⇒ 命中 tasks（实测触发路径）', () => {
    expect(
      findInvalidTaskAssignmentValues({ tasks: { agent: 'abc' } })
    ).toEqual(['tasks']);
  });

  test('非字符串值（数字/数组/布尔）⇒ 逐个报出', () => {
    expect(
      findInvalidTaskAssignmentValues({ agent: 123, chat: ['a'], quick: true })
    ).toEqual(['agent', 'chat', 'quick']);
  });

  test('扁平合法映射 / 空值 ⇒ 不报（空串/null 属"清空路由"）', () => {
    expect(findInvalidTaskAssignmentValues({})).toEqual([]);
    expect(
      findInvalidTaskAssignmentValues({
        agent: 'uuid-1',
        chat: '',
        local: null,
      })
    ).toEqual([]);
  });
});
