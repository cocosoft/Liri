/**
 * P0-3（2026-11-05）：路由层**工具能力硬拦截**（C1 告警版 → 派发前抛错）
 *
 * 现场：`agent` 任务被指到 Ollama `qwen3.6-27b`（未声明工具能力）⇒ provider 回退成
 * "无 tools" 请求，长程步骤空转、单轮被拖到 6 分钟（服务端 `does not support tools`）。
 *
 * 口径（本文件锁定）：
 *  ① 工具必用任务（`agent` / `coding`）+ **显式声明**了 capabilities 且不含
 *     `tool_use` / `function_calling` ⇒ 抛 `MODEL_TOOL_CAPABILITY_MISSING`（可读、可定位）；
 *  ② 能力**未声明**（空 / undefined）⇒ 放行（无法区分"不支持"与"没填"，拦截会误伤）；
 *  ③ 非工具任务（`chat` / `default`）⇒ 放行（模型能力与本次派发无关）。
 */
import { describe, expect, it } from 'bun:test';

import { AppError } from '@openliri/infra/error';

import { ModelCapability } from '../../src/ai/models/types';
import { enforceToolCapabilityGate } from '../../src/ai/modelRouter';

/** 捕获同步抛出的错误（不做断言，交给用例判断） */
function thrownBy(fn: () => void): unknown {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

describe('P0-3 派发前工具能力硬拦截', () => {
  it('agent + 显式声明无工具能力 ⇒ 抛可读的配置错误', () => {
    const err = thrownBy(() =>
      enforceToolCapabilityGate('agent', 'qwen3.6-27b', [
        ModelCapability.VISION,
      ])
    );

    expect(err).toBeInstanceOf(AppError);
    const appErr = err as AppError;
    expect(appErr.code).toBe('MODEL_TOOL_CAPABILITY_MISSING');
    expect(appErr.message).toContain('agent');
    expect(appErr.message).toContain('qwen3.6-27b');
    expect(appErr.message).toContain('任务分工');
  });

  it('coding + tool_use 或 function_calling ⇒ 放行', () => {
    expect(
      thrownBy(() =>
        enforceToolCapabilityGate('coding', 'm1', [ModelCapability.TOOL_USE])
      )
    ).toBeNull();
    expect(
      thrownBy(() =>
        enforceToolCapabilityGate('coding', 'm2', [
          ModelCapability.FUNCTION_CALLING,
        ])
      )
    ).toBeNull();
  });

  it('能力未声明（空数组 / undefined）⇒ 放行（不误伤"没填"）', () => {
    expect(
      thrownBy(() => enforceToolCapabilityGate('agent', 'm3', []))
    ).toBeNull();
    expect(
      thrownBy(() => enforceToolCapabilityGate('agent', 'm4', undefined))
    ).toBeNull();
  });

  it('非工具任务（chat / default）⇒ 放行，与模型能力无关', () => {
    expect(
      thrownBy(() =>
        enforceToolCapabilityGate('chat', 'm5', [ModelCapability.VISION])
      )
    ).toBeNull();
    expect(
      thrownBy(() =>
        enforceToolCapabilityGate('default', 'm6', [ModelCapability.VISION])
      )
    ).toBeNull();
  });
});
