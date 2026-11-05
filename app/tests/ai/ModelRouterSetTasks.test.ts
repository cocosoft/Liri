// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ModelRouter.setTasks 清除语义（Teamwork P3 收尾，2026-09-07，预存问题 K 补充 2-B）
 *
 * 覆盖：PUT /v1/models/tasks 提交空串值 → 删除对应任务/role 配置（DB 行 + _taskCache），
 * 使前端清空下拉（"— 未设置（跟随默认）—"）保存后后端真正恢复"未配置"态。
 * 通过 spy AppModelConfigService 单例（initialize/setConfig/deleteConfig）避免触碰 DB。
 */
import { describe, expect, test, beforeEach, afterEach, spyOn } from 'bun:test';
import { ModelRouter } from '../../src/ai/modelRouter.js';
import type { TaskModelConfig } from '../../src/ai/modelRouter.js';
import { appModelConfigService } from '../../src/ai/models/AppModelConfigService.js';

const router = ModelRouter.getInstance();

type RouterInternals = { _taskCache: Map<string, string> };
const internals = (): RouterInternals => router as unknown as RouterInternals;

/**
 * 进程级单例的**进场快照**（2026-11-05 修复）：
 * `ModelRouter` 是进程单例，`_taskCache` 的写入会**跨文件存活**。本文件此前只 `seed({})` 清空、
 * 从不还原 ⇒ 用例留下的 `chat=new-chat` / `default=deepseek-v4-flash` 会泄漏到后续文件，
 * 实测使 `tests/chat/taorLoopResumeWiring` 的 3 个 `sendMessage` 委托路径用例在**全量**跑时变红
 * （单跑/窄跑全绿）。故改为「进场快照 → 逐例还原」。
 */
let originalTasks: Map<string, string>;

/** 记录 service 调用 + 重置内存缓存 */
function seed(opts: { tasks?: Record<string, string> }) {
  const r = internals();
  // 2026-09-27：此处**保持严格形态，不做兜底**。`_taskCache` 缺失只可能说明
  // `getInstance()` 拿到的不是真身而是别的测试留下的 stub —— 该现象的真实成因是
  // `resolveModelRoute.test.ts` 曾用 `mock.module('@modules/ai/modelRouter.js')`
  // 替换整个模块并跨文件泄漏（macOS CI 实测 `TypeError: router.setTasks is not a
  // function`）；该处已改为 `spyOn`（可还原、不外溢）。保留严格断言作为哨兵：
  // 一旦同类泄漏再现，这里会立刻红，而不是被 `??=` 掩盖成假绿。
  r._taskCache.clear();
  for (const [k, v] of Object.entries(opts.tasks ?? {})) r._taskCache.set(k, v);
}

beforeEach(() => {
  originalTasks = new Map(internals()._taskCache);
  seed({});
});

afterEach(() => {
  // 还原进场快照（避免进程级单例把本文件的 `_taskCache` 泄漏给后续测试文件）
  const cache = internals()._taskCache;
  cache.clear();
  for (const [k, v] of originalTasks) cache.set(k, v);
});

describe('ModelRouter.setTasks 空串清除语义（K 补充 2-B）', () => {
  test('空串值 → 删除 DB 配置 + 内存缓存（role 清空场景）', async () => {
    const initSpy = spyOn(
      appModelConfigService,
      'initialize'
    ).mockResolvedValue(undefined);
    const setSpy = spyOn(appModelConfigService, 'setConfig').mockResolvedValue(
      undefined
    );
    const delSpy = spyOn(
      appModelConfigService,
      'deleteConfig'
    ).mockResolvedValue(true);

    seed({ tasks: { generator: 'c04a930f-0e02-498c-9427-8b43f1548f22' } });
    await router.setTasks({ generator: '' } as TaskModelConfig);

    expect(delSpy).toHaveBeenCalledWith('generator');
    expect(setSpy).not.toHaveBeenCalled();
    const r = router as unknown as { _taskCache: Map<string, string> };
    expect(r._taskCache.has('generator')).toBe(false);
    expect(router.resolveRole('generator')).toBe('');

    initSpy.mockRestore();
    setSpy.mockRestore();
    delSpy.mockRestore();
  });

  test('混合提交：有值键 upsert、空串键删除、非空键保留', async () => {
    const initSpy = spyOn(
      appModelConfigService,
      'initialize'
    ).mockResolvedValue(undefined);
    const setSpy = spyOn(appModelConfigService, 'setConfig').mockResolvedValue(
      undefined
    );
    const delSpy = spyOn(
      appModelConfigService,
      'deleteConfig'
    ).mockResolvedValue(true);

    seed({
      tasks: {
        chat: 'old-chat',
        verifier: 'f7b9d835-8587-4f53-8c24-1a0ab86a6ff6',
      },
    });
    await router.setTasks({
      chat: 'new-chat',
      verifier: '',
    } as TaskModelConfig);

    // N-46（2026-09-20）：用户保存路径携带 source='user'（使该任务在 chat 类 route 上
    // 优先于 SmartRouter 档位）⇒ 断言随之更新。
    expect(setSpy).toHaveBeenCalledWith('chat', {
      model: 'new-chat',
      source: 'user',
    });
    expect(delSpy).toHaveBeenCalledWith('verifier');
    const r = router as unknown as { _taskCache: Map<string, string> };
    expect(r._taskCache.get('chat')).toBe('new-chat');
    expect(r._taskCache.has('verifier')).toBe(false);
    expect(router.resolveRole('verifier')).toBe('');

    initSpy.mockRestore();
    setSpy.mockRestore();
    delSpy.mockRestore();
  });

  test('default 空串跳过（deleteConfig 禁止删 default，保持静默不 500）', async () => {
    const initSpy = spyOn(
      appModelConfigService,
      'initialize'
    ).mockResolvedValue(undefined);
    const setSpy = spyOn(appModelConfigService, 'setConfig').mockResolvedValue(
      undefined
    );
    const delSpy = spyOn(
      appModelConfigService,
      'deleteConfig'
    ).mockResolvedValue(true);

    seed({ tasks: { default: 'deepseek-v4-flash' } });
    await router.setTasks({ default: '' } as TaskModelConfig);

    expect(delSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    const r = router as unknown as { _taskCache: Map<string, string> };
    expect(r._taskCache.has('default')).toBe(true); // 原缓存保留（现状语义）

    initSpy.mockRestore();
    setSpy.mockRestore();
    delSpy.mockRestore();
  });
});
