/**
 * D3（2026-09-22）：制品保留策略（traces / checkpoints / rollback snapshots）
 *
 * 背景（真机实测）：`~/.pyapp/data` 合计 **15.1GB**，其中
 *  - `traces/`      6795MB（36 天，单日最高 662MB）—— 写入方无清理代码
 *  - `snapshots/`   4430MB（495 个 rollback 轮次目录，单个 manifest ~17MB）—— 只在 undo 时删单轮
 *  - `checkpoints/` 1181MB（5140 文件）—— 仅"每会话 50"，总数不受控
 *
 * 本文件锁定：
 *  ① 按龄清理三类制品；② **最新/未过期者一律不动**；③ 快照额外保底保留每会话最近 K 轮；
 *  ④ 目录形状不匹配者（非 `session_*` / 非白名单文件名）绝不触碰；
 *  ⑤ 目录不存在时安全返回；⑥ 会话目录清空后随之移除。
 *
 * 手法：目录与时间**全部注入**（临时目录 + `utimes` 造旧 mtime），不触碰真实
 * `~/.pyapp/data`。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
  existsSync,
  readdirSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runArtifactRetention } from '../../src/session/ArtifactRetention';
// 目录名唯一真源在探针模块；此处 import 用于**防漂移断言**（避免两处字面量各自演化）
import { LOOP_PROBE_DIR_NAME } from '../../src/diagnostics/loopProbe/loopProbe';

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const DAY = 24 * 60 * 60 * 1000;

function makeRoots(): {
  traces: string;
  checkpoints: string;
  snapshots: string;
  otelTraces: string;
  logs: string;
  transcripts: string;
  toolResults: string;
  eventLoopBlocks: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'artifact-retention-'));
  roots.push(root);
  const traces = join(root, 'traces');
  const checkpoints = join(root, 'checkpoints');
  const snapshots = join(root, 'snapshots');
  const otelTraces = join(root, 'otel-traces');
  const logs = join(root, 'logs');
  const transcripts = join(root, 'transcripts');
  const toolResults = join(root, 'tool-results');
  // 2026-09-22：必须注入探针产物目录 —— 否则 `dirs` 缺该键时会**回落到生产路径**
  // `~/.pyapp/data/artifacts/eventloop-blocks`，测试就会去扫描/删除真实探针产物。
  const eventLoopBlocks = join(root, 'eventloop-blocks');
  [
    traces,
    checkpoints,
    snapshots,
    otelTraces,
    logs,
    transcripts,
    toolResults,
    eventLoopBlocks,
  ].forEach((d) => mkdirSync(d, { recursive: true }));
  return {
    traces,
    checkpoints,
    snapshots,
    otelTraces,
    logs,
    transcripts,
    toolResults,
    eventLoopBlocks,
  };
}

/** 造一个文件并设置其 mtime 为 N 天前 */
function fileWithAge(
  dir: string,
  name: string,
  ageDays: number,
  size = 100
): string {
  const full = join(dir, name);
  writeFileSync(full, 'x'.repeat(size), 'utf-8');
  const t = new Date(Date.now() - ageDays * DAY);
  utimesSync(full, t, t);
  return full;
}

/** 造一个快照轮次目录（含 manifest.json）并设置 mtime */
function roundDir(sessionDir: string, round: string, ageDays: number): string {
  const full = join(sessionDir, round);
  mkdirSync(full, { recursive: true });
  writeFileSync(join(full, 'manifest.json'), 'y'.repeat(200), 'utf-8');
  const t = new Date(Date.now() - ageDays * DAY);
  utimesSync(full, t, t);
  return full;
}

