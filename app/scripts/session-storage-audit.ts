// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * session-storage-audit.ts — #24（2026-10-30）
 *
 * 会话存储面盘点 + 孤儿成本痕迹清理。
 *
 * 背景（真机实测）：同一份会话至少 3 处副本 + 1 处废弃目录，且成本表远多于会话：
 * - `data/sessions/<ws>/<sessionId>/`  ← **唯一真源**（session.json + messages.jsonl + events.jsonl）
 * - `data/history/<proj>/<date>.jsonl` ← 派生视图
 * - `data/transcripts/*.jsonl`         ← 派生视图
 * - `data/chat_sessions/`              ← 废弃（`chatService` 无生产消费者）
 * - DB `session_cost_summaries`        ← 404 行 ≫ 32 个会话（孤儿未清理）
 *
 * 语义：
 * - **默认只读**（dry-run）：只打印盘点结果与待清理清单；
 * - `--apply`：清理"会话已不存在"的成本痕迹（摘要 + 明细），走
 *   `CostRecordRepository.pruneOrphanSessions`（与删除路径同一语义）；
 * - `--drop-empty-chat-sessions`：`data/chat_sessions/` **为空**时才删除该目录（非空一律不动）；
 * - 任何真源会话目录/文件都不删除（本脚本只读它们）。
 *
 * 用法：
 *   bun run scripts/session-storage-audit.ts
 *   bun run scripts/session-storage-audit.ts --apply
 */

import { existsSync, readdirSync, statSync, rmdirSync } from 'fs';
import { join } from 'path';
import { resolveDataDir, resolveDbPath } from '@modules/environment';
import { CostRecordRepository } from '../src/cost/CostRecordRepository.js';

/** 单文件告警阈值（issue #24 的验收口径） */
export const OVERSIZE_BYTES = 5 * 1024 * 1024;

export interface SessionFilePair {
  sessionId: string;
  messagesBytes: number;
  eventsBytes: number;
}

export interface StorageAudit {
  dataRoot: string;
  /** 磁盘真源会话 id（`sessions/<partition>/<sessionId>/session.json` 存在者） */
  sessionIds: string[];
  /** `history/` 下的项目目录数（派生视图） */
  historyDirs: number;
  /** `transcripts/*.jsonl` 个数（派生视图） */
  transcriptFiles: number;
  /** `chat_sessions/` 是否存在 / 是否为空（废弃目录） */
  deadChatSessionsDir: { exists: boolean; empty: boolean } | null;
  /** 超过阈值的会话文件（真源膨胀证据） */
  oversize: SessionFilePair[];
}

function safeReaddir(dir: string): Array<{ name: string; isDir: boolean }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).map((e) => ({
    name: e.name,
    isDir: e.isDirectory(),
  }));
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * 枚举磁盘真源会话（`<root>/<partition>/<sessionId>/session.json`）。
 *
 * 只认 `session.json` 存在者 —— 与后端"磁盘目录即真源"的口径一致（`.trash` 等已软删目录
 * 不在 `<sessionId>` 层级上，天然不会被计入）。
 */
export function listSessionIdsOnDisk(sessionsRoot: string): string[] {
  const ids: string[] = [];
  for (const partition of safeReaddir(sessionsRoot)) {
    if (!partition.isDir) continue;
    for (const session of safeReaddir(join(sessionsRoot, partition.name))) {
      if (!session.isDir) continue;
      const dir = join(sessionsRoot, partition.name, session.name);
      if (existsSync(join(dir, 'session.json'))) ids.push(session.name);
    }
  }
  return ids.sort();
}

