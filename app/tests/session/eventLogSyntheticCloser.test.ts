/**
 * P1-3 回归（2026-11-04，《运行态问题排查与修复方案》）
 *
 * 两个缺陷各自成一节：
 *   ① **序号冲突**：`appendMutex` 是实例级，同一会话被多个 `EventLogStorage` 实例
 *      并发写时各自排队 ⇒ 读到同一 tailSeq ⇒ `duplicate-seq` 自动纠正
 *      （实测 5 次/窗口）。现在排队键改为文件绝对路径（进程级单写者）。
 *   ② **合成 closer 污染观感**：崩溃恢复补的 `turn/end{canceled}` 会让"日志到此为止"
 *      被渲染成"该回复已中断"（实测 18 次）。closer 现带 `synthetic: true`，
 *      派生层据此静默。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { getLogger } from '@openliri/infra/monitoring';
import { EventLogStorage } from '@modules/session/storage/EventLogStorage';
import { deriveMessagesFromEvents } from '@modules/session/storage/EventMessageDeriver';
import type { LiriEvent } from '@modules/session/types/events';

const HASH = 'default';
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

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'evtlog-p13-'));
  createdDirs.push(dir);
  return dir;
}

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

type WarnFn = (message: string, meta?: unknown) => void;

/** 临时接管 `session:event-log` 的 warn，统计"seq 冲突自动纠正"次数 */
async function withSeqConflictSpy<T>(
  fn: (conflicts: () => number) => Promise<T>
): Promise<T> {
  const target = getLogger('session:event-log') as unknown as { warn: WarnFn };
  const original = target.warn;
  let count = 0;
  target.warn = ((message: string) => {
    if (message.includes('seq 冲突自动纠正')) count++;
  }) as WarnFn;
  try {
    return await fn(() => count);
  } finally {
    target.warn = original;
  }
}

describe('P1-3：同一会话多实例并发写 ⇒ 不再产生 duplicate-seq', () => {
  it('两个实例各并发写 5 条（seq=0 交由 append 分配）⇒ 序号唯一且无冲突纠正', async () => {
    const root = makeRoot();
    const sessionId = 'multi-writer';
    mkdirSync(join(root, HASH, sessionId), { recursive: true });

    // 两个独立实例指向同一 events.jsonl（真机里由不同子系统各自构造）
    const a = new EventLogStorage(sessionId, HASH, root);
    const b = new EventLogStorage(sessionId, HASH, root);

    const conflicts = await withSeqConflictSpy(async (count) => {
      const tasks: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        tasks.push(
          a.append(
            ev(0, 'assistant/text', { content: `a${i}`, messageId: 'm-a' })
          )
        );
        tasks.push(
          b.append(
            ev(0, 'assistant/text', { content: `b${i}`, messageId: 'm-b' })
          )
        );
      }
      const results = (await Promise.all(tasks)) as Array<{ ok: boolean }>;
      expect(results.every((r) => r.ok)).toBe(true);
      return count();
    });

    expect(conflicts).toBe(0);

    const lines = readFileSync(
      join(root, HASH, sessionId, 'events.jsonl'),
      'utf-8'
    )
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as LiriEvent);
    expect(lines.length).toBe(10);
    const seqs = lines.map((e) => e.seq).sort((x, y) => x - y);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('P1-3：合成 closer 不再渲染成"该回复已中断"', () => {
  const base = (closerSynthetic: boolean): LiriEvent[] => [
    ev(1, 'turn/start', { turn: 1 }),
    ev(2, 'user/message', { content: 'hi', messageId: 'm-user' }),
    // 本轮没有任何正文（崩溃点）：这是"合成 closer 会污染观感"的最坏情形
    ev(3, 'assistant/thinking', { content: '思考', messageId: 'm-asst' }),
    ev(4, 'turn/end', {
      turn: 1,
      finishReason: 'canceled',
      ...(closerSynthetic ? { synthetic: true } : {}),
    }),
  ];

  it('synthetic:true ⇒ 派生消息不带 canceled（前端不显示中断）', () => {
    const messages = deriveMessagesFromEvents(base(true), []);
    const asst = messages.find((m) => m.id === 'm-asst');
    expect(asst?.finishReason).toBeUndefined();
  });

  it('真实 canceled（无 synthetic 标记）⇒ 仍补 canceled（用户真中断要看得到）', () => {
    const messages = deriveMessagesFromEvents(base(false), []);
    const asst = messages.find((m) => m.id === 'm-asst');
    expect(asst?.finishReason).toBe('canceled');
  });

  it('合成 closer 先到、真实 stop 后到 ⇒ 以真实原因为准，且不再静默', () => {
    const events: LiriEvent[] = [
      ev(1, 'turn/start', { turn: 1 }),
      ev(2, 'assistant/text', { content: '完整正文', messageId: 'm-asst' }),
      // 崩溃恢复先补了一条合成 canceled
      ev(3, 'turn/end', { turn: 1, finishReason: 'canceled', synthetic: true }),
      // 之后同轮真实收尾
      ev(4, 'turn/end', { turn: 1, finishReason: 'stop' }),
    ];
    const asst = deriveMessagesFromEvents(events, []).find(
      (m) => m.id === 'm-asst'
    );
    // stop 不是中断 ⇒ 无 finishReason（与改造前明文一致）
    expect(asst?.finishReason).toBeUndefined();
  });
});
