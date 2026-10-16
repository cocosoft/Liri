// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 「编辑并另存为分支」的 fork 边界回归测试（2026-10-16）
//
// 背景（真机缺陷）：分支流程原为「fork 全量历史 → 事后用旧会话的 messageId 截断新会话」
// ⇒ 新会话的 `messages.jsonl` 为空（fork 只复制**事件**）⇒ 截断恒 404 ⇒ 分支重载后
// **旧消息回显**（编辑点之后的轮次仍可见）。
//
// 修法：边界改由**后端在源会话事件上**解析（`fork { truncateBeforeMessageId }`）——
// 客户端拿不到可信事件 seq（`lastEventSeq` 常为 null；`withPaginationSeq` 合成的是
// 「消息分页游标」而非事件 seq；写盘 tail 戳可能落在未闭合 turn 内被 400）。
//
// 本文件锁定的契约：
//   1. 非首条编辑 ⇒ 边界退到「该消息之前**最后一个已闭合轮次**的 turn/end」
//   2. 该消息之前无已闭合轮次（首轮编辑）⇒ 边界 0 ⇒ **零种子**分支（不复制任何事件）
//   3. 消息不在事件日志中 ⇒ 失败（不猜测边界），且**不建子会话**
//   4. 零回归：显式 boundary 的既有口径（0 / 越界 / 超 tailSeq）不变

import { describe, expect, it, afterEach, beforeEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SessionGateway } from '../../src/session/SessionGateway';
import { StorageType } from '../../src/session/storage/UnifiedStorage';
import {
  getSessionParent,
  resetSessionLineage,
} from '../../src/session/lineage/sessionLineage';
import {
  getFTS5SearchEngine,
  resetFTS5SearchEngine,
} from '../../src/session/FTS5SearchEngine';
import type { LiriEvent, LiriEventType } from '@modules/session/types/events';

const WORKTREE_HASH = 'testhash';

const gateways: SessionGateway[] = [];
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'fork-boundary-'));
  process.env.LIRI_DATA_DIR = dataDir;
  resetFTS5SearchEngine();
  resetSessionLineage();
});

afterEach(async () => {
  for (const gw of gateways.splice(0)) {
    try {
      await gw.close();
    } catch {
      // 关闭失败不影响断言
    }
  }
  delete process.env.LIRI_DATA_DIR;
  resetFTS5SearchEngine();
  resetSessionLineage();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // 清理失败不影响断言
  }
});

function makeFsGateway(): SessionGateway {
  const gw = new SessionGateway({
    storageConfig: {
      type: StorageType.FILESYSTEM,
      basePath: join(dataDir, 'sessions', WORKTREE_HASH),
    },
  });
  gateways.push(gw);
  return gw;
}

const sessionsRoot = (): string => join(dataDir, 'sessions');

function makeEvent(
  seq: number,
  sessionId: string,
  type: LiriEventType,
  data: Record<string, unknown> = {}
): LiriEvent {
  return {
    type,
    schemaVersion: 1,
    seq,
    time: 1700000000000 + seq * 1000,
    sessionId,
    data,
  };
}

