/**
 * C（2026-10-30）：事件流 thinking「按轮清理」的单测。
 *
 * 覆盖：
 *  ① 计划口径（只删更早轮次的 thinking；坏行/非 thinking 行不动；无 `turn/start` 不猜）；
 *  ② 不变量（`seq` 不重排、最大 seq 行永不删、末行不删）；
 *  ③ 预演只读（文件逐字节不变、不建备份目录）；
 *  ④ `--apply`：仓库级守卫「非 thinking 事件序列逐条不变」+ 备份 + 审计 + 删 `events.idx` + `events.tail` 对齐；
 *  ⑤ 活跃会话跳过、重复执行幂等。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  planThinkingPrune,
  pruneEventThinkingFile,
} from '../../src/session/storage/eventThinkingPrune.js';
import { pruneEventThinking } from '../../scripts/prune-event-thinking.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-prune-thinking-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 构造一段事件流；每轮：turn/start → user → thinking×3 → text-batch → tool_call → tool/result → turn/end */
function buildEvents(turns: number, thinkingPerTurn = 3): string[] {
  const lines: string[] = [];
  let seq = 0;
  const push = (type: string, data: Record<string, unknown>) => {
    seq += 1;
    lines.push(
      JSON.stringify({ seq, type, time: 1_700_000_000_000 + seq, data })
    );
  };
  for (let turn = 1; turn <= turns; turn++) {
    push('turn/start', { turn });
    push('user/message', { content: `问题 ${turn}` });
    for (let i = 0; i < thinkingPerTurn; i++) {
      push('assistant/thinking', {
        content: `思考 ${turn}-${i}`,
        messageId: `msg-${turn}`,
      });
    }
    push('assistant/text-batch', {
      content: `回答 ${turn}`,
      messageId: `msg-${turn}`,
    });
    push('assistant/tool_call', {
      toolCallId: `call-${turn}`,
      name: 'read_file',
      args: {},
      messageId: `msg-${turn}`,
    });
    push('tool/result', { toolCallId: `call-${turn}`, callSeq: seq - 1 });
    push('turn/end', { turn, finishReason: 'stop' });
  }
  return lines;
}

/** 建一个会话目录（默认带 events.idx + events.tail，模拟真实会话） */
function makeSession(
  sessionId: string,
  lines: string[],
  options: { idx?: boolean } = {}
): string {
  const dir = join(root, 'sessions', 'partition1', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), `${lines.join('\n')}\n`, 'utf-8');
  if (options.idx !== false) {
    writeFileSync(join(dir, 'events.idx'), '{"fromSeq":1}\n', 'utf-8');
  }
  const maxSeq = lines.reduce((max, line) => {
    const seq = (JSON.parse(line) as { seq: number }).seq;
    return seq > max ? seq : max;
  }, 0);
  writeFileSync(join(dir, 'events.tail'), String(maxSeq), 'utf-8');
  return dir;
}

/** 把 `mtime` 拨旧（绕过"活跃会话跳过"） */
function ageFile(filePath: string, days: number): void {
  const t = Date.now() - days * 24 * 3600 * 1000;
  utimesSync(filePath, new Date(t), new Date(t));
}

const readLines = (filePath: string): string[] =>
  readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0);

