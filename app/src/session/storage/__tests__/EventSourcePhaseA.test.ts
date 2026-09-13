// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * Phase A 单测（2026-08-23）— 会话系统轨迹规则完整性
 *
 * 覆盖规格书 Phase A 验收：
 * - A-3 压缩区间：回放跳过区间内事件、合成单条 summary（id=summaryMessageId）
 * - A-3 连续覆盖：多次压缩合并为一条最新 summary（评审 v0.4#2）
 * - A-6 tailSeq 平滑降级：读盘失败用持久化 lastKnown / 尾部扫描恢复，不归零、不中断
 * - 负向用例：未压缩会话不受影响（正常回放全部消息）
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { readFileSync, rmSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import type { LiriEvent } from '../../../chat/types/events';
import {
  deriveMessagesFromEvents,
  type CompactionRange,
  type DerivedMessage,
} from '../EventMessageDeriver';
import { EventLogStorage } from '../EventLogStorage';
import {
  ReconcileService,
  type ReconcileDeps,
} from '../../reconcile/ReconcileService';

// ─── 工具函数 ──────────────────────────────────────────────────────────────

/** 构造测试事件（seq 作 time 基准，sessionId 固定） */
function makeEvent<T extends LiriEvent['type']>(
  type: T,
  seq: number,
  data: LiriEvent[T]['data'],
  sessionId = 's1'
): LiriEvent<T> {
  return {
    type,
    seq,
    time: 1000 + seq,
    sessionId,
    data,
  } as LiriEvent<T>;
}

/** 构造压缩区间事件（A-1 写入的 context/compaction） */
function makeCompactionEvent(
  seq: number,
  compactedRange: { startSeq: number; endSeq: number },
  summary: string,
  summaryMessageId: string
): LiriEvent<'context/compaction'> {
  return makeEvent('context/compaction', seq, {
    compactedRange,
    summary,
    summaryMessageId,
  });
}

/** 构造完整会话事件流：u1 → a1 → a2（将压缩）→ a3 */
function buildConversationEvents(): LiriEvent[] {
  return [
    makeEvent('user/message', 1, { content: '你好', messageId: 'u1' }),
    makeEvent('assistant/thinking', 2, { content: '思考1', messageId: 'a1' }),
    makeEvent('assistant/text', 3, { content: '回答1', messageId: 'a1' }),
    makeEvent('user/message', 4, { content: '继续', messageId: 'u2' }),
    makeEvent('assistant/text', 5, { content: '回答2a', messageId: 'a2' }),
    makeEvent('assistant/text', 6, { content: '回答2b', messageId: 'a2' }),
    makeEvent('user/message', 7, { content: '再问', messageId: 'u3' }),
    makeEvent('assistant/text', 8, { content: '回答3', messageId: 'a3' }),
  ];
}

// ─── A-3 压缩区间派生 ───────────────────────────────────────────────────────

describe('EventMessageDeriver 压缩区间（A-3）', () => {
  it('压缩区间内事件不回放，合成 summary（id=summaryMessageId）', () => {
    const events = buildConversationEvents();
    const ranges: CompactionRange[] = [
      {
        startSeq: 4,
        endSeq: 7,
        summary: '早期对话摘要',
        summaryMessageId: 'summary-1',
      },
    ];

    const result = deriveMessagesFromEvents(events, [], {
      compactionRanges: ranges,
    });

    const ids = result.map((m) => m.id);
    // u1/a1 在压缩区间外（seq 1-3）→ 保留；a2 区间内（seq 4-7）→ 不回放
    expect(ids).toContain('u1');
    expect(ids).toContain('a1');
    expect(ids).not.toContain('a2');
    // a3（seq 8）在区间外 → 保留
    expect(ids).toContain('a3');
    // summary 合成且 id 复用 summaryMessageId
    const summary = result.find((m) => m.id === 'summary-1');
    expect(summary).toBeDefined();
    expect(summary?.content).toBe('早期对话摘要');
  });

  it('多次压缩区间连续 → 只回放最新一条 summary（连续覆盖规则）', () => {
    const events = buildConversationEvents();
    // 第一次压缩 [1,3]，第二次压缩 [4,7]（连续：4 ≤ 3+1）
    const ranges: CompactionRange[] = [
      {
        startSeq: 1,
        endSeq: 3,
        summary: '第一段',
        summaryMessageId: 'summary-1',
      },
      {
        startSeq: 4,
        endSeq: 7,
        summary: '第二段',
        summaryMessageId: 'summary-2',
      },
    ];

    const result = deriveMessagesFromEvents(events, [], {
      compactionRanges: ranges,
    });

    // 区间合并为 [1,7] → 仅一条 summary（用后到区间 summaryMessageId）
    const summaries = result.filter((m) => m.id.startsWith('summary-'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.id).toBe('summary-2');
    expect(summaries[0]?.content).toBe('第二段');
    // 区间内消息全部不回放
    expect(result.map((m) => m.id)).not.toContain('a2');
    // a3 在区间外保留
    expect(result.map((m) => m.id)).toContain('a3');
  });

  it('负向用例：无压缩区间时正常回放全部消息', () => {
    const events = buildConversationEvents();
    const result = deriveMessagesFromEvents(events, []);
    const ids = result.map((m) => m.id);
    expect(ids).toContain('u1');
    expect(ids).toContain('a1');
    expect(ids).toContain('a2');
    expect(ids).toContain('a3');
    // 无 summary 合成
    expect(result.some((m) => m.id.startsWith('summary-'))).toBe(false);
  });

  it('压缩事件（context/compaction）自身也作为区间来源补充 metadata', () => {
    const events = [
      ...buildConversationEvents(),
      makeCompactionEvent(
        9,
        { startSeq: 4, endSeq: 7 },
        '事件里摘要',
        'summary-3'
      ),
    ];
    // 不传 metadata 区间 → 从 events 中的 compaction 事件提取
    const result = deriveMessagesFromEvents(events, []);

    expect(result.map((m) => m.id)).not.toContain('a2');
    const summary = result.find((m) => m.id === 'summary-3');
    expect(summary?.content).toBe('事件里摘要');
  });
});

// ─── B-2 后端派生统一排序键 ─────────────────────────────────────────────────

describe('EventMessageDeriver 统一排序键（B-2）', () => {
  it('事件消息与投影兜底消息按 lastEventSeq 混排（兜底消息插入正确位置非末尾）', () => {
    // 事件：seq 1-2（u1/a1），seq 3 之后的 a2 事件缺失（半写场景）
    const events = [
      makeEvent('user/message', 1, { content: '你好', messageId: 'u1' }),
      makeEvent('assistant/text', 2, { content: '回答1', messageId: 'a1' }),
    ];
    // 投影兜底消息：a2（lastEventSeq=5，位于 seq 3-5）、a3（lastEventSeq=8）
    const projections = [
      {
        id: 'a3',
        role: 'assistant',
        content: '回答3',
        timestamp: 3000,
        lastEventSeq: 8,
      },
      {
        id: 'a2',
        role: 'assistant',
        content: '回答2',
        timestamp: 2000,
        lastEventSeq: 5,
      },
    ];

    const result = deriveMessagesFromEvents(events, projections);

    // 排序键统一为 lastEventSeq：u1(1) < a1(2) < a2(5) < a3(8)
    expect(result.map((m) => m.id)).toEqual(['u1', 'a1', 'a2', 'a3']);
    // 兜底消息 a2 插入中间位置而非末尾
    expect(result.findIndex((m) => m.id === 'a2')).toBeLessThan(
      result.findIndex((m) => m.id === 'a3')
    );
  });

  it('纯投影消息无 lastEventSeq（存量旧数据）→ 0 占位排最前', () => {
    const events = [
      makeEvent('user/message', 1, { content: '你好', messageId: 'u1' }),
    ];
    const projections = [
      {
        id: 'legacy-1',
        role: 'assistant',
        content: '旧消息',
        timestamp: 500,
        lastEventSeq: 0,
      },
    ];

    const result = deriveMessagesFromEvents(events, projections);
    // lastEventSeq 缺失 → 0 占位；u1 seq=1 → legacy-1(0) 在前
    expect(result.map((m) => m.id)).toEqual(['legacy-1', 'u1']);
  });
});

// ─── 中断提示链路（2026-08-24）：中断 turn 补 finishReason（3.5） ─────────────

describe('EventMessageDeriver 中断 turn 补 finishReason（2026-08-24）', () => {
  it('turn/end canceled + 消息有完整正文 → 不补 canceled（2026-08-26 对齐实现）', () => {
    // 实现（EventMessageDeriver :651-658）：消息有完整正文视为已完成，
    // 不补 canceled——否则历史里所有正常回复都显示"该回复已中断"
    const events = [
      makeEvent('turn/start', 1, { turn: 1 }),
      makeEvent('user/message', 2, { content: '你好', messageId: 'u1' }),
      makeEvent('assistant/text', 3, { content: '回答', messageId: 'a1' }),
      makeEvent('turn/end', 4, { turn: 1, finishReason: 'canceled' }),
    ];
    const derived = deriveMessagesFromEvents(events, []);
    const a1 = derived.find((m) => m.id === 'a1');
    expect(a1?.finishReason).toBeUndefined();
  });

  it('turn/end canceled + 消息无正文（thinking-only）→ 补 canceled', () => {
    // 无正文时没有可展示的回复，提示"生成中断"是准确的
    const events = [
      makeEvent('turn/start', 1, { turn: 1 }),
      makeEvent('user/message', 2, { content: '你好', messageId: 'u1' }),
      makeEvent('assistant/thinking', 3, {
        content: '思考中',
        messageId: 'a1',
      }),
      makeEvent('turn/end', 4, { turn: 1, finishReason: 'canceled' }),
    ];
    const derived = deriveMessagesFromEvents(events, []);
    const a1 = derived.find((m) => m.id === 'a1');
    expect(a1?.finishReason).toBe('canceled');
  });

  it('正常 turn（stop）→ 不补 finishReason', () => {
    const events = [
      makeEvent('turn/start', 1, { turn: 1 }),
      makeEvent('user/message', 2, { content: '你好', messageId: 'u1' }),
      makeEvent('assistant/text', 3, { content: '回答', messageId: 'a1' }),
      makeEvent('turn/end', 4, { turn: 1, finishReason: 'stop' }),
    ];
    const derived = deriveMessagesFromEvents(events, []);
    const a1 = derived.find((m) => m.id === 'a1');
    expect(a1?.finishReason).toBeUndefined();
  });
});

// ─── C-2/C-3 派生器富块（对齐前端 deriveConversationBlocks） ────────────────

describe('EventMessageDeriver 富块事件（C-2/C-3）', () => {
  /** 构造归属测试用事件流：assistant(text) + 富块事件（无 messageId） */
  function buildRichBlockEvents(richEvents: LiriEvent[]): LiriEvent[] {
    return [
      makeEvent('assistant/text', 1, { content: '正文', messageId: 'a1' }),
      ...richEvents,
    ];
  }

  function deriveBlocks(events: LiriEvent[]): Array<Record<string, unknown>> {
    const result = deriveMessagesFromEvents(events, []);
    const a1 = result.find((m) => m.id === 'a1');
    return a1?.blocks ?? [];
  }

  it('连续 todo write 同标题 → 合并为单个块（生产落盘 action 恒 write）', () => {
    // 2026-08-26 对齐生产行为：后端落盘 action 硬编码 'write'（streamMessageFlow），
    // 回放派生器按 title 查重——连续 write 全量替换而非新建块
    const events = buildRichBlockEvents([
      makeEvent('assistant/todo', 2, {
        action: 'write',
        taskCard: {
          title: '开发计划',
          status: 'executing',
          tasks: [
            { id: 't1', name: '任务1', status: 'in_progress', dependsOn: [] },
            { id: 't2', name: '任务2', status: 'pending', dependsOn: ['t1'] },
          ],
        },
      }),
      makeEvent('assistant/todo', 3, {
        action: 'write',
        taskCard: {
          title: '开发计划',
          status: 'executing',
          tasks: [
            { id: 't1', name: '任务1', status: 'completed', dependsOn: [] },
            {
              id: 't2',
              name: '任务2',
              status: 'in_progress',
              dependsOn: ['t1'],
            },
          ],
        },
      }),
    ]);

    const blocks = deriveBlocks(events);
    // 两次 write 同标题 → 只保留一个 todo 块，第二次全量替换
    expect(blocks.filter((b) => b.type === 'todo')).toHaveLength(1);
    const todo = blocks.find((b) => b.type === 'todo');
    const card = todo?.taskCard as {
      title: string;
      tasks: Array<{ id: string; status: string }>;
    };
    expect(card.title).toBe('开发计划');
    const t1 = card.tasks.find((t) => t.id === 't1');
    expect(t1?.status).toBe('completed');
  });

  it('todo write 新建块 + update 增量合并（防御分支）', () => {
    const events = buildRichBlockEvents([
      makeEvent('assistant/todo', 2, {
        action: 'write',
        taskCard: {
          title: '开发计划',
          status: 'executing',
          tasks: [
            { id: 't1', name: '任务1', status: 'in_progress', dependsOn: [] },
            { id: 't2', name: '任务2', status: 'pending', dependsOn: ['t1'] },
          ],
        },
      }),
      makeEvent('assistant/todo', 3, {
        action: 'update',
        taskId: 't2',
        updates: { status: 'completed', result: '完成', durationMs: 100 },
      }),
    ]);

    const blocks = deriveBlocks(events);
    const todo = blocks.find((b) => b.type === 'todo');
    expect(todo).toBeDefined();
    const card = todo?.taskCard as {
      title: string;
      tasks: Array<{ id: string; status: string; result?: string }>;
    };
    expect(card.title).toBe('开发计划');
    // update 合并到最后一个 todo 块的对应 task（不新增块）
    expect(blocks.filter((b) => b.type === 'todo')).toHaveLength(1);
    const t2 = card.tasks.find((t) => t.id === 't2');
    expect(t2?.status).toBe('completed');
    expect(t2?.result).toBe('完成');
  });

  it('status：内部过渡态过滤 + compaction 过滤 + 连续重复去重（对齐前端）', () => {
    const events = buildRichBlockEvents([
      // 内部过渡态（ai_thinking）→ 不建块
      makeEvent('assistant/status', 2, {
        content: 'AI is thinking...',
        statusType: 'ai_thinking',
      }),
      // compaction → 不建块（context/compaction 分支处理）
      makeEvent('assistant/status', 3, {
        content: '压缩中',
        statusType: 'compaction',
      }),
      // 普通状态
      makeEvent('assistant/status', 4, {
        content: '执行 2 个工具调用',
        statusType: 'tool_count',
      }),
      // 连续重复 → 去重
      makeEvent('assistant/status', 5, {
        content: '执行 2 个工具调用',
        statusType: 'tool_count',
      }),
    ]);

    const blocks = deriveBlocks(events);
    const statusBlocks = blocks.filter((b) => b.type === 'status');
    expect(statusBlocks).toHaveLength(1);
    expect(statusBlocks[0]?.content).toBe('执行 2 个工具调用');
  });

  it('progress：同一 phase 心跳更新已有块（不堆块）', () => {
    const events = buildRichBlockEvents([
      makeEvent('assistant/progress', 2, {
        phase: 'implementing',
        progress: 30,
        description: '编写代码',
        steps: [{ name: '实现', status: 'in_progress' }],
        currentStep: '实现',
      }),
      makeEvent('assistant/progress', 3, {
        phase: 'implementing',
        progress: 80,
        description: '编写代码中',
        steps: [{ name: '实现', status: 'in_progress' }],
        currentStep: '实现',
      }),
    ]);

    const blocks = deriveBlocks(events);
    const progressBlocks = blocks.filter((b) => b.type === 'progress');
    expect(progressBlocks).toHaveLength(1);
    const pd = progressBlocks[0]?.progressData as { progress: number };
    expect(pd.progress).toBe(80); // 更新为最新心跳
  });

  it('question / doc_workflow 建块 + truncation 累加 text 与 content', () => {
    const events = buildRichBlockEvents([
      makeEvent('assistant/question', 2, {
        questionId: 'q1',
        question: '继续吗？',
        header: '确认',
        options: [{ label: '继续' }, { label: '停止' }],
      }),
      makeEvent('assistant/doc_workflow', 3, {
        title: '文档',
        format: 'docx',
        currentStage: 'outline',
        stages: {
          outline: { status: 'in_progress' },
          filling: { status: 'pending' },
          compose: { status: 'pending' },
        },
      }),
      makeEvent('assistant/truncation', 4, {
        reason: 'length',
        suffix: '（输出已截断）',
      }),
    ]);

    const blocks = deriveBlocks(events);
    expect(blocks.some((b) => b.type === 'question')).toBe(true);
    expect(blocks.some((b) => b.type === 'doc_workflow')).toBe(true);
    // truncation → text 块 + content 累加
    const textBlock = blocks.find(
      (b) => b.type === 'text' && b.content === '（输出已截断）'
    );
    expect(textBlock).toBeDefined();
    const result = deriveMessagesFromEvents(events, []);
    const a1 = result.find((m) => m.id === 'a1');
    expect(a1?.content).toContain('（输出已截断）');
  });

  it('text/thinking 流式 chunk 合并到相邻块（防碎片化：12031 blocks 卡死回归）', () => {
    // 模拟 token 级流式 chunk：同一条消息的 100 个 text chunk + 20 个 thinking chunk
    const events: LiriEvent[] = [];
    let seq = 1;
    for (let i = 0; i < 20; i++) {
      events.push(
        makeEvent('assistant/thinking', seq++, {
          content: `思考${i}`,
          messageId: 'a1',
        })
      );
    }
    for (let i = 0; i < 100; i++) {
      events.push(
        makeEvent('assistant/text', seq++, {
          content: `字${i}`,
          messageId: 'a1',
        })
      );
    }
    const result = deriveMessagesFromEvents(events, []);
    const a1 = result.find((m) => m.id === 'a1');
    expect(a1).toBeDefined();
    const blocks = a1?.blocks ?? [];
    const textBlocks = blocks.filter((b) => b.type === 'text');
    const thinkingBlocks = blocks.filter((b) => b.type === 'thinking');
    // 合并后：thinking 1 个、text 1 个（不再是 20 + 100 个碎片）
    expect(thinkingBlocks).toHaveLength(1);
    expect(textBlocks).toHaveLength(1);
    // content 完整保留
    expect(a1?.content).toBe(
      Array.from({ length: 100 }, (_, i) => `字${i}`).join('')
    );
    expect(textBlocks[0]?.content).toBe(a1?.content);
    // 总 blocks 数量远小于 chunk 数（120 个 chunk → 不应超过 10 个块）
    expect(blocks.length).toBeLessThanOrEqual(3);
  });
});

// ─── D-3 事件日志物理裁剪 ───────────────────────────────────────────────────

describe('EventLogStorage 物理裁剪（D-3）', () => {
  const sessionId = `evt-trim-${Date.now()}`;
  let storage: EventLogStorage;
  let sessionDir: string;

  afterEach(() => {
    if (sessionDir && existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('trimEvents 裁剪旧事件 → tailSeq 重置 → append 正常（无 duplicate 误判）', async () => {
    storage = new EventLogStorage(sessionId);
    sessionDir = dirname(storage.getFilePath());
    await storage.append(
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' })
    );
    await storage.append(
      makeEvent('assistant/text', 2, { content: 'a', messageId: 'a1' })
    );
    await storage.append(
      makeEvent('assistant/text', 3, { content: 'b', messageId: 'a1' })
    );

    // 修剪保留 seq >= 2（模拟清理最早事件）
    const { newTailSeq } = await storage.trimEvents(2);
    expect(newTailSeq).toBe(3);

    // 剩余事件为 seq 2,3；tailSeq 持久化同步
    const events = await storage.read();
    expect(events.map((e) => e.seq)).toEqual([2, 3]);
    expect(readFileSync(join(sessionDir, 'events.tail'), 'utf-8').trim()).toBe(
      '3'
    );

    // 修剪后 append seq=4 正常写入（tailSeq 已重置，不会误判 duplicate/out-of-order）
    const result = await storage.append(
      makeEvent('assistant/text', 4, { content: 'c', messageId: 'a1' })
    );
    expect(result.ok).toBe(true);
    expect(await storage.getTailSeq()).toBe(4);
  });
});

// ─── D-1 对账服务 ───────────────────────────────────────────────────────────

describe('ReconcileService（D-1）', () => {
  const sessionId = `evt-rec-${Date.now()}`;
  let storage: EventLogStorage;
  let sessionDir: string;
  let meta: Record<string, unknown> | undefined;

  afterEach(() => {
    meta = undefined; // 防止测试间 metadata 泄漏
    if (sessionDir && existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  /** 构造对账服务（事件来自真实临时 EventLogStorage，投影/meta 注入） */
  function makeService(projections: DerivedMessage[]) {
    const deps: ReconcileDeps = {
      getEventLog: () => storage,
      getProjections: async () => projections,
      getSessionMeta: async () => meta,
    };
    return new ReconcileService(deps);
  }

  async function setupEvents(events: LiriEvent[]): Promise<void> {
    storage = new EventLogStorage(sessionId);
    sessionDir = dirname(storage.getFilePath());
    for (const ev of events) {
      await storage.append(ev);
    }
  }

  it('投影有、事件无（半写）→ event-missing + 反向补全候选', async () => {
    await setupEvents([
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' }),
    ]);
    const projections: DerivedMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'hi',
        timestamp: 1000,
        lastEventSeq: 1,
      },
      // a1 有投影但无事件（events 半写）
      {
        id: 'a1',
        role: 'assistant',
        content: '回答',
        timestamp: 2000,
        lastEventSeq: 2,
      },
    ];
    const report = await makeService(projections).reconcileSession(sessionId);
    const drift = report.drifts.find((d) => d.messageId === 'a1');
    expect(drift?.kind).toBe('event-missing');
    expect(report.backfillCandidates.some((c) => c.messageId === 'a1')).toBe(
      true
    );
    expect(report.repairPlan.some((p) => p.includes('反向补全'))).toBe(true);
  });

  it('事件有、投影无 → projection-missing（events 为准）', async () => {
    await setupEvents([
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' }),
      makeEvent('assistant/text', 2, { content: '回答', messageId: 'a1' }),
    ]);
    // 投影只有 u1，缺少 a1
    const projections: DerivedMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'hi',
        timestamp: 1000,
        lastEventSeq: 1,
      },
    ];
    const report = await makeService(projections).reconcileSession(sessionId);
    expect(
      report.drifts.some(
        (d) => d.kind === 'projection-missing' && d.messageId === 'a1'
      )
    ).toBe(true);
  });

  it('修剪缺口不误报（投影 lastEventSeq 落在 trajectoryTrims 区间）', async () => {
    await setupEvents([
      makeEvent('user/message', 3, { content: '后段', messageId: 'u2' }),
    ]);
    meta = { trajectoryTrims: [{ startSeq: 1, endSeq: 2 }] };
    const projections: DerivedMessage[] = [
      // lastEventSeq=2 落在修剪区间 [1,2] → 不报 event-missing
      {
        id: 'a1',
        role: 'assistant',
        content: '已修剪',
        timestamp: 1000,
        lastEventSeq: 2,
      },
      {
        id: 'u2',
        role: 'user',
        content: '后段',
        timestamp: 3000,
        lastEventSeq: 3,
      },
    ];
    const report = await makeService(projections).reconcileSession(sessionId);
    expect(report.drifts.some((d) => d.kind === 'event-missing')).toBe(false);
  });

  it('压缩半状态：投影含压缩区间内消息 → compaction-half-state + summary 替换计划', async () => {
    await setupEvents([
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' }),
    ]);
    meta = {
      trajectoryCompactions: [
        {
          startSeq: 2,
          endSeq: 5,
          summary: '摘要',
          summaryMessageId: 'summary-1',
        },
      ],
    };
    const projections: DerivedMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'hi',
        timestamp: 1000,
        lastEventSeq: 1,
      },
      // 区间内投影消息未压缩（半状态）
      {
        id: 'a2',
        role: 'assistant',
        content: '旧内容',
        timestamp: 2000,
        lastEventSeq: 4,
      },
    ];
    const report = await makeService(projections).reconcileSession(sessionId);
    expect(report.drifts.some((d) => d.kind === 'compaction-half-state')).toBe(
      true
    );
    expect(report.repairPlan.some((p) => p.includes('半状态自愈'))).toBe(true);
  });

  it('无漂移会话 → ok=true（负向用例）', async () => {
    await setupEvents([
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' }),
      makeEvent('assistant/text', 2, { content: '回答', messageId: 'a1' }),
    ]);
    const projections: DerivedMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'hi',
        timestamp: 1000,
        lastEventSeq: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        content: '回答',
        timestamp: 2000,
        lastEventSeq: 2,
      },
    ];
    const report = await makeService(projections).reconcileSession(sessionId);
    expect(report.ok).toBe(true);
    expect(report.drifts).toHaveLength(0);
  });

  it('坏行：events 损坏 → 检测到坏行告警，不生成反向补全候选（以投影为准）', async () => {
    await setupEvents([
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' }),
    ]);
    // 手动注入一条损坏行（有换行结尾的完整坏行——无换行的半写行归 D4 torn repair 截断）
    appendFileSync(
      join(sessionDir, 'events.jsonl'),
      'not-a-json-line\n',
      'utf-8'
    );
    const projections: DerivedMessage[] = [
      // a1 有投影但事件缺失——但因坏行导致事件流不可信 → 不补全
      {
        id: 'a1',
        role: 'assistant',
        content: '回答',
        timestamp: 2000,
        lastEventSeq: 2,
      },
    ];
    const report = await makeService(projections).reconcileSession(sessionId);
    expect(report.drifts.some((d) => d.detail.includes('坏行'))).toBe(true);
    // 坏行场景不生成反向补全候选
    expect(report.backfillCandidates).toHaveLength(0);
  });
});

