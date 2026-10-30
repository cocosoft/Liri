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
 * M6（2026-10-31）：幽灵 / 空会话清理（一次性运维）。
 *
 * **背景**：`dev_docs/20261030/Liri-项目-会话-渠道一致性核查-20261030.md` M6：
 * 磁盘存在 0 消息、0 事件的空会话（含历史默认会话 `sess_001`）与无 `session.json`
 * 的杂目录（`pid`），UI 侧靠「折叠空会话」隐藏，但磁盘从未清理。
 *
 * **口径（保守）**：
 *  - 只有「**0 消息 + 0 事件 + 无其它产物**」才进候选；`events.tail` / `events.idx` /
 *    `session.json` 不算产物（它们是空会话的正常落盘形态）。
 *  - 目录 `mtime` 在 `--min-idle-hours`（默认 24h）内 ⇒ **跳过**（可能是用户刚建、
 *    尚未发消息的会话；与 `SessionPruner.activeBufferMinutes` 同一思路）。
 *  - 走**软删除**：rename 到 `<partition>/.trash/<sessionId>_<ts>`（与
 *    `FileSystemUnifiedStorage.deleteSession` 完全同款），`.trash` 由既有 TTL（7 天）
 *    物理清理 ⇒ 误删可恢复。
 *
 * **安全**：默认只读预演，`--apply` 才移动；先把 `session.json` 备份到
 * `<root>/migrations/empty-sessions-<ts>/<sessionId>/` 并逐条写 `audit.jsonl`。
 *
 * 运行（建议先停止应用，避免与内存会话索引不一致）：
 *   cd app && bun run prune:empty-sessions                 # 预演
 *   cd app && bun run prune:empty-sessions -- --apply
 *   cd app && bun run prune:empty-sessions -- --apply --min-idle-hours=72
 */

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** 事件 / 消息文件（含 A 分片布局）；`events.tail` / `events.idx` 不计入产物 */
const EVENT_RE = /^events(?:\.\d{4,})?\.jsonl$/;
const MESSAGE_RE = /^messages(?:\.\d{4,})?\.jsonl$/;
/** 空会话的正常落盘文件（不算"有产物"） */
const NON_ARTIFACT_FILES = new Set(['session.json', 'events.tail', 'events.idx']);

/**
 * 非会话目录：`sessions/<分区>/pid` 是**会话锁目录**
 * （`chat/manager/bootstrap.ts` 的 pidDir；`FileSystemUnifiedStorage` 扫描时同样跳过）。
 * 它不是幽灵会话，**绝不能**删除。
 */
const NON_SESSION_DIR_NAMES = new Set(['pid']);

/** 默认保护窗口（小时）：目录在该窗口内被写过 ⇒ 视为"可能是刚建的空会话" */
export const DEFAULT_MIN_IDLE_HOURS = 24;

export type EmptySessionStatus = 'empty' | 'recent' | 'has-data';

export interface EmptySessionItem {
  partition: string;
  sessionId: string;
  dir: string;
  status: EmptySessionStatus;
  hasMeta: boolean;
  title: string;
  sessionStatus: string;
  idleHours: number;
  messageLines: number;
  eventLines: number;
  /** 除 session.json / events.tail / events.idx 之外的其它文件（有则一定是"有内容"） */
  otherFiles: string[];
}

export interface PruneEmptyOptions {
  apply?: boolean;
  minIdleHours?: number;
  now?: number;
}

export interface PruneEmptyResult {
  items: EmptySessionItem[];
  applied: number;
  backupDir?: string;
}

function countLines(files: readonly string[]): number {
  let total = 0;
  for (const file of files) {
    try {
      total += readFileSync(file, 'utf-8')
        .split('\n')
        .filter((line) => line.trim().length > 0).length;
    } catch {
      // @ignore-catch 读不到按 0 计（后续 stat/rename 会暴露真实错误）
    }
  }
  return total;
}

/**
 * 扫描空会话候选。
 *
 * 只看 `<root>/sessions/<partition>/<sessionId>/`（跳过 `.trash` 等点目录），
 * 不做任何写操作。
 */