describe('planThinkingPrune（按轮保留口径）', () => {
  it('保留最近 K 轮，只清理更早轮次的 thinking', () => {
    const lines = buildEvents(4);
    const plan = planThinkingPrune(lines, { keepTurns: 2 });

    expect(plan.maxTurn).toBe(4);
    expect(plan.keepFromTurn).toBe(3);
    expect(plan.thinkingEvents).toBe(12);
    expect(plan.prunableEvents).toBe(6); // 第 1、2 轮各 3 条
    const prunedTurns = plan.turns.filter((t) => t.pruned).map((t) => t.turn);
    expect(prunedTurns).toEqual([1, 2]);
    // 只删 thinking：下标全部指向 thinking 行
    for (const index of plan.pruneIndexes) {
      expect(JSON.parse(lines[index]).type).toBe('assistant/thinking');
    }
    expect(plan.remainingEvents).toBe(lines.length - 6);
  });

  it('轮数不超过 K ⇒ 一条不删（幂等前提）', () => {
    const plan = planThinkingPrune(buildEvents(3), { keepTurns: 10 });
    expect(plan.keepFromTurn).toBe(0);
    expect(plan.prunableEvents).toBe(0);
  });

  it('无 turn/start（v0 legacy）⇒ 不猜轮次、整体不动', () => {
    const lines = [
      JSON.stringify({ seq: 1, type: 'user/message', data: { content: 'a' } }),
      JSON.stringify({
        seq: 2,
        type: 'assistant/thinking',
        data: { content: 't', messageId: 'm' },
      }),
    ];
    const plan = planThinkingPrune(lines, { keepTurns: 1 });
    expect(plan.maxTurn).toBe(0);
    expect(plan.prunableEvents).toBe(0);
  });

  it('坏行不是清理对象（原样保留，且不参与轮次推断）', () => {
    const lines = [...buildEvents(4), '{"seq": 999, 坏行'];
    const plan = planThinkingPrune(lines, { keepTurns: 2 });
    expect(plan.totalEvents).toBe(lines.length);
    expect(plan.pruneIndexes).not.toContain(lines.length - 1);
  });

  it('最大 seq 行与文件末行永不删（即使它属于旧轮次）', () => {
    const lines = buildEvents(4);
    // 末尾追加「回到第 1 轮」的落单 thinking：可归轮但绝不能删
    lines.push(
      JSON.stringify({
        seq: 9999,
        type: 'turn/start',
        time: 1,
        data: { turn: 1 },
      })
    );
    lines.push(
      JSON.stringify({
        seq: 10000,
        type: 'assistant/thinking',
        time: 2,
        data: { content: '落单', messageId: 'msg-x' },
      })
    );
    const plan = planThinkingPrune(lines, { keepTurns: 1 });
    expect(plan.pruneIndexes).not.toContain(lines.length - 1);
    expect(plan.pruneIndexes).not.toContain(lines.length - 2);
  });
});

