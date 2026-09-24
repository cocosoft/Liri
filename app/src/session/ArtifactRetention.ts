/**
 * 制品保留策略（D3，2026-09-22）
 *
 * **背景**：`~/.pyapp/data` 实测 **15.1GB**，其中多类"会话派生制品"原先**完全没有保留策略**：
 *  - `traces/`      6795MB（36 天，单日最高 662MB；写入方无任何清理代码）
 *  - `snapshots/`   4430MB（495 个 rollback 轮次目录，单个 manifest ~17MB；只在显式 undo 时删单轮）
 *  - `checkpoints/` 1181MB（5140 文件；仅"每会话 50"上限 ⇒ 总量 = 会话数 × 50，不受控）
 *  - `logs/`        498MB（38 个轮转件；`rotateLogs()` **只轮转不删除**，`LogConfig` 的
 *                   `maxFiles=5`/`maxSize=10MB` 在 logging 栈内**无消费者**）
 *  - `otel-traces/` 37MB（按日 jsonl，与 traces 同构）
 *  - `transcripts/` 27MB · `tool-results/` 26MB（按次追加）
 *
 * **2026-09-22 追加**：`artifacts/eventloop-blocks/<stamp>/`（事件循环阻塞探针产物：
 * `profile.cpuprofile` + `summary.md`）—— 单份数 MB 且产生速率与阻塞频率绑定
 * （实测阻塞 562 次 / 11 天），按"龄 7 天 + 上限 30 份"清理（目录型判据）。
 *
 * **明确不纳入**：`background/tasks.jsonl`（单文件追加）—— 按龄删"单文件"等于**一次删掉全部历史**，
 * 需的是"按大小轮转/截断"而非年龄清理，属另一机制，另议。
 *
 * **职责边界（归一化）**：会话本体与"被剪枝会话的检查点"由既有
 * [`SessionPruner`](./SessionPruner.ts)（30 天 / 1000 会话 / 联动清检查点）负责；
 * `backups/`（DB 备份，`maxBackups=7`）本就有效；本模块只补**制品级**缺口，不重复实现。
 *
 * **安全约束**（destructive 代码必须自我约束）：
 *  ① 只触碰**白名单目录**（traces / checkpoints / snapshots / otel-traces / logs / transcripts
 *     / tool-results / `artifacts/eventloop-blocks`），且只按**文件名前缀/后缀**与
 *     **目录形状**（`session_<id>` 下的轮次目录、探针的 `<stamp>_lag<n>` 目录）匹配；
 *  ② 一律按 `mtime` 判龄，**最近的文件永不动**（快照还额外保底保留最新 1 轮；
 *     `logs` 只匹配 `app.log.<时间戳>` 轮转件，**活跃的 `app.log` 与异构 `*.log` 永不匹配**）；
 *  ③ 单条目失败只 warn 并继续（不中断整轮，也不因单点异常误删其它）；
 *  ④ 目录不可注入时（未传 `dirs`）才用生产路径，测试一律传临时目录。
 */

import { readdir, stat, rm, rmdir } from 'fs/promises';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';
import { resolveDataSubDir, resolveSnapshotsDir } from '@modules/core/paths';
import { enterPhase, exitPhase } from '@modules/diagnostics';

const logger = getLogger('session:artifact-retention');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 保留策略。
 *
 * 取值依据（真机实测增速约 300–400MB/天）：
 *  - `traces` 7 天 —— 排查/复现窗口足够，且单日最大 662MB ⇒ 上限约 4.6GB → 收敛到 ~1.3GB；
 *  - `checkpoints` 14 天 —— 回滚是"近期操作"语义，长龄检查点几乎不会被用；
 *  - `snapshots` 30 天 + 每会话 20 轮 —— 与 `SessionPruner` 的会话 30 天口径对齐。
 */
export interface ArtifactRetentionPolicy {
  /** traces/*.jsonl 保留天数 */
  traceKeepDays: number;
  /** checkpoints/checkpoint-*.json 保留天数 */
  checkpointKeepDays: number;
  /** snapshots 下各会话轮次目录的保留天数 */
  snapshotKeepDays: number;
  /** 每个会话额外保底保留的最近轮次数（不论年龄） */
  snapshotKeepRoundsPerSession: number;
  /** otel-traces/<date>.jsonl 保留天数（与 traces 同构的按日遥测） */
  otelTraceKeepDays: number;
  /** logs/app.log.<时间戳> 轮转件保留天数（**活跃的 app.log 本体永不删**） */
  logKeepDays: number;
  /** transcripts/*.jsonl 保留天数 */
  transcriptKeepDays: number;
  /** tool-results/*.txt 保留天数 */
  toolResultKeepDays: number;
  /**
   * `artifacts/eventloop-blocks/<stamp>/` 保留天数（2026-09-22 新增）。
   *
   * 来源：事件循环阻塞探针（`diagnostics/loopProbe`）的归因产物 —— 每次阻塞转储
   * `profile.cpuprofile` + `summary.md`，单份可达数 MB 且**天然连续产生**（阻塞高频重复），
   * 必须有上限，否则又是"只增不减"的制品。
   */
  eventLoopBlockKeepDays: number;
  /** `artifacts/eventloop-blocks` 下最多保留份数（不论年龄，最新优先） */
  eventLoopBlockMaxCount: number;
}

