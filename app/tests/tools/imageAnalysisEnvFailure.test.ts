// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-7（2026-11-28，真机 `session_mwz477wj251057474e` 15:15Z / 15:17Z 段）：
 * **本机缺可选模型 ⇒ env_unavailable，不得计 invalid turn**。
 *
 * 现场：`analyze.l2.ocr` 失败（`Model 'easyocr' is not installed`，worker 侧
 * `code=MODEL_NOT_INSTALLED`），降级 L3 失败后按通用失败返回 ⇒ 计入
 * `consecutiveInvalidTurns`（模型没错，是本机缺依赖）。
 *
 * 本文件锁定判据：**只认结构化 `code`**（CS02，不解析错误文案）；非环境类一律 `undefined`，
 * 保持"真实工具失败仍计 invalid"的洗白防线。
 */
import { describe, expect, it } from 'bun:test';
import { envFailureKindOf } from '../../../packages/tool-media/src/tool-media/ImageAnalysisTool';

describe('envFailureKindOf：Python RPC 失败的环境层分型', () => {
  it('MODEL_NOT_INSTALLED（本机缺可选模型）⇒ env_unavailable', () => {
    const err = Object.assign(new Error("Model 'easyocr' is not installed"), {
      code: 'MODEL_NOT_INSTALLED',
    });
    expect(envFailureKindOf(err)).toBe('env_unavailable');
  });

  it('PYTHON_UNAVAILABLE / WORKER_NOT_READY（worker 不可用）⇒ env_unavailable', () => {
    expect(envFailureKindOf({ code: 'PYTHON_UNAVAILABLE' })).toBe(
      'env_unavailable'
    );
    expect(envFailureKindOf({ code: 'WORKER_NOT_READY' })).toBe(
      'env_unavailable'
    );
  });

  it('负向：真实模型错误 / 内部错误 / 无 code / 非对象 ⇒ undefined（不洗白）', () => {
    expect(envFailureKindOf({ code: 'MODEL_ERROR' })).toBeUndefined();
    expect(envFailureKindOf({ code: 'INTERNAL_ERROR' })).toBeUndefined();
    expect(envFailureKindOf(new Error('boom'))).toBeUndefined();
    expect(envFailureKindOf({ code: 1 })).toBeUndefined();
    expect(envFailureKindOf(null)).toBeUndefined();
    expect(envFailureKindOf(undefined)).toBeUndefined();
    expect(envFailureKindOf('MODEL_NOT_INSTALLED')).toBeUndefined();
  });
});
