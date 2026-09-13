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

/** 记录 service 调用 + 重置内存缓存 */
function seed(opts: { tasks?: Record<string, string> }) {
  const r = router as unknown as { _taskCache: Map<string, string> };
  r._taskCache.clear();
  for (const [k, v] of Object.entries(opts.tasks ?? {})) r._taskCache.set(k, v);
}

beforeEach(() => {
  seed({});
});

afterEach(() => {
  // spy 在用例内显式 restore；bun:test 文件级隔离无跨文件污染
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

    expect(setSpy).toHaveBeenCalledWith('chat', { model: 'new-chat' });
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
