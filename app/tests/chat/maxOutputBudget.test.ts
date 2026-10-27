// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * BUG-C（2026-10-27 真机长程任务）：聊天输出预算的事实来源。
 *
 * 实测：4 次 LLM 调用 `outputTokens` 全部恰好 `4096`（整点值）⇒ 写大文件参数被截断。
 * 根因：`streamMessageFlow` / `streamingLlm` 在调用方未给 `maxTokens` 时**硬编码 4096**，
 * 而模型真实输出上限在 DB 的 `model_registry.max_output_tokens`。
 *
 * 本用例锁定 `resolveMaxOutputTokens` 的取值链（DB 优先 / 未知不臆造 / 窗口封顶）。
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { resolveMaxOutputTokens } from '../../src/chat/services/ChatHelper.js';
import { ModelRegistry } from '../../src/ai/models/ModelRegistry.js';

describe('BUG-C：resolveMaxOutputTokens 以 DB 模型属性为准', () => {
  beforeEach(() => {
    ModelRegistry.resetCacheForTest();
  });

  it('DB 声明 65536 且窗口 128K ⇒ 封顶为窗口一半 64000（不再硬编码 4096）', () => {
    ModelRegistry.getInstance().discoverModel('bug-c-big', {
      contextWindow: 128000,
      maxOutputTokens: 65536,
    });
    expect(resolveMaxOutputTokens('bug-c-big')).toBe(64000);
  });

  it('输出预算超过窗口一半 ⇒ 按窗口一半封顶（防 400）', () => {
    ModelRegistry.getInstance().discoverModel('bug-c-small', {
      contextWindow: 8192,
      maxOutputTokens: 65536,
    });
    expect(resolveMaxOutputTokens('bug-c-small')).toBe(4096);
  });

  it('未知模型 / 空模型名 ⇒ undefined（不臆造，调用方保留原兜底）', () => {
    expect(resolveMaxOutputTokens('bug-c-unknown')).toBeUndefined();
    expect(resolveMaxOutputTokens('')).toBeUndefined();
    expect(resolveMaxOutputTokens(undefined)).toBeUndefined();
  });

  it('模型名为兜底默认值 4096 ⇒ 原样返回（不放大也不缩小）', () => {
    ModelRegistry.getInstance().discoverModel('bug-c-default', {
      contextWindow: 200000,
      maxOutputTokens: 4096,
    });
    expect(resolveMaxOutputTokens('bug-c-default')).toBe(4096);
  });
});