/** 写源会话事件日志（逐行 JSON，与生产落盘格式一致） */
function writeEvents(sessionId: string, events: LiriEvent[]): void {
  const evDir = join(sessionsRoot(), WORKTREE_HASH, sessionId);
  mkdirSync(evDir, { recursive: true });
  writeFileSync(
    join(evDir, 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf-8'
  );
}

/**
 * 读子会话事件 seq 列表。
 *
 * ⚠️ **不走 `EventLogStorage.read()`**：其缺省 `limit=1000` 同样会截断（本文件的长会话用例
 * 正是为此而设）⇒ 这里直接读文件，断言"复制了多少条"才是真的。
 */
async function readChildSeqs(childId: string): Promise<number[]> {
  const p = join(sessionsRoot(), WORKTREE_HASH, childId, 'events.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => (JSON.parse(l) as LiriEvent).seq);
}

/**
 * 布局 A（**真机实测**：用户消息先于本轮 `turn/start` 落盘）——
 *  1 user/message m1 · 3 turn/start · 4 assistant · 5 turn/end
 *  7 user/message m2 · 8 turn/start · 9 assistant · 10 turn/end
 */
function layoutA(sessionId: string): LiriEvent[] {
  return [
    makeEvent(1, sessionId, 'user/message', { content: '甲', messageId: 'm1' }),
    makeEvent(2, sessionId, 'context/model-input', {}),
    makeEvent(3, sessionId, 'turn/start', { turn: 1 }),
    makeEvent(4, sessionId, 'assistant/text-batch', {
      content: '甲答',
      messageId: 'a1',
    }),
    makeEvent(5, sessionId, 'turn/end', { turn: 1, finishReason: 'stop' }),
    makeEvent(6, sessionId, 'metric/timing', {}),
    makeEvent(7, sessionId, 'user/message', { content: '乙', messageId: 'm2' }),
    makeEvent(8, sessionId, 'turn/start', { turn: 2 }),
    makeEvent(9, sessionId, 'assistant/text-batch', {
      content: '乙答',
      messageId: 'a2',
    }),
    makeEvent(10, sessionId, 'turn/end', { turn: 2, finishReason: 'stop' }),
  ];
}

describe('fork truncateBeforeMessageId: 编辑点之前的历史', () => {
  it('非首条编辑 ⇒ 边界退到上一轮 turn/end，子会话前缀不含编辑点消息', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();

    const sourceId = 'fb-a-source';
    const childId = 'fb-a-child';
    await gateway.createSession({ id: sourceId, title: sourceId });
    writeEvents(sourceId, layoutA(sourceId));

    const result = await gateway.forkSession(sourceId, {
      childId,
      truncateBeforeMessageId: 'm2',
    });

    expect(result.success).toBe(true);
    // 边界 = 第 1 轮 turn/end（5）；若按 `firstSeq - 1`（6）会多带一条非轮次事件
    expect(result.boundary).toBe(5);
    expect(result.copied).toBe(5);
    // 子会话前缀 = [1..5]，且**不含**编辑点消息 m2 / 其 turn
    expect(await readChildSeqs(childId)).toEqual([1, 2, 3, 4, 5]);
    // 血缘：声明 = 事实
    expect(getSessionParent(childId)).toBe(sourceId);
    const child = await gateway.getSession(childId);
    expect(
      (child?.metadata as { seedLength?: number } | undefined)?.seedLength
    ).toBe(5);
  });

  it('该消息之前无已闭合轮次（首轮编辑）⇒ 零种子分支（不复制事件）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();

    // 布局 B：`turn/start` 先于 `user/message` —— 此时 `firstSeq - 1` 会切在
    // **未闭合的 turn/start 之内**（被 open turn 拒绝）⇒ 必须退到"无已闭合轮次"= 0
    const sourceId = 'fb-b-source';
    const childId = 'fb-b-child';
    await gateway.createSession({ id: sourceId, title: sourceId });
    writeEvents(sourceId, [
      makeEvent(1, sourceId, 'turn/start', { turn: 1 }),
      makeEvent(2, sourceId, 'user/message', {
        content: '甲',
        messageId: 'm1',
      }),
      makeEvent(3, sourceId, 'assistant/text-batch', {
        content: '甲答',
        messageId: 'a1',
      }),
      makeEvent(4, sourceId, 'turn/end', { turn: 1, finishReason: 'stop' }),
    ]);

    const result = await gateway.forkSession(sourceId, {
      childId,
      truncateBeforeMessageId: 'm1',
    });

    expect(result.success).toBe(true);
    expect(result.boundary).toBe(0);
    expect(result.copied).toBe(0);
    expect(await readChildSeqs(childId)).toEqual([]);
    const child = await gateway.getSession(childId);
    expect(
      (child?.metadata as { seedLength?: number } | undefined)?.seedLength
    ).toBe(0);
  });

  it('消息不在事件日志中 ⇒ 失败且不建子会话（不猜测边界）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();

    const sourceId = 'fb-c-source';
    const childId = 'fb-c-child';
    await gateway.createSession({ id: sourceId, title: sourceId });
    writeEvents(sourceId, layoutA(sourceId));

    const result = await gateway.forkSession(sourceId, {
      childId,
      truncateBeforeMessageId: 'm-not-exist',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('truncate-before message not in event log');
    expect(result.session).toBeUndefined();
    expect(await gateway.getSession(childId)).toBeNull();
    expect(getSessionParent(childId)).toBeNull();
  });

  it('零回归：显式 boundary 的既有口径不变（0 / 超 tailSeq 均拒绝）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();

    const sourceId = 'fb-d-source';
    await gateway.createSession({ id: sourceId, title: sourceId });
    writeEvents(sourceId, layoutA(sourceId));

    const zero = await gateway.forkSession(sourceId, { boundary: 0 });
    expect(zero.success).toBe(false);
    expect(zero.error).toContain('invalid boundary');

    const over = await gateway.forkSession(sourceId, { boundary: 99 });
    expect(over.success).toBe(false);
    expect(over.error).toContain('invalid boundary');
  });
});

/**
 * 长会话（事件数 > 1000）—— `read()` 缺省 limit=1000 的**窗口截断**曾让 fork 全面误判
 * （2026-10-16，台账 FORK-PREFIX-WINDOW）。
 *
 * 布局：seq 1 为一条噪声事件（把窗口右端 1000 顶到"轮内"），其后每轮 5 条：
 * `user → turn/start → text → metric → turn/end` ⇒ 第 r 轮 user=5r-3、turn/end=5r+1。
 * 于是 [1..1000] 恰好**含 turn/start(998) 而不含 turn/end(1001)** ⇒ 旧实现必误报未闭合。
 */
