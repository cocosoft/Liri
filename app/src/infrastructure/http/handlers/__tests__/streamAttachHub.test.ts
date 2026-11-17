/**
 * streamAttachHub 单测（2026-11-18）
 *
 * Spec：`.trae/specs/stream-attach.md` §9/§10。锁死四件事：
 * 1. 游标语义：`from_seq` = 已消费帧数，回放从该序号起、不重不漏；
 * 2. 显式失败：无 run / 游标越界 / run 身份不符 / 订阅超限，绝不返回"看似连续"的流；
 * 3. 隔离：新 run 顶替旧 run，旧句柄不得污染新缓冲；订阅端异常只摘除该端；
 * 4. 收口：`end()` 关闭订阅端、保留期内 attach 仍可拿到全量回放。
 */
import { describe, expect, it, beforeEach } from 'bun:test';

import {
  ATTACH_MAX_FRAMES,
  ATTACH_MAX_SUBSCRIBERS,
  __resetAttachHubForTest,
  beginRun,
  openAttach,
  type AttachSink,
} from '../streamAttachHub';

const SID = 'session_attach_test';
const frame = (n: number): string => `data: {"n":${n}}\n\n`;

function makeSink(): AttachSink & {
  writes: Array<[number, string]>;
  closes: number;
} {
  const writes: Array<[number, string]> = [];
  const sink = {
    writes,
    closes: 0,
    write(seq: number, f: string): boolean {
      writes.push([seq, f]);
      return true;
    },
    close(): void {
      sink.closes++;
    },
  };
  return sink;
}

beforeEach(() => {
  __resetAttachHubForTest();
});

describe('openAttach（显式失败）', () => {
  it('无运行中的 run ⇒ 404 no_active_run', () => {
    const r = openAttach(SID, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('no_active_run');
    }
  });

  it('带不匹配的 run_id ⇒ 409 run_mismatch（附当前 runId）', () => {
    const run = beginRun(SID, 'chatcmpl-new');
    run.publish(frame(0));

    const r = openAttach(SID, 0, 'chatcmpl-old');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('run_mismatch');
      expect(r.body.error.runId).toBe('chatcmpl-new');
    }
  });

  it('from_seq 超出已发布范围 ⇒ 409 cursor_gap', () => {
    const run = beginRun(SID, 'run-1');
    run.publish(frame(0));

    const r = openAttach(SID, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('cursor_gap');
      expect(r.body.error.nextSeq).toBe(1);
    }
  });

  it('订阅数达上限 ⇒ 429 too_many_attachments', () => {
    const run = beginRun(SID, 'run-1');
    run.publish(frame(0));
    for (let i = 0; i < ATTACH_MAX_SUBSCRIBERS; i++) {
      const r = openAttach(SID, 1);
      expect(r.ok).toBe(true);
      if (r.ok) r.addSink(makeSink());
    }

    const r = openAttach(SID, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(429);
      expect(r.body.error.code).toBe('too_many_attachments');
    }
  });
});