describe('D3：traces 按龄清理', () => {
  test('超龄 .jsonl 被删、近期保留、非白名单名不触碰', async () => {
    const dirs = makeRoots();
    const oldTrace = fileWithAge(dirs.traces, 'trace_2026-01-01.jsonl', 30);
    const freshTrace = fileWithAge(dirs.traces, 'trace_today.jsonl', 0);
    const notTrace = fileWithAge(dirs.traces, 'notes.jsonl', 30); // 前缀不符

    const report = await runArtifactRetention({
      dirs,
      policy: { traceKeepDays: 7 },
    });

    expect(existsSync(oldTrace)).toBe(false);
    expect(existsSync(freshTrace)).toBe(true);
    expect(existsSync(notTrace)).toBe(true); // 白名单外不动
    expect(report.traces.deleted).toBe(1);
    expect(report.traces.bytesFreed).toBeGreaterThan(0);
  });
});

describe('D3：checkpoints 按龄清理', () => {
  test('超龄 checkpoint-*.json 被删，近期的保留', async () => {
    const dirs = makeRoots();
    const old = fileWithAge(dirs.checkpoints, 'checkpoint-a.json', 20);
    const fresh = fileWithAge(dirs.checkpoints, 'checkpoint-b.json', 1);

    const report = await runArtifactRetention({
      dirs,
      policy: { checkpointKeepDays: 14 },
    });

    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(report.checkpoints.deleted).toBe(1);
  });
});

describe('D3：rollback snapshots 双重判据', () => {
  test('每会话保底保留最近 K 轮（不论年龄），更旧轮次被删', async () => {
    const dirs = makeRoots();
    const sessionDir = join(dirs.snapshots, 'session_demo');
    mkdirSync(sessionDir, { recursive: true });
    // 25 轮，越新 ageDays 越小（0 = 最新）
    const paths: string[] = [];
    for (let i = 0; i < 25; i++) {
      paths.push(roundDir(sessionDir, `${i + 1}`, 25 - i));
    }

    const report = await runArtifactRetention({
      dirs,
      policy: { snapshotKeepRoundsPerSession: 20, snapshotKeepDays: 365 },
    });

    const left = readdirSync(sessionDir).sort((a, b) => Number(a) - Number(b));
    expect(left).toHaveLength(20);
    expect(left).toContain('25'); // 最新轮次必留
    expect(left).toContain('6');
    expect(left).not.toContain('5'); // 第 21 名之前被删
    expect(report.snapshots.deleted).toBe(5);
  });

  test('超龄轮次即使在新 K 轮内也被删（年龄判据独立生效）', async () => {
    const dirs = makeRoots();
    const sessionDir = join(dirs.snapshots, 'session_age');
    mkdirSync(sessionDir, { recursive: true });
    roundDir(sessionDir, '1', 400); // 极旧
    roundDir(sessionDir, '2', 1); // 新

    const report = await runArtifactRetention({
      dirs,
      policy: { snapshotKeepDays: 30, snapshotKeepRoundsPerSession: 20 },
    });

    expect(existsSync(join(sessionDir, '1'))).toBe(false);
    expect(existsSync(join(sessionDir, '2'))).toBe(true);
    expect(report.snapshots.deleted).toBe(1);
  });

  test('每会话至少保留最新 1 轮（K 传 0 被夹到 1，未超龄者不删空）', async () => {
    const dirs = makeRoots();
    const sessionDir = join(dirs.snapshots, 'session_keep1');
    mkdirSync(sessionDir, { recursive: true });
    roundDir(sessionDir, '1', 3); // 未超龄（30 天窗口内）
    roundDir(sessionDir, '2', 1);

    await runArtifactRetention({
      dirs,
      policy: { snapshotKeepRoundsPerSession: 0, snapshotKeepDays: 30 },
    });

    // 数量判据被夹到 keep=1 ⇒ 只留最新；未超龄故不是"全删"
    const left = readdirSync(sessionDir);
    expect(left).toEqual(['2']);
  });

  test('年龄判据独立生效：**最新一轮**若已超龄同样被删（不因保底而豁免）', async () => {
    const dirs = makeRoots();
    const sessionDir = join(dirs.snapshots, 'session_all_old');
    mkdirSync(sessionDir, { recursive: true });
    roundDir(sessionDir, '1', 999);
    roundDir(sessionDir, '2', 999);

    await runArtifactRetention({
      dirs,
      policy: { snapshotKeepRoundsPerSession: 20, snapshotKeepDays: 30 },
    });

    // 全删 ⇒ 空会话目录随之移除（保底只对"数量"生效，不对"年龄"豁免）
    expect(existsSync(sessionDir)).toBe(false);
  });

  test('清理后会话目录为空 ⇒ 目录一并移除', async () => {
    const dirs = makeRoots();
    const sessionDir = join(dirs.snapshots, 'session_empty');
    mkdirSync(sessionDir, { recursive: true });
    roundDir(sessionDir, '1', 999);

    await runArtifactRetention({ dirs, policy: { snapshotKeepDays: 1 } });

    expect(existsSync(sessionDir)).toBe(false);
  });

  test('非 session_* 目录不触碰', async () => {
    const dirs = makeRoots();
    const other = join(dirs.snapshots, 'config-backup');
    mkdirSync(other, { recursive: true });
    roundDir(other, '1', 999);

    await runArtifactRetention({ dirs, policy: { snapshotKeepDays: 1 } });

    expect(existsSync(join(other, '1'))).toBe(true);
  });
});

