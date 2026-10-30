/**
 * M1 前置（2026-10-30，一致性核查 §4-M1）：**只读**的"会话 → 项目"归属回填预演。
 *
 * 背景：项目页按 `metadata.workspacePath` 统计、会话页按 `metadata.projectId` 分组 ⇒ 同一会话
 * 既出现在某项目下、又出现在「未分组」（真机 32 会话中 22 个无 `projectId`）。
 *
 * 本脚本**只读**：把"按 workspacePath 反查唯一项目"的结论打印出来（谁会被补成哪个 projectId、
 * 谁无法判定、谁指向了不存在的项目），供用户确认后再决定是否执行写入迁移。
 *
 * 用法：
 *   bun run scripts/preview-session-project-backfill.ts                # 默认 ~/.pyapp/data
 *   bun run scripts/preview-session-project-backfill.ts --root <dir>   # 指定数据目录
 *   bun run scripts/preview-session-project-backfill.ts --json         # 机器可读
 *
 * 不写入任何文件、不改 DB、不启动服务。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** 会话侧用于归属判定的最小投影 */
export interface SessionOwnershipRecord {
  sessionId: string;
  title?: string;
  projectId?: string;
  workspacePath?: string;
}

/** 项目侧用于归属判定的最小投影 */
export interface ProjectOwnershipRecord {
  projectId: string;
  name?: string;
  sandboxPath?: string;
}

export type BindingVerdict =
  | { kind: 'proposed'; projectId: string }
  | { kind: 'already'; projectId: string }
  | { kind: 'no-workspace' }
  | { kind: 'unmatched'; workspacePath: string }
  | { kind: 'ambiguous'; workspacePath: string; candidates: string[] };

export interface BindingRow {
  sessionId: string;
  title?: string;
  verdict: BindingVerdict;
}

/** 路径归一：统一分隔符、去尾分隔符、Windows 下转小写（与 `normalizeApprovalPath` 同口径思路） */
export function normalizePathKey(raw: string | undefined): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!trimmed) return '';
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/**
 * 计算每个会话的归属结论（**纯函数**，便于单测）。
 *
 * 规则（保守，宁可不补也不猜）：
 * 1. 已有 `projectId` ⇒ 若该项目存在 ⇒ `already`；不存在 ⇒ `unmatched`（悬挂引用，需人工看）；
 * 2. 无 `workspacePath` ⇒ `no-workspace`（无从判定）；
 * 3. `workspacePath` 与唯一项目 `sandboxPath` 归一后相等 ⇒ `proposed`；
 * 4. 命中多个项目 ⇒ `ambiguous`（列出候选，不自动选）；
 * 5. 命中零个项目 ⇒ `unmatched`。
 */
export function proposeSessionBindings(
  sessions: readonly SessionOwnershipRecord[],
  projects: readonly ProjectOwnershipRecord[]
): BindingRow[] {
  const byPath = new Map<string, string[]>();
  const known = new Set<string>();
  for (const p of projects) {
    known.add(p.projectId);
    const key = normalizePathKey(p.sandboxPath);
    if (!key) continue;
    const list = byPath.get(key) ?? [];
    list.push(p.projectId);
    byPath.set(key, list);
  }

  return sessions.map((s) => {
    if (s.projectId) {
      return {
        sessionId: s.sessionId,
        title: s.title,
        verdict: known.has(s.projectId)
          ? { kind: 'already', projectId: s.projectId }
          : { kind: 'unmatched', workspacePath: s.workspacePath ?? '' },
      };
    }
    const key = normalizePathKey(s.workspacePath);
    if (!key) {
      return {
        sessionId: s.sessionId,
        title: s.title,
        verdict: { kind: 'no-workspace' },
      };
    }
    const candidates = byPath.get(key) ?? [];
    if (candidates.length === 0) {
      return {
        sessionId: s.sessionId,
        title: s.title,
        verdict: { kind: 'unmatched', workspacePath: s.workspacePath ?? '' },
      };
    }
    if (candidates.length > 1) {
      return {
        sessionId: s.sessionId,
        title: s.title,
        verdict: {
          kind: 'ambiguous',
          workspacePath: s.workspacePath ?? '',
          candidates,
        },
      };
    }
    return {
      sessionId: s.sessionId,
      title: s.title,
      verdict: { kind: 'proposed', projectId: candidates[0] },
    };
  });
}

interface SessionJson {
  id?: string;
  title?: string;
  metadata?: { projectId?: string; workspacePath?: string };
}

interface ProjectJson {
  id?: string;
  name?: string;
  sandboxPath?: string;
}

function safeJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** 读取数据目录下的全部会话（`sessions/<partition>/session_<id>/session.json`） */
export function readSessions(dataDir: string): SessionOwnershipRecord[] {
  const sessionsRoot = join(dataDir, 'sessions');
  if (!existsSync(sessionsRoot)) return [];
  const out: SessionOwnershipRecord[] = [];
  for (const partition of safeReaddir(sessionsRoot)) {
    const partitionDir = join(sessionsRoot, partition);
    for (const name of safeReaddir(partitionDir)) {
      if (!name.startsWith('session_')) continue;
      const json = safeJson<SessionJson>(join(partitionDir, name, 'session.json'));
      if (!json) continue;
      out.push({
        sessionId: json.id ?? name,
        title: json.title,
        projectId: json.metadata?.projectId,
        workspacePath: json.metadata?.workspacePath,
      });
    }
  }
  return out;
}

/** 读取数据目录下的全部项目（`projects/<proj_*>/project.json`） */
export function readProjects(dataDir: string): ProjectOwnershipRecord[] {
  const projectsRoot = join(dataDir, 'projects');
  if (!existsSync(projectsRoot)) return [];
  const out: ProjectOwnershipRecord[] = [];
  for (const name of safeReaddir(projectsRoot)) {
    const json = safeJson<ProjectJson>(join(projectsRoot, name, 'project.json'));
    if (!json) continue;
    out.push({
      projectId: json.id ?? name,
      name: json.name,
      sandboxPath: json.sandboxPath,
    });
  }
  return out;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 汇总计数（供人读输出与文档引用） */
export function summarizeBindings(rows: readonly BindingRow[]): Record<string, number> {
  const summary: Record<string, number> = {
    total: rows.length,
    already: 0,
    proposed: 0,
    'no-workspace': 0,
    unmatched: 0,
    ambiguous: 0,
  };
  for (const row of rows) summary[row.verdict.kind] += 1;
  return summary;
}

function defaultRoot(): string {
  const fromEnv = process.env.LIRI_HOME?.trim();
  return join(fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), '.pyapp'), 'data');
}

function main(): void {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const dataDir = resolve(rootIdx >= 0 ? argv[rootIdx + 1] ?? '' : defaultRoot());
  const asJson = argv.includes('--json');

  if (!existsSync(dataDir)) {
    console.error(`数据目录不存在：${dataDir}（用 --root 指定）`);
    process.exitCode = 1;
    return;
  }

  const sessions = readSessions(dataDir);
  const projects = readProjects(dataDir);
  const rows = proposeSessionBindings(sessions, projects);
  const summary = summarizeBindings(rows);

  if (asJson) {
    console.log(JSON.stringify({ dataDir, projects: projects.length, summary, rows }, null, 2));
    return;
  }

  console.log(`[只读预演] dataDir=${dataDir}`);
  console.log(`项目 ${projects.length} 个 · 会话 ${sessions.length} 个`);
  console.log(`结论：${JSON.stringify(summary)}`);
  const actionable = rows.filter(
    (r) => r.verdict.kind === 'proposed' || r.verdict.kind === 'ambiguous'
  );
  if (actionable.length === 0) {
    console.log('✓ 没有可自动回填的会话（其余属已有归属 / 无 workspacePath / 找不到匹配项目）');
  } else {
    console.log('\n可回填（workspacePath ⇒ 唯一项目）：');
    for (const row of actionable) {
      if (row.verdict.kind === 'proposed') {
        console.log(`  ${row.sessionId} → ${row.verdict.projectId}  ${row.title ?? ''}`);
      } else if (row.verdict.kind === 'ambiguous') {
        console.log(
          `  ⚠ ${row.sessionId} 命中多个项目：${row.verdict.candidates.join(', ')}（不自动选）`
        );
      }
    }
  }
  const unmatched = rows.filter((r) => r.verdict.kind === 'unmatched');
  if (unmatched.length > 0) {
    console.log('\n无法判定（workspacePath 无对应项目，或 projectId 指向不存在的项目）：');
    for (const row of unmatched) console.log(`  ${row.sessionId}  ${row.title ?? ''}`);
  }
  console.log('\n本脚本只读，未写入任何文件。');
}

if (import.meta.main) {
  main();
  // lint:exit（N-16/N-49）：入口脚本必须显式退出，避免长驻句柄让命令"卡住不返回"。
  // 错误分支已设 `process.exitCode = 1`，此处以 0 退出会覆盖它 —— 故按 exitCode 决定。
  process.exit(process.exitCode ?? 0);
}
