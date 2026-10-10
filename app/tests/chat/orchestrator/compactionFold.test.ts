/**
 * P2-1d —— S6 压缩段**纯函数** `deriveCompactionFold` 契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §3-S6 / §5；实现见
 * `src/chat/orchestrator/streamMessageHelpers.ts`（由 `runStreamMessage` 内联逻辑**逐字搬迁**）。
 *
 * 锁定：
 * 1. **折叠判据**（结构化字段，CS02）：`compressedSeqs` = 压缩前有 `lastEventSeq`、压缩后消失者；
 * 2. **无折叠 ⇒ `null`**（调用方据此刻意跳过事件写入，不造空事件 —— CS04）；
 * 3. **摘要产物** = 压缩后**无 `lastEventSeq`** 的新消息；缺 `id` 时**不带** `summaryMessageId` 键
 *    （防 `undefined` 键被 D1 无损 JSON 校验整条拒绝）。
 */
import { describe, expect, it } from 'bun:test';

import { deriveCompactionFold } from '../../../src/chat/orchestrator/streamMessageHelpers.js';

describe('P2-1d S6 压缩段 · deriveCompactionFold（纯函数）', () => {
  it('有折叠区间 ⇒ 给出 compressedSeqs / compactedRange / summary / summaryMessageId', () => {
    const before = [
      { lastEventSeq: 1 },
      { lastEventSeq: 2 },
      { lastEventSeq: 3 },
    ];
    const after = [
      { content: '摘要正文', id: 'summary-1' }, // 压缩产物（无 lastEventSeq）
      { lastEventSeq: 3 }, // 幸存
    ];
    const fold = deriveCompactionFold(before, after);
    expect(fold).not.toBeNull();
    expect(fold!.compressedSeqs).toEqual([1, 2]);
    expect(fold!.compactedRange).toEqual({ startSeq: 1, endSeq: 2 });
    expect(fold!.summary).toBe('摘要正文');
    expect(fold!.summaryMessageId).toBe('summary-1');
  });

  it('无折叠（压缩后仍含全部源 seq）⇒ `null`（刻意不写空事件）', () => {
    const before = [{ lastEventSeq: 1 }, { lastEventSeq: 2 }];
    const after = [{ lastEventSeq: 1 }, { lastEventSeq: 2 }];
    expect(deriveCompactionFold(before, after)).toBeNull();
  });

  it('压缩前无 `lastEventSeq` 的源消息不参与判据（非事件消息）', () => {
    const before = [{ content: '无 seq' }, { lastEventSeq: 5 }];
    const after: Array<{ lastEventSeq?: number }> = [];
    const fold = deriveCompactionFold(before, after);
    expect(fold!.compressedSeqs).toEqual([5]);
    expect(fold!.compactedRange).toEqual({ startSeq: 5, endSeq: 5 });
  });

  it('摘要消息缺 `content`/`id` ⇒ 摘要为空串，且**不带** `summaryMessageId` 键', () => {
    const before = [{ lastEventSeq: 7 }];
    const after = [{ lastEventSeq: undefined }];
    const fold = deriveCompactionFold(before, after);
    expect(fold!.summary).toBe('');
    expect('summaryMessageId' in fold!).toBe(false); // 防 undefined 键（D1 校验会整条拒绝）
  });
});
