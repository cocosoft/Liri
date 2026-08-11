import type { LogEntry } from "../../types";
import { createLogger } from "../../utils/logger";

/**
 * 内部调用断点日志的来源解析（LogViewer 徽章数据源）
 * 与组件解耦以便独立单元测试（react-refresh 要求组件文件仅导出组件）。
 */

const logger = createLogger("components:logViewer");

/** 内部调用断点日志的前缀（ChatManager/ChatOrchestrator 调试断点） */
const INTERNAL_BREAKPOINT_PREFIX = "[内部调用断点]";

/** 已记录过解析日志的日志 id（防列表渲染 + 详情弹窗对同一日志重复打印刷屏） */
const loggedBreakpointParseIds = new Set<string>();

/**
 * 从断点日志 details(JSON) 中提取 source 来源标识，非断点日志返回 null
 */
export function extractInternalSource(log: LogEntry): string | null {
  if (!log.message.startsWith(INTERNAL_BREAKPOINT_PREFIX)) return null;

  // 每个日志 id 只记录一次解析过程，避免重渲染/弹窗重复打印
  const alreadyLogged = loggedBreakpointParseIds.has(log.id);
  if (!alreadyLogged) loggedBreakpointParseIds.add(log.id);

  if (!log.details) {
    if (!alreadyLogged) {
      logger.info("[来源徽章] 断点日志缺少 details，无法解析 source", {
        id: log.id,
        message: log.message,
        module: log.module,
      });
    }
    return null;
  }

  let data: { source?: string } | null | undefined;
  try {
    data = JSON.parse(log.details) as { source?: string } | null;
  } catch (err) {
    if (!alreadyLogged) {
      logger.info("[来源徽章] details JSON 解析失败，回退 unknown", {
        id: log.id,
        error: err instanceof Error ? err.message : String(err),
        detailsPreview: log.details.slice(0, 200),
      });
      logger.debug("[来源徽章][debug] details JSON 解析失败堆栈", {
        id: log.id,
        stack: err instanceof Error ? err.stack : new Error(String(err)).stack,
        details: log.details,
      });
    }
    return "unknown";
  }

  // JSON 字面量（如 "null" / "123" / "true" / 数组）解析成功但非对象 → 无 source 可读，安全回退
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    if (!alreadyLogged) {
      logger.info("[来源徽章] details 解析结果非对象，回退 unknown", {
        id: log.id,
        details: log.details,
      });
      logger.debug("[来源徽章][debug] details 解析结果非对象调用栈", {
        id: log.id,
        stack: new Error().stack,
        details: log.details,
      });
    }
    return "unknown";
  }

  if (!data.source) {
    if (!alreadyLogged) {
      logger.info("[来源徽章] details 缺少 source 字段，回退 unknown", {
        id: log.id,
        details: log.details,
      });
      logger.debug("[来源徽章][debug] source 缺失回退 unknown 调用栈", {
        id: log.id,
        stack: new Error().stack,
        details: log.details,
      });
    }
    return "unknown";
  }

  if (!alreadyLogged) {
    logger.info("[来源徽章] 断点日志 source 解析成功", {
      id: log.id,
      source: data.source,
      module: log.module,
    });
  }
  return data.source;
}