describe('pruneEventThinkingFile（预演 / 执行 / 不变量）', () => {
  it('预演：文件逐字节不变，不写备份、不删 idx', () => {
    const dir = makeSession('sess_preview', buildEvents(4));
    const filePath = join(dir, 'events.jsonl');
    const before = readFileSync(filePath, 'utf-8');
    ageFile(filePath, 1);

    const result = pruneEventThinkingFile({
      filePath,
      sessionId: 'sess_preview',
      keepTurns: 2,
      idleMs: 60_000,
      apply: false,
      backupDir: join(root, 'migrations', 'x'),
    });

    expect(result.status).toBe('ok');
    expect(result.applied).toBe(false);
    expect(result.plan?.prunableEvents).toBe(6);
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
    expect(existsSync(join(root, 'migrations'))).toBe(false);
    expect(existsSync(join(dir, 'events.idx'))).toBe(true);
  });

  it('执行：非 thinking 事件逐条不变 + seq 不重排 + 删 idx + tail 对齐 + 备份', () => {
    const original = buildEvents(4);
    const dir = makeSession('sess_apply', original);
    const filePath = join(dir, 'events.jsonl');
    ageFile(filePath, 1);

    const result = pruneEventThinkingFile({
      filePath,
      sessionId: 'sess_apply',
      keepTurns: 2,
      idleMs: 60_000,
      apply: true,
      backupDir: join(root, 'migrations', 'backup'),
    });

    expect(result.applied).toBe(true);
    const kept = readLines(filePath);

    // 守卫（= 生产读路径的实际输入）：排除 thinking 后逐条完全相同
    const beforeNonThinking = original.filter(
      (l) => JSON.parse(l).type !== 'assistant/thinking'
    );
    const afterNonThinking = kept.filter(
      (l) => JSON.parse(l).type !== 'assistant/thinking'
    );
    expect(afterNonThinking).toEqual(beforeNonThinking);

    // 保留的 thinking 全部属于最近 2 轮；seq 原始值不变（允许空洞）
    const keptThinking = kept.filter(
      (l) => JSON.parse(l).type === 'assistant/thinking'
    );
    expect(keptThinking).toHaveLength(6);
    const seqs = kept.map((l) => JSON.parse(l).seq as number);
    const originalSeqs = new Set(
      original.map((l) => JSON.parse(l).seq as number)
    );
    for (const seq of seqs) expect(originalSeqs.has(seq)).toBe(true);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    // 派生物：idx 删除（字节偏移失效）、tail 对齐最大 seq
    expect(existsSync(join(dir, 'events.idx'))).toBe(false);
    const maxSeq = Math.max(...seqs);
    expect(readFileSync(join(dir, 'events.tail'), 'utf-8')).toBe(
      String(maxSeq)
    );

    // 备份逐字节等于原文件
    const backup = join(
      root,
      'migrations',
      'backup',
      'sess_apply',
      'events.jsonl'
    );
    expect(readFileSync(backup, 'utf-8')).toBe(`${original.join('\n')}\n`);
  });

  it('活跃会话（mtime 在窗口内）⇒ 跳过，不写盘', () => {
    const dir = makeSession('sess_active', buildEvents(4));
    const filePath = join(dir, 'events.jsonl');
    const before = readFileSync(filePath, 'utf-8');

    const result = pruneEventThinkingFile({
      filePath,
      sessionId: 'sess_active',
      keepTurns: 2,
      idleMs: 60 * 60 * 1000,
      apply: true,
    });
    expect(result.status).toBe('recent-write');
    expect(result.applied).toBe(false);
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('重复执行 ⇒ noop（幂等）', () => {
    const dir = makeSession('sess_twice', buildEvents(4));
    const filePath = join(dir, 'events.jsonl');
    ageFile(filePath, 1);
    const params = {
      filePath,
      sessionId: 'sess_twice',
      keepTurns: 2,
      apply: true,
    };
    expect(pruneEventThinkingFile(params).applied).toBe(true);
    expect(pruneEventThinkingFile(params).status).toBe('noop');
  });
});

describe('pruneEventThinking（脚本：扫描 / 备份 / 审计）', () => {
  it('--apply 后才建备份目录并写 audit.jsonl；预演不写', () => {
    const dir = makeSession('sess_script', buildEvents(4));
    ageFile(join(dir, 'events.jsonl'), 1);
    const now = new Date('2026-10-30T12:00:00Z');

    const preview = pruneEventThinking(root, {
      apply: false,
      keepTurns: 2,
      idleMinutes: 30,
      now,
    });
    expect(preview.applied).toBe(0);
    expect(preview.backupDir).toBeUndefined();
    expect(existsSync(join(root, 'migrations'))).toBe(false);

    const applied = pruneEventThinking(root, {
      apply: true,
      keepTurns: 2,
      idleMinutes: 30,
      now,
    });
    expect(applied.applied).toBe(1);
    expect(applied.backupDir).toBe(
      join(root, 'migrations', 'events-thinking-prune-20261030T120000')
    );
    const audit = readLines(join(applied.backupDir!, 'audit.jsonl'));
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0])).toMatchObject({
      sessionId: 'sess_script',
      prunedThinkingEvents: 6,
      keepTurns: 2,
    });
  });

  it('legacy 会话（无 turn/start）⇒ 跳过，不动文件', () => {
    const legacy = [
      JSON.stringify({ seq: 1, type: 'user/message', data: { content: 'a' } }),
      JSON.stringify({
        seq: 2,
        type: 'assistant/thinking',
        data: { content: 't', messageId: 'm' },
      }),
    ];
    const dir = makeSession('sess_legacy', legacy, { idx: false });
    ageFile(join(dir, 'events.jsonl'), 1);

    const result = pruneEventThinking(root, {
      apply: true,
      keepTurns: 1,
      idleMinutes: 30,
    });
    expect(result.items[0]?.status).toBe('noop');
    expect(result.applied).toBe(0);
    expect(readLines(join(dir, 'events.jsonl'))).toEqual(legacy);
  });
});