describe('游标与回放', () => {
  it('from_seq=0 ⇒ 全量回放，序号连续，meta 带 runId/fromSeq/nextSeq', () => {
    const run = beginRun(SID, 'run-1');
    for (let i = 0; i < 3; i++) run.publish(frame(i));

    const r = openAttach(SID, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.runId).toBe('run-1');
    expect(r.snapshot.fromSeq).toBe(0);
    expect(r.snapshot.nextSeq).toBe(3);
    expect(r.snapshot.replay).toEqual([frame(0), frame(1), frame(2)]);
    const meta = JSON.parse(
      r.snapshot.metaFrame.replace(/^data: /, '').trim()
    ) as Record<string, unknown>;
    expect(meta.__pyapp_type).toBe('attach_meta');
    expect(meta.runId).toBe('run-1');
    expect(meta.fromSeq).toBe(0);
    expect(meta.nextSeq).toBe(3);
  });

  it('from_seq=中间值 ⇒ 只回放其后帧（不重不漏）', () => {
    const run = beginRun(SID, 'run-1');
    for (let i = 0; i < 4; i++) run.publish(frame(i));

    const r = openAttach(SID, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.fromSeq).toBe(2);
    expect(r.snapshot.replay).toEqual([frame(2), frame(3)]);
  });

  it('from_seq=nextSeq ⇒ 空回放（仅接实时）', () => {
    const run = beginRun(SID, 'run-1');
    run.publish(frame(0));

    const r = openAttach(SID, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.replay).toEqual([]);
  });

  it('超出帧数上限 ⇒ 淘汰最旧并推进 oldestSeq（再回放到已淘汰游标 ⇒ 409）', () => {
    const run = beginRun(SID, 'run-1');
    const total = ATTACH_MAX_FRAMES + 10;
    for (let i = 0; i < total; i++) run.publish(frame(i));

    const evicted = openAttach(SID, 5);
    expect(evicted.ok).toBe(false);
    if (!evicted.ok) {
      expect(evicted.status).toBe(409);
      expect(evicted.body.error.code).toBe('cursor_gap');
      expect(evicted.body.error.oldestSeq).toBe(total - ATTACH_MAX_FRAMES);
    }

    const ok = openAttach(SID, total - 2);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.snapshot.replay).toEqual([frame(total - 2), frame(total - 1)]);
  });
});

describe('订阅与收口', () => {
  it('publish 逐帧推给订阅端，序号与主链路一致', () => {
    const run = beginRun(SID, 'run-1');
    run.publish(frame(0));
    const opened = openAttach(SID, 1);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const sink = makeSink();
    opened.addSink(sink);

    run.publish(frame(1));
    run.publish(frame(2));
    expect(sink.writes).toEqual([
      [1, frame(1)],
      [2, frame(2)],
    ]);
  });

  it('订阅端写入返回 false ⇒ 摘除并 close 一次（后续 publish 不再写入）', () => {
    const run = beginRun(SID, 'run-1');
    const opened = openAttach(SID, 0);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    let closes = 0;
    let calls = 0;
    opened.addSink({
      write() {
        calls++;
        return false;
      },
      close() {
        closes++;
      },
    });

    run.publish(frame(0));
    run.publish(frame(1));
    expect(calls).toBe(1);
    expect(closes).toBe(1);
  });

  it('end() 关闭全部订阅端；保留期内仍可回放全量（ended=true）', () => {
    const run = beginRun(SID, 'run-1');
    run.publish(frame(0));
    run.publish('data: [DONE]\n\n');
    const opened = openAttach(SID, 0);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const sink = makeSink();
    opened.addSink(sink);

    run.end();
    expect(sink.closes).toBe(1);

    const late = openAttach(SID, 0);
    expect(late.ok).toBe(true);
    if (!late.ok) return;
    expect(late.snapshot.ended).toBe(true);
    expect(late.snapshot.replay).toEqual([frame(0), 'data: [DONE]\n\n']);
  });

  it('end() 之后 publish 被忽略（不追加帧）', () => {
    const run = beginRun(SID, 'run-1');
    run.publish(frame(0));
    run.end();
    run.publish(frame(1));

    const r = openAttach(SID, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.nextSeq).toBe(1);
  });

  it('新 run 顶替旧 run：旧订阅端被关闭，旧句柄不得写入新缓冲', () => {
    const oldRun = beginRun(SID, 'run-old');
    oldRun.publish(frame(0));
    const opened = openAttach(SID, 1);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const sink = makeSink();
    opened.addSink(sink);

    const newRun = beginRun(SID, 'run-new');
    expect(sink.closes).toBe(1);

    // 旧生成器即便还在 yield，也不得污染新一轮
    oldRun.publish(frame(99));
    newRun.publish(frame(100));

    const r = openAttach(SID, 0, 'run-new');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.runId).toBe('run-new');
    expect(r.snapshot.replay).toEqual([frame(100)]);
  });
});
