// MIT License
// Copyright (c) 2026 Liri
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
 * MigrationRegistry —— 迁移**注册表 + 统一执行入口**（P2-9 / spec `.trae/specs/migration-registry.md`）
 *
 * 解决（可证）：本仓曾有 6 套互不知情的版本/迁移机制（配置级 `/migrate`、`StateMigrator`、
 * 记忆 schema、知识 frontmatter、上下文版本门、各 sqlite store 自管 `schema_version`），
 * 且**无"已应用"记录** ⇒ 无法回答"本安装处于哪个版本、哪些迁移跑过"。
 *
 * 本模块只做三件事：**登记**（各子系统注册自己的跨版本迁移）、**编排执行**（幂等由中枢判定）、
 * **可恢复**（执行前快照 + 失败恢复；不做逆向迁移 —— `§1.1` 禁删改库结构）。
 *
 * 分层（R06-008）：本模块**不 import 任何业务模块** ⇒ 业务迁移的 `apply` 由调用方注册。
 * 快照落 `~/.pyapp/data/migration-backups/<runId>/<id>/`（含 `manifest.json`，见 `restoreSnapshot`）。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, join } from 'path';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { resolveDataSubDir } from '../paths';
import {
  getAppMigrationStore,
  type AppMigrationRow,
} from './AppMigrationStore';

const logger = getLogger('core:migration:registry');

/** 快照根目录名（第二层数据目录下） */
export const MIGRATION_BACKUPS_DIRNAME = 'migration-backups';
/** 快照保留天数（成功后按此清理） */
export const MIGRATION_SNAPSHOT_RETENTION_DAYS = 7;

export interface MigrationEntry {
  /** 全局唯一 id（约定 `<module>.<from>->.<to>`，如 `agent_runs.2->3`） */
  id: string;
  module: string;
  fromVersion?: string;
  toVersion: string;
  description: string;
  /** 是否执行前快照（默认 `false`；DDL / 大批量改写建议 `true`） */
  requiresSnapshot?: boolean;
  /** 受快照/恢复影响的资源路径（`requiresSnapshot` 时必填） */
  snapshotTargets?: string[];
  /** 执行体（幂等由中枢保证；实现应"一次成功即安全重入"） */
  apply: (ctx: MigrationContext) => Promise<{ warnings?: string[] }>;
}

export interface MigrationContext {
  /** 本次运行的快照目录（`requiresSnapshot` 时非空） */
  snapshotDir?: string;
  /** 预演模式：**不得**产生副作用（`runAll({dryRun})` 不会调用 `apply`，此处恒 false） */
  dryRun: boolean;
  logger: typeof logger;
}

export type MigrationStepStatus =
  | 'applied'
  | 'failed'
  | 'reverted'
  | 'skipped'
  | 'planned';

export interface MigrationStepReport {
  id: string;
  module: string;
  description: string;
  status: MigrationStepStatus;
  costMs: number;
  warnings: string[];
  error?: string;
}

export interface MigrationRunReport {
  dryRun: boolean;
  startedAt: number;
  costMs: number;
  steps: MigrationStepReport[];
  appliedCount: number;
  failedCount: number;
  skippedCount: number;
  plannedCount: number;
  revertedCount: number;
}

export interface MigrationStatusEntry {
  module: string;
  /** 该 module 已应用的最高 `toVersion`（无 ⇒ null） */
  appliedMax: string | null;
  /** 待执行（未 `applied`）的迁移 id */
  pending: string[];
}