export const DEFAULT_ARTIFACT_RETENTION: ArtifactRetentionPolicy = {
  traceKeepDays: 7,
  checkpointKeepDays: 14,
  snapshotKeepDays: 30,
  snapshotKeepRoundsPerSession: 20,
  // 与 traces 同口径：都是"按日追加的排查类遥测"，7 天够复现窗口
  otelTraceKeepDays: 7,
  // 轮转日志比遥测更可能被翻查（且单文件可达 71MB）⇒ 给 14 天
  logKeepDays: 14,
  transcriptKeepDays: 30,
  toolResultKeepDays: 30,
  // 探针产物：与 traces 同口径 7 天；单进程最多转储 3 份 ⇒ 30 份足够覆盖多轮取证会话
  eventLoopBlockKeepDays: 7,
  eventLoopBlockMaxCount: 30,
};

export interface RetentionStats {
  deleted: number;
  bytesFreed: number;
}

export interface ArtifactRetentionReport {
  traces: RetentionStats;
  checkpoints: RetentionStats;
  snapshots: RetentionStats;
  otelTraces: RetentionStats;
  logs: RetentionStats;
  transcripts: RetentionStats;
  toolResults: RetentionStats;
  eventLoopBlocks: RetentionStats;
  elapsedMs: number;
}

/** 目录注入点（测试用；缺省取生产路径） */
export interface ArtifactRetentionDirs {
  traces?: string;
  checkpoints?: string;
  snapshots?: string;
  otelTraces?: string;
  logs?: string;
  transcripts?: string;
  toolResults?: string;
  eventLoopBlocks?: string;
}

export interface RunArtifactRetentionParams {
  policy?: Partial<ArtifactRetentionPolicy>;
  dirs?: ArtifactRetentionDirs;
  /** 时间注入（测试用；缺省 `Date.now()`） */
  now?: number;
}

function emptyStats(): RetentionStats {
  return { deleted: 0, bytesFreed: 0 };
}

/** 路径不存在（首次启动尚无该目录）⇒ 空列表，不报错 */
async function safeReaddir(
  dir: string
): Promise<
  Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    // @ignore-catch — 目录不存在 = 无制品可清，属正常路径
    return [];
  }
}

/** 取条目大小（失败返回 0，仅用于统计） */
async function sizeOf(target: string): Promise<number> {
  try {
    const st = await stat(target);
    return st.size;
  } catch {
    // @ignore-catch — 统计口径，失败按 0 计
    return 0;
  }
}

/**
 * 按"名字过滤 + 年龄"清理单层目录里的文件。
 * 只处理**常规文件**（跳过目录/符号链接），失败逐条 warn 后继续。
 */
async function pruneFilesByAge(params: {
  dir: string;
  cutoffMs: number;
  match: (name: string) => boolean;
}): Promise<RetentionStats> {
  const stats = emptyStats();
  for (const entry of await safeReaddir(params.dir)) {
    if (!entry.isFile() || !params.match(entry.name)) continue;
    const full = join(params.dir, entry.name);
    try {
      const st = await stat(full);
      if (st.mtimeMs >= params.cutoffMs) continue;
      await rm(full, { force: true });
      stats.deleted++;
      stats.bytesFreed += st.size;
    } catch (err) {
      logger.warn('制品保留：删除失败（跳过该条目）', {
        file: full,
        error: String(err),
      });
    }
  }
  return stats;
}

/**
 * 清理 rollback 快照：`snapshots/session_<id>/<轮次>/`。
 *
 * 双重判据（任一命中即删）：① 超过 `snapshotKeepDays`；② 该会话内**按 mtime 降序**排在第
 * `snapshotKeepRoundsPerSession` 之后的轮次。最新 1 轮**恒定保留**（`index >= keep` 且 keep ≥ 1）。
 * 清理后若会话目录已空则一并移除（避免留下空壳目录影响巡检）。
 */