describe('fork 长会话（事件数 > 1000，窗口截断回归）', () => {
  const ROUNDS = 300;
  /** 第 r 轮 user 消息 seq = 5r-3；turn/end seq = 5r+1；tail = 5*ROUNDS+1 */
  const turnEndSeq = (r: number): number => 5 * r + 1;

  function longLayout(sessionId: string): {
    events: LiriEvent[];
    userIds: string[];
  } {
    const events: LiriEvent[] = [makeEvent(1, sessionId, 'metric/timing', {})];
    const userIds: string[] = [];
    let seq = 1;
    for (let r = 1; r <= ROUNDS; r++) {
      const mid = `lu${r}`;
      userIds.push(mid);
      events.push(
        makeEvent(++seq, sessionId, 'user/message', {
          content: `第${r}问`,
          messageId: mid,
        })
      );
      events.push(makeEvent(++seq, sessionId, 'turn/start', { turn: r }));
      events.push(
        makeEvent(++seq, sessionId, 'assistant/text-batch', {
          content: `第${r}答`,
          messageId: `la${r}`,
        })
      );
      events.push(makeEvent(++seq, sessionId, 'metric/timing', {}));
      events.push(
        makeEvent(++seq, sessionId, 'turn/end', {
          turn: r,
          finishReason: 'stop',
        })
      );
    }
    return { events, userIds };
  }

  it('全量 fork（boundary=tailSeq > 1000）⇒ 成功（旧实现：窗口尾部误报未闭合轮次）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();

    const sourceId = 'fb-long-source';
    const childId = 'fb-long-child';
    await gateway.createSession({ id: sourceId, title: sourceId });
    writeEvents(sourceId, longLayout(sourceId).events);

    const tail = turnEndSeq(ROUNDS);
    const result = await gateway.forkSession(sourceId, { childId });

    expect(result.success).toBe(true);
    expect(result.boundary).toBe(tail);
    expect(result.copied).toBe(tail);
    expect((await readChildSeqs(childId)).length).toBe(tail);
  });

  it('truncateBeforeMessageId 目标落在 1000 之外 ⇒ 仍解析成功（旧实现：误判"不在事件日志"）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();

    const sourceId = 'fb-long2-source';
    const childId = 'fb-long2-child';
    await gateway.createSession({ id: sourceId, title: sourceId });
    const { events, userIds } = longLayout(sourceId);
    writeEvents(sourceId, events);

    // 末轮 user（seq = 5*300-3 = 1497，远超窗口）⇒ 边界 = 上一轮 turn/end（1496）
    const result = await gateway.forkSession(sourceId, {
      childId,
      truncateBeforeMessageId: userIds[ROUNDS - 1],
    });

    const expected = turnEndSeq(ROUNDS - 1);
    expect(expected).toBeGreaterThan(1000);
    expect(result.success).toBe(true);
    expect(result.boundary).toBe(expected);
    expect(result.copied).toBe(expected);
    // 子会话前缀 = [1..1496]（无噪声事件之外的多余项，且不含末轮 user）
    expect((await readChildSeqs(childId)).length).toBe(expected);
  });
});

describe('fork 标题锁（分支标题不被自动命名覆盖）', () => {
  it('给了 childTitle ⇒ 子会话 metadata 落 titleStage=manual / titleLocked（复用 renameSession 口径）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();

    const sourceId = 'fb-t1-source';
    const childId = 'fb-t1-child';
    await gateway.createSession({ id: sourceId, title: sourceId });
    writeEvents(sourceId, layoutA(sourceId));

    const result = await gateway.forkSession(sourceId, {
      childId,
      childTitle: '分支：甲',
    });
    expect(result.success).toBe(true);

    const child = await gateway.getSession(childId);
    const meta = child?.metadata as Record<string, unknown> | undefined;
    expect(meta?.titleStage).toBe('manual');
    expect(meta?.titleLocked).toBe(true);
    expect(meta?.titleAutoGenerated).toBe(true);
    expect(meta?.title).toBe('分支：甲');
    // 血缘字段不受影响
    expect(meta?.parentSessionId).toBe(sourceId);
  });

  it('未给 childTitle ⇒ 不落标题锁（程序化 fork 仍可自动命名）', async () => {
    const gateway = makeFsGateway();
    await gateway.initialize();

    const sourceId = 'fb-t2-source';
    const childId = 'fb-t2-child';
    await gateway.createSession({ id: sourceId, title: sourceId });
    writeEvents(sourceId, layoutA(sourceId));

    const result = await gateway.forkSession(sourceId, { childId });
    expect(result.success).toBe(true);

    const child = await gateway.getSession(childId);
    const meta = child?.metadata as Record<string, unknown> | undefined;
    expect(meta?.titleStage).toBeUndefined();
    expect(meta?.titleLocked).toBeUndefined();
  });
});
