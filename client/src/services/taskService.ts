import { httpLegacy as http } from "./httpClient";

export interface TaskItem {
  id: string;
  description: string;
  status: string; // pending | running | completed | failed | killed | lost
  type: string;
  startTime: number;
  endTime?: number;
  error?: string;
  toolUseCount: number;
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

export interface TaskListResponse {
  tasks: TaskItem[];
  count: number;
}

export const taskService = {
  list: async (): Promise<TaskItem[]> => {
    const res = await http.get<TaskListResponse>("/v1/tasks");
    return res.tasks || [];
  },

  cancel: async (taskId: string): Promise<void> => {
    return http.post<void>(`/v1/tasks/${taskId}/cancel`);
  },

  remove: async (taskId: string): Promise<void> => {
    return http.delete<void>(`/v1/tasks/${taskId}`);
  },
};
