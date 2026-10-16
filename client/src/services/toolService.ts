import type { Tool } from "../types";
import type { SharedToolVisibilityEntry } from "@shared/types";
import { httpLegacy as http, setHttpTimeout } from "./httpClient";
import { handleClientError } from "../utils/handleError";
import { getOTelTracing } from "../monitoring/otel";
import { ENDPOINTS } from "./endpoints";

const TOOL_CALL_DEFAULT_TIMEOUT_MS = 30_000;

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import("@tauri-apps/api/core");
  } catch (e) {
    handleClientError(e, { module: "services:tool", action: "getTauriCore" });
    return null;
  }
}

async function tryTauri<T>(
  method: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const core = await getTauriCore();
  if (!core) return null;
  try {
    return await core.invoke<T>(method, args);
  } catch (e) {
    handleClientError(e, { module: "services:tool", action: "tryTauri" });
    return null;
  }
}

export interface ToolExecuteOptions {
  /** HTTP 超时时间（毫秒），默认 30s。视频生成建议 600000 */
  timeout?: number;
}

/** 三态覆写值；缺省（不在表中）= `auto`（跟随默认） */
export type ToolVisibilityOverrideValue = "auto" | "on" | "off";

/** 已归一化覆写表（只含 `on` / `off`） */
export type ToolVisibilityOverrides = Record<
  string,
  Exclude<ToolVisibilityOverrideValue, "auto">
>;

/** `GET /v1/settings/tools` 的响应（`{ namespace, value }`，与 `userService` 同形） */
interface ToolVisibilitySettingsResponse {
  namespace?: string;
  value?: { overrides?: Record<string, unknown> };
}

export const toolService = {
  list: (): Promise<Tool[]> => {
    return getOTelTracing().asyncWrap("services:tool:list", async () => {
      try {
        return await http.get<Tool[]>(ENDPOINTS.tools.base);
      } catch (e) {
        handleClientError(e, { module: "services:tool", action: "list" });
        const result = await tryTauri<Tool[]>("list_tools");
        if (result) return result;
        return [];
      }
    });
  },

  execute: (
    toolName: string,
    args: Record<string, unknown>,
    opts?: ToolExecuteOptions,
  ): Promise<unknown> => {
    return getOTelTracing().asyncWrap("services:tool:execute", async () => {
      const timeout = opts?.timeout ?? TOOL_CALL_DEFAULT_TIMEOUT_MS;
      const prevTimeout = setHttpTimeout(timeout);

      try {
        return await http.post<unknown>(ENDPOINTS.tools.execute(toolName), {
          arguments: args,
        });
      } catch (err) {
        // 提取真实错误信息，避免吞没后端返回的异常
        handleClientError(err, { module: "services:tool", action: "execute" });
        const errorMsg = err instanceof Error ? err.message : String(err);

        const result = await tryTauri<unknown>("execute_tool", {
          toolName,
          args,
        });
        if (result !== null) return result;

        return {
          success: false,
          error: `后端请求失败: ${errorMsg}`,
        };
      } finally {
        // 恢复原超时时间
        setHttpTimeout(prevTimeout);
      }
    });
  },

  /**
   * 工具**可见性报表**（P1，2026-10-16 工具治理）。
   *
   * 返回**全量**内置工具的可见性解释（`reasons` 说明"模型这轮为什么看不见它"）——
   * 与 `list()`（注册表全量）不同：后者只答"装了什么"，不含当轮裁剪结论。
   *
   * @param params.taskType 任务类型（缺省由后端取 `default`）
   * @param params.extraCategories 额外类别名（可重复；非法值由后端丢弃并告警）
   */
  visibility: (params?: {
    taskType?: string;
    extraCategories?: string[];
  }): Promise<SharedToolVisibilityEntry[]> => {
    return getOTelTracing().asyncWrap("services:tool:visibility", async () => {
      const query = new URLSearchParams();
      if (params?.taskType) query.set("taskType", params.taskType);
      for (const c of params?.extraCategories ?? []) {
        query.append("extraCategories", c);
      }
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      try {
        return await http.get<SharedToolVisibilityEntry[]>(
          `${ENDPOINTS.tools.visibility}${suffix}`,
        );
      } catch (e) {
        handleClientError(e, {
          module: "services:tool",
          action: "visibility",
        });
        return [];
      }
    });
  },

  /**
   * 读工具可见性覆写（`settings.tools`）—— 存储为 `{ overrides: { [toolName]: 'on' | 'off' } }`。
   *
   * 未配置 / 读取失败 ⇒ `{}`（= 全 `auto`，跟随默认）—— 与后端"读取侧归一化"同口径。
   */
  getVisibilityOverrides: (): Promise<ToolVisibilityOverrides> => {
    return getOTelTracing().asyncWrap(
      "services:tool:getVisibilityOverrides",
      async () => {
        try {
          const res = await http.get<ToolVisibilitySettingsResponse>(
            ENDPOINTS.settings.tools,
          );
          const raw = res?.value?.overrides ?? {};
          const out: ToolVisibilityOverrides = {};
          for (const [name, value] of Object.entries(raw)) {
            // 只接受 on / off（`auto` / 非法值 ⇒ 不入表 ⇒ 等于跟随默认）
            if (value === "on" || value === "off") out[name] = value;
          }
          return out;
        } catch (e) {
          handleClientError(e, {
            module: "services:tool",
            action: "getVisibilityOverrides",
          });
          return {};
        }
      },
    );
  },

  /** 写工具可见性覆写（`PUT /v1/settings/tools`；下一轮对话即生效，无需重启） */
  setVisibilityOverrides: (
    overrides: ToolVisibilityOverrides,
  ): Promise<boolean> => {
    return getOTelTracing().asyncWrap(
      "services:tool:setVisibilityOverrides",
      async () => {
        await http.put(ENDPOINTS.settings.tools, { overrides });
        return true;
      },
    );
  },
};
