// canvas-editor/utils/logger.ts — CanvasLogger（debug/warn/error + performance 帧耗时追踪）

type LogLevel = "debug" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: number;
  extra?: Record<string, unknown>;
}

const MAX_ENTRIES = 200;
const ring: LogEntry[] = [];

function log(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
  const entry: LogEntry = { level, msg, ts: Date.now(), extra };
  ring.push(entry);
  if (ring.length > MAX_ENTRIES) ring.shift();

  const prefix = `[Canvas:${level.toUpperCase()}]`;
  const style =
    level === "error"
      ? "color:red"
      : level === "warn"
        ? "color:orange"
        : "color:gray";
  const extraStr = extra ? " " + JSON.stringify(extra) : "";
  console.log(`%c${prefix}%c ${msg}${extraStr}`, style, "");
  if (level === "error" && extra?.error instanceof Error)
    console.error(extra.error);
}

export const CanvasLogger = {
  debug: (msg: string, extra?: Record<string, unknown>) =>
    log("debug", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) =>
    log("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) =>
    log("error", msg, extra),

  /** 帧耗时追踪 — 使用 performance.mark/measure */
  mark(label: string) {
    performance.mark(`canvas:${label}`);
  },
  measure(name: string, start: string, end: string) {
    try {
      performance.measure(`canvas:${name}`, `canvas:${start}`, `canvas:${end}`);
    } catch {
      /* 静默 */
    }
  },
  /** 获取最近 N 条日志 */
  getRecent(n = 20): ReadonlyArray<LogEntry> {
    return ring.slice(-n);
  },
  /** 清空日志环 */
  clear() {
    ring.length = 0;
  },
};
