// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * BUG-F（2026-10-27 真机）：**工具参数被截断后不得只报「缺参数」**。
 *
 * 事故（14:01:13Z，`session_mvqr6vtfe9b47d73c9`）：`file_write` 的参数串
 * `rawLength=12068`，`JSON.parse` 失败 ⇒ 适配器降级为空参数 `{}` ⇒ 模型只收到
 * `Missing required parameter: file_path` ⇒ 它无法区分"漏传"与"输出被截断"，原样重试
 * 两次后 `diminishing_returns` 收尾，任务零产出。
 *
 * 修法：适配器把「解析失败 + 原始长度」作为**保留键诊断**带给执行层，缺参文案据此外显
 * "参数不完整 / 可能被截断 + 分段写入建议"；执行前剥除该键（不污染工具入参）。
 *
 * 安全边界：保留键**只带原始长度**，不带参数内容前缀（该键会随 assistant `tool_calls`
 * 落盘并在后续轮回放给模型 —— 真机 `session_mvqstue8ecef7606df` 实测）。
 */
import { describe, expect, it } from 'bun:test';

import {
  ARG_PARSE_ERROR_KEY,
  describeMissingRequiredParams,
  getArgParseError,
  stripArgParseErrorKey,
  withArgParseError,
} from '../../src/utils/toolContract/argParseError.js';
import { TransportProviderAdapter } from '../../src/ai/transports/TransportProviderAdapter.js';
import type { NormalizedResponse } from '../../src/ai/transports/types.js';

describe('保留键契约：写入 / 读取 / 剥除', () => {
  it('往返：写入后可按长度读回，载荷只含原始长度', () => {
    const input = withArgParseError({ rawLength: 12068 });
    expect(getArgParseError(input)?.rawLength).toBe(12068);
    expect(Object.keys(input)).toEqual([ARG_PARSE_ERROR_KEY]);
    // 载荷形状锁死：不得夹带参数内容前缀
    expect(Object.keys(input[ARG_PARSE_ERROR_KEY] as object)).toEqual([
      'rawLength',
    ]);
  });

  it('剥除后不残留保留键（其余键原样保留）', () => {
    const input = {
      file_path: 'a.md',
      [ARG_PARSE_ERROR_KEY]: { rawLength: 1 },
    };
    expect(stripArgParseErrorKey(input)).toEqual({ file_path: 'a.md' });
  });

  it('负向：非该形态 / undefined ⇒ 无诊断', () => {
    expect(getArgParseError(undefined)).toBeUndefined();
    expect(getArgParseError({})).toBeUndefined();
    expect(getArgParseError({ [ARG_PARSE_ERROR_KEY]: 'oops' })).toBeUndefined();
  });
});

describe('缺参文案：三档依据（禁止解析文本反推 —— CS02）', () => {
  it('① 解析失败 ⇒ 明确「参数不完整/被截断」+ 分段写入建议', () => {
    const detail = describeMissingRequiredParams(
      withArgParseError({ rawLength: 12068 }),
      ['file_path'],
      ['file_path', 'content']
    );
    expect(
      detail.error.startsWith('Missing required parameter: file_path')
    ).toBe(true);
    expect(detail.error).toContain('参数 JSON 不完整');
    expect(detail.error).toContain('12068');
    expect(detail.error).toContain('分段');
    // 收到键里也不应把保留键算进去
    expect(detail.receivedKeys).toEqual([]);
    expect(detail.parseErr?.rawLength).toBe(12068);
  });

  it('② 真·空参数 ⇒ 提示未携带任何参数', () => {
    const detail = describeMissingRequiredParams(
      {},
      ['file_path'],
      ['file_path']
    );
    expect(detail.error).toContain('未携带任何参数');
    expect(detail.parseErr).toBeUndefined();
  });

  it('③ 有键但漏必填 ⇒ 只回显收到的键，不臆测原因', () => {
    const detail = describeMissingRequiredParams(
      { content: 'x' },
      ['file_path'],
      ['file_path', 'content']
    );
    expect(detail.receivedKeys).toEqual(['content']);
    expect(detail.error).not.toContain('参数 JSON 不完整');
    expect(detail.error).not.toContain('未携带任何参数');
    expect(detail.systemContent).toContain('content');
  });
});

describe('适配器：解析失败 ⇒ 携带诊断（不再静默空参数）', () => {
  const makeNormalized = (args: string): NormalizedResponse =>
    ({
      content: '',
      model: 'm',
      finishReason: 'tool_calls',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
      },
      toolCalls: [{ id: 'call_1', name: 'file_write', arguments: args }],
    }) as unknown as NormalizedResponse;

  it('非法/截断 JSON ⇒ tool_calls[0].arguments 带保留键，长度与原始串一致', () => {
    // 模拟被截断：开头合法、结尾未闭合
    const truncated =
      '{"file_path": "workflow/game/index.html", "content": "<!DOCTYPE html>\\n<htm';
    const adapter = new TransportProviderAdapter({} as never);
    const res = adapter.toChatResponse(makeNormalized(truncated), 'm');
    const args = res.tool_calls?.[0]?.arguments as Record<string, unknown>;
    const info = getArgParseError(args);
    expect(info).toBeDefined();
    expect(info?.rawLength).toBe(truncated.length);
    // 落盘后会回放给模型的载荷：只有长度，不带内容前缀
    expect(
      Object.keys(args[ARG_PARSE_ERROR_KEY] as Record<string, unknown>)
    ).toEqual(['rawLength']);
    // 工具真正的必填键确实缺失（执行层据此走缺参分支）
    expect(args.file_path).toBeUndefined();
  });

  it('负向：合法 JSON ⇒ 原样参数，不含保留键', () => {
    const ok = '{"file_path":"a.md","content":"hi"}';
    const adapter = new TransportProviderAdapter({} as never);
    const res = adapter.toChatResponse(makeNormalized(ok), 'm');
    const args = res.tool_calls?.[0]?.arguments as Record<string, unknown>;
    expect(getArgParseError(args)).toBeUndefined();
    expect(args.file_path).toBe('a.md');
  });
});
