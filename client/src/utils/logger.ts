/**
 * 前端 Logger
 *
 * 统一日志格式，生产环境可抑制 DEBUG 级别日志。
 * 日志同时输出到 console 和 localStorage（持久化）。
 */

import { logStore } from "./logStore";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel =
  (import.meta.env.VITE_LOG_LEVEL as LogLevel) ||
  (import.meta.env.PROD ? "warn" : "info");

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}

export function createLogger(module: string) {
  const prefix = `[${module}]`;

  return {
    debug: (msg: string, data?: unknown) => {
      if (!shouldLog("debug")) return;
      console.debug(prefix, msg, data ?? "");
      logStore.add("debug", module, msg, data);
    },

    info: (msg: string, data?: unknown) => {
      if (!shouldLog("info")) return;
      console.info(prefix, msg, data ?? "");
      logStore.add("info", module, msg, data);
    },

    warn: (msg: string, data?: unknown) => {
      if (!shouldLog("warn")) return;
      console.warn(prefix, msg, data ?? "");
      logStore.add("warn", module, msg, data);
    },

    error: (msg: string, data?: unknown) => {
      if (!shouldLog("error")) return;
      console.error(prefix, msg, data ?? "");
      logStore.add("error", module, msg, data);
    },
  };
}