async function pruneSnapshotsByAge(params: {
  dir: string;
  cutoffMs: number;
  keepRoundsPerSession: number;
}): Promise<RetentionStats> {
  const stats = emptyStats();
  const keep = Math.max(1, Math.floor(params.keepRoundsPerSession));

  for (const sessionEntry of await safeReaddir(params.dir)) {
    if (
      !sessionEntry.isDirectory() ||
      !sessionEntry.name.startsWith('session_')
    ) {
      continue;
    }
    const sessionDir = join(params.dir, sessionEntry.name);
    const rounds = (await safeReaddir(sessionDir)).filter((e) =>
      e.isDirectory()
    );
    if (rounds.length === 0) continue;

    // 按 mtime 降序（最新在前）——排序失败按名字降序兜底（轮次目录名通常递增）
    const withTime: Array<{ name: string; mtimeMs: number }> = [];
    for (const round of rounds) {
      const full = join(sessionDir, round.name);
      try {
        const st = await stat(full);
        withTime.push({ name: round.name, mtimeMs: st.mtimeMs });
      } catch (err) {
        logger.warn('制品保留：快照轮次 stat 失败（跳过）', {
          dir: full,
          error: String(err),
        });
      }
    }
    withTime.sort(
      (a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name)
    );

    for (let i = 0; i < withTime.length; i++) {
      const round = withTime[i];
      const tooOld = round.mtimeMs < params.cutoffMs;
      const beyondKeep = i >= keep;
      if (!tooOld && !beyondKeep) continue;
      const full = join(sessionDir, round.name);
      try {
        const bytes = await sizeOf(full);
        await rm(full, { recursive: true, force: true });
        stats.deleted++;
        stats.bytesFreed += bytes;
      } catch (err) {
        logger.warn('制品保留：删除快照轮次失败（跳过）', {
          dir: full,
          error: String(err),
        });
      }
    }

    // 会话目录清空后移除（空目录会让巡检误判"有制品"）
    try {
      const left = await readdir(sessionDir);
      if (left.length === 0) await rmdir(sessionDir);
    } catch {
      // @ignore-catch — 目录已删/非空/被占用均无需处理
    }
  }
  return stats;
}

/**
 * 按"龄 + 份数"清理**目录型**制品（`artifacts/eventloop-blocks/<stamp>/`）。
 *
 * 与 `pruneFilesByAge` 的差别：探针一次产出的是一个**目录**（profile + 摘要），
 * 且产生速率与阻塞频率绑定 ⇒ 除年龄外还需**份数上限**（最新优先保留）。
 */
async function pruneDirsByAgeAndCount(params: {
  dir: string;
  cutoffMs: number;
  maxCount: number;
}): Promise<RetentionStats> {
  const stats = emptyStats();
  const entries = (await safeReaddir(params.dir)).filter((e) =>
    e.isDirectory()
  );
  if (entries.length === 0) return stats;

  const withTime: Array<{ name: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    const full = join(params.dir, entry.name);
    try {
      const st = await stat(full);
      withTime.push({ name: entry.name, mtimeMs: st.mtimeMs });
    } catch (err) {
      logger.warn('制品保留：探针产物 stat 失败（跳过）', {
        dir: full,
        error: String(err),
      });
    }
  }
  withTime.sort(
    (a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name)
  );

  const keep = Math.max(1, Math.floor(params.maxCount));
  for (let i = 0; i < withTime.length; i++) {
    const item = withTime[i];
    const tooOld = item.mtimeMs < params.cutoffMs;
    const beyondKeep = i >= keep;
    if (!tooOld && !beyondKeep) continue;
    const full = join(params.dir, item.name);
    try {
      const bytes = await sizeOf(full);
      await rm(full, { recursive: true, force: true });
      stats.deleted++;
      stats.bytesFreed += bytes;
    } catch (err) {
      logger.warn('制品保留：删除探针产物失败（跳过）', {
        dir: full,
        error: String(err),
      });
    }
  }
  return stats;
}

/**
 * 执行一次制品保留（幂等、可重复调用）。
 *
 * 由 `SessionGateway.startPruneInterval` 的 5 分钟节拍一并驱动（复用既有生命周期，
 * 不新造定时器）；也可在 CLI/运维路径手动调用。
 */
