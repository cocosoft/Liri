/**
 * P3（2026-10-31）：存量会话作用域对齐（`dev_docs/20261031` §三 P3）。
 *
 * **背景**：`session.json` 的 `metadata` 里，`projectId` / `workspaceId` / `moduleType`
 * 三者**没有任何一致性约束** —— 真机 12 条会话里 8 条没有 `moduleType`、3 条 `projectId`
 * 被写成同一个垃圾项目、1 条写的是 worktree id（`wt-*`），于是"会话里看到项目会话、
 * 项目里看到别人的会话"。
 *
 * **修数据口径（用户 2026-10-31 裁定）**：
 *  - 「属于某项目」以 `metadata.projectId` 为运行时权威；**修数据时以 `workspacePath`
 *    的实际目录为准**（§七 裁定 1 / §7.2）；
 *  - `proj_*` 是后端项目实体，`wt-*` 是前端 workspace 实体 ⇒ **不保留 `wt-*` 归属**（裁定 3）。
 *
 * **四条规则**（只改 `metadata`，不动 `workspacePath` / 消息 / 事件）：
 *  | 规则 | 判据 | 动作 |
 *  |---|---|---|
 *  | D 形态异常 | `projectId` / `workspaceId` 为 `wt-*` | 能从 `workspacePath` 解析出 `proj_*` ⇒ 重写为该项目；解析不出 ⇒ 置空归属并归 `chat` |
 *  | A 归属冲突 | `projectId` ≠ `basename(workspacePath)`，且两者都是 `proj_*` | 按 `workspacePath` 归位（`--prefer=projectId` 可反转） |
 *  | B 归属缺失 | 无 `projectId`，但 `workspacePath` 指向 `proj_*` | 补写该 `projectId` |
 *  | C 模块缺失 | 无 `moduleType` | 有项目归属 ⇒ `project`；否则 ⇒ `chat` |
 *
 * **安全**：默认只读预演；`--apply` 先把每个 `session.json` 原样备份到
 * `migrations/session-scope-<ts>/` 并写 `audit.jsonl`，再逐文件原子替换。
 * `sessions/` 不可读 ⇒ **拒绝执行**（不做"全量重写"这种不可逆判断）。
 *
 * 运行（建议先停止应用）：
 *   cd app && bun run repair:session-scope
 *   cd app && bun run repair:session-scope -- --apply
 */

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { basename, join } from 'path';
import { homedir } from 'os';

/** 后端项目实体 id（`proj_<毫秒>_<随机>`，与 client `isProjectEntityId` 同口径） */
const PROJECT_ENTITY_ID_RE = /^proj_\d+_[a-z0-9]+$/i;
/** 前端 workspace 实体 id（worktree）——**不得**作为会话归属 */
const WORKTREE_ID_RE = /^wt-/i;

export type ScopeRule = 'A' | 'B' | 'C' | 'D';
export type ScopePrefer = 'workspacePath' | 'projectId';

export interface ScopeSnapshot {
  projectId?: string;
  workspaceId?: string;
  moduleType?: string;
}

export interface ScopePlan {
  rules: ScopeRule[];
  before: ScopeSnapshot;
  after: ScopeSnapshot;
  workspacePath?: string;
}

export interface ScopeChange extends ScopePlan {
  sessionId: string;
  partition: string;
  filePath: string;
  backupFile?: string;
}

export interface RepairSessionScopeResult {
  scanned: number;
  skipped: number;
  changes: ScopeChange[];
  applied: number;
  backupDir?: string;
}

export function isProjectEntityId(id: string | undefined): boolean {
  return PROJECT_ENTITY_ID_RE.test((id ?? '').trim());
}

