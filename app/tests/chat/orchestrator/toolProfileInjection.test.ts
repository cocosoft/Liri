/**
 * TG-4 / `T1-13`：会话 profile **按需注入** 验收（2026-10-13）
 *
 * 对齐工具治理方案 §5 阶段 3.3 的验收原文：
 * - 「**不同 profile 可见面差异可枚举**」⇒ 用同一工具集在 `undefined` / `media` / `coding`
 *   三种声明下比对**最终可见集**（精确断言，非"大概包含"）；
 * - 「**重放工具面 = 落盘快照**」⇒ 重放经 `pickPreparedSnapshot` 读**落盘快照**；
 *   即使当前运行时 profile 已改变，重放结果**仍等于快照**（**不读当前 Profile**）。
 * - 「**不引入 Top-K**」⇒ 全程复用既有 `filterToolsByTask`（本测试不新增任何路由）。
 */
import { describe, it, expect } from 'bun:test';
import { selectToolsForTurn } from '../../../src/chat/orchestrator/streamMessageToolSelection.js';
import { pickPreparedSnapshot } from '../../../src/execution/index.js';
import type { LiriEvent } from '../../../src/session/types/events.js';

type ToolLike = { function?: { name?: string } };

/** 覆盖四类关键类别的**真实**工具名（`toolCategories.ts` 已登记） */
function makeTools(): ToolLike[] {
  return [
    { function: { name: 'file_read' } }, // file_read（default 集内）
    { function: { name: 'image_analysis' } }, // image
    { function: { name: 'video_generate' } }, // video
    { function: { name: 'lsp' } }, // code
    { function: { name: 'todo_write' } }, // MANDATORY（恒保留）
  ];
}

function visibleNames(result: { tools: unknown[] }): string[] {
  return (result.tools as ToolLike[]).map((t) => t.function?.name ?? '').sort();
}

function select(profile?: string[]): string[] {
  return visibleNames(
    selectToolsForTurn({
      tools: makeTools() as never,
      explicitTaskType: undefined,
      lastUserText: '',
      hasImages: false,
      ...(profile ? { profile } : {}),
    })
  );
}

describe('TG-4 会话 profile 按需注入', () => {
  it('未声明 profile ⇒ 与现状等价（image/video/code 类被裁掉）', () => {
    expect(select()).toEqual(['file_read', 'todo_write']);
  });

  it('声明 media ⇒ 可见面**可枚举**地追加 image / video 类', () => {
    expect(select(['media'])).toEqual([
      'file_read',
      'image_analysis',
      'todo_write',
      'video_generate',
    ]);
  });

  it('声明 coding ⇒ 追加 code 类', () => {
    expect(select(['coding'])).toEqual(['file_read', 'lsp', 'todo_write']);
  });

  it('三种声明差异可枚举且两两不等', () => {
    const [none, media, coding] = [
      select(),
      select(['media']),
      select(['coding']),
    ];
    expect(new Set([none, media, coding].map((s) => s.join(','))).size).toBe(3);
  });

  it('重放工具面 = 落盘快照（**不读**当前 profile）', () => {
    // 落盘时（PREPARED）profile = media ⇒ 快照含 image_analysis
    const events = [
      {
        type: 'execution/prepared',
        seq: 1,
        time: 0,
        sessionId: 's',
        data: {
          executionId: 'e1',
          generation: 1,
          visibleTools: ['file_read', 'image_analysis', 'todo_write'],
        },
      },
    ] as unknown as LiriEvent[];

    // 其后会话 profile 被改为 coding（运行期变更）
    const current = select(['coding']);
    expect(current).toContain('lsp');

    // 重放：读落盘快照 ⇒ 与当前 profile 无关
    const replay = pickPreparedSnapshot(events);
    expect(replay?.visibleTools).toEqual([
      'file_read',
      'image_analysis',
      'todo_write',
    ]);
    expect(replay?.visibleTools).not.toEqual(current);
  });
});