const registry = new Map<string, MigrationEntry>();
const registrationOrder: string[] = [];

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 注册一条迁移（**重复 id 或字段缺失 ⇒ 抛 `AppError`**，fail-closed） */
export function registerMigration(entry: MigrationEntry): void {
  if (!entry.id || !entry.module || !entry.toVersion) {
    throw new AppError(
      `迁移条目缺少必填字段（id / module / toVersion）：${JSON.stringify({
        id: entry.id,
        module: entry.module,
        toVersion: entry.toVersion,
      })}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  if (registry.has(entry.id)) {
    throw new AppError(
      `迁移 id 重复注册：${entry.id}（id 必须全局唯一）`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }
  registry.set(entry.id, entry);
  registrationOrder.push(entry.id);
}

/** 已注册迁移（**顺序稳定** = 注册顺序） */
export function listRegistered(): MigrationEntry[] {
  return registrationOrder.map((id) => registry.get(id) as MigrationEntry);
}

/** 清空注册表（**仅测试用**） */
export function resetMigrationRegistry(): void {
  registry.clear();
  registrationOrder.length = 0;
}

/** 版本比较（按 `.` 分段：数字段按数值，其余按字符串） */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i];
    const vb = pb[i];
    if (va === undefined) return vb === undefined ? 0 : -1;
    if (vb === undefined) return 1;
    const na = Number(va);
    const nb = Number(vb);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na - nb;
    } else if (va !== vb) {
      return va < vb ? -1 : 1;
    }
  }
  return 0;
}

/** 排序：按 `module` 首次出现顺序分组，组内保持注册顺序（稳定的可预期顺序） */
function orderEntries(entries: MigrationEntry[]): MigrationEntry[] {
  const moduleOrder: string[] = [];
  for (const e of entries) {
    if (!moduleOrder.includes(e.module)) moduleOrder.push(e.module);
  }
  return moduleOrder.flatMap((m) => entries.filter((e) => e.module === m));
}

/** 打快照（返回快照目录；写入 `manifest.json` 记录 target 顺序与"迁移前是否存在"） */
function takeSnapshot(
  runId: string,
  entryId: string,
  targets: string[]
): string {
  const dir = join(
    resolveDataSubDir(MIGRATION_BACKUPS_DIRNAME),
    runId,
    entryId.replace(/[^a-zA-Z0-9_.-]/g, '_')
  );
  mkdirSync(dir, { recursive: true });
  const manifest: Array<{
    index: number;
    target: string;
    existedBefore: boolean;
  }> = [];
  targets.forEach((target, index) => {
    const existedBefore = existsSync(target);
    manifest.push({ index, target, existedBefore });
    if (existedBefore) {
      cpSync(target, join(dir, `t${index}_${basename(target)}`), {
        recursive: true,
      });
    }
  });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ targets: manifest }, null, 2),
    'utf-8'
  );
  return dir;
}

/**
 * 恢复快照（**回到执行前状态**，不是"迁移的逆运算"）。
 *
 * - `existedBefore: true` ⇒ 先删当前内容再从快照拷回；
 * - `existedBefore: false`（迁移前不存在）⇒ **不删除**当前内容，只记 warning
 *   （若迁移新建了它，需人工确认 —— 不静默删用户的目录）。
 */
function restoreSnapshot(
  snapshotDir: string,
  warnings: string[]
): { restored: number } {
  const manifestPath = join(snapshotDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`快照缺少 manifest.json：${snapshotDir}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    targets: Array<{ index: number; target: string; existedBefore: boolean }>;
  };
  let restored = 0;
  for (const t of manifest.targets) {
    const backup = join(snapshotDir, `t${t.index}_${basename(t.target)}`);
    if (!t.existedBefore) {
      warnings.push(
        `目标在迁移前不存在，快照无内容可回（如迁移新建了它，请人工确认）：${t.target}`
      );
      continue;
    }
    if (!existsSync(backup)) {
      warnings.push(`快照内容缺失，跳过恢复：${t.target}`);
      continue;
    }
    rmSync(t.target, { recursive: true, force: true });
    cpSync(backup, t.target, { recursive: true });
    restored++;
  }
  return { restored };
}

/** 清理超期快照（幂等；删除失败仅 WARN） */
export function cleanupMigrationSnapshots(now = Date.now()): number {
  const root = resolveDataSubDir(MIGRATION_BACKUPS_DIRNAME);
  if (!existsSync(root)) return 0;
  const cutoff = now - MIGRATION_SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const runId of readdirSync(root)) {
    const runDir = join(root, runId);
    try {
      if (statSync(runDir).mtimeMs >= cutoff) continue;
      rmSync(runDir, { recursive: true, force: true });
      removed++;
    } catch (err) {
      logger.warn('清理迁移快照失败（不阻断）', {
        runDir,
        error: errText(err),
      });
    }
  }
  if (removed > 0) {
    logger.info('迁移快照已裁剪（超保留期）', { removed });
  }
  return removed;
}

