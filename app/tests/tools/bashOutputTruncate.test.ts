/**
 * bash 大输出软截断阈值（2026-10-31，上下文溢出预防第二步）
 *
 * 真机取证：`K-5 BashTool 大输出源头截断` 单日 11 次，均为 **16.6MB → 2MB** ——
 * 2MB ASCII ≈ 50 万 tokens，单条结果即可把一次请求推到模型窗口之上（实测 1.79M tokens
 * 请求被 provider 以 400 拒绝，随后全靠事后压缩恢复）。
 *
 * 口径：软截断对齐 `file_read` 的 200k（≈5 万 tokens/结果）；硬防线 16MB 不变；
 * 超限文案继续提示"过滤 / 落文件后再读"。
 */
import { describe, expect, it } from 'bun:test';
import {
  BASH_EXEC_MAX_BUFFER_BYTES,
  BASH_OUTPUT_SOFT_LIMIT_BYTES,
  applyBashOutputSoftTruncate,
} from '../../src/tools/bash/bashOutputTruncate';

describe('bash 输出软截断：阈值与保留形态', () => {
  it('软截断阈值 200KB，且严格小于 exec 硬防线', () => {
    expect(BASH_OUTPUT_SOFT_LIMIT_BYTES).toBe(200 * 1024);
    expect(BASH_OUTPUT_SOFT_LIMIT_BYTES).toBeLessThan(
      BASH_EXEC_MAX_BUFFER_BYTES
    );
  });

  it('未超限的原样返回（不额外分配/不标注）', () => {
    const s = 'x'.repeat(100 * 1024);
    expect(applyBashOutputSoftTruncate(s, 'stdout')).toBe(s);
  });

  it('超限输出：保留 head+tail 并附截断提示（长度受控）', () => {
    const s = 'x'.repeat(300 * 1024);
    const out = applyBashOutputSoftTruncate(s, 'stdout');

    expect(out).toContain('[K-5 output truncated on stdout]');
    expect(out).toContain('soft_limit=200.0KB');
    expect(out.startsWith('x')).toBe(true);
    expect(out.endsWith('x')).toBe(true);
    // head(≈180KB) + 提示 + tail(20KB) ⇒ 略高于 200KB，但远小于原文 300KB
    expect(out.length).toBeLessThan(230 * 1024);
  });

  it('CJK 多字节输出按字节阈值截断（UTF-8 安全，不移位）', () => {
    const s = '中'.repeat(120 * 1024); // ≈360KB
    const out = applyBashOutputSoftTruncate(s, 'stderr');

    expect(out).toContain('[K-5 output truncated on stderr]');
    expect(out.startsWith('中')).toBe(true);
    expect(out.endsWith('中')).toBe(true);
  });
});
