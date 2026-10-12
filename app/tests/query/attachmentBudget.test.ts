/**
 * 附件 → 预算折算（通道治理 阶段 1.3「防富媒体预算逃逸」，2026-10-12）。
 *
 * 覆盖纯函数 `estimateAttachmentTokens` / `estimateAttachmentsTokens`：
 * 字节 → 估算 token（保守下限 4 bytes/token）；缺 `size` / 非法值 ⇒ 0（不臆造，CS06）。
 */
import { describe, expect, it } from 'bun:test';
import {
  ATTACHMENT_BYTES_PER_TOKEN,
  estimateAttachmentTokens,
  estimateAttachmentsTokens,
} from '../../src/query/attachmentBudget.js';

describe('附件 → 预算折算（阶段 1.3）', () => {
  it('折算比常量 = 4 bytes/token（保守下限）', () => {
    expect(ATTACHMENT_BYTES_PER_TOKEN).toBe(4);
  });

  it('单附件：向上取整折算 token', () => {
    expect(estimateAttachmentTokens({ size: 4 })).toBe(1);
    expect(estimateAttachmentTokens({ size: 5 })).toBe(2);
    expect(estimateAttachmentTokens({ size: 1000 })).toBe(250);
  });

  it('缺 size / 0 / 负数 / 非有限数 ⇒ 0（不臆造）', () => {
    expect(estimateAttachmentTokens({})).toBe(0);
    expect(estimateAttachmentTokens({ size: 0 })).toBe(0);
    expect(estimateAttachmentTokens({ size: -10 })).toBe(0);
    expect(estimateAttachmentTokens({ size: Number.NaN })).toBe(0);
    expect(estimateAttachmentTokens({ size: Number.POSITIVE_INFINITY })).toBe(
      0
    );
  });

  it('列表合计：逐项求和；空 / 缺省 ⇒ 0', () => {
    expect(estimateAttachmentsTokens([])).toBe(0);
    expect(estimateAttachmentsTokens(undefined)).toBe(0);
    expect(
      estimateAttachmentsTokens([
        { size: 4 },
        { size: 5 },
        {}, // 缺 size ⇒ 0，不影响其它项
        { size: 400 },
      ])
    ).toBe(1 + 2 + 0 + 100);
  });

  it('量级示例：10MB 附件 ⇒ 2,621,440 估算 token（远超常见日预算，必须计入预留）', () => {
    expect(estimateAttachmentTokens({ size: 10 * 1024 * 1024 })).toBe(
      2_621_440
    );
  });
});