/**
 * 执行全部**待执行**迁移。
 *
 * - **幂等**：中枢 `status='applied'` 的条目直接 `skipped`（不重复执行）；
 * - **顺序**：`module` 分组（首次出现顺序）+ 组内注册顺序；
 * - **失败语义**：默认 **fail-fast**（迁移改数据，半途继续会放大不一致）；失败时若已打快照则**自动恢复**；
 * - `dryRun` ⇒ **零副作用**（不调 `apply`、不写中枢、不打快照）。
 */
export async function runAll(opts?: {
  dryRun?: boolean;
  only?: string[];
}): Promise<MigrationRunReport> {
  const dryRun = opts?.dryRun === true;
  const startedAt = Date.now();
  const steps: MigrationStepReport[] = [];
  const store = getAppMigrationStore();

  const entries = orderEntries(
    listRegistered().filter((e) => !opts?.only || opts.only.includes(e.id))
  );
  const existing = new Map<string, AppMigrationRow>(
    (await store.listAll()).map((r) => [r.id, r])
  );
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  for (const entry of entries) {
    const row = existing.get(entry.id);
    if (row?.status === 'applied') {
      steps.push({
        id: entry.id,
        module: entry.module,
        description: entry.description,
        status: 'skipped',
        costMs: 0,
        warnings: [],
      });
      continue;
    }
    if (dryRun) {
      steps.push({
        id: entry.id,
        module: entry.module,
        description: entry.description,
        status: 'planned',
        costMs: 0,
        warnings: [],
      });
      continue;
    }

    const t0 = Date.now();
    let snapshotDir: string | undefined;
    try {
      if (entry.requiresSnapshot && entry.snapshotTargets?.length) {
        snapshotDir = takeSnapshot(runId, entry.id, entry.snapshotTargets);
      }
      const result = await entry.apply({
        snapshotDir,
        dryRun: false,
        logger,
      });
      await store.upsert({
        id: entry.id,
        module: entry.module,
        fromVersion: entry.fromVersion,
        toVersion: entry.toVersion,
        status: 'applied',
        appliedAt: Date.now(),
        snapshotPath: snapshotDir,
      });
      steps.push({
        id: entry.id,
        module: entry.module,
        description: entry.description,
        status: 'applied',
        costMs: Date.now() - t0,
        warnings: result.warnings ?? [],
      });
    } catch (err) {
      const error = errText(err);
      const warnings: string[] = [];
      let reverted = false;
      if (snapshotDir) {
        try {
          restoreSnapshot(snapshotDir, warnings);
          reverted = true;
        } catch (recoverErr) {
          warnings.push(`自动恢复快照失败：${errText(recoverErr)}`);
          logger.warn('迁移失败后自动恢复快照失败', {
            id: entry.id,
            error: errText(recoverErr),
          });
        }
      }
      await store.upsert({
        id: entry.id,
        module: entry.module,
        fromVersion: entry.fromVersion,
        toVersion: entry.toVersion,
        status: reverted ? 'reverted' : 'failed',
        lastError: error,
        snapshotPath: snapshotDir,
      });
      steps.push({
        id: entry.id,
        module: entry.module,
        description: entry.description,
        status: reverted ? 'reverted' : 'failed',
        costMs: Date.now() - t0,
        warnings,
        error,
      });
      break; // fail-fast
    }
  }

  const report: MigrationRunReport = {
    dryRun,
    startedAt,
    costMs: Date.now() - startedAt,
    steps,
    appliedCount: steps.filter((s) => s.status === 'applied').length,
    failedCount: steps.filter((s) => s.status === 'failed').length,
    skippedCount: steps.filter((s) => s.status === 'skipped').length,
    plannedCount: steps.filter((s) => s.status === 'planned').length,
    revertedCount: steps.filter((s) => s.status === 'reverted').length,
  };

  if (!dryRun) {
    cleanupMigrationSnapshots();
    if (report.failedCount > 0) {
      logger.warn('迁移执行存在失败项', {
        failed: report.failedCount,
        steps: steps.filter((s) => s.status === 'failed').map((s) => s.id),
      });
    } else if (report.appliedCount > 0) {
      logger.info('迁移执行完成', {
        applied: report.appliedCount,
        skipped: report.skippedCount,
        costMs: report.costMs,
      });
    }
  }
  return report;
}