/** 盘点各存储面（**只读**） */
export function auditStorage(dataRoot: string): StorageAudit {
  const sessionsRoot = join(dataRoot, 'sessions');
  const sessionIds = listSessionIdsOnDisk(sessionsRoot);

  const oversize: SessionFilePair[] = [];
  for (const partition of safeReaddir(sessionsRoot)) {
    if (!partition.isDir) continue;
    for (const session of safeReaddir(join(sessionsRoot, partition.name))) {
      if (!session.isDir) continue;
      const dir = join(sessionsRoot, partition.name, session.name);
      const messagesBytes = fileSize(join(dir, 'messages.jsonl'));
      const eventsBytes = fileSize(join(dir, 'events.jsonl'));
      if (messagesBytes > OVERSIZE_BYTES || eventsBytes > OVERSIZE_BYTES) {
        oversize.push({ sessionId: session.name, messagesBytes, eventsBytes });
      }
    }
  }
  oversize.sort((a, b) => b.messagesBytes - a.messagesBytes);

  const deadDir = join(dataRoot, 'chat_sessions');
  const deadEntries = safeReaddir(deadDir);

  return {
    dataRoot,
    sessionIds,
    historyDirs: safeReaddir(join(dataRoot, 'history')).length,
    transcriptFiles: safeReaddir(join(dataRoot, 'transcripts')).filter(
      (e) => !e.isDir && e.name.endsWith('.jsonl')
    ).length,
    deadChatSessionsDir: existsSync(deadDir)
      ? { exists: true, empty: deadEntries.length === 0 }
      : null,
    oversize,
  };
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 打印盘点结果（CLI 与测试共用同一文案口径） */
export function formatAudit(audit: StorageAudit): string[] {
  const lines: string[] = [
    `数据根：${audit.dataRoot}`,
    `会话真源（sessions/<ws>/<id>/session.json）：${audit.sessionIds.length} 个`,
    `派生视图：history/ ${audit.historyDirs} 个目录 · transcripts/ ${audit.transcriptFiles} 个 .jsonl（可删除后重建）`,
  ];
  if (audit.deadChatSessionsDir) {
    lines.push(
      `废弃目录 chat_sessions/：存在，${audit.deadChatSessionsDir.empty ? '空（可删）' : '非空（不动）'}`
    );
  } else {
    lines.push('废弃目录 chat_sessions/：不存在');
  }
  if (audit.oversize.length === 0) {
    lines.push(`超过 ${mb(OVERSIZE_BYTES)} 的会话文件：0`);
  } else {
    lines.push(`超过 ${mb(OVERSIZE_BYTES)} 的会话文件：${audit.oversize.length} 个`);
    for (const item of audit.oversize) {
      lines.push(
        `  - ${item.sessionId}  messages ${mb(item.messagesBytes)} · events ${mb(item.eventsBytes)}`
      );
    }
  }
  return lines;
}

if (import.meta.main) {
  const apply = process.argv.includes('--apply');
  const dropDeadDir = process.argv.includes('--drop-empty-chat-sessions');
  const dataRoot = resolveDataDir();
  const audit = auditStorage(dataRoot);
  for (const line of formatAudit(audit)) console.log(line);

  // 空 chat_sessions/ 清理（显式开关；非空一律不动）
  if (dropDeadDir) {
    if (audit.deadChatSessionsDir?.empty) {
      rmdirSync(join(dataRoot, 'chat_sessions'));
      console.log('已删除空的废弃目录 chat_sessions/。');
    } else {
      console.log('chat_sessions/ 不存在或非空 ⇒ 未删除。');
    }
  }

  const repo = new CostRecordRepository(resolveDbPath());
  const before = await repo.countSessionSummaries();
  // 先只读地算清单（dry-run 与 --apply 共用同一份判据）
  const plan = await repo.findOrphanSessions(new Set(audit.sessionIds));
  console.log(
    `成本摘要：现存 ${before} 行；磁盘会话 ${audit.sessionIds.length} 个`
  );
  console.log(
    `孤儿成本痕迹：${plan.orphanSessionIds.length} 个会话（含摘要 ${plan.withSummary} / 含明细 ${plan.withRecords}）`
  );

  if (!apply) {
    if (plan.orphanSessionIds.length > 0) {
      console.log(
        `  前 5 个：${plan.orphanSessionIds.slice(0, 5).join(', ')}${plan.orphanSessionIds.length > 5 ? ' …' : ''}`
      );
    }
    console.log('dry-run：清单已打印，**未删除**任何行（加 --apply 落盘）。');
  } else {
    const removed = await repo.pruneOrphanSessions(plan.orphanSessionIds);
    const after = await repo.countSessionSummaries();
    console.log(
      `已清理 ${removed} 个孤儿会话的成本痕迹：session_cost_summaries ${before} → ${after} 行。`
    );
  }
  await repo.close();
}
