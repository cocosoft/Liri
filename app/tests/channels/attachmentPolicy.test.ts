// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-26（2026-10-17）：入站附件 MIME 分类与上限。
 */
import { describe, expect, it } from 'bun:test';
import {
  applyAttachmentPolicy,
  classifyAttachment,
  ATTACHMENT_SIZE_LIMITS,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../../src/channels/routing/attachmentPolicy';

describe('classifyAttachment', () => {
  it('按 MIME 主类型分类（含参数归一化）', () => {
    expect(classifyAttachment({ mimeType: 'image/PNG; charset=binary' })).toBe(
      'image'
    );
    expect(classifyAttachment({ mimeType: 'audio/ogg' })).toBe('audio');
    expect(classifyAttachment({ mimeType: 'video/mp4' })).toBe('video');
    expect(classifyAttachment({ mimeType: 'application/pdf' })).toBe(
      'document'
    );
    expect(classifyAttachment({ mimeType: 'application/zip' })).toBe('archive');
  });

  it('MIME 缺省 ⇒ 按扩展名兜底', () => {
    expect(classifyAttachment({ fileName: 'a.MP4' })).toBe('video');
    expect(classifyAttachment({ fileName: 'notes.md' })).toBe('document');
    expect(classifyAttachment({ fileName: 'pkg.tar.gz' })).toBe('archive');
  });

  it('MIME 与扩展名都无法判定 ⇒ other（最严档）', () => {
    expect(classifyAttachment({})).toBe('other');
    expect(
      classifyAttachment({ mimeType: 'application/x-unknown', fileName: 'x' })
    ).toBe('other');
  });
});

describe('applyAttachmentPolicy', () => {
  it('未超限 ⇒ 全部保留、原顺序不变', () => {
    const r = applyAttachmentPolicy([
      { mimeType: 'image/png', size: 1024 },
      { mimeType: 'application/pdf', size: 2048 },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(2);
  });

  it('单附件超分类上限 ⇒ 拒绝（size_exceeded），不进入预算口径', () => {
    const r = applyAttachmentPolicy([
      { mimeType: 'video/mp4', size: ATTACHMENT_SIZE_LIMITS.video + 1 },
      { mimeType: 'image/png', size: 10 },
    ]);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]?.reason).toBe('size_exceeded');
    expect(r.rejected[0]?.category).toBe('video');
  });

  it('缺 size ⇒ 接受（无法证明超限，不臆造）', () => {
    const r = applyAttachmentPolicy([{ mimeType: 'video/mp4' }]);
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(1);
  });

  it('超过条数上限 ⇒ 后续项拒绝（count_exceeded）', () => {
    const many = Array.from(
      { length: MAX_ATTACHMENTS_PER_MESSAGE + 2 },
      () => ({
        mimeType: 'image/png',
        size: 1,
      })
    );
    const r = applyAttachmentPolicy(many);
    expect(r.accepted).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected.every((x) => x.reason === 'count_exceeded')).toBe(true);
  });

  it('可覆盖上限（按渠道能力收窄）', () => {
    const r = applyAttachmentPolicy([{ mimeType: 'image/png', size: 5 }], {
      limits: { image: 4 },
    });
    expect(r.rejected[0]?.reason).toBe('size_exceeded');
    expect(r.rejected[0]?.limitBytes).toBe(4);
  });

  it('空 / 缺省 ⇒ 空结果（不抛错）', () => {
    expect(applyAttachmentPolicy(undefined)).toEqual({
      accepted: [],
      rejected: [],
    });
  });
});