describe('D3 补充：otel-traces / logs / transcripts / tool-results', () => {
  test('otel-traces：超龄按日文件被删、当天保留', async () => {
    const dirs = makeRoots();
    const old = fileWithAge(dirs.otelTraces, '2026-01-01.jsonl', 30);
    const today = fileWithAge(dirs.otelTraces, '2026-09-22.jsonl', 0);

    const report = await runArtifactRetention({
      dirs,
      policy: { otelTraceKeepDays: 7 },
    });

    expect(existsSync(old)).toBe(false);
    expect(existsSync(today)).toBe(true);
    expect(report.otelTraces.deleted).toBe(1);
  });

  test('logs：只删 app.log.<时间戳> 轮转件，**活跃 app.log 永不删**（即使 mtime 很旧）', async () => {
    const dirs = makeRoots();
    const rotated = fileWithAge(
      dirs.logs,
      'app.log.2026-08-20T10-29-04-590Z',
      30
    );
    const live = fileWithAge(dirs.logs, 'app.log', 30); // 活跃文件（人为设旧）
    const otherLogger = fileWithAge(dirs.logs, 'llama-server.log', 30);

    const report = await runArtifactRetention({
      dirs,
      policy: { logKeepDays: 14 },
    });

    expect(existsSync(rotated)).toBe(false);
    expect(existsSync(live)).toBe(true); // 关键：活跃文件不匹配 `app.log.` 前缀
    expect(existsSync(otherLogger)).toBe(true); // 异构 logger 不碰
    expect(report.logs.deleted).toBe(1);
  });

  test('logs：轮转件在保留期内不删', async () => {
    const dirs = makeRoots();
    const fresh = fileWithAge(dirs.logs, 'app.log.2026-09-21T09-53-12-967Z', 1);

    await runArtifactRetention({ dirs, policy: { logKeepDays: 14 } });

    expect(existsSync(fresh)).toBe(true);
  });

  test('transcripts：超龄 .jsonl 删、近期留', async () => {
    const dirs = makeRoots();
    const old = fileWithAge(dirs.transcripts, 'sess_old.jsonl', 40);
    const fresh = fileWithAge(dirs.transcripts, 'sess_new.jsonl', 2);

    const report = await runArtifactRetention({
      dirs,
      policy: { transcriptKeepDays: 30 },
    });

    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(report.transcripts.deleted).toBe(1);
  });

  test('tool-results：超龄 .txt 删、近期留', async () => {
    const dirs = makeRoots();
    const old = fileWithAge(dirs.toolResults, 'c-old.txt', 40);
    const fresh = fileWithAge(dirs.toolResults, 'c-new.txt', 2);

    const report = await runArtifactRetention({
      dirs,
      policy: { toolResultKeepDays: 30 },
    });

    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(report.toolResults.deleted).toBe(1);
  });

  test('background/tasks.jsonl 不在白名单内 ⇒ 永不删（避免一次丢光任务历史）', async () => {
    const dirs = makeRoots();
    // background 未纳入 policy/dirs：把该文件放在任一受管目录下模拟"单文件追加"
    const old = fileWithAge(dirs.traces, 'tasks.jsonl', 999); // 无 trace_ 前缀

    await runArtifactRetention({ dirs });

    expect(existsSync(old)).toBe(true);
  });
});

