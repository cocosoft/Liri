/**
 * ModelRouter 路由解析（D11 测试覆盖）
 *
 * 覆盖 resolve() 的同步路由逻辑（任务配置 → UUID 解析 → default/current 兜底、
 * 能力任务不兜底），通过注入内存缓存测试，不触碰 DB。
 * 说明：UUID 缓存未命中路径会触发异步预加载（读 DB），此处不测，避免测试副作用。
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  ModelRouter,
  ALL_TASK_TYPES,
  DEFAULT_PHASE_TASK_MAP,
  detectPhase,
} from '../modelRouter.js';

/** 通过单例注入内存缓存（TS private 仅编译期限制） */
function seedRouter(
  router: ModelRouter,
  opts: {
    tasks?: Record<string, string>;
    current?: string;
    defaultModel?: string;
    uuidMap?: Record<string, string>;
  }
) {
  const r = router as unknown as {
    _taskCache: Map<string, string>;
    _currentModel: string;
    defaultModel: string;
    uuidToModelName: Map<string, string>;
    _phaseMapping: Record<string, string>;
  };
  r._taskCache.clear();
  r._currentModel = opts.current ?? '';
  r.defaultModel = opts.defaultModel ?? '';
  r.uuidToModelName.clear();
  r._phaseMapping = {};
  for (const [k, v] of Object.entries(opts.tasks ?? {})) r._taskCache.set(k, v);
  for (const [k, v] of Object.entries(opts.uuidMap ?? {}))
    r.uuidToModelName.set(k, v);
}

describe('ModelRouter.resolve 路由解析', () => {
  const router = ModelRouter.getInstance();
  const UUID = '2b3fdf83-4ca7-44f4-9c89-e8e4f5e322f4';

  beforeEach(() => seedRouter(router, {}));

  test('配置任务 + 直接模型名 → 返回模型名', () => {
    seedRouter(router, { tasks: { chat: 'deepseek-v4-flash' } });
    expect(router.resolve('chat')).toBe('deepseek-v4-flash');
  });

  test('配置任务 + UUID → 缓存命中转模型名', () => {
    seedRouter(router, {
      tasks: { quick: UUID },
      uuidMap: { [UUID]: 'deepseek-v4-flash' },
    });
    expect(router.resolve('quick')).toBe('deepseek-v4-flash');
  });

  test('未配置任务 → 回退 default（模型名）', () => {
    seedRouter(router, {
      tasks: { default: 'deepseek-v4-pro' },
    });
    expect(router.resolve('chat')).toBe('deepseek-v4-pro');
  });

  test('未配置任务 → 回退 default（UUID 缓存命中）', () => {
    seedRouter(router, {
      tasks: { default: UUID },
      uuidMap: { [UUID]: 'deepseek-v4-pro' },
    });
    expect(router.resolve('translation')).toBe('deepseek-v4-pro');
  });

  test('能力任务（embedding/image）即使有 default 也不回退对话模型', () => {
    seedRouter(router, {
      tasks: { default: 'deepseek-v4-pro' },
    });
    expect(router.resolve('embedding')).toBe('');
    expect(router.resolve('image')).toBe('');
  });

  test('default 未配置 → 回退 current', () => {
    seedRouter(router, { current: 'current-model' });
    expect(router.resolve('chat')).toBe('current-model');
  });

  test('全部未配置 → 返回硬编码默认（空串）', () => {
    expect(router.resolve('chat')).toBe('');
  });

  test('显式任务优先级高于 default', () => {
    seedRouter(router, {
      tasks: { chat: 'chat-model', default: 'default-model' },
    });
    expect(router.resolve('chat')).toBe('chat-model');
  });

  test('getTasks 读取内存缓存', () => {
    seedRouter(router, { tasks: { chat: 'm1', coding: 'm2' } });
    const tasks = router.getTasks();
    expect(tasks.chat).toBe('m1');
    expect(tasks.coding).toBe('m2');
    expect(Object.keys(tasks).length).toBe(2);
  });
});

