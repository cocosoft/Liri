// MIT License
// Copyright (c) 2026 190615273@qq.com
// D 阶段（2026-09-02）：会话摘要检索读取视图 + 记忆上卷持久化 单元测试

import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { LiriEvent } from '../../src/chat/types/events';
import {
  parseSessionSummaries,
  findSummaryForSeq,
  findSummaryByKeyword,
} from '../../src/session/storage/SessionSummaryReader';
import { SessionMemoryManager as CoreMemoryManager } from '../../src/session/memory/SessionMemoryManager';

function ev(
  seq: number,
  type: LiriEvent['type'],
  data: Record<string, unknown>
): LiriEvent {
  return {
    type: type as never,
    schemaVersion: 1,
    seq,
    time: 1700000000000 + seq * 1000,
    sessionId: 's1',
    data: data as never,
  };
}

const createdDirs: string[] = [];
afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

describe('SessionSummaryReader — D 阶段摘要检索视图', () => {
  const events: LiriEvent[] = [
    ev(1, 'user/message', { content: 'hi', messageId: 'm1' }),
    ev(2, 'assistant/text', { content: '答', messageId: 'm2' }),
    ev(3, 'session/summary', {
      content: '阶段一：完成 AI-AGENT 前沿调研并产出 HTML 日报',
      keywords: ['AI-AGENT', '日报'],
      compactedRange: { startSeq: 1, endSeq: 2 },
      sourceEventSeqs: [1, 2],
      summaryMessageId: 'sum-1',
    }),
    ev(4, 'user/message', { content: '继续', messageId: 'm3' }),
    ev(5, 'session/summary', {
      content: '阶段二：处理供应商评审与招标文件转换',
      keywords: ['招标', '供应商'],
      compactedRange: { startSeq: 4, endSeq: 4 },
      sourceEventSeqs: [4],
    }),
  ];

  it('parseSessionSummaries：只取 session/summary，seq 升序，字段完整', () => {
    const summaries = parseSessionSummaries(events);
    expect(summaries.length).toBe(2);
    expect(summaries.map((s) => s.seq)).toEqual([3, 5]);
    const first = summaries[0];
    expect(first.content).toContain('AI-AGENT');
    expect(first.keywords).toEqual(['AI-AGENT', '日报']);
    expect(first.compactedRange).toEqual({ startSeq: 1, endSeq: 2 });
    expect(first.sourceEventSeqs).toEqual([1, 2]);
    expect(first.summaryMessageId).toBe('sum-1');
  });

  it('findSummaryForSeq：区间/源 seq 命中优先，否则最近兜底，越界返回 null', () => {
    const summaries = parseSessionSummaries(events);
    // 区间命中（seq 2 被阶段一折叠）
    expect(findSummaryForSeq(summaries, 2)?.content).toContain('AI-AGENT');
    // 源 seq 命中
    expect(findSummaryForSeq(summaries, 4)?.content).toContain('供应商');
    // 落在新会话区域（seq 99 之后无摘要）→ 兜底最近一份（seq5 仍 ≤99）
    const late = findSummaryForSeq(summaries, 99);
    expect(late).not.toBeNull();
    // 目标在首份摘要之前（seq 0）→ 无兜底
    expect(findSummaryForSeq(summaries, 0)).toBeNull();
  });

  it('findSummaryByKeyword：keywords 命中优先，正文命中次之，限量', () => {
    const summaries = parseSessionSummaries(events);
    const byKw = findSummaryByKeyword(summaries, '招标');
    expect(byKw.length).toBe(1);
    expect(byKw[0].content).toContain('供应商');
    const byText = findSummaryByKeyword(summaries, 'HTML 日报');
    expect(byText.length).toBe(1);
    expect(byText[0].seq).toBe(3);
    expect(findSummaryByKeyword(summaries, '', 5).length).toBe(0);
    expect(findSummaryByKeyword(summaries, '不存在关键词', 1).length).toBe(0);
  });
});

describe('SessionMemoryManager.session_summary — D 阶段记忆上卷持久化', () => {
  it('appendToMemory 写入 session_summary 项并可回读（memory.md 往返）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sumroll-'));
    createdDirs.push(dir);
    const mm = new CoreMemoryManager(dir);
    const memory = mm.loadMemory('rollup-s1');
    mm.initMemory('rollup-s1');
    mm.appendToMemory(memory, [
      {
        type: 'session_summary',
        content: '【会话阶段摘要】完成 AI-AGENT 调研（关键词：日报）',
      },
    ]);

    const reloaded = mm.loadMemory('rollup-s1');
    const item = reloaded.items.find(
      (i) => i.type === 'session_summary'
    );
    expect(item).toBeDefined();
    expect(item?.content).toContain('AI-AGENT');
    // 记忆注入上下文文本同样包含该摘要（后续轮次可复用）
    expect(mm.getMemoryContext('rollup-s1')).toContain('会话摘要');
    expect(mm.getMemoryContext('rollup-s1')).toContain('AI-AGENT');
  });
});
