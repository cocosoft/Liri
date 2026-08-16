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

const STORAGE_KEY = "liri-frontend-logs";
const MAX_LOGS = 500;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getStoredLogs(): FrontendLogEntry[] {
  let data: string | null = null;
  try {
    data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed: unknown = JSON.parse(data);
    // 仅接受数组（null/对象/原始值视为损坏数据，避免遍历或 slice 崩溃）
    if (Array.isArray(parsed)) {
      return parsed as FrontendLogEntry[];
    }
    // 注：此处不可用 createLogger（logger.ts 依赖本模块，会循环依赖且无限递归），
    // 参照后端 Logger.ts 内部用 console 打印的先例
    // eslint-disable-next-line no-console
    console.info("[logStore] 前端日志存储数据损坏，返回空", {
      dataType: parsed === null ? "null" : typeof parsed,
      dataPreview: String(data).slice(0, 200),
    });
    return [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.info("[logStore] 前端日志存储 JSON 解析失败，返回空", {
      error: err instanceof Error ? err.message : String(err),
      dataPreview: data ? String(data).slice(0, 200) : String(data),
    });
    return [];
  }
}

function saveLogs(logs: FrontendLogEntry[]): void {
  try {
    // 限制日志数量
    const trimmed = logs.slice(-MAX_LOGS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    // 清除缓存（日志内容变化）
    _levelCountsCache = null;
  } catch {
    // localStorage 不可用，静默忽略
  }
}

// 级别计数缓存，避免每次 countByLevel 遍历全数组
let _levelCountsCache: Record<string, number> | null = null;

function getLevelCountsCache(): Record<string, number> {
  if (!_levelCountsCache) {
    const logs = getStoredLogs();
    _levelCountsCache = {};
    for (const log of logs) {
      _levelCountsCache[log.level] = (_levelCountsCache[log.level] || 0) + 1;
    }
  }
  return _levelCountsCache;
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
   * 获取指定级别的日志数量（O(1) 缓存，首次或写操作后重建）
   */
  countByLevel(level: LogLevel): number {
    return getLevelCountsCache()[level] || 0;
  },
};