describe('resolveWithPhase 阶段路由', () => {
  const router = ModelRouter.getInstance();

  beforeEach(() => seedRouter(router, {}));

  test('阶段直配模型（UUID 命中）优先', () => {
    const uuid = '2b3fdf83-4ca7-44f4-9c89-e8e4f5e322f4';
    seedRouter(router, { uuidMap: { [uuid]: 'deepseek-v4-pro' } });
    const r = router as unknown as { _phaseMapping: Record<string, string> };
    r._phaseMapping = { plan: uuid };
    expect(
      router.resolveWithPhase('chat', { phase: 'plan', confidence: 0.9 })
    ).toBe('deepseek-v4-pro');
  });

  test('低置信度 → 降级为原始任务', () => {
    seedRouter(router, {
      tasks: { chat: 'chat-model' },
      uuidMap: { '2b3fdf83-4ca7-44f4-9c89-e8e4f5e322f4': 'plan-model' },
    });
    const r = router as unknown as { _phaseMapping: Record<string, string> };
    r._phaseMapping = { plan: '2b3fdf83-4ca7-44f4-9c89-e8e4f5e322f4' };
    expect(
      router.resolveWithPhase('chat', { phase: 'plan', confidence: 0.5 })
    ).toBe('chat-model');
  });
});

describe('ModelRouter.resolveRole（P3 role 路由）', () => {
  const router = ModelRouter.getInstance();
  const UUID = '2b3fdf83-4ca7-44f4-9c89-e8e4f5e322f4';

  beforeEach(() => seedRouter(router, {}));

  test('配置 verifier + 直接模型名 → 返回该模型', () => {
    seedRouter(router, { tasks: { verifier: 'deepseek-v4-pro' } });
    expect(router.resolveRole('verifier')).toBe('deepseek-v4-pro');
  });

  test('配置 verifier + UUID → 缓存命中转模型名', () => {
    seedRouter(router, {
      tasks: { verifier: UUID },
      uuidMap: { [UUID]: 'deepseek-v4-pro' },
    });
    expect(router.resolveRole('verifier')).toBe('deepseek-v4-pro');
  });

  test('验收 #6：未配置角色 → 返回空（消费端回退现状路由）', () => {
    seedRouter(router, { tasks: { default: 'deepseek-v4-flash' } });
    expect(router.resolveRole('verifier')).toBe('');
    expect(router.resolveRole('generator')).toBe('');
  });

  test('generator 角色同样解析', () => {
    seedRouter(router, { tasks: { generator: 'gen-model' } });
    expect(router.resolveRole('generator')).toBe('gen-model');
  });
});

describe('检测与定义', () => {
  test('detectPhase 关键词分类', () => {
    expect(detectPhase('请分析这个架构方案')?.phase).toBe('plan');
    expect(detectPhase('帮我修复这个 bug')?.phase).toBe('do');
    expect(detectPhase('检查一下这段代码')?.phase).toBe('check');
    expect(detectPhase('帮我总结一下')?.phase).toBe('act');
    expect(detectPhase('你好')).toBeUndefined();
  });

  test('DEFAULT_PHASE_TASK_MAP 覆盖四个阶段', () => {
    expect(Object.keys(DEFAULT_PHASE_TASK_MAP).sort()).toEqual([
      'act',
      'check',
      'do',
      'plan',
    ]);
  });

  test('ALL_TASK_TYPES 包含全部 19 个任务类型', () => {
    expect(ALL_TASK_TYPES).toContain('default');
    expect(ALL_TASK_TYPES).toContain('chat');
    expect(ALL_TASK_TYPES).toContain('quick');
    expect(ALL_TASK_TYPES).toContain('embedding');
    expect(ALL_TASK_TYPES).toContain('knowledge_compile');
    expect(ALL_TASK_TYPES).toContain('image');
    expect(ALL_TASK_TYPES).toContain('video');
    expect(ALL_TASK_TYPES.length).toBe(19);
  });
});
