/**
 * LogStore — 前端日志持久化存储
 *
 * 将前端日志保存到 localStorage，支持查询、过滤和清理。
 * 保留最近 500 条日志，超限自动清理最旧记录。
 *
 * 使用方式：
 *   import { logStore } from "./logStore";
 *   logStore.add("info", "components:chat", "会话切换成功", { sessionId: "xxx" });
 *   const logs = logStore.query({ level: "error" });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

export interface FrontendLogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

const STORAGE_KEY = "pyapp_frontend_logs";
const MAX_LOGS = 500;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getStoredLogs(): FrontendLogEntry[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveLogs(logs: FrontendLogEntry[]): void {
  try {
    // 限制日志数量
    const trimmed = logs.slice(-MAX_LOGS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage 不可用，静默忽略
  }
}

export const logStore = {
  /**
   * 添加日志条目
   */
  add(level: LogLevel, module: string, message: string, data?: unknown): void {
    const logs = getStoredLogs();
    const entry: FrontendLogEntry = {
      id: generateId(),
      timestamp: Date.now(),
      level,
      module,
      message,
      data,
    };
    logs.push(entry);
    saveLogs(logs);
  },

  /**
   * 查询日志
   */
  query(
    options: {
      level?: LogLevel;
      module?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): { logs: FrontendLogEntry[]; total: number } {
    let logs = getStoredLogs();

    // 按级别过滤
    if (options.level) {
      logs = logs.filter((log) => log.level === options.level);
    }

    // 按模块过滤（支持模糊匹配）
    if (options.module) {
      const moduleLower = options.module.toLowerCase();
      logs = logs.filter((log) =>
        log.module.toLowerCase().includes(moduleLower),
      );
    }

    // 按搜索词过滤（匹配消息和模块）
    if (options.search) {
      const searchLower = options.search.toLowerCase();
      logs = logs.filter(
        (log) =>
          log.message.toLowerCase().includes(searchLower) ||
          log.module.toLowerCase().includes(searchLower),
      );
    }

    // 按时间倒序排序
    logs.sort((a, b) => b.timestamp - a.timestamp);

    const total = logs.length;
    const offset = options.offset || 0;
    const limit = options.limit || 50;

    return {
      logs: logs.slice(offset, offset + limit),
      total,
    };
  },

  /**
   * 获取所有日志（最新在前）
   */
  getAll(): FrontendLogEntry[] {
    const logs = getStoredLogs();
    return logs.sort((a, b) => b.timestamp - a.timestamp);
  },

  /**
   * 清空所有日志
   */
  clear(): void {
    saveLogs([]);
  },

  /**
   * 获取日志数量
   */
  count(): number {
    return getStoredLogs().length;
  },

  /**
   * 获取指定级别的日志数量
   */
  countByLevel(level: LogLevel): number {
    return getStoredLogs().filter((log) => log.level === level).length;
  },
};
