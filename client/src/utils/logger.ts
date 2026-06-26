/**
 * 简单前端 Logger
 *
 * 统一日志格式，生产环境可抑制 DEBUG 级别日志。
 * 不引入第三方依赖，基于 console 标准化输出。
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel =
  (import.meta.env.VITE_LOG_LEVEL as LogLevel) || "debug";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}

export function createLogger(module: string) {
  const prefix = `[${module}]`;

  return {
    debug: (msg: string, data?: unknown) => {
      if (!shouldLog("debug")) return;
      console.debug(prefix, msg, data ?? "");
    },

    info: (msg: string, data?: unknown) => {
      if (!shouldLog("info")) return;
      console.info(prefix, msg, data ?? "");
    },

    warn: (msg: string, data?: unknown) => {
      if (!shouldLog("warn")) return;
      console.warn(prefix, msg, data ?? "");
    },

    error: (msg: string, data?: unknown) => {
      if (!shouldLog("error")) return;
      console.error(prefix, msg, data ?? "");
    },
  };
}
