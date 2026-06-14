import type { AgentTask } from "../types";
import { http } from "./httpClient";

const isTauri = typeof window !== "undefined" && ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

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

function createMemoryAgentService() {
  return {
    listTasks: async (): Promise<AgentTask[]> => [],
    executeTask: async (
      name: string,
      _params?: Record<string, unknown>,
    ): Promise<AgentTask> => ({
      id: `local-${Date.now()}`,
      name,
      status: "completed",
      result: "Agent execution unavailable",
      created_at: Date.now(),
    }),
    cancelTask: async (_id: string): Promise<void> => {},
  };
}

export interface AgentProgress {
  agentId: string;
  state: string;
  progress: number;
  message: string;
}

export interface AgentTaskCreateParams {
  name: string;
  description?: string;
  prompt?: string;
  priority?: "high" | "medium" | "low";
  subagentType?: string;
  runInBackground?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentTaskUpdateParams {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export type AgentTaskCreateParamsRecord = Record<string, unknown> &
  AgentTaskCreateParams;

export const agentService = {
  listTasks: async (): Promise<AgentTask[]> => {
    try {
      return await http.get<AgentTask[]>("/v1/agents/tasks");
    } catch {
      const result = await tryTauri<AgentTask[]>("list_agent_tasks");
      if (result) return result;
      return createMemoryAgentService().listTasks();
    }
  },

  getTask: async (id: string): Promise<AgentProgress> => {
    try {
      return await http.get<AgentProgress>(`/v1/agents/tasks/${id}`);
    } catch {
      const result = await tryTauri<AgentProgress>("get_agent_progress", {
        id,
      });
      if (result) return result;
      return { agentId: id, state: "unknown", progress: 0, message: "" };
    }
  },

  getTaskLogs: async (id: string): Promise<string[]> => {
    try {
      return await http.get<string[]>(`/v1/agents/tasks/${id}/logs`);
    } catch {
      const result = await tryTauri<string[]>("get_agent_task_logs", { id });
      if (result) return result;
      return [];
    }
  },

  createTask: async (params: AgentTaskCreateParams): Promise<AgentTask> => {
    try {
      return await http.post<AgentTask>(
        "/v1/agents/tasks",
        params as unknown as Record<string, unknown>,
      );
    } catch {
      const result = await tryTauri<AgentTask>(
        "create_agent_task",
        params as unknown as Record<string, unknown>,
      );
      if (result) return result;
      const task: AgentTask = {
        id: `local-${Date.now()}`,
        name: params.name,
        status: "pending",
        created_at: Date.now(),
      };
      if (params.description) {
        task.description = params.description;
      }
      return task;
    }
  },

  executeTask: async (
    name: string,
    params?: Record<string, unknown>,
  ): Promise<AgentTask> => {
    try {
      return await http.post<AgentTask>("/v1/agents/tasks/execute", {
        name,
        ...params,
      });
    } catch {
      const result = await tryTauri<AgentTask>("execute_agent_task", {
        name,
        params,
      });
      if (result) return result;
      return createMemoryAgentService().executeTask(name, params);
    }
  },

  updateTask: async (
    id: string,
    params: AgentTaskUpdateParams,
  ): Promise<AgentTask> => {
    try {
      return await http.put<AgentTask>(`/v1/agents/tasks/${id}`, params);
    } catch {
      const result = await tryTauri<AgentTask>("update_agent_task", {
        id,
        ...params,
      });
      if (result) return result;
      const tasks = await agentService.listTasks();
      const task = tasks.find((t) => t.id === id);
      return task ? { ...task, ...params } : task!;
    }
  },

  deleteTask: async (id: string): Promise<void> => {
    try {
      await http.delete<void>(`/v1/agents/tasks/${id}`);
    } catch {
      const result = await tryTauri<void>("delete_agent_task", { id });
      if (result !== null) return;
    }
  },

  cancelTask: async (id: string): Promise<void> => {
    try {
      await http.post<void>(`/v1/agents/tasks/${id}/cancel`);
    } catch {
      const result = await tryTauri<void>("cancel_agent_task", { id });
      if (result !== null) return;
      return createMemoryAgentService().cancelTask(id);
    }
  },

  listTaskHistory: async (): Promise<AgentTask[]> => {
    try {
      return await http.get<AgentTask[]>("/v1/agents/tasks/history");
    } catch {
      const result = await tryTauri<AgentTask[]>("list_agent_task_history");
      if (result) return result;
      return [];
    }
  },

  /** 获取任务审计日志 */
  getTaskAuditLogs: async (taskId: string): Promise<Array<{
    taskId: string;
    eventType: string;
    oldStatus: string | null;
    newStatus: string;
    timestamp: number;
  }>> => {
    try {
      return await http.get(`/v1/agents/tasks/${taskId}/audit`);
    } catch {
      const result = await tryTauri("get_task_audit_logs", { taskId });
      if (result) return result as any[];
      return [];
    }
  },

  /** 恢复 LOST 任务 */
  recoverTask: async (taskId: string): Promise<AgentTask> => {
    try {
      return await http.post(`/v1/agents/tasks/${taskId}/recover`);
    } catch {
      const result = await tryTauri<AgentTask>("recover_agent_task", { taskId });
      if (result) return result;
      throw new Error("无法恢复任务");
    }
  },

  /** 获取任务状态（后端 TaskState） */
  getTaskState: async (taskId: string): Promise<{
    id: string;
    type: string;
    status: string;
    description: string;
    startTime: number;
    endTime?: number;
    toolUseCount: number;
    tokenCount: number;
    outputFile: string;
    error?: string;
  } | null> => {
    try {
      return await http.get(`/v1/agents/tasks/${taskId}/state`);
    } catch {
      const result = await tryTauri("get_task_state", { taskId });
      return (result as any) || null;
    }
  },

  /** 获取任务输出内容 */
  getTaskOutput: async (taskId: string): Promise<string> => {
    try {
      return await http.get<string>(`/v1/agents/tasks/${taskId}/output`);
    } catch {
      const result = await tryTauri<string>("get_task_output", { taskId });
      return result || "";
    }
  },

  /** 向 Agent 任务发送对话消息 */
  sendChatMessage: async (taskId: string, message: string): Promise<string> => {
    try {
      return await http.post<string>(`/v1/agents/tasks/${taskId}/chat`, { message });
    } catch {
      const result = await tryTauri<string>("agent_task_chat", { taskId, message });
      return result || "";
    }
  },
};
