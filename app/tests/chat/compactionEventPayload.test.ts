// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// `context/compaction` 载荷的 D1 无损 JSON 校验回归（2026-09-25，
// `.trae/specs/event-payload-undefined-rootfix.md`）
//
// 修复前：`data.summaryEnvelope` **无条件写入**，而 Tier2 / 异步 Tier3 路径下该字段为
// `undefined` ⇒ D1 校验**整条拒绝**事件 ⇒ `compactionCommitted` 保持 false
// ⇒ **该次压缩不提交投影（压缩白做）**。实测日志（2026-09-25T10:32:34Z）：
//   ① `event-log: 事件未通过无损 JSON 校验，拒绝写入（event.data.summaryEnvelope: undefined）`
//   ② `compaction:写 context/compaction 事件失败，不提交投影压缩`
//   ③ `compaction:build_start{messageCount:484, preCompacted:false}`
//
// 本用例断言的是**行为面**：真实校验器（`sanitizeEvent`）对真实构造器产出的载荷给 `ok:true`。

import { describe, it, expect } from 'bun:test';
import { buildCompactionDoneData } from '../../src/chat/orchestrator/streamMessageFlow.js';
import { sanitizeEvent } from '../../src/session/storage/eventSanitize.js';
import type { LiriEvent } from '../../src/chat/types/events.js';
import type { LiriEventMap } from '../../src/chat/types/eventPayloads.js';

/** 用**真实**校验器走一遍（与落盘路径 `EventLogStorage.append` 同一函数） */
function sanitize(data: LiriEventMap['context/compaction']): {
  ok: boolean;
  reason?: string;
} {
  const event = {
    type: 'context/compaction',
    schemaVersion: 1,
    seq: 0,
    time: Date.now(),
    sessionId: 'sess-payload-regression',
    data,
  } as LiriEvent;
  return sanitizeEvent(event);
}

const BASE = {
  compactedRange: { startSeq: 10, endSeq: 20 },
  summary: '摘要正文',
  beforeTokens: 1000,
  afterTokens: 400,
};

describe('context/compaction 载荷可通过 D1 无损校验（2026-09-25）', () => {
  it('summaryEnvelope / summaryMessageId 缺省（Tier2 路径）⇒ 校验通过（修复前整条被拒）', () => {
    const data = buildCompactionDoneData(BASE);

    // 约定：可选字段有值才写键（修复前 `summaryEnvelope` 键存在且为 undefined）
    expect(Object.prototype.hasOwnProperty.call(data, 'summaryEnvelope')).toBe(
      false
    );
    expect(Object.prototype.hasOwnProperty.call(data, 'summaryMessageId')).toBe(
      false
    );

    const res = sanitize(data);
    expect(res.ok).toBe(true);
  });

  it('有值 ⇒ 键存在且通过校验（不误删有值字段）', () => {
    const data = buildCompactionDoneData({
      ...BASE,
      summaryMessageId: 'msg-summary-1',
      summaryEnvelope: {
        model: 'test-model',
        maxTokens: 2560,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        structured: true,
      },
    });

    expect(data.summaryMessageId).toBe('msg-summary-1');
    expect(data.summaryEnvelope?.structured).toBe(true);
    expect(sanitize(data).ok).toBe(true);
  });

  it('仅 summaryMessageId 有值 / 仅 summaryEnvelope 有值 ⇒ 均通过', () => {
    const onlyMessageId = buildCompactionDoneData({
      ...BASE,
      summaryMessageId: 'msg-summary-2',
    });
    expect(
      Object.prototype.hasOwnProperty.call(onlyMessageId, 'summaryMessageId')
    ).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(onlyMessageId, 'summaryEnvelope')
    ).toBe(false);
    expect(sanitize(onlyMessageId).ok).toBe(true);

    const onlyEnvelope = buildCompactionDoneData({
      ...BASE,
      summaryEnvelope: { model: 'test-model', structured: false },
    });
    expect(
      Object.prototype.hasOwnProperty.call(onlyEnvelope, 'summaryMessageId')
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(onlyEnvelope, 'summaryEnvelope')
    ).toBe(true);
    expect(sanitize(onlyEnvelope).ok).toBe(true);
  });
});