// ─── A-6 tailSeq 平滑降级 ───────────────────────────────────────────────────

describe('EventLogStorage tailSeq 平滑降级（A-6）', () => {
  const sessionId = `evt-test-${Date.now()}`;
  let storage: EventLogStorage;
  let sessionDir: string;

  afterEach(() => {
    // 清理测试会话目录（唯一 sessionId，不触碰真实数据）
    if (sessionDir && existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('append 成功后持久化 lastKnown 到 events.tail', async () => {
    storage = new EventLogStorage(sessionId);
    sessionDir = dirname(storage.getFilePath());

    await storage.append(
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' })
    );
    await storage.append(
      makeEvent('assistant/text', 2, { content: 'hello', messageId: 'a1' })
    );

    expect(await storage.getTailSeq()).toBe(2);
    const tailRaw = readFileSync(join(sessionDir, 'events.tail'), 'utf-8');
    expect(tailRaw.trim()).toBe('2');
  });

  it('读盘失败 → 用持久化 lastKnown 恢复 tailSeq（不归零）', async () => {
    storage = new EventLogStorage(sessionId);
    sessionDir = dirname(storage.getFilePath());
    await storage.append(
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' })
    );

    // 模拟主扫描 IO 失败（覆盖私有方法，仅测试用）
    (
      storage as unknown as { createReadlineInterface: () => never }
    ).createReadlineInterface = () => {
      throw new Error('mock io failure');
    };

    // 持久值 lastKnown=1 → 恢复为 1，而非归 0
    expect(await storage.getTailSeq(true)).toBe(1);
  });

  it('持久值失效（events.tail 删除）→ 扫描文件尾部恢复真实 tailSeq', async () => {
    storage = new EventLogStorage(sessionId);
    sessionDir = dirname(storage.getFilePath());
    await storage.append(
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' })
    );
    await storage.append(
      makeEvent('assistant/text', 2, { content: 'hello', messageId: 'a1' })
    );

    // 删除持久化 meta 文件（模拟首次/损坏），主扫描仍失败
    rmSync(join(sessionDir, 'events.tail'), { force: true });
    (
      storage as unknown as { createReadlineInterface: () => never }
    ).createReadlineInterface = () => {
      throw new Error('mock io failure');
    };

    // 尾部扫描读 events.jsonl 末尾恢复真实 tailSeq=2
    expect(await storage.getTailSeq(true)).toBe(2);
  });

  it('降级后 append 继续写入（消息写入不中断、seq 单调）', async () => {
    storage = new EventLogStorage(sessionId);
    sessionDir = dirname(storage.getFilePath());
    await storage.append(
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' })
    );

    // 模拟主扫描失败后，tailSeq 恢复为 lastKnown=1
    (
      storage as unknown as { createReadlineInterface: () => never }
    ).createReadlineInterface = () => {
      throw new Error('mock io failure');
    };
    expect(await storage.getTailSeq(true)).toBe(1);

    // 恢复读盘（解除 mock）后 append seq=2 正常写入
    delete (storage as unknown as { createReadlineInterface?: () => never })
      .createReadlineInterface;
    const result = await storage.append(
      makeEvent('assistant/text', 2, { content: 'hello', messageId: 'a1' })
    );
    expect(result.ok).toBe(true);
    expect(await storage.getTailSeq()).toBe(2);
    // 持久化同步更新
    const tailRaw = readFileSync(join(sessionDir, 'events.tail'), 'utf-8');
    expect(tailRaw.trim()).toBe('2');
  });
});