function isWorktreeId(id: string | undefined): boolean {
  return WORKTREE_ID_RE.test((id ?? '').trim());
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** `workspacePath` 的目录名若形如 `proj_*` ⇒ 该项目；否则 `undefined` */
export function projectIdFromWorkspacePath(
  workspacePath: string | undefined
): string | undefined {
  const trimmed = str(workspacePath);
  if (!trimmed) return undefined;
  const name = basename(trimmed.replace(/[\\/]+$/, ''));
  return isProjectEntityId(name) ? name.trim() : undefined;
}

/**
 * 纯函数：算出一条会话 `metadata` 该怎么改（不改任何东西）。
 * 无规则命中 ⇒ `null`（幂等的关键：第二次运行不会产生变更）。
 */
export function planSessionScopeRepair(
  metadata: Record<string, unknown> | undefined,
  opts: { prefer?: ScopePrefer } = {}
): ScopePlan | null {
  const meta = metadata ?? {};
  const before: ScopeSnapshot = {
    projectId: str(meta.projectId),
    workspaceId: str(meta.workspaceId),
    moduleType: str(meta.moduleType),
  };
  let projectId = before.projectId;
  let workspaceId = before.workspaceId;
  let moduleType = before.moduleType;
  const workspacePath = str(meta.workspacePath);
  const pathProjectId = projectIdFromWorkspacePath(workspacePath);
  const rules: ScopeRule[] = [];

  // 规则 D：`wt-*` 形态归属一律重写 / 清空（裁定 3）
  if (isWorktreeId(projectId) || isWorktreeId(workspaceId)) {
    if (pathProjectId) {
      projectId = pathProjectId;
      workspaceId = pathProjectId;
    } else {
      projectId = undefined;
      workspaceId = undefined;
      moduleType = 'chat'; // 无法解析 ⇒ 归 chat（不保留无法解析的 id）
    }
    rules.push('D');
  }

  // 规则 A：归属冲突 ⇒ 以 workspacePath 为准（可 --prefer=projectId 反转）
  if (
    (opts.prefer ?? 'workspacePath') === 'workspacePath' &&
    projectId &&
    pathProjectId &&
    isProjectEntityId(projectId) &&
    projectId !== pathProjectId
  ) {
    projectId = pathProjectId;
    rules.push('A');
  }

  // 规则 B：归属缺失 ⇒ 由 workspacePath 补写
  if (!projectId && pathProjectId) {
    projectId = pathProjectId;
    rules.push('B');
  }

  // 规则 C：模块缺失 ⇒ 有归属即 project，否则 chat
  if (!moduleType) {
    moduleType = projectId ? 'project' : 'chat';
    rules.push('C');
  }

  if (rules.length === 0) return null;
  return {
    rules,
    before,
    after: { projectId, workspaceId, moduleType },
    ...(workspacePath ? { workspacePath } : {}),
  };
}

/** 把 `after` 落到 `metadata` 上（删除即置 `undefined`，不写空串） */
function applyPlan(metadata: Record<string, unknown>, plan: ScopePlan): void {
  for (const key of ['projectId', 'workspaceId', 'moduleType'] as const) {
    const next = plan.after[key];
    if (next === undefined) delete metadata[key];
    else metadata[key] = next;
  }
}

function stampOf(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
}

/**
 * 执行（或预演）存量作用域对齐。
 *
 * 防御：`sessions/` 不可读、或一条会话目录都没扫到 ⇒ **抛错拒绝执行**
 * （避免把"路径写错/磁盘没挂上"当成"确实没有会话"而做出错误判断）。
 */
export function repairSessionScope(params: {
  dataRoot: string;
  apply: boolean;
  prefer?: ScopePrefer;
  now?: Date;
}): RepairSessionScopeResult {
  const sessionsRoot = join(params.dataRoot, 'sessions');
  let partitions: string[];
  try {
    partitions = readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name);
  } catch {
    throw new Error(`sessions 目录不可读，拒绝执行：${sessionsRoot}`);
  }

  const changes: ScopeChange[] = [];
  let scanned = 0;
  let skipped = 0;

  for (const partition of partitions) {
    const partitionDir = join(sessionsRoot, partition);
    let entries;
    try {
      entries = readdirSync(partitionDir, { withFileTypes: true });
    } catch {
      // @ignore-catch 单个分区不可读 ⇒ 跳过（不做判断）
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.trash' || entry.name === 'pid')
        continue;
      const filePath = join(partitionDir, entry.name, 'session.json');
      if (!existsSync(filePath)) continue; // 空目录 / 非会话目录
      scanned++;
      let raw: string;
      let parsed: Record<string, unknown>;
      try {
        raw = readFileSync(filePath, 'utf-8');
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // @ignore-catch 坏文件不猜：计入跳过，绝不重写
        skipped++;
        continue;
      }
      const metadata = (parsed.metadata ?? {}) as Record<string, unknown>;
      const plan = planSessionScopeRepair(metadata, {
        ...(params.prefer ? { prefer: params.prefer } : {}),
      });
      if (!plan) continue;
      changes.push({
        ...plan,
        sessionId: entry.name,
        partition,
        filePath,
      });
    }
  }

  if (scanned === 0) {
    throw new Error(
      `未扫描到任何会话（${sessionsRoot}），拒绝执行作用域修复`
    );
  }

  if (!params.apply || changes.length === 0) {
    return { scanned, skipped, changes, applied: 0 };
  }

  const backupDir = join(
    params.dataRoot,
    'migrations',
    `session-scope-${stampOf(params.now ?? new Date())}`
  );
  mkdirSync(backupDir, { recursive: true });

  let applied = 0;
  for (const change of changes) {
    const backupFile = join(
      backupDir,
      `${change.partition}__${change.sessionId}__session.json`
    );
    copyFileSync(change.filePath, backupFile);
    change.backupFile = backupFile;

    const parsed = JSON.parse(readFileSync(change.filePath, 'utf-8')) as Record<
      string,
      unknown
    >;
    if (!parsed.metadata || typeof parsed.metadata !== 'object') {
      parsed.metadata = {};
    }
    applyPlan(parsed.metadata as Record<string, unknown>, change);

    const tmpPath = `${change.filePath}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
    renameSync(tmpPath, change.filePath);

    appendFileSync(
      join(backupDir, 'audit.jsonl'),
      `${JSON.stringify({
        ts: new Date().toISOString(),
        sessionId: change.sessionId,
        partition: change.partition,
        rules: change.rules,
        before: change.before,
        after: change.after,
        workspacePath: change.workspacePath ?? null,
        backup: backupFile,
      })}\n`,
      'utf-8'
    );
    applied++;
  }

  appendFileSync(
    join(backupDir, 'audit.jsonl'),
    `${JSON.stringify({
      ts: new Date().toISOString(),
      summary: true,
      scanned,
      skipped,
      applied,
    })}\n`,
    'utf-8'
  );

  return { scanned, skipped, changes, applied, backupDir };
}

/** CLI 入口（`--apply` 才写；`--root` / `--prefer` / `--json`） */
function main(): number {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const json = argv.includes('--json');
  const arg = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dataRoot = arg('--root') ?? join(homedir(), '.pyapp', 'data');
  const prefer: ScopePrefer =
    arg('--prefer') === 'projectId' ? 'projectId' : 'workspacePath';

  let result: RepairSessionScopeResult;
  try {
    result = repairSessionScope({ dataRoot, apply, prefer });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (json) {
    console.log(JSON.stringify(result));
    return 0;
  }

  console.log(
    `[repair:session-scope] root=${dataRoot} prefer=${prefer} ${apply ? 'APPLY' : '预演（只读，加 --apply 才写）'}`
  );
  console.log(
    `  扫描 ${result.scanned} 条会话（跳过坏文件 ${result.skipped}）；需变更 ${result.changes.length} 条`
  );
  for (const change of result.changes) {
    console.log(
      `   · ${change.sessionId}  [${change.rules.join('+')}]  ` +
        `projectId ${change.before.projectId ?? '∅'} → ${change.after.projectId ?? '∅'}  ` +
        `moduleType ${change.before.moduleType ?? '∅'} → ${change.after.moduleType ?? '∅'}` +
        `${change.workspacePath ? `  path=${basename(change.workspacePath)}` : ''}`
    );
  }
  if (apply) {
    console.log(
      `  已写入 ${result.applied} 条；备份 + 审计：${result.backupDir ?? '-'}`
    );
  } else if (result.changes.length > 0) {
    console.log('  预演结束（未改动任何数据）');
  }
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