describe('2026-09-22：事件循环阻塞探针产物保留（目录型：龄 + 份数）', () => {
  /** 造一份探针产物目录（含 profile + 摘要）并设置 mtime */
  function probeDir(parent: string, stamp: string, ageDays: number): string {
    const full = join(parent, `${stamp}_lag40000`);
    mkdirSync(full, { recursive: true });
    writeFileSync(join(full, 'summary.md'), 'z'.repeat(200), 'utf-8');
    const t = new Date(Date.now() - ageDays * DAY);
    utimesSync(full, t, t);
    return full;
  }

  test('目录名与探针模块 LOOP_PROBE_DIR_NAME 同值（防两处字面量漂移）', () => {
    expect(LOOP_PROBE_DIR_NAME).toBe('eventloop-blocks');
  });

  test('份数上限：超出 maxCount 的旧份被删，最新优先保留', async () => {
    const dirs = makeRoots();
    // 造 5 份：`d0` 最新（0 天前）、`d4` 最旧（4 天前）—— 名字下标即年龄
    const created = [0, 1, 2, 3, 4].map((i) =>
      probeDir(dirs.eventLoopBlocks, `d${i}`, i)
    );

    const report = await runArtifactRetention({
      dirs,
      policy: { eventLoopBlockMaxCount: 3 },
    });

    expect(report.eventLoopBlocks.deleted).toBe(2);
    expect(existsSync(created[4])).toBe(false); // 最旧（4 天前）
    expect(existsSync(created[3])).toBe(false);
    expect(existsSync(created[2])).toBe(true);
    expect(existsSync(created[0])).toBe(true); // 最新
  });

  test('年龄判据独立生效：超龄份即使在新份数内也被删', async () => {
    const dirs = makeRoots();
    const stale = probeDir(dirs.eventLoopBlocks, 'stale', 10);
    const fresh = probeDir(dirs.eventLoopBlocks, 'fresh', 1);

    const report = await runArtifactRetention({
      dirs,
      policy: { eventLoopBlockKeepDays: 7 },
    });

    expect(report.eventLoopBlocks.deleted).toBe(1);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

describe('D3：安全边界', () => {
  test('目录不存在 ⇒ 安全返回零删除（不抛错）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-missing-'));
    roots.push(root);
    const report = await runArtifactRetention({
      dirs: {
        traces: join(root, 'nope-traces'),
        checkpoints: join(root, 'nope-cp'),
        snapshots: join(root, 'nope-snap'),
        // 一并注入不存在的探针产物目录，避免回落到生产路径
        eventLoopBlocks: join(root, 'nope-probe'),
      },
    });
    expect(report).toMatchObject({
      traces: { deleted: 0, bytesFreed: 0 },
      checkpoints: { deleted: 0, bytesFreed: 0 },
      snapshots: { deleted: 0, bytesFreed: 0 },
    });
  });

  test('策略内无过期内容 ⇒ 零删除（幂等：连跑两次第二次为 0）', async () => {
    const dirs = makeRoots();
    fileWithAge(dirs.traces, 'trace_old.jsonl', 30);
    const first = await runArtifactRetention({
      dirs,
      policy: { traceKeepDays: 7 },
    });
    const second = await runArtifactRetention({
      dirs,
      policy: { traceKeepDays: 7 },
    });

    expect(first.traces.deleted).toBe(1);
    expect(second.traces.deleted).toBe(0);
  });
});
