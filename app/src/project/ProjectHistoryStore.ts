/**
 * ProjectHistoryStore — 项目讨论记录追加式落盘
 *
 * 存储格式：~/.pyapp/data/history/<projectId>/YYYY-MM-DD.jsonl
 * 每行一条 HistoryEntry JSON，追加写入（append-only）。
 *
 * 两级展示：
 *   L1: 按 sessionId + 日期折叠 → 摘要（消息数、关键话题）
 *   L2: 展开后显示逐条记录（消息/决策/工具调用/PDCA阶段）
 *
 * 写入者：ChatManager._finalizeStreamMessage、ImplicitEngineHook.persist
 */

import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  readdirSync,
} from 'fs';
import { resolveDataSubDir } from '@modules/core';
import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'project:HistoryStore',
  level: LogLevel.INFO,
});

const HISTORY_ROOT = join(resolveDataSubDir('history'));

export type HistoryEntryType =
  | 'message'
  | 'decision'
  | 'tool_call'
  | 'pdca_phase'
  | 'context_change';

export interface HistoryEntry {
  /** 时间戳 */
  ts: string;
  /** 所属会话 */
  sessionId: string;
  /** 条目类型 */
  type: HistoryEntryType;
  /** 一级摘要（折叠时显示） */
  summary: string;
  /** 二级详情（展开时显示，可选） */
  detail?: string;
  /** 消息 ID（关联回聊天消息） */
  messageId?: string;
  /** PDCA 阶段（仅 pdca_phase 类型） */
  pdcaPhase?: string;
  /** 是否内部轨迹（PDCA 引擎内部步骤，默认隐藏） */
  internal?: boolean;
}

export class ProjectHistoryStore {
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  private get todayFile(): string {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return join(HISTORY_ROOT, this.projectId, `${date}.jsonl`);
  }

  private ensureDir(): void {
    const dir = join(HISTORY_ROOT, this.projectId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** 追加一条历史记录 */
  append(entry: Omit<HistoryEntry, 'ts'>): void {
    const otel = getOTelTracing();
    const span = otel.startSpan('ProjectHistoryStore.append');
    try {
      this.ensureDir();
      const record: HistoryEntry = { ...entry, ts: new Date().toISOString() };
      appendFileSync(this.todayFile, JSON.stringify(record) + '\n', 'utf-8');
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
      void handleError(e, { module: 'project:HistoryStore', action: 'append' });
    } finally {
      span.end();
    }
  }

  /** 读取指定日期范围内的历史记录 */
  read(since?: string): HistoryEntry[] {
    const dir = join(HISTORY_ROOT, this.projectId);
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort(); // 按日期排序

    const entries: HistoryEntry[] = [];
    for (const file of files) {
      // 日期过滤
      if (since) {
        const fileDate = file.replace('.jsonl', '');
        if (fileDate < since.slice(0, 10)) continue;
      }

      try {
        const content = readFileSync(join(dir, file), 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as HistoryEntry;
            if (since && entry.ts < since) continue;
            entries.push(entry);
          } catch {
            /* skip malformed line */
          }
        }
      } catch {
        /* skip unreadable file */
        logger.warn('读取历史文件失败', { file });
        void handleError(new Error(`读取历史文件失败: ${file}`), { module: 'project:HistoryStore', action: 'read' });
      }
    }

    return entries;
  }

  /**
   * 按 sessionId 分组，生成 L1 摘要
   * 供前端两级展开使用
   */
  getGrouped(since?: string): HistoryGroup[] {
    const entries = this.read(since);
    const groups = new Map<string, HistoryEntry[]>();

    for (const e of entries) {
      const key = `${e.sessionId}`;
      const group = groups.get(key) || [];
      group.push(e);
      groups.set(key, group);
    }

    return Array.from(groups.entries())
      .map(([sessionId, items]) => {
        const dates = [...new Set(items.map((i) => i.ts.slice(0, 10)))]
          .sort()
          .reverse();
        return {
          sessionId,
          dates,
          itemCount: items.length,
          // L1 摘要：取最近3条非内部记录的 summary
          summary: items
            .filter((i) => !i.internal)
            .slice(-3)
            .map((i) => i.summary)
            .join(' | '),
          // L2 详情：全部记录（内部轨迹标记 internal=true，默认隐藏）
          items: items.reverse(),
        };
      })
      .sort((a, b) => b.dates[0]?.localeCompare(a.dates[0] || '') || 0);
  }
}

export interface HistoryGroup {
  sessionId: string;
  dates: string[];
  itemCount: number;
  summary: string;
  items: HistoryEntry[];
}

/** 便捷工厂 */
export function createProjectHistoryStore(
  projectId: string
): ProjectHistoryStore {
  return new ProjectHistoryStore(projectId);
}