export async function runArtifactRetention(
  params: RunArtifactRetentionParams = {}
): Promise<ArtifactRetentionReport> {
  enterPhase('retention:run');
  try {
    const policy: ArtifactRetentionPolicy = {
      ...DEFAULT_ARTIFACT_RETENTION,
      ...params.policy,
    };
    const now = params.now ?? Date.now();
    const started = Date.now();

    const tracesDir = params.dirs?.traces ?? resolveDataSubDir('traces');
    const checkpointsDir =
      params.dirs?.checkpoints ?? resolveDataSubDir('checkpoints');
    const snapshotsDir = params.dirs?.snapshots ?? resolveSnapshotsDir();
    const otelTracesDir =
      params.dirs?.otelTraces ?? resolveDataSubDir('otel-traces');
    const logsDir = params.dirs?.logs ?? resolveDataSubDir('logs');
    const transcriptsDir =
      params.dirs?.transcripts ?? resolveDataSubDir('transcripts');
    const toolResultsDir =
      params.dirs?.toolResults ?? resolveDataSubDir('tool-results');
    // 事件循环阻塞探针产物：`artifacts/eventloop-blocks/<stamp>/`。
    // 目录名与 `diagnostics/loopProbe` 的 `LOOP_PROBE_DIR_NAME` 同值 ——
    // 由 `artifactRetention.test.ts` 断言两者一致（防漂移），此处刻意不做跨层 import
    // 以免把 `node:inspector` 拉进会话模块的启动图。
    const eventLoopBlocksDir =
      params.dirs?.eventLoopBlocks ??
      join(resolveDataSubDir('artifacts'), 'eventloop-blocks');

    const traces = await pruneFilesByAge({
      dir: tracesDir,
      cutoffMs: now - policy.traceKeepDays * MS_PER_DAY,
      match: (n) => n.startsWith('trace_') && n.endsWith('.jsonl'),
    });
    const checkpoints = await pruneFilesByAge({
      dir: checkpointsDir,
      cutoffMs: now - policy.checkpointKeepDays * MS_PER_DAY,
      match: (n) => n.startsWith('checkpoint-') && n.endsWith('.json'),
    });
    const snapshots = await pruneSnapshotsByAge({
      dir: snapshotsDir,
      cutoffMs: now - policy.snapshotKeepDays * MS_PER_DAY,
      keepRoundsPerSession: policy.snapshotKeepRoundsPerSession,
    });
    // D3 补充（2026-09-22）：以下四类原先**完全没有清理**（实测 logs 498MB / otel-traces 37MB
    // / transcripts 27MB / tool-results 26MB），与 traces 同构 —— 都是"按日或按次追加、只增不减"。
    const otelTraces = await pruneFilesByAge({
      dir: otelTracesDir,
      cutoffMs: now - policy.otelTraceKeepDays * MS_PER_DAY,
      // 按日命名（<date>.jsonl）；活跃写入的是**当天**文件，由年龄判据保护
      match: (n) => n.endsWith('.jsonl'),
    });
    const logs = await pruneFilesByAge({
      dir: logsDir,
      cutoffMs: now - policy.logKeepDays * MS_PER_DAY,
      // 只删**轮转件** `app.log.<时间戳>`：活跃的 `app.log` 无该前缀（不匹配），
      // 其它 logger 的 `*.log` 同样不匹配 ⇒ 活跃文件与异构日志一律不碰
      match: (n) => n.startsWith('app.log.'),
    });
    const transcripts = await pruneFilesByAge({
      dir: transcriptsDir,
      cutoffMs: now - policy.transcriptKeepDays * MS_PER_DAY,
      match: (n) => n.endsWith('.jsonl'),
    });
    const toolResults = await pruneFilesByAge({
      dir: toolResultsDir,
      cutoffMs: now - policy.toolResultKeepDays * MS_PER_DAY,
      match: (n) => n.endsWith('.txt'),
    });
    const eventLoopBlocks = await pruneDirsByAgeAndCount({
      dir: eventLoopBlocksDir,
      cutoffMs: now - policy.eventLoopBlockKeepDays * MS_PER_DAY,
      maxCount: policy.eventLoopBlockMaxCount,
    });

    const report: ArtifactRetentionReport = {
      traces,
      checkpoints,
      snapshots,
      otelTraces,
      logs,
      transcripts,
      toolResults,
      eventLoopBlocks,
      elapsedMs: Date.now() - started,
    };

    const deletedTotal =
      traces.deleted +
      checkpoints.deleted +
      snapshots.deleted +
      otelTraces.deleted +
      logs.deleted +
      transcripts.deleted +
      toolResults.deleted +
      eventLoopBlocks.deleted;
    // 无删除时保持静默（每 5 分钟一条噪音日志没有价值）；有删除则记录可核对的口径
    if (deletedTotal > 0) {
      const withMb = (s: RetentionStats): RetentionStats & { mb: number } => ({
        ...s,
        mb: +(s.bytesFreed / 1048576).toFixed(1),
      });
      logger.info('制品保留：已清理过期制品', {
        traces: withMb(traces),
        checkpoints: withMb(checkpoints),
        snapshots: withMb(snapshots),
        otelTraces: withMb(otelTraces),
        logs: withMb(logs),
        transcripts: withMb(transcripts),
        toolResults: withMb(toolResults),
        eventLoopBlocks: withMb(eventLoopBlocks),
        policy,
        elapsedMs: report.elapsedMs,
      });
    }
    return report;
  } finally {
    exitPhase('retention:run');
  }
}
