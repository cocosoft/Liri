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
import {
  resolveMaxOutputTokens,
  withTurnBudget,
} from '../../src/chat/services/ChatHelper.js';
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

/**
 * BUG-C 第二轮复验（2026-10-27 14:07Z）：真机非流式 + TAOR 路径 `outputTokens` 仍为
 * 4096 —— ① HTTP 未指定模型时 `model` 是占位哨兵 `pyapp-default`（查不到 DB）；
 * ② 非流式入口先前没走归一。本组锁定 `withTurnBudget` 的两条口径。
 */
describe('BUG-C：withTurnBudget 的入口归一', () => {
  beforeEach(() => {
    ModelRegistry.resetCacheForTest();
  });

  it('哨兵模型名视为「未指定」⇒ 用 client 默认模型取预算，且不覆盖原 model 名', async () => {
    ModelRegistry.getInstance().discoverModel('bug-c-client', {
      contextWindow: 128000,
      maxOutputTokens: 12000,
    });
    const out = await withTurnBudget<{ model?: string; maxTokens?: number }>(
      { model: 'pyapp-default' },
      { getConfiguredModel: () => 'bug-c-client' }
    );
    expect(out?.maxTokens).toBe(12000);
    // 下游仍按哨兵做默认路由：不得把 model 改成解析值
    expect(out?.model).toBe('pyapp-default');
  });

  it('显式模型名 ⇒ 直接按其 DB 预算补 maxTokens', async () => {
    ModelRegistry.getInstance().discoverModel('bug-c-explicit', {
      contextWindow: 128000,
      maxOutputTokens: 9000,
    });
    const out = await withTurnBudget<{ model?: string; maxTokens?: number }>({
      model: 'bug-c-explicit',
    });
    expect(out?.maxTokens).toBe(9000);
  });

  it('调用方已给 maxTokens ⇒ 原样返回（不覆盖用户/上层选择）', async () => {
    const input = { model: 'bug-c-explicit', maxTokens: 777 };
    const out = await withTurnBudget(input);
    expect(out).toBe(input);
    expect(out?.maxTokens).toBe(777);
  });

  it('解析不到模型 ⇒ 返回原对象（不臆造预算，保留下游 4096 兜底）', async () => {
    const input: { model?: string; maxTokens?: number } = {
      model: 'bug-c-nonexistent',
    };
    const out = await withTurnBudget(input);
    expect(out).toBe(input);
    expect(out?.maxTokens).toBeUndefined();
  });
});