export function scanEmptySessions(
  root: string,
  options: Pick<PruneEmptyOptions, 'minIdleHours' | 'now'> = {}
): EmptySessionItem[] {
  const sessionsRoot = join(root, 'sessions');
  const minIdleHours = Math.max(
    0,
    options.minIdleHours ?? DEFAULT_MIN_IDLE_HOURS
  );
  const now = options.now ?? Date.now();
  const items: EmptySessionItem[] = [];

  let partitions: string[];
  try {
    partitions = readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name);
  } catch {
    // @ignore-catch 目录不存在 ⇒ 无可扫描会话
    return items;
  }

  for (const partition of partitions) {
    const partitionDir = join(sessionsRoot, partition);
    let dirs: string[];
    try {
      dirs = readdirSync(partitionDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name);
    } catch {
      // @ignore-catch 单个分区不可读 ⇒ 跳过
      continue;
    }
    for (const sessionId of dirs) {
      if (NON_SESSION_DIR_NAMES.has(sessionId)) continue;
      const dir = join(partitionDir, sessionId);
      let files: string[];
      let idleHours: number;
      try {
        files = readdirSync(dir);
        idleHours = +((now - statSync(dir).mtimeMs) / 3_600_000).toFixed(1);
      } catch {
        // @ignore-catch 目录在扫描期间消失 ⇒ 跳过
        continue;
      }
      const eventLines = countLines(
        files.filter((n) => EVENT_RE.test(n)).map((n) => join(dir, n))
      );
      const messageLines = countLines(
        files.filter((n) => MESSAGE_RE.test(n)).map((n) => join(dir, n))
      );
      const otherFiles = files.filter(
        (n) => !EVENT_RE.test(n) && !MESSAGE_RE.test(n) && !NON_ARTIFACT_FILES.has(n)
      );
      const hasData =
        eventLines > 0 || messageLines > 0 || otherFiles.length > 0;

      let hasMeta = false;
      let title = '';
      let sessionStatus = '';
      const metaPath = join(dir, 'session.json');
      if (existsSync(metaPath)) {
        hasMeta = true;
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as {
            title?: unknown;
            status?: unknown;
          };
          title = typeof meta.title === 'string' ? meta.title : '';
          sessionStatus =
            typeof meta.status === 'string' ? meta.status : '';
        } catch {
          // @ignore-catch 元数据损坏不影响"是否空会话"判定（按无标题处理）
        }
      }

      items.push({
        partition,
        sessionId,
        dir,
        status: hasData
          ? 'has-data'
          : idleHours < minIdleHours
            ? 'recent'
            : 'empty',
        hasMeta,
        title,
        sessionStatus,
        idleHours,
        messageLines,
        eventLines,
        otherFiles,
      });
    }
  }
  return items;
}

/**
 * 清理空会话（`apply=false` 只预演）。
 *
 * 软删除目标与 `FileSystemUnifiedStorage.deleteSession` 完全一致：
 * `<partition>/.trash/<sessionId>_<nowMs>`（避免同名冲突，由既有 TTL 物理清理）。
 */
export function pruneEmptySessions(
  root: string,
  options: PruneEmptyOptions = {}
): PruneEmptyResult {
  const now = options.now ?? Date.now();
  const items = scanEmptySessions(root, { ...options, now });
  if (!options.apply) return { items, applied: 0 };

  const targets = items.filter((i) => i.status === 'empty');
  if (targets.length === 0) return { items, applied: 0 };

  const stamp = new Date(now)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*$/, '');
  const backupDir = join(root, 'migrations', `empty-sessions-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  const auditPath = join(backupDir, 'audit.jsonl');

  let applied = 0;
  for (const item of targets) {
    const sessionBackup = join(backupDir, item.sessionId);
    mkdirSync(sessionBackup, { recursive: true });
    let backupPath: string | undefined;
    const metaPath = join(item.dir, 'session.json');
    if (existsSync(metaPath)) {
      backupPath = join(sessionBackup, 'session.json');
      copyFileSync(metaPath, backupPath);
    }

    const trashDir = join(
      join(root, 'sessions', item.partition),
      '.trash',
      `${item.sessionId}_${now}`
    );
    try {
      mkdirSync(join(root, 'sessions', item.partition, '.trash'), {
        recursive: true,
      });
      renameSync(item.dir, trashDir);
    } catch (err) {
      console.warn(
        `[skip] ${item.sessionId} 软删除失败：${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    appendFileSync(
      auditPath,
      `${JSON.stringify({
        ts: new Date(now).toISOString(),
        partition: item.partition,
        sessionId: item.sessionId,
        hasMeta: item.hasMeta,
        title: item.title,
        sessionStatus: item.sessionStatus,
        idleHours: item.idleHours,
        trash: trashDir,
        backup: backupPath,
      })}\n`,
      'utf-8'
    );
    applied += 1;
  }

  return { items, applied, ...(applied > 0 ? { backupDir } : {}) };
}

/** CLI 入口（`--apply` 才移动；`--root` / `--min-idle-hours` / `--json`） */
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
  const root = arg('--root') ?? join(homedir(), '.pyapp', 'data');
  const rawIdle = arg('--min-idle-hours');
  const parsed = rawIdle === undefined ? Number.NaN : Number.parseInt(rawIdle, 10);
  const minIdleHours = Number.isFinite(parsed)
    ? parsed
    : DEFAULT_MIN_IDLE_HOURS;

  const result = pruneEmptySessions(root, { apply, minIdleHours });

  if (json) {
    console.log(JSON.stringify(result));
    return 0;
  }

  console.log(
    `[prune:empty-sessions] root=${root} ${apply ? 'APPLY' : '预演（只读，加 --apply 才移动）'} minIdleHours=${minIdleHours}`
  );
  for (const item of result.items) {
    if (item.status === 'has-data') continue;
    const flag = item.status === 'empty' ? '候选' : '跳过(近期写入)';
    console.log(
      `  [${flag}] ${item.sessionId} 分区=${item.partition} 龄=${item.idleHours}h ` +
        `标题="${item.title}" 状态=${item.sessionStatus || '-'} 元数据=${item.hasMeta ? 'ok' : '缺失'}`
    );
  }
  const empty = result.items.filter((i) => i.status === 'empty').length;
  const recent = result.items.filter((i) => i.status === 'recent').length;
  const hasData = result.items.filter((i) => i.status === 'has-data').length;
  console.log(
    `  有内容：${hasData} / 空会话候选：${empty} / 近期跳过：${recent}`
  );
  if (apply) {
    console.log(
      `  已软删除 ${result.applied} 个（移入各分区 .trash，7 天后由既有 TTL 物理清理）；备份 + 审计：${result.backupDir ?? '-'}`
    );
  }
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
