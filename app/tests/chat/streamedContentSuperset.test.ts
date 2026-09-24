/**
 * 二期 O2-4（2026-09-24「会话暴露问题分析与优化方案」§五）：**取证判据**单测。
 *
 * 背景：同一 assistant 消息内发生多轮 reason（截断续接回捞 / 超时重试）时，前端 append 累积
 * 各轮正文，而后端 `assistantMessage.content` 被**整体替换**为最后一轮正文 ⇒ 前端多出重复段落，
 * 且流内与落盘不同源（违反 project_rules §1.6「所见即所存」）。
 * 该情形的可判定特征：**落盘正文被包含于流内正文之中**。
 */

import { describe, it, expect } from 'bun:test';
import { isStreamedContentSuperset } from '../../src/chat/orchestrator/streamMessageFlow.js';

describe('流内正文 vs 落盘正文一致性判据（二期 O2-4 探针）', () => {
  it('多轮替换（首句重复）⇒ 命中', () => {
    const persisted = '我先定位这两个文件。我先建个计划，然后分段读取。';
    const streamed = '我先定位这两个文件。' + persisted;
    expect(isStreamedContentSuperset(streamed, persisted)).toBe(true);
  });

  it('同一报告整段重复 ⇒ 命中', () => {
    const persisted = '# 报告\n一、结论摘要\n二、证据';
    const streamed = persisted + persisted;
    expect(isStreamedContentSuperset(streamed, persisted)).toBe(true);
  });

  it('一轮内正常流式（长度一致或更短）⇒ 不命中（零误报）', () => {
    const persisted = '一二三';
    expect(isStreamedContentSuperset(persisted, persisted)).toBe(false);
    expect(isStreamedContentSuperset('一', persisted)).toBe(false);
  });

  it('落盘被清洗过（非包含关系）⇒ 不命中（只认"前端多出"这一特征）', () => {
    expect(
      isStreamedContentSuperset('原始文本（含标签）', '清洗后的另一段文本')
    ).toBe(false);
  });

  it('空落盘正文 ⇒ 不命中', () => {
    expect(isStreamedContentSuperset('任意流内文本', '')).toBe(false);
  });
});