/**
 * 恢复（对标 codex `state_db_recovery` 的**最小可行形态**）：对 `failed` 条目恢复快照并置 `reverted`。
 *
 * **诚实边界**：无快照（未声明 `requiresSnapshot` 或快照已过期清理）⇒ **如实报"无可恢复快照"**，
 * 不假装成功。若未指定 `id` ⇒ 处理全部 `failed` 条目。
 */
export async function recover(opts?: {
  id?: string;
}): Promise<MigrationRunReport> {
  const startedAt = Date.now();
  const store = getAppMigrationStore();
  const rows = await store.listAll();
  const targets = opts?.id
    ? rows.filter((r) => r.id === opts.id)
    : rows.filter((r) => r.status === 'failed');
  const steps: MigrationStepReport[] = [];

  for (const row of targets) {
    const entry = registry.get(row.id);
    const t0 = Date.now();
    if (!row.snapshotPath || !existsSync(row.snapshotPath)) {
      steps.push({
        id: row.id,
        module: row.module,
        description: entry?.description ?? '(未注册)',
        status: 'failed',
        costMs: Date.now() - t0,
        warnings: [],
        error:
          '无可恢复快照（该迁移未声明 requiresSnapshot，或快照已超保留期被清理）',
      });
      continue;
    }
    const warnings: string[] = [];
    try {
      restoreSnapshot(row.snapshotPath, warnings);
      await store.upsert({
        id: row.id,
        module: row.module,
        fromVersion: row.fromVersion,
        toVersion: row.toVersion,
        status: 'reverted',
        lastError: row.lastError,
        snapshotPath: row.snapshotPath,
      });
      steps.push({
        id: row.id,
        module: row.module,
        description: entry?.description ?? '(未注册)',
        status: 'reverted',
        costMs: Date.now() - t0,
        warnings,
      });
    } catch (err) {
      steps.push({
        id: row.id,
        module: row.module,
        description: entry?.description ?? '(未注册)',
        status: 'failed',
        costMs: Date.now() - t0,
        warnings,
        error: errText(err),
      });
    }
  }

  const report: MigrationRunReport = {
    dryRun: false,
    startedAt,
    costMs: Date.now() - startedAt,
    steps,
    appliedCount: 0,
    failedCount: steps.filter((s) => s.status === 'failed').length,
    skippedCount: 0,
    plannedCount: 0,
    revertedCount: steps.filter((s) => s.status === 'reverted').length,
  };
  logger.info('迁移恢复执行完成', {
    targets: targets.length,
    reverted: report.revertedCount,
    failed: report.failedCount,
  });
  return report;
}

/** 当前版本视图：各 module 的"已应用最高版本 + 待执行清单"（回答"本安装处于哪个版本"） */
export async function getMigrationStatus(): Promise<MigrationStatusEntry[]> {
  const rows = await getAppMigrationStore().listAll();
  const byModule = new Map<string, MigrationStatusEntry>();

  for (const entry of listRegistered()) {
    const cur: MigrationStatusEntry =
      byModule.get(entry.module) ??
      ({
        module: entry.module,
        appliedMax: null,
        pending: [],
      } as MigrationStatusEntry);
    const row = rows.find((r) => r.id === entry.id);
    if (row?.status === 'applied') {
      if (
        !cur.appliedMax ||
        compareVersions(row.toVersion, cur.appliedMax) > 0
      ) {
        cur.appliedMax = row.toVersion;
      }
    } else {
      cur.pending.push(entry.id);
    }
    byModule.set(entry.module, cur);
  }

  return [...byModule.values()];
}
