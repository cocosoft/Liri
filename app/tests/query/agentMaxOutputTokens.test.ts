/**
 * TAOR 输出上限解析（2026-10-31 真机取证）
 *
 * 现象：传输层缺省 `max_tokens=4096`，agent 轮把预算花在推理后开始写大参数
 * （`file_write` / `file_edit` 正文）⇒ 参数 JSON 在 4096 处被截断 ⇒ 缺参被拒 ⇒
 * 模型原样重试（单日 80 次）。`finish_reason` 仍是 `tool_calls`，走不到
 * `max_output` 翻倍分支，故必须在**传参处**给出高于 4096 的默认值。
 */
import { describe, expect, it } from 'bun:test';
import {
  MAX_OUTPUT_TOKENS_CEILING,
  TAOR_DEFAULT_MAX_OUTPUT_TOKENS,
  nextDoubledOutputCap,
  resolveAgentMaxOutputTokens,
} from '../../src/query/taor/helpers';

describe('TAOR 输出上限解析', () => {
  it('未翻倍且未配置 ⇒ 默认高于传输层 4096（防大参数截断）', () => {
    expect(TAOR_DEFAULT_MAX_OUTPUT_TOKENS).toBeGreaterThan(4096);
    expect(resolveAgentMaxOutputTokens(undefined, undefined)).toBe(
      TAOR_DEFAULT_MAX_OUTPUT_TOKENS
    );
  });

  it('用户显式配置优先于默认', () => {
    expect(resolveAgentMaxOutputTokens(undefined, 1234)).toBe(1234);
  });

  it('翻倍后的有效值优先于用户配置', () => {
    expect(resolveAgentMaxOutputTokens(16384, 2048)).toBe(16384);
  });

  it('天花板维持既有 C1 口径（64k）', () => {
    expect(MAX_OUTPUT_TOKENS_CEILING).toBe(64_000);
  });

  it('C1 翻倍从默认 8192 起算，且封顶 64k', () => {
    expect(nextDoubledOutputCap(undefined, undefined)).toBe(16_384);
    expect(nextDoubledOutputCap(40_000, undefined)).toBe(
      MAX_OUTPUT_TOKENS_CEILING
    );
  });
});
