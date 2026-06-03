import type { Tool } from "../types";
import { http } from "./httpClient";

const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

async function getTauriCore() {
  if (!isTauri) return null;
  try {
    return await import("@tauri-apps/api/core");
  } catch {
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
  } catch {
    return null;
  }
}

function createMemoryToolService() {
  return {
    list: async (): Promise<Tool[]> => [],
    execute: async (
      _toolName: string,
      _args: Record<string, unknown>,
    ): Promise<unknown> => {
      return "Fallback: tool execution unavailable";
    },
  };
}

export const toolService = {
  list: async (): Promise<Tool[]> => {
    try {
      return await http.get<Tool[]>("/v1/tools");
    } catch {
      const result = await tryTauri<Tool[]>("list_tools");
      if (result) return result;
      return createMemoryToolService().list();
    }
  },

  execute: async (
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    try {
      return await http.post<unknown>(`/v1/tools/${toolName}/execute`, {
        arguments: args,
      });
    } catch {
      const result = await tryTauri<unknown>("execute_tool", {
        toolName,
        args,
      });
      if (result !== null) return result;
      return createMemoryToolService().execute(toolName, args);
    }
  },
};
