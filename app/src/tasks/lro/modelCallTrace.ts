// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * modelCallTrace —— 单次模型调用的**慢调用**可观测（2026-11-08，真机 `pdca_mw7t9rj9`）。
 *
 * 为什么用定时器而不是"返回后比时长"：规划调用一旦**长时间不返回**，返回后的判断
 * 永远执行不到 ⇒ 日志里一条都没有（用户视角是"卡死"，排查时也无法区分"在等模型"
 * 与"死锁"）。定时器在**调用进行中**就留痕，模型回来后再清掉。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { SLOW_MODEL_CALL_WARN_MS } from './defaults.js';

const logger = getLogger('tasks:longRunning');

/**
 * 开始监视一次模型调用；返回**清理函数**（必须挂到 `finally` 或 `.finally()`）。
 *
 * @example
 * const stop = watchSlowModelCall({ taskId, model, taskType });
 * const res = await service.generate(...).finally(stop);
 */
export function watchSlowModelCall(info: {
  taskId: string;
  model: string;
  taskType: string;
  maxTokens?: number;
}): () => void {
  const startMs = Date.now();
  const timer = setTimeout(() => {
    logger.warn('LLM 调用仍在等待（未返回）—— 在等模型，非死锁', {
      taskId: info.taskId,
      model: info.model,
      taskType: info.taskType,
      elapsedMs: Date.now() - startMs,
      maxTokens: info.maxTokens ?? null,
    });
  }, SLOW_MODEL_CALL_WARN_MS);
  // 不因该定时器拖住进程退出
  timer.unref?.();
  return () => clearTimeout(timer);
}
