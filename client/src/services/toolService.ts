import type { Tool } from "../types";
import { httpLegacy as http, setHttpTimeout } from "./httpClient";
import { handleClientError } from "../utils/handleError";
import { getOTelTracing } from "../monitoring/otel";

const DEFAULT_TIMEOUT = 30_000;

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

export const toolService = {
  list: (): Promise<Tool[]> => {
    return getOTelTracing().asyncWrap("services:tool:list", async () => {
      try {
        return await http.get<Tool[]>("/v1/tools");
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
      const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
      const prevTimeout = setHttpTimeout(timeout);

      try {
        return await http.post<unknown>(`/v1/tools/${toolName}/execute`, {
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
};
